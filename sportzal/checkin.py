"""Check-in at the desk: the member's rotating QR, the scan (a fresh, genuine code; each 30-second step accepted once
and only upwards; the visit taken off atomically inside ``BEGIN IMMEDIATE``), the exit scan, the 3-hour automatic
check-out, the live count with today's forecast, and today's check-ins for the desk."""

from __future__ import annotations

from .common import Refused
from .core import occupancy, rotqr
from .core import plans as planlib
from .core.clock import at_local
from .membership import abon_view

STALE = occupancy.STAY_MAX_MS


class Checkin:
    _fc: tuple[int, dict] | None = None

    async def qr(self, uid: int) -> dict:
        """The member's QR for this 30-second step and the short code under it."""
        who = await self.need(uid, "member")
        now = self.now()
        step = rotqr.step_of(now)
        return {"token": rotqr.token(self.qr_secret, who["no"], step), "code": rotqr.short_code(self.qr_secret, who["no"], step),
                "step": step, "left": rotqr.seconds_left(now), "no": who["no"], "name": who["name"]}

    async def forecast(self) -> dict:
        """Today's forecast (past days only, so it is computed once a day)."""
        today = self.today()
        if self._fc is None or self._fc[0] != today:
            rows = []
            for d in occupancy.history_days(today):
                rows += await self.db.all("SELECT in_at, out_at FROM visits WHERE in_at >= ? AND in_at < ?",
                                          (at_local(d, 0), at_local(d + 1, 0)))
            self._fc = (today, occupancy.forecast(rows, today))
        return self._fc[1]

    async def live(self) -> dict:
        """How busy the gym is now: one function for the member's app, the desk, the door and the bot."""
        now = self.now()
        rows = await self.db.all("SELECT in_at, out_at FROM visits WHERE in_at > ? AND in_at <= ? AND (out_at IS NULL OR out_at > ?)",
                                 (now - STALE, now, now))
        return occupancy.summary(rows, await self.forecast(), now, self.gym)

    async def scan(self, uid: int, data: dict) -> tuple[dict, list[dict]]:
        """A QR (``token``) or a typed short code (``code``) at the desk -> entry, exit or the reason it is refused."""
        await self.need(uid, "admin", "owner")
        now = self.now()
        if not isinstance(data, dict):
            raise Refused("generic")
        if isinstance(data.get("token"), str):
            found = rotqr.verify(self.qr_secret, data["token"], now)
        elif isinstance(data.get("code"), str):
            nos = [r["no"] for r in await self.db.all("SELECT no FROM members")]
            found = rotqr.find_code(self.qr_secret, data["code"], nos, now)
        else:
            raise Refused("generic")
        if found is None:
            return {"code": "bad", "count": (await self.live())["count"]}, []
        notes = []
        async with self.db.tx() as c:
            m = await self.q1(c, "SELECT * FROM members WHERE no = ?", (found["member"],))
            used = await c.execute("UPDATE members SET last_step = ? WHERE no = ? AND last_step < ?", (found["step"], found["member"], found["step"]))
            if m is None or used.rowcount != 1:
                out = {"code": "bad"}  # a step already used, or an older one: a screenshot or a replay
            else:
                out = await self._enter_or_leave(c, m, uid, now)
                if out["code"] in ("ok", "exit") and (m["user_id"] or 0) > 0:
                    notes.append({"type": "checkin" if out["code"] == "ok" else "checkout", "to": m["user_id"], "abon": out.get("abon_id"),
                                  "at": now, "minutes": out.get("minutes")})
        out["count"] = (await self.live())["count"]
        return out, notes

    async def _enter_or_leave(self, c, m: dict, uid: int, now: int) -> dict:
        no = m["no"]
        await c.execute("UPDATE visits SET out_at = in_at + ?, auto = 1 WHERE member = ? AND out_at IS NULL AND in_at <= ?",
                        (STALE, no, now - STALE))
        base = {"no": no, "name": m["name"]}
        open_ = await self.q1(c, "SELECT id, in_at FROM visits WHERE member = ? AND out_at IS NULL", (no,))
        if open_:
            await c.execute("UPDATE visits SET out_at = ? WHERE id = ?", (now, open_["id"]))
            return {**base, "code": "exit", "minutes": (now - open_["in_at"]) // 60_000}
        ab, fz, _ = await self.current(c, no)
        st = planlib.state(ab, fz, self.today(), self.minute())
        if st["code"] != "ok":
            return {**base, **st}
        if ab["visits_left"] is not None:
            cur = await c.execute("UPDATE abonements SET visits_left = visits_left - 1 WHERE id = ? AND visits_left > 0", (ab["id"],))
            if cur.rowcount != 1:  # pragma: no cover - the write lock makes this unreachable
                return {**base, "code": "used_up"}
            ab = {**ab, "visits_left": ab["visits_left"] - 1}
        await c.execute("INSERT INTO visits (member, abon, in_at, by) VALUES (?, ?, ?, ?)", (no, ab["id"], now, uid))
        view = abon_view(ab, fz, await self.plans(c), self.today(), self.minute())
        return {**base, "code": "ok", "abon": view, "abon_id": ab["id"]}

    async def close_stale(self) -> int:
        """The 3-hour automatic check-out for visits without an exit scan."""
        now = self.now()
        async with self.db.tx() as c:
            cur = await c.execute("UPDATE visits SET out_at = in_at + ?, auto = 1 WHERE out_at IS NULL AND in_at <= ?", (STALE, now - STALE))
            return cur.rowcount

    async def today_visits(self, uid: int) -> dict:
        """Today's check-ins for the desk, newest first (the 50 latest) and how many in all."""
        await self.need(uid, "admin", "owner")
        now = self.now()
        start = at_local(self.today(), 0)
        rows = await self.db.all(
            "SELECT v.member AS no, m.name, v.in_at, v.out_at, v.auto, a.plan, a.visits_left FROM visits v "
            "JOIN members m ON m.no = v.member LEFT JOIN abonements a ON a.id = v.abon "
            "WHERE v.in_at >= ? AND v.in_at <= ? ORDER BY v.in_at DESC, v.id DESC LIMIT 50", (start, now))
        total = await self.db.one("SELECT COUNT(*) AS n FROM visits WHERE in_at >= ? AND in_at <= ?", (start, now))
        for r in rows:
            gone = r["out_at"] is not None and r["out_at"] <= now
            r["inside"] = not gone and now - r["in_at"] < STALE
        return {"items": rows, "total": total["n"]}
