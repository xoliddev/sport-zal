"""Two desks (two connections to one database file, as two processes would have) scanning at the same moment: a QR
step is accepted once, the last visit is taken once, the last place in a class goes to one member, a personal-training
slot to one member."""

from __future__ import annotations

import asyncio

from sportzal.db import Database
from sportzal.service import Service

from .helpers import ADMIN, AZIZ, OWNER, SECRET, TODAY, Clock, member_no, service_env


async def two_desks(tmp_path):
    clock = Clock()
    path = str(tmp_path / "zal.db")
    async with service_env(clock, path) as (svc, _):
        other = Service(await Database.open(path), clock=clock, qr_secret=SECRET)
        try:
            yield svc, other, clock
        finally:
            await other.db.close()


async def test_the_same_qr_scanned_on_two_desks_at_once(tmp_path):
    async for svc, other, _ in two_desks(tmp_path):
        aziz = await member_no(svc, AZIZ)
        await svc.sell(ADMIN, {"member": aziz, "plan": "t12", "paid": "cash"})
        qr = await svc.qr(AZIZ)
        tries = [desk.scan(ADMIN if k % 2 else OWNER, {"token": qr["token"]} if k % 3 else {"code": qr["code"]})
                 for k in range(10) for desk in (svc, other)]
        results = [r for r, _ in await asyncio.gather(*tries)]
        assert [r["code"] for r in results].count("ok") == 1
        assert all(r["code"] == "bad" for r in results if r["code"] != "ok")
        row = await other.db.one("SELECT visits_left FROM abonements WHERE member = ?", (aziz,))
        assert row["visits_left"] == 11
        n = await svc.db.one("SELECT COUNT(*) AS n FROM visits WHERE member = ?", (aziz,))
        assert n["n"] == 1


async def test_the_last_visit_is_taken_once(tmp_path):
    async for svc, other, clock in two_desks(tmp_path):
        aziz = await member_no(svc, AZIZ)
        await svc.sell(ADMIN, {"member": aziz, "plan": "t12", "paid": "cash"})
        await svc.db.conn.execute("UPDATE abonements SET visits_left = 1 WHERE member = ?", (aziz,))
        a = await svc.qr(AZIZ)
        clock.skip(minutes=0.5)
        b = await svc.qr(AZIZ)  # two different, both still fresh codes
        results = [r for r, _ in await asyncio.gather(svc.scan(ADMIN, {"token": a["token"]}), other.scan(ADMIN, {"token": b["token"]}),
                                                       other.scan(OWNER, {"token": a["token"]}), svc.scan(OWNER, {"token": b["token"]}))]
        codes = sorted(r["code"] for r in results)
        assert codes.count("ok") == 1 and set(codes) <= {"ok", "bad", "exit"}  # a newer step after the entry is the exit scan
        row = await svc.db.one("SELECT visits_left FROM abonements WHERE member = ?", (aziz,))
        assert row["visits_left"] == 0


async def test_the_last_place_in_a_class_and_a_slot(tmp_path):
    async for svc, other, _ in two_desks(tmp_path):
        rows = await svc.db.all("SELECT m.user_id FROM members m JOIN abonements a ON a.member = m.no WHERE a.plan IN ('m1', 'm3') "
                                "AND a.start_day <= ? AND a.end_day >= ? AND m.no NOT IN (SELECT member FROM bookings WHERE day = ?) "
                                "ORDER BY m.no LIMIT 6", (TODAY + 1, TODAY + 1, TODAY + 1))
        people = [r["user_id"] for r in rows]
        k = next(c for c in await svc.classes() if (TODAY + 4) % 7 in c["days"] and c["start"] >= 17 * 60)  # tomorrow evening
        session = {"class": k["id"], "day": TODAY + 1}
        taken = await svc.db.one("SELECT COUNT(*) AS n FROM bookings WHERE class = ? AND day = ? AND status = 'booked'", (k["id"], TODAY + 1))
        free = k["cap"] - taken["n"]
        await svc.db.conn.execute("UPDATE classes SET cap = ? WHERE id = ?", (taken["n"] + 1, k["id"]))
        results = [v for v, _ in await asyncio.gather(*[(svc if i % 2 else other).book(uid, session) for i, uid in enumerate(people)])]
        assert free >= 1 and [v["me"] for v in results].count("booked") == 1
        waits = sorted(v["pos"] for v in results if v["me"] == "wait")
        assert waits == list(range(1, len(people)))
        slot = await svc.db.one("SELECT id FROM slots WHERE member IS NULL ORDER BY day, start LIMIT 1")
        outs = await asyncio.gather(*[(svc if i % 2 else other).take_slot(uid, slot["id"]) for i, uid in enumerate(people)], return_exceptions=True)
        assert sum(not isinstance(o, Exception) for o in outs) == 1
        assert all(getattr(o, "code", "") == "slot_taken" for o in outs if isinstance(o, Exception))
