"""The admin panel's numbers: the dashboard (live count, today's check-ins, abonements ending soon, revenue this month
for the owner only, class fill rates), a reminder sent from the desk, and prices (the owner changes them, the
administrator only sees them). The scheduler's tick sends the automatic reminders and the 3-hour check-outs."""

from __future__ import annotations

from .base import abon_row, checked, is_id
from .common import Refused
from .core import plans as planlib
from .core import stats
from .membership import abon_view

FILL_DAYS = 28
QUIET = (9 * 60, 21 * 60)  # reminders go out between 09:00 and 21:00 only


class Desk:
    async def _soon(self) -> list[dict]:
        """Running abonements that end within 3 days or have one visit left, not yet renewed (core.plans.soon)."""
        today = self.today()
        rows = await self.db.all(
            "SELECT a.*, m.name, m.user_id FROM abonements a JOIN members m ON m.no = a.member "
            "WHERE a.start_day <= ? AND a.end_day >= ? AND (a.end_day <= ? OR a.visits_left = 1) ORDER BY a.end_day, a.id",
            (today, today, today + planlib.SOON_DAYS))
        out = []
        for r in rows:
            ab = abon_row(r)
            if not planlib.soon(ab, today):
                continue
            if await self.db.one("SELECT 1 FROM abonements WHERE member = ? AND start_day > ?", (r["member"], r["end_day"])):
                continue  # already renewed
            out.append({"ab": ab, "name": r["name"], "user_id": r["user_id"]})
        return out

    async def dashboard(self, uid: int) -> dict:
        who = await self.need(uid, "admin", "owner")
        today, minute = self.today(), self.minute()
        plans = await self.plans()
        soon = []
        for s in await self._soon():
            ab = s["ab"]
            sent = await self.db.one("SELECT at FROM sent WHERE key = ?", (f"manual:{ab['id']}:{today}",))
            soon.append({"no": ab["member"], "name": s["name"], "abon": abon_view(ab, await self.freezes(self.db.conn, ab["id"]), plans, today, minute),
                         "kinds": planlib.reminders(ab, today, False), "reminded": sent["at"] if sent else None, "has_tg": (s["user_id"] or 0) > 0})
        out = {"role": who["role"], "live": await self.live(), "today": (await self.today_visits(uid))["total"], "soon": soon,
               "fill": await self.fill(), "plans": plans, "revenue": None}
        if who["role"] == "owner":
            out["revenue"] = await self.revenue()
        return out

    async def revenue(self) -> dict:
        first, last = stats.month_of(self.today())
        sales = await self.db.all("SELECT plan, price, paid, sold_day AS day FROM abonements WHERE sold_day BETWEEN ? AND ?", (first, last))
        return stats.revenue(sales, await self.plans(), self.today())

    async def fill(self) -> dict:
        """Places taken in the past 4 weeks' sessions (attended, missed or still booked), per class."""
        today = self.today()
        first, last = today - FILL_DAYS, today - 1
        rows = await self.db.all("SELECT class, day, COUNT(*) AS n FROM bookings WHERE day BETWEEN ? AND ? "
                                 "AND status IN ('booked', 'attended', 'missed') GROUP BY class, day", (first, last))
        taken = {f"{r['class']}:{r['day']}": r["n"] for r in rows}
        return {"from": first, "to": last, "items": stats.fill_rates(await self.classes(), taken, first, last)}

    async def remind(self, uid: int, abon_id: object) -> tuple[dict, list[dict]]:
        """The desk sends one reminder a day to a member on the "tugayotganlar" list."""
        await self.need(uid, "admin", "owner")
        if not is_id(abon_id):
            raise Refused("not_found")
        hit = next((s for s in await self._soon() if s["ab"]["id"] == abon_id), None)
        if hit is None:
            raise Refused("not_found")
        if (hit["user_id"] or 0) <= 0:
            raise Refused("no_tg")
        async with self.db.tx() as c:
            cur = await c.execute("INSERT OR IGNORE INTO sent (key, at) VALUES (?, ?)", (f"manual:{abon_id}:{self.today()}", self.now()))
            if cur.rowcount != 1:
                raise Refused("reminded")
        kinds = planlib.reminders(hit["ab"], self.today(), False)
        return await self.dashboard(uid), [{"type": "remind", "to": hit["user_id"], "abon": abon_id, "kinds": kinds}]

    async def set_price(self, uid: int, data: dict) -> list[dict]:
        await self.need(uid, "owner")
        if not isinstance(data, dict):
            raise Refused("generic")
        async with self.db.tx() as c:
            plan = checked(planlib.plan_of, await self.plans(c), data.get("plan"))
            price = checked(planlib.valid_price, data.get("price"))
            await c.execute("UPDATE plans SET price = ? WHERE id = ?", (price, plan["id"]))
            await c.execute("INSERT INTO price_log (plan, old, new, by, at) VALUES (?, ?, ?, ?, ?)", (plan["id"], plan["price"], price, uid, self.now()))
        return await self.plans()

    async def prices(self, uid: int) -> dict:
        who = await self.need(uid, "admin", "owner")
        return {"items": await self.plans(), "can_edit": who["role"] == "owner"}

    async def tick(self) -> list[dict]:
        """Every minute: the 3-hour check-outs, then the renewal reminders that are due (each claimed once)."""
        await self.close_stale()
        if not QUIET[0] <= self.minute() < QUIET[1]:
            return []
        notes = []
        today = self.today()
        for s in await self._soon():
            if (s["user_id"] or 0) <= 0:
                continue
            for kind in planlib.reminders(s["ab"], today, False):
                async with self.db.tx() as c:
                    cur = await c.execute("INSERT OR IGNORE INTO sent (key, at) VALUES (?, ?)", (f"{kind}:{s['ab']['id']}", self.now()))
                if cur.rowcount == 1:
                    notes.append({"type": "remind", "to": s["user_id"], "abon": s["ab"]["id"], "kinds": [kind]})
        return notes
