"""The service's foundation: the clock, the shared data, people and their roles, and the few queries every rule
needs (a member's abonements and freezes, plans and classes in the core's shape). Memberships, check-in, classes, the
desk, the scheduler's tick, sign-in and seeding live in their own modules and are mixed into ``Service``."""

from __future__ import annotations

import json
import secrets
import time
from collections.abc import Callable
from pathlib import Path

from .common import Refused
from .core import plans as planlib
from .core.clock import local_day, local_minute
from .core.text import InputError, clean
from .db import Database

DATA = Path(__file__).resolve().parent.parent / "shared" / "data"
STAFF = ("owner", "admin", "trainer")


def load(name: str):
    with open(DATA / f"{name}.json", encoding="utf-8") as fh:
        return json.load(fh)


def checked(fn, *args):
    """Run a core validator; its InputError becomes a Refused with the same code."""
    try:
        return fn(*args)
    except InputError as err:
        raise Refused(err.code) from err


def is_id(value: object, top: int = 10**9) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 < value < top


def abon_row(r: dict) -> dict:
    """A database row in the core's shape."""
    return {"id": r["id"], "member": r["member"], "plan": r["plan"], "price": r["price"], "paid": r["paid"],
            "sold_day": r["sold_day"], "start_day": r["start_day"], "end_day": r["end_day"], "visits_left": r["visits_left"],
            "window": [r["win_from"], r["win_to"]] if r["win_from"] is not None else None, "freeze_left": r["freeze_left"]}


