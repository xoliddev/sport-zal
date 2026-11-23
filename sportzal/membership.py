"""Abonements at the desk and in the member's hands: the card every screen shows, selling and renewing (cash or card,
recorded by the administrator), freezing (the member or the desk; the end date moves by exactly the frozen days) and
finding a member."""

from __future__ import annotations

from .base import abon_row, checked
from .common import Refused
from .core import plans as planlib
from .core.text import clean

PAID = ("cash", "card")


def abon_view(ab: dict | None, freezes: list[dict], plans: list[dict], today: int, minute: int) -> dict | None:
    """The abonement as the app, the bot, the desk and the door show it (the same numbers everywhere)."""
    if ab is None:
        return None
    p = next((x for x in plans if x["id"] == ab["plan"]), None) or {"uz": ab["plan"], "ru": ab["plan"], "visits": None}
    future = [f for f in freezes if f["from_day"] + f["days"] - 1 >= today]
    return {"id": ab["id"], "plan": ab["plan"], "uz": p["uz"], "ru": p["ru"], "price": ab["price"], "start_day": ab["start_day"],
            "end_day": ab["end_day"], "visits_left": ab["visits_left"], "visits_total": p["visits"], "window": ab["window"],
            "freeze_left": ab["freeze_left"], "freeze": future[0] if future else None, "days_left": ab["end_day"] - today,
            "state": planlib.state(ab, freezes, today, minute), "soon": planlib.soon(ab, today)}


class Membership:
    async def card(self, c, no: int) -> dict:
        m = await self.member(c, no)
        ab, fz, all_ = await self.current(c, no)
        plans = await self.plans(c)
        inside = await self.q1(c, "SELECT in_at FROM visits WHERE member = ? AND out_at IS NULL AND in_at > ?",
                               (no, self.now() - 3 * 3_600_000))
        later = [a for a in all_ if ab and a["start_day"] > ab["end_day"]]
        return {"no": no, "name": m["name"], "joined_day": m["joined_day"], "abon": abon_view(ab, fz, plans, self.today(), self.minute()),
                "next": abon_view(later[0], [], plans, self.today(), self.minute()) if later else None,
                "inside": inside["in_at"] if inside else None, "has_tg": (m["user_id"] or 0) > 0}

    async def my_card(self, uid: int) -> dict:
        who = await self.need(uid, "member")
        return await self.card(self.db.conn, who["no"])

    async def member_card(self, uid: int, no: object) -> dict:
        await self.need(uid, "admin", "owner")
        card = await self.card(self.db.conn, await self._no(no))
        rows = await self.db.all("SELECT * FROM abonements WHERE member = ? ORDER BY id DESC LIMIT 8", (card["no"],))
        plans = await self.plans()
        card["history"] = [{**abon_view(abon_row(r), [], plans, self.today(), self.minute()), "paid": r["paid"], "sold_day": r["sold_day"]}
                           for r in rows]
        card["visits"] = await self.db.all("SELECT in_at, out_at, auto FROM visits WHERE member = ? ORDER BY in_at DESC LIMIT 8", (card["no"],))
        return card

    async def _no(self, no: object) -> int:
        m = await self.member(self.db.conn, no)
        return m["no"]

    async def search(self, uid: int, q: object) -> list[dict]:
        """Members by card number or by a part of the name (at most 20)."""
        await self.need(uid, "admin", "owner")
        text = clean(q, 40) if isinstance(q, str) else ""
        if text.isdigit() and len(text) <= 9:
            rows = await self.db.all("SELECT no FROM members WHERE no = ?", (int(text),))
        elif len(text) >= 2:
            like = "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            rows = await self.db.all("SELECT no FROM members WHERE name LIKE ? ESCAPE '\\' ORDER BY name, no LIMIT 20", (like,))
        else:
            rows = []
        return [await self.card(self.db.conn, r["no"]) for r in rows]

    async def sell(self, uid: int, data: dict) -> tuple[dict, list[dict]]:
        """The desk sells or renews an abonement; the payment (cash or card) is taken at the desk and only recorded."""
        who = await self.need(uid, "admin", "owner")
        if not isinstance(data, dict) or data.get("paid") not in PAID:
            raise Refused("paid")
        async with self.db.tx() as c:
            m = await self.member(c, data.get("member"))
            plan = checked(planlib.plan_of, await self.plans(c), data.get("plan"))
            new = planlib.sell(plan, self.today(), await self.abons(c, m["no"]))
            w = new["window"] or [None, None]
            cur = await c.execute(
                "INSERT INTO abonements (member, plan, price, paid, sold_by, sold_day, sold_at, start_day, end_day, visits_left, "
                "win_from, win_to, freeze_left) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (m["no"], plan["id"], plan["price"], data["paid"], who["uid"], self.today(), self.now(), new["start_day"],
                 new["end_day"], new["visits_left"], w[0], w[1], new["freeze_left"]))
            out = await self.card(c, m["no"])
            out["sold"] = cur.lastrowid
        notes = [{"type": "sold", "to": m["user_id"], "abon": out["sold"]}] if m["user_id"] else []
        return out, notes

    async def abon_for(self, abon_id: int, lang: str) -> dict | None:
        """An abonement for a bot message (no access check: only the notifier uses it, for the abonement's own member)."""
        r = await self.db.one("SELECT * FROM abonements WHERE id = ?", (abon_id,))
        if r is None:
            return None
        ab = abon_row(r)
        view = abon_view(ab, await self.freezes(self.db.conn, ab["id"]), await self.plans(), self.today(), self.minute())
        return {**view, "name": view["ru" if lang == "ru" else "uz"], "paid": r["paid"]}

    async def freeze(self, uid: int, data: dict) -> tuple[dict, list[dict]]:
        """Freeze the current abonement for ``days`` days from day ``from``. A member freezes their own; the desk anyone's."""
        who = await self.role(uid)
        if not isinstance(data, dict):
            raise Refused("generic")
        async with self.db.tx() as c:
            if who["role"] == "member":
                no = who["no"]
            elif who["role"] in ("admin", "owner"):
                no = (await self.member(c, data.get("member")))["no"]
            else:
                raise Refused("forbidden")
            ab, fz, _ = await self.current(c, no)
            res = checked(planlib.freeze, ab, fz, data.get("from"), data.get("days"), self.today())
            cur = await c.execute("UPDATE abonements SET end_day = ?, freeze_left = ? WHERE id = ? AND end_day = ? AND freeze_left = ?",
                                  (res["end_day"], res["freeze_left"], ab["id"], ab["end_day"], ab["freeze_left"]))
            if cur.rowcount != 1:  # pragma: no cover - the write lock makes this unreachable
                raise Refused("generic")
            await c.execute("INSERT INTO freezes (abon, from_day, days, by, at) VALUES (?, ?, ?, ?, ?)",
                            (ab["id"], res["from_day"], res["days"], uid, self.now()))
            out = await self.card(c, no)
            m = await self.member(c, no)
        note = {"type": "frozen", "to": m["user_id"], "abon": ab["id"], "from": res["from_day"], "days": res["days"],
                "old_end": ab["end_day"], "end": res["end_day"]}
        return out, [note] if m["user_id"] else []
