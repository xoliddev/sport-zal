"""Abonements: selling and renewing, the state on a given day and minute, freezing with an exact shift of the end
date, and which renewal reminders are due. Prices are whole so'm, days are Tashkent day numbers, minutes are minutes of
the Tashkent day. ``visits_left`` is ``None`` for an unlimited abonement."""

from __future__ import annotations

from .text import InputError, whole

FREEZE_AHEAD = 14  # a freeze may start today or up to two weeks later
SOON_DAYS = 3  # "tugayotganlar": ends within 3 days, or one visit left


def plan_of(plans: list[dict], pid: object) -> dict:
    for p in plans:
        if p["id"] == pid:
            return p
    raise InputError("plan")


def valid_price(value: object) -> int:
    """A new price from the owner: whole so'm, 1 000 .. 50 000 000, in steps of 1 000."""
    n = whole(value, 1000, 50_000_000, "price")
    if n % 1000:
        raise InputError("price")
    return n


def usable(ab: dict, day: int) -> bool:
    """Still running on ``day`` or later: not ended, not used up."""
    return ab["end_day"] >= day and ab["visits_left"] != 0


def pick(abons: list[dict], day: int) -> dict | None:
    """The abonement every screen talks about: the one running today, else the next one bought ahead, else the last."""
    now = [a for a in abons if a["start_day"] <= day <= a["end_day"] and a["visits_left"] != 0]
    if now:
        return min(now, key=lambda a: (a["start_day"], a["id"]))
    ahead = [a for a in abons if a["start_day"] > day]
    if ahead:
        return min(ahead, key=lambda a: (a["start_day"], a["id"]))
    return max(abons, key=lambda a: (a["end_day"], a["id"])) if abons else None


def sell(plan: dict, today: int, abons: list[dict]) -> dict:
    """A new abonement. A renewal bought while one is still running starts the day after the last usable one ends."""
    ends = [a["end_day"] for a in abons if usable(a, today)]
    start = max(ends) + 1 if ends else today
    return {"plan": plan["id"], "price": plan["price"], "start_day": start, "end_day": start + plan["days"] - 1,
            "visits_left": plan["visits"], "window": list(plan["window"]) if plan["window"] else None, "freeze_left": plan["freeze"]}


def frozen_on(freezes: list[dict], day: int) -> dict | None:
    for f in freezes:
        if f["from_day"] <= day < f["from_day"] + f["days"]:
            return f
    return None


def state(ab: dict | None, freezes: list[dict], day: int, minute: int) -> dict:
    """What the desk says when this abonement is scanned on ``day`` at ``minute``."""
    if ab is None:
        return {"code": "none"}
    if day < ab["start_day"]:
        return {"code": "not_started", "day": ab["start_day"]}
    if day > ab["end_day"]:
        return {"code": "expired", "day": ab["end_day"]}
    if ab["visits_left"] == 0:
        return {"code": "used_up"}
    f = frozen_on(freezes, day)
    if f:
        return {"code": "frozen", "day": f["from_day"] + f["days"] - 1}
    w = ab["window"]
    if w and not w[0] <= minute < w[1]:
        return {"code": "window", "minute": minute}
    return {"code": "ok"}


def freeze(ab: dict | None, freezes: list[dict], start: object, days: object, today: int) -> dict:
    """Validate a freeze of ``days`` days from day ``start``; the end date moves by exactly ``days``."""
    if ab is None or not usable(ab, today):
        raise InputError("freeze_state")
    if any(f["from_day"] + f["days"] - 1 >= today for f in freezes):
        raise InputError("freeze_twice")
    if ab["freeze_left"] <= 0:
        raise InputError("freeze_none")
    first = max(today, ab["start_day"])
    begin = whole(start, first, min(today + FREEZE_AHEAD, ab["end_day"]), "freeze_from") if first <= ab["end_day"] else None
    if begin is None:
        raise InputError("freeze_from")
    n = whole(days, 1, ab["freeze_left"], "freeze_days")
    return {"from_day": begin, "days": n, "end_day": ab["end_day"] + n, "freeze_left": ab["freeze_left"] - n}


def soon(ab: dict | None, today: int) -> bool:
    """On the desk's "tugayotganlar" list: running, and ends within 3 days or has one visit left."""
    if ab is None or not ab["start_day"] <= today <= ab["end_day"] or ab["visits_left"] == 0:
        return False
    return ab["end_day"] - today <= SOON_DAYS or ab["visits_left"] == 1


def reminders(ab: dict | None, today: int, renewed: bool) -> list[str]:
    """Which renewal reminders are due (each is sent once per abonement): "end3" and "last1". None after a renewal."""
    if renewed or not soon(ab, today):
        return []
    out = []
    if ab["end_day"] - today <= SOON_DAYS:
        out.append("end3")
    if ab["visits_left"] == 1:
        out.append("last1")
    return out
