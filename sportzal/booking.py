"""Group classes and personal training: the week's schedule with places and the waitlist, booking (a free place or the
next waitlist number, inside ``BEGIN IMMEDIATE``), cancelling up to 2 hours before (the first on the waitlist is moved
up and told by the bot), the trainer's lists and attendance, and personal-training slots (one member per slot, taken
with a conditional UPDATE)."""

from __future__ import annotations

from .base import checked, is_id
from .common import Refused
from .core import classes as cl
from .core import plans as planlib
from .core.text import InputError

TAKEN = ("booked", "attended", "missed")


class Booking:
    async def _trainer_names(self) -> dict[int, str]:
        return {r["user_id"]: r["name"] for r in await self.db.all("SELECT user_id, name FROM staff WHERE role = 'trainer'")}

    async def _counts(self, c, first: int, last: int) -> dict[tuple[str, int], dict]:
        rows = await self.qa(c, "SELECT class, day, status, COUNT(*) AS n FROM bookings WHERE day BETWEEN ? AND ? AND status <> 'cancelled' "
                                "GROUP BY class, day, status", (first, last))
        out: dict[tuple[str, int], dict] = {}
        for r in rows:
            k = out.setdefault((r["class"], r["day"]), {"taken": 0, "wait": 0})
            k["taken" if r["status"] in TAKEN else "wait"] += r["n"]
        return out

    def _view(self, k: dict, day: int, counts: dict, names: dict, mine: dict | None = None) -> dict:
        n = counts.get((k["id"], day), {"taken": 0, "wait": 0})
        start = cl.starts(k, day)
        now = self.now()
        out = {"class": k["id"], "kind": k["kind"], "trainer": names.get(k["trainer"], ""), "day": day, "start": k["start"], "dur": k["dur"],
               "cap": k["cap"], "taken": n["taken"], "wait": n["wait"], "fill": cl.fill(n["taken"], k["cap"]), "past": start <= now,
               "me": None, "pos": None, "can_cancel": now <= start - cl.CANCEL_BEFORE_MS}
        if mine:
            out["me"], out["pos"] = mine["status"], mine.get("pos")
        return out

    async def _mine(self, c, no: int, first: int, last: int) -> dict[tuple[str, int], dict]:
        rows = await self.qa(c, "SELECT id, class, day, status FROM bookings WHERE member = ? AND day BETWEEN ? AND ? AND status <> 'cancelled'",
                             (no, first, last))
        out = {}
        for r in rows:
            if r["status"] == "wait":
                ahead = await self.q1(c, "SELECT COUNT(*) AS n FROM bookings WHERE class = ? AND day = ? AND status = 'wait' AND id <= ?",
                                      (r["class"], r["day"], r["id"]))
                r["pos"] = ahead["n"]
            out[(r["class"], r["day"])] = r
        return out

    async def schedule_view(self, uid: int) -> dict:
        """The coming week's sessions with places, the waitlist and the member's own bookings."""
        who = await self.role(uid)
        today = self.today()
        last = today + cl.AHEAD_DAYS
        c = self.db.conn
        ks = await self.classes(c)
        counts = await self._counts(c, today, last)
        mine = await self._mine(c, who["no"], today, last) if who["no"] else {}
        names = await self._trainer_names()
        by_id = {k["id"]: k for k in ks}
        items = [self._view(by_id[s["class"]], s["day"], counts, names, mine.get((s["class"], s["day"])))
                 for s in cl.sessions(ks, today, last) if cl.starts(by_id[s["class"]], s["day"]) > self.now() - 3_600_000]
        return {"items": items, "today": today}

    async def _session_of(self, c, data: object) -> tuple[dict, int]:
        if not isinstance(data, dict):
            raise Refused("generic")
        k = checked(cl.class_of, await self.classes(c), data.get("class"))
        day = data.get("day")
        if not is_id(day, 10**6) or not cl.runs_on(k, day):
            raise Refused("not_found")
        return k, day

    async def book(self, uid: int, data: dict) -> tuple[dict, list[dict]]:
        who = await self.need(uid, "member")
        async with self.db.tx() as c:
            k, day = await self._session_of(c, data)
            checked(cl.check_book, k, day, self.now())
            abons = await self.abons(c, who["no"])
            ab = planlib.pick(abons, day)
            st = planlib.state(ab, await self.freezes(c, ab["id"]) if ab else [], day, k["start"])
            if st["code"] in ("none", "expired", "used_up", "not_started"):
                raise Refused("class_abon")
            if st["code"] in ("frozen", "window"):
                raise Refused(f"class_{st['code']}")
            if await self.q1(c, "SELECT 1 FROM bookings WHERE class = ? AND day = ? AND member = ? AND status <> 'cancelled'",
                             (k["id"], day, who["no"])):
                raise Refused("class_twice")
            taken = await self.q1(c, "SELECT COUNT(*) AS n FROM bookings WHERE class = ? AND day = ? AND status IN ('booked', 'attended', 'missed')",
                                  (k["id"], day))
            status = "booked" if taken["n"] < k["cap"] else "wait"
            await c.execute("INSERT INTO bookings (class, day, member, status, at) VALUES (?, ?, ?, ?, ?)", (k["id"], day, who["no"], status, self.now()))
            mine = (await self._mine(c, who["no"], day, day)).get((k["id"], day))
            view = self._view(k, day, await self._counts(c, day, day), await self._trainer_names(), mine)
        return view, []

    async def cancel(self, uid: int, data: dict) -> tuple[dict, list[dict]]:
        who = await self.need(uid, "member")
        notes = []
        async with self.db.tx() as c:
            k, day = await self._session_of(c, data)
            b = await self.q1(c, "SELECT id, status FROM bookings WHERE class = ? AND day = ? AND member = ? AND status IN ('booked', 'wait')",
                              (k["id"], day, who["no"]))
            if b is None:
                raise Refused("not_found")
            if b["status"] == "booked":
                checked(cl.check_cancel, k, day, self.now())
            elif cl.starts(k, day) <= self.now():
                raise Refused("class_past")
            await c.execute("UPDATE bookings SET status = 'cancelled' WHERE id = ?", (b["id"],))
            if b["status"] == "booked":
                notes += await self._promote(c, k, day)
            view = self._view(k, day, await self._counts(c, day, day), await self._trainer_names())
        return view, notes

    async def _promote(self, c, k: dict, day: int) -> list[dict]:
        """A place came free: the first on the waitlist gets it and a bot message."""
        nxt = await self.q1(c, "SELECT b.id, b.member, m.user_id FROM bookings b JOIN members m ON m.no = b.member "
                               "WHERE b.class = ? AND b.day = ? AND b.status = 'wait' ORDER BY b.id LIMIT 1", (k["id"], day))
        if nxt is None:
            return []
        await c.execute("UPDATE bookings SET status = 'booked' WHERE id = ? AND status = 'wait'", (nxt["id"],))
        return [{"type": "promoted", "to": nxt["user_id"], "class": k["id"], "day": day}] if (nxt["user_id"] or 0) > 0 else []

    # ── the trainer ──
    async def _own_class(self, c, uid: int, data: object) -> tuple[dict, int, dict]:
        who = await self.need(uid, "trainer", "admin", "owner")
        k, day = await self._session_of(c, data)
        if who["role"] == "trainer" and k["trainer"] != uid:
            raise Refused("not_found")  # someone else's class looks like no class at all
        return k, day, who

    async def trainer_view(self, uid: int) -> dict:
        """The trainer's sessions from yesterday to a week ahead, with places taken and the waitlist."""
        await self.need(uid, "trainer")
        today = self.today()
        c = self.db.conn
        ks = [k for k in await self.classes(c) if k["trainer"] == uid]
        counts = await self._counts(c, today - 1, today + cl.AHEAD_DAYS)
        names = await self._trainer_names()
        by_id = {k["id"]: k for k in ks}
        return {"items": [self._view(by_id[s["class"]], s["day"], counts, names) for s in cl.sessions(ks, today - 1, today + cl.AHEAD_DAYS)],
                "today": today}

    async def session_list(self, uid: int, data: dict) -> dict:
        """Who booked a session (and the waitlist): the class's trainer, the desk or the owner."""
        c = self.db.conn
        k, day, _ = await self._own_class(c, uid, data)
        rows = await self.qa(c, "SELECT b.member AS no, m.name, b.status FROM bookings b JOIN members m ON m.no = b.member "
                                "WHERE b.class = ? AND b.day = ? AND b.status <> 'cancelled' ORDER BY b.status = 'wait', b.id", (k["id"], day))
        now = self.now()
        inside = {r["member"] for r in await self.qa(c, "SELECT member FROM visits WHERE in_at > ? AND in_at <= ? AND (out_at IS NULL OR out_at > ?)",
                                                     (now - 3 * 3_600_000, now, now))}
        for r in rows:
            r["inside"] = r["no"] in inside
        view = self._view(k, day, await self._counts(c, day, day), await self._trainer_names())
        try:
            cl.check_mark(k, day, now)
            view["can_mark"] = True
        except InputError:
            view["can_mark"] = False
        return {**view, "people": rows}

    async def mark(self, uid: int, data: dict) -> dict:
        """The trainer marks a booked member as attended or missed (from 15 minutes before the start to the next day)."""
        async with self.db.tx() as c:
            k, day, who = await self._own_class(c, uid, data)
            if who["role"] != "trainer" or data.get("status") not in ("attended", "missed") or not is_id(data.get("member")):
                raise Refused("forbidden" if who["role"] != "trainer" else "generic")
            checked(cl.check_mark, k, day, self.now())
            cur = await c.execute("UPDATE bookings SET status = ? WHERE class = ? AND day = ? AND member = ? AND status IN ('booked', 'attended', 'missed')",
                                  (data["status"], k["id"], day, data["member"]))
            if cur.rowcount != 1:
                raise Refused("not_found")
        return await self.session_list(uid, data)
