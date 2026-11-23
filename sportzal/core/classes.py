"""Group classes on a weekly schedule, booking with a waitlist, and personal-training slots.

A class runs on the weekdays in ``days`` (0 = Monday) at ``start`` (minute of the day) for ``dur`` minutes with ``cap``
places. A session is a class on one day. Members book up to 7 days ahead and until it starts; cancelling is allowed up
to 2 hours before the start (then the first one on the waitlist gets the place); the trainer marks attendance from 15
minutes before the start until the end of the next day."""

from __future__ import annotations

from .clock import HOUR_MS, MIN_MS, at_local, local_day, weekday
from .text import InputError, whole

AHEAD_DAYS = 7
CANCEL_BEFORE_MS = 2 * HOUR_MS
MARK_FROM_MS = 15 * MIN_MS
PT_AHEAD_DAYS = 14
PT_MINUTES = 60


def class_of(classes: list[dict], cid: object) -> dict:
    for c in classes:
        if c["id"] == cid:
            return c
    raise InputError("not_found")


def starts(c: dict, day: int) -> int:
    return at_local(day, c["start"])


def runs_on(c: dict, day: int) -> bool:
    return weekday(day) in c["days"]


def sessions(classes: list[dict], first: int, last: int) -> list[dict]:
    """Every session from day ``first`` to ``last``, in time order."""
    out = [{"class": c["id"], "day": d} for d in range(first, last + 1) for c in classes if runs_on(c, d)]
    by_id = {c["id"]: c for c in classes}
    return sorted(out, key=lambda s: (s["day"], by_id[s["class"]]["start"], s["class"]))


def check_book(c: dict, day: object, now: int) -> int:
    d = whole(day, 0, 10**6, "not_found")
    if not runs_on(c, d):
        raise InputError("not_found")
    if starts(c, d) <= now:
        raise InputError("class_past")
    if d > local_day(now) + AHEAD_DAYS:
        raise InputError("class_far")
    return d


def check_cancel(c: dict, day: int, now: int) -> None:
    if now > starts(c, day) - CANCEL_BEFORE_MS:
        raise InputError("cancel_late")


def check_mark(c: dict, day: int, now: int) -> None:
    if now < starts(c, day) - MARK_FROM_MS:
        raise InputError("mark_early")
    if now >= at_local(day + 2, 0):
        raise InputError("mark_late")


def fill(taken: int, cap: int) -> int:
    """Whole percent of places taken (rounded down)."""
    return taken * 100 // max(1, cap)


def check_slot(data: object, gym: dict, now: int) -> dict:
    """A personal-training slot a trainer offers: a day in the next 14, a half-hour start inside opening hours (the hour
    must end by closing), a price in whole thousands of so'm."""
    if not isinstance(data, dict):
        raise InputError("slot")
    today = local_day(now)
    day = whole(data.get("day"), today, today + PT_AHEAD_DAYS, "slot_day")
    start = whole(data.get("start"), gym["open"], gym["close"] - PT_MINUTES, "slot_time")
    if start % 30 or at_local(day, start) <= now:
        raise InputError("slot_time")
    price = whole(data.get("price"), 0, 5_000_000, "slot_price")
    if price % 1000:
        raise InputError("slot_price")
    return {"day": day, "start": start, "price": price}


def slot_overlaps(slots: list[dict], day: int, start: int) -> bool:
    return any(s["day"] == day and abs(s["start"] - start) < PT_MINUTES for s in slots)


def slot_starts(s: dict) -> int:
    return at_local(s["day"], s["start"])

