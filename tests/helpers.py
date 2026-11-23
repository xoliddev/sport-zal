"""Shared helpers: the seeded gym in a database, a clock the tests can move, and the people of the story."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from functools import cache
from pathlib import Path

from sportzal.core import seedgen
from sportzal.core.clock import at_local, local_day
from sportzal.db import Database
from sportzal.service import Service

ROOT = Path(__file__).resolve().parent.parent
NOW = 1_795_000_000_000  # Wednesday 2026-11-18, 16:06 in Tashkent (the same moment as the shared vectors)
TODAY = local_day(NOW)
MORNING = at_local(TODAY, 9 * 60 + 20)
DAY = 86_400_000
# Seeded people have negative ids (nobody can sign in as them); the tests make them positive so they can also use
# the Mini App and the panel like real people.
OWNER, ADMIN, MALIKA, SHERZOD = 1, 2, 11, 12
AZIZ = 100_001  # member card 1, the story's hero
STRANGER = 7777
SECRET = b"test-only-qr-secret-0123456789ab"


def load(name: str):
    with open(ROOT / "shared" / "data" / f"{name}.json", encoding="utf-8") as fh:
        return json.load(fh)


@cache
def _world(today: int, minute: int) -> str:
    w = seedgen.world(load("names"), load("plans"), load("schedule"), load("gym"), today, minute)
    for m in w["members"]:
        m["user_id"] = abs(m["user_id"])
    for s in w["staff"]:
        s["user_id"] = abs(s["user_id"])
    for s in w["slots"]:
        s["trainer"] = abs(s["trainer"])
    return json.dumps(w)


def world(now: int) -> dict:
    return json.loads(_world(local_day(now), (now - at_local(local_day(now), 0)) // 60_000))


class Clock:
    def __init__(self, start: int = MORNING) -> None:
        self.now = start

    def __call__(self) -> int:
        return self.now

    def skip(self, minutes: float = 0, days: float = 0) -> None:
        self.now += int((minutes * 60 + days * 86_400) * 1000)

    def at(self, day: int, minute: int) -> None:
        self.now = at_local(day, minute)


@asynccontextmanager
async def service_env(clock: Clock | None = None, path: str = ":memory:", seed: bool = True):
    clock = clock or Clock()
    db = await Database.open(path)
    svc = Service(db, clock=clock, qr_secret=SECRET)
    if seed:
        await svc.seed(world(clock.now))
    else:
        async with db.tx() as c:
            await svc.sync_classes(c)
    for uid in (STRANGER, 5555):
        await svc.touch_user(uid, "Test", "uz")
    try:
        yield svc, clock
    finally:
        await db.close()


async def member_no(svc: Service, uid: int) -> int:
    return (await svc.db.one("SELECT no FROM members WHERE user_id = ?", (uid,)))["no"]


async def scan_now(svc: Service, uid: int, desk: int = ADMIN) -> dict:
    """The member shows the QR, the desk scans it."""
    qr = await svc.qr(uid)
    res, _ = await svc.scan(desk, {"token": qr["token"]})
    return res
