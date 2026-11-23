"""Filling an empty database with the fictional gym (core.seedgen.world), in one transaction."""

from __future__ import annotations


class Seeding:
    async def seed(self, world: dict) -> bool:
        """Insert the world if there are no members yet; plans and the weekly schedule come from shared/data."""
        async with self.db.tx() as c:
            await self.sync_classes(c)
            if await self.q1(c, "SELECT 1 FROM members LIMIT 1"):
                return False
            await c.executemany("INSERT OR IGNORE INTO staff (user_id, role, name, trainer) VALUES (?, ?, ?, ?)",
                                [(s["user_id"], s["role"], s["name"], s["trainer"]) for s in world["staff"]])
            await self.sync_classes(c)
            await c.executemany("INSERT INTO members (no, user_id, name, joined_day) VALUES (?, ?, ?, ?)",
                                [(m["no"], m["user_id"], m["name"], m["joined_day"]) for m in world["members"]])
            at = self.now()
            await c.executemany(
                "INSERT INTO abonements (id, member, plan, price, paid, sold_by, sold_day, sold_at, start_day, end_day, visits_left, "
                "win_from, win_to, freeze_left) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [(a["id"], a["member"], a["plan"], a["price"], a["paid"], -2, a["sold_day"], at, a["start_day"], a["end_day"], a["visits_left"],
                  *(a["window"] or [None, None]), a["freeze_left"]) for a in world["abonements"]])
            await c.executemany("INSERT INTO freezes (abon, from_day, days, by, at) VALUES (?, ?, ?, ?, ?)",
                                [(f["abon"], f["from_day"], f["days"], -2, at) for f in world["freezes"]])
            await c.executemany("INSERT INTO visits (member, abon, in_at, out_at, auto, by) VALUES (?, ?, ?, ?, ?, ?)",
                                [(v["member"], v["abon"], v["in_at"], v["out_at"], v["auto"], -2) for v in world["visits"]])
            await c.executemany("INSERT INTO bookings (class, day, member, status, at) VALUES (?, ?, ?, ?, ?)",
                                [(b["class"], b["day"], b["member"], b["status"], at) for b in world["bookings"]])
            await c.executemany("INSERT INTO slots (trainer, day, start, price, member, booked_at) VALUES (?, ?, ?, ?, ?, ?)",
                                [(s["trainer"], s["day"], s["start"], s["price"], s["member"], at if s["member"] else None) for s in world["slots"]])
        self._fc = None
        return True
