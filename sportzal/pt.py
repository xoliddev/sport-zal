"""Personal training: a trainer offers one-hour slots (a price in so'm, paid at the desk); a member takes a free one
(one member per slot: a conditional UPDATE inside ``BEGIN IMMEDIATE``) and may give it back up to 2 hours before."""

from __future__ import annotations

from .base import checked, is_id
from .common import Refused
from .core import classes as cl


class Personal:
    async def slots_view(self, uid: int) -> dict:
        """A member sees free slots and their own; a trainer sees their own with who took them."""
        who = await self.role(uid)
        now, today = self.now(), self.today()
        last = today + cl.PT_AHEAD_DAYS
        if who["role"] == "trainer":
            rows = await self.db.all("SELECT s.*, m.name AS member_name FROM slots s LEFT JOIN members m ON m.no = s.member "
                                     "WHERE s.trainer = ? AND s.day BETWEEN ? AND ? ORDER BY s.day, s.start", (uid, today, last))
        elif who["role"] == "member":
            rows = await self.db.all("SELECT * FROM slots WHERE day BETWEEN ? AND ? AND (member IS NULL OR member = ?) ORDER BY day, start",
                                     (today, last, who["no"]))
        else:
            raise Refused("forbidden")
        names = {r["user_id"]: r["name"] for r in await self.db.all("SELECT user_id, name FROM staff WHERE role = 'trainer'")}
        items = []
        for r in rows:
            starts = cl.slot_starts(r)
            if starts <= now:
                continue
            item = {"id": r["id"], "trainer": names.get(r["trainer"], ""), "day": r["day"], "start": r["start"], "price": r["price"],
                    "taken": r["member"] is not None, "mine": who["role"] == "member" and r["member"] == who["no"],
                    "can_cancel": now <= starts - cl.CANCEL_BEFORE_MS}
            if who["role"] == "trainer":
                item["member_name"] = r["member_name"]
            items.append(item)
        return {"items": items}

    async def add_slot(self, uid: int, data: dict) -> dict:
        await self.need(uid, "trainer")
        slot = checked(cl.check_slot, data, self.gym, self.now())
        async with self.db.tx() as c:
            mine = await self.qa(c, "SELECT day, start FROM slots WHERE trainer = ? AND day = ?", (uid, slot["day"]))
            if cl.slot_overlaps(mine, slot["day"], slot["start"]):
                raise Refused("slot_overlap")
            await c.execute("INSERT INTO slots (trainer, day, start, price) VALUES (?, ?, ?, ?)", (uid, slot["day"], slot["start"], slot["price"]))
        return await self.slots_view(uid)

    async def remove_slot(self, uid: int, sid: object) -> dict:
        await self.need(uid, "trainer")
        if not is_id(sid):
            raise Refused("not_found")
        async with self.db.tx() as c:
            cur = await c.execute("DELETE FROM slots WHERE id = ? AND trainer = ? AND member IS NULL", (sid, uid))
            if cur.rowcount != 1:
                raise Refused("slot_taken")
        return await self.slots_view(uid)

    async def take_slot(self, uid: int, sid: object) -> tuple[dict, list[dict]]:
        who = await self.need(uid, "member")
        if not is_id(sid):
            raise Refused("not_found")
        async with self.db.tx() as c:
            s = await self.q1(c, "SELECT * FROM slots WHERE id = ?", (sid,))
            if s is None or cl.slot_starts(s) <= self.now():
                raise Refused("not_found")
            cur = await c.execute("UPDATE slots SET member = ?, booked_at = ? WHERE id = ? AND member IS NULL", (who["no"], self.now(), sid))
            if cur.rowcount != 1:
                raise Refused("slot_taken")
        note = {"type": "pt", "to": s["trainer"], "slot": s["id"], "name": who["name"], "day": s["day"], "start": s["start"], "taken": True}
        return await self.slots_view(uid), [note] if s["trainer"] > 0 else []

    async def give_back_slot(self, uid: int, sid: object) -> tuple[dict, list[dict]]:
        who = await self.need(uid, "member")
        if not is_id(sid):
            raise Refused("not_found")
        async with self.db.tx() as c:
            s = await self.q1(c, "SELECT * FROM slots WHERE id = ? AND member = ?", (sid, who["no"]))
            if s is None:
                raise Refused("not_found")
            if self.now() > cl.slot_starts(s) - cl.CANCEL_BEFORE_MS:
                raise Refused("cancel_late")
            await c.execute("UPDATE slots SET member = NULL, booked_at = NULL WHERE id = ? AND member = ?", (sid, who["no"]))
        note = {"type": "pt", "to": s["trainer"], "slot": s["id"], "name": who["name"], "day": s["day"], "start": s["start"], "taken": False}
        return await self.slots_view(uid), [note] if s["trainer"] > 0 else []