class Base:
    def __init__(self, db: Database, clock: Callable[[], int] | None = None, qr_secret: bytes = b"") -> None:
        self.db = db
        self.clock = clock or (lambda: int(time.time() * 1000))
        self.qr_secret = qr_secret or secrets.token_bytes(32)
        self.gym, self.schedule, self.names = load("gym"), load("schedule"), load("names")
        self.kinds = self.schedule["kinds"]

    def now(self) -> int:
        return self.clock()

    def today(self) -> int:
        return local_day(self.now())

    def minute(self) -> int:
        return local_minute(self.now())

    # ── people ──
    async def touch_user(self, uid: int, name: str, lang_code: str | None) -> dict:
        """Register a Telegram user on first contact; everyone who is not staff also gets a member card."""
        row = await self.db.one("SELECT * FROM users WHERE id = ?", (uid,))
        if row is None:
            lang = "ru" if (lang_code or "")[:2].lower() == "ru" else "uz"
            async with self.db.tx() as c:
                await c.execute("INSERT OR IGNORE INTO users (id, name, lang, created_at) VALUES (?, ?, ?, ?)",
                                (uid, clean(name, 64) or "Mijoz", lang, self.now()))
                if not await self.q1(c, "SELECT 1 FROM staff WHERE user_id = ?", (uid,)):
                    await c.execute("INSERT OR IGNORE INTO members (user_id, name, joined_day) VALUES (?, ?, ?)",
                                    (uid, clean(name, 64) or "Mijoz", self.today()))
            row = await self.db.one("SELECT * FROM users WHERE id = ?", (uid,))
            async with self.db.tx() as c:  # desk staff from the settings get their Telegram name (trainers keep the schedule's)
                await c.execute("UPDATE staff SET name = ? WHERE user_id = ? AND trainer IS NULL", (row["name"], uid))
        return row

    async def user(self, uid: int) -> dict | None:
        return await self.db.one("SELECT * FROM users WHERE id = ?", (uid,))

    async def set_lang(self, uid: int, lang: object) -> str:
        if lang not in ("uz", "ru"):
            raise Refused("generic")
        async with self.db.tx() as c:
            await c.execute("UPDATE users SET lang = ? WHERE id = ?", (lang, uid))
        return lang

    async def register_staff(self, owners: frozenset[int], admins: frozenset[int], trainers: dict[str, int]) -> None:
        """Staff from the settings (OWNER_IDS, ADMIN_IDS, TRAINERS). The owner wins if an id is in both lists."""
        names = {t["key"]: t["name"] for t in self.schedule["trainers"]}
        async with self.db.tx() as c:
            for key, uid in trainers.items():
                if key in names:
                    await c.execute("DELETE FROM staff WHERE trainer = ? AND user_id <> ?", (key, uid))
                    await c.execute("INSERT OR REPLACE INTO staff (user_id, role, name, trainer) VALUES (?, 'trainer', ?, ?)",
                                    (uid, names[key], key))
            for role, ids in (("admin", admins), ("owner", owners)):
                for uid in ids:
                    await c.execute("INSERT OR REPLACE INTO staff (user_id, role, name, trainer) VALUES (?, ?, ?, NULL)",
                                    (uid, role, "Administrator" if role == "admin" else "Egasi"))
                    await c.execute("UPDATE staff SET name = (SELECT name FROM users WHERE id = ?) WHERE user_id = ? "
                                    "AND EXISTS (SELECT 1 FROM users WHERE id = ?)", (uid, uid, uid))
            await self.sync_classes(c)

    async def role(self, uid: int) -> dict:
        """``{"role", "no", "trainer", "name"}``: owner, admin, trainer or member (with the member card number)."""
        st = await self.db.one("SELECT * FROM staff WHERE user_id = ?", (uid,))
        if st:
            return {"role": st["role"], "no": None, "trainer": st["trainer"], "name": st["name"], "uid": uid}
        m = await self.db.one("SELECT no, name FROM members WHERE user_id = ?", (uid,))
        if m is None:
            raise Refused("auth")
        return {"role": "member", "no": m["no"], "trainer": None, "name": m["name"], "uid": uid}

    async def need(self, uid: int, *roles: str) -> dict:
        who = await self.role(uid)
        if who["role"] not in roles:
            raise Refused("forbidden")
        return who

    async def me(self, uid: int) -> dict:
        who = await self.role(uid)
        u = await self.user(uid)
        return {**who, "lang": (u or {}).get("lang", "uz"), "gym": self.gym["name"], "today": self.today(), "now": self.now()}

    # ── shared queries ──
    @staticmethod
    async def q1(c, sql: str, args: tuple = ()) -> dict | None:
        async with c.execute(sql, args) as cur:
            row = await cur.fetchone()
        return dict(row) if row else None

    @staticmethod
    async def qa(c, sql: str, args: tuple = ()) -> list[dict]:
        async with c.execute(sql, args) as cur:
            return [dict(r) for r in await cur.fetchall()]

    async def plans(self, c=None) -> list[dict]:
        rows = await self.qa(c or self.db.conn, "SELECT * FROM plans ORDER BY pos")
        return [{"id": r["id"], "uz": r["name_uz"], "ru": r["name_ru"], "price": r["price"], "days": r["days"], "visits": r["visits"],
                 "window": [r["win_from"], r["win_to"]] if r["win_from"] is not None else None, "freeze": r["freeze"]} for r in rows]

    async def classes(self, c=None) -> list[dict]:
        rows = await self.qa(c or self.db.conn, "SELECT * FROM classes ORDER BY start, id")
        return [{"id": r["id"], "kind": r["kind"], "trainer": r["trainer"], "days": json.loads(r["days"]), "start": r["start"],
                 "dur": r["dur"], "cap": r["cap"]} for r in rows]

    async def sync_classes(self, c) -> None:
        """Plans (prices the owner changed are kept) and the weekly schedule from shared/data, with trainers' ids."""
        for pos, p in enumerate(load("plans")):
            w = p["window"] or [None, None]
            await c.execute("INSERT OR IGNORE INTO plans (id, pos, name_uz, name_ru, price, days, visits, win_from, win_to, freeze) "
                            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            (p["id"], pos, p["uz"], p["ru"], p["price"], p["days"], p["visits"], w[0], w[1], p["freeze"]))
        ids = {r["trainer"]: r["user_id"] for r in await self.qa(c, "SELECT trainer, user_id FROM staff WHERE trainer IS NOT NULL")}
        for i, t in enumerate(self.schedule["trainers"]):
            ids.setdefault(t["key"], -(11 + i))
        for k in self.schedule["classes"]:
            await c.execute("INSERT OR REPLACE INTO classes (id, kind, trainer, days, start, dur, cap) VALUES (?, ?, ?, ?, ?, ?, ?)",
                            (k["id"], k["kind"], ids[k["trainer"]], json.dumps(k["days"]), k["start"], k["dur"], k["cap"]))

    async def abons(self, c, no: int) -> list[dict]:
        return [abon_row(r) for r in await self.qa(c, "SELECT * FROM abonements WHERE member = ? ORDER BY id", (no,))]

    async def freezes(self, c, abon_id: int) -> list[dict]:
        return await self.qa(c, "SELECT from_day, days FROM freezes WHERE abon = ? ORDER BY from_day", (abon_id,))

    async def current(self, c, no: int) -> tuple[dict | None, list[dict], list[dict]]:
        """The member's current abonement (core.plans.pick), its freezes, and all their abonements."""
        all_ = await self.abons(c, no)
        ab = planlib.pick(all_, self.today())
        return ab, (await self.freezes(c, ab["id"]) if ab else []), all_

    async def member(self, c, no: object) -> dict:
        if not is_id(no):
            raise Refused("not_found")
        m = await self.q1(c, "SELECT * FROM members WHERE no = ?", (no,))
        if m is None:
            raise Refused("not_found")
        return m

    def plan_name(self, plans: list[dict], pid: str, lang: str) -> str:
        p = next((x for x in plans if x["id"] == pid), None)
        return (p["ru"] if lang == "ru" else p["uz"]) if p else pid
