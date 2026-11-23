"""SQLite storage (aiosqlite, WAL). Parameterised SQL only. Times are UTC milliseconds, days Tashkent day numbers,
minutes minutes of the Tashkent day, money whole so'm.

The rules that must never break are in the schema too, so even a bug in the service cannot break them: visits left
never go below zero, a member has at most one open visit, a member books a session once, a personal-training slot is
taken by one member, prices are whole thousands, a reminder key and a login token exist once."""

from __future__ import annotations

import asyncio
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'uz' CHECK (lang IN ('uz', 'ru')), created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS staff (
  user_id INTEGER PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'trainer')), name TEXT NOT NULL, trainer TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS members (
  no INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE, name TEXT NOT NULL, joined_day INTEGER NOT NULL,
  last_step INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY, pos INTEGER NOT NULL, name_uz TEXT NOT NULL, name_ru TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price BETWEEN 1000 AND 50000000 AND price % 1000 = 0), days INTEGER NOT NULL CHECK (days BETWEEN 1 AND 400),
  visits INTEGER CHECK (visits IS NULL OR visits BETWEEN 1 AND 500), win_from INTEGER, win_to INTEGER,
  freeze INTEGER NOT NULL CHECK (freeze BETWEEN 0 AND 90), CHECK ((win_from IS NULL) = (win_to IS NULL))
);
CREATE TABLE IF NOT EXISTS price_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, plan TEXT NOT NULL, old INTEGER NOT NULL, new INTEGER NOT NULL, by INTEGER NOT NULL, at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS abonements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, member INTEGER NOT NULL REFERENCES members(no), plan TEXT NOT NULL REFERENCES plans(id),
  price INTEGER NOT NULL CHECK (price >= 0), paid TEXT NOT NULL CHECK (paid IN ('cash', 'card')), sold_by INTEGER NOT NULL,
  sold_day INTEGER NOT NULL, sold_at INTEGER NOT NULL, start_day INTEGER NOT NULL, end_day INTEGER NOT NULL,
  visits_left INTEGER CHECK (visits_left IS NULL OR visits_left >= 0), win_from INTEGER, win_to INTEGER,
  freeze_left INTEGER NOT NULL CHECK (freeze_left >= 0), CHECK (end_day >= start_day)
);
CREATE INDEX IF NOT EXISTS abon_member ON abonements(member, end_day);
CREATE INDEX IF NOT EXISTS abon_sold ON abonements(sold_day);
CREATE TABLE IF NOT EXISTS freezes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, abon INTEGER NOT NULL REFERENCES abonements(id), from_day INTEGER NOT NULL,
  days INTEGER NOT NULL CHECK (days BETWEEN 1 AND 90), by INTEGER NOT NULL, at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS freezes_abon ON freezes(abon);
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT, member INTEGER NOT NULL REFERENCES members(no), abon INTEGER REFERENCES abonements(id),
  in_at INTEGER NOT NULL, out_at INTEGER, auto INTEGER NOT NULL DEFAULT 0 CHECK (auto IN (0, 1)), by INTEGER,
  CHECK (out_at IS NULL OR out_at >= in_at)
);
CREATE INDEX IF NOT EXISTS visits_in ON visits(in_at);
CREATE UNIQUE INDEX IF NOT EXISTS visits_open ON visits(member) WHERE out_at IS NULL;
CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, trainer INTEGER NOT NULL, days TEXT NOT NULL, start INTEGER NOT NULL,
  dur INTEGER NOT NULL, cap INTEGER NOT NULL CHECK (cap BETWEEN 1 AND 100)
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, class TEXT NOT NULL REFERENCES classes(id), day INTEGER NOT NULL,
  member INTEGER NOT NULL REFERENCES members(no), at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('booked', 'wait', 'cancelled', 'attended', 'missed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS bookings_one ON bookings(class, day, member) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS bookings_session ON bookings(class, day, status);
CREATE INDEX IF NOT EXISTS bookings_member ON bookings(member, day);
CREATE TABLE IF NOT EXISTS slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, trainer INTEGER NOT NULL, day INTEGER NOT NULL, start INTEGER NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0), member INTEGER REFERENCES members(no), booked_at INTEGER, UNIQUE (trainer, day, start)
);
CREATE TABLE IF NOT EXISTS sent (key TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS logins (
  hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0, 1))
);
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL, created_at INTEGER NOT NULL
);
"""


class Database:
    def __init__(self, conn: aiosqlite.Connection) -> None:
        self.conn = conn
        self.lock = asyncio.Lock()  # one transaction at a time on this connection

    @classmethod
    async def open(cls, path: str) -> Database:
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        conn = await aiosqlite.connect(path, isolation_level=None)  # we issue BEGIN/COMMIT ourselves
        conn.row_factory = aiosqlite.Row
        await conn.execute("PRAGMA journal_mode=WAL")
        await conn.execute("PRAGMA synchronous=NORMAL")
        await conn.execute("PRAGMA busy_timeout=5000")
        await conn.execute("PRAGMA foreign_keys=ON")
        await conn.executescript(SCHEMA)
        return cls(conn)

    async def close(self) -> None:
        await self.conn.close()

    @asynccontextmanager
    async def tx(self):
        """``BEGIN IMMEDIATE`` takes the write lock up front, so check-then-write sequences (a QR step used once, the
        last visit, the last place in a class, one member per slot) cannot interleave, neither between coroutines nor
        between processes."""
        async with self.lock:
            for attempt in range(6):
                try:
                    await self.conn.execute("BEGIN IMMEDIATE")
                    break
                except sqlite3.OperationalError as err:
                    if "locked" not in str(err) or attempt == 5:
                        raise
                    await asyncio.sleep(0.05 * (attempt + 1))
            try:
                yield self.conn
            except BaseException:
                await self.conn.execute("ROLLBACK")
                raise
            await self.conn.execute("COMMIT")

    async def one(self, sql: str, args: tuple = ()) -> dict | None:
        async with self.conn.execute(sql, args) as cur:
            row = await cur.fetchone()
        return dict(row) if row else None

    async def all(self, sql: str, args: tuple = ()) -> list[dict]:
        async with self.conn.execute(sql, args) as cur:
            return [dict(r) for r in await cur.fetchall()]
