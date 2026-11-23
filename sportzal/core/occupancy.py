"""How busy the gym is: the live count (one function for the member's app, the desk and the door), the level against
capacity, and today's hourly forecast from the same weekday's history.

A visit is ``{"in_at", "out_at"}`` in UTC milliseconds; ``out_at`` is None until the exit scan, and a visit with no
exit scan counts as over after 3 hours (the scheduler then writes that check-out). The forecast for hour ``h`` is the
whole-number average (halves round up) of how many people were inside at ``h``:30 on the same weekday in each of the
past 4 weeks that have any visits."""

from __future__ import annotations

from .clock import HOUR_MS, MIN_MS, at_local, local_day

STAY_MAX_MS = 3 * HOUR_MS
WEEKS = 4
SPAN = 2  # "Eng bo'sh vaqt" is a two-hour window


def out_at(v: dict) -> int:
    """When the visit ends: the exit scan, or 3 hours after entry."""
    return v["out_at"] if v["out_at"] is not None else v["in_at"] + STAY_MAX_MS


def inside(v: dict, at: int) -> bool:
    return v["in_at"] <= at < out_at(v)


def live(visits: list[dict], now: int) -> int:
    """People in the gym right now."""
    return sum(1 for v in visits if inside(v, now))


def level(count: int, capacity: int, levels: list[int]) -> str:
    """"low" (Bo'sh) below levels[0] %, "mid" (O'rtacha) below levels[1] %, else "high" (Gavjum)."""
    pct = count * 100 // max(1, capacity)
    if pct < levels[0]:
        return "low"
    return "mid" if pct < levels[1] else "high"


def by_hour(visits: list[dict], day: int) -> list[int]:
    """How many were inside at h:30 for every hour of ``day``."""
    marks = [at_local(day, h * 60 + 30) for h in range(24)]
    out = [0] * 24
    for v in visits:
        end = out_at(v)
        for h, at in enumerate(marks):
            if v["in_at"] <= at < end:
                out[h] += 1
    return out


def history_days(today: int) -> list[int]:
    return [today - 7 * k for k in range(1, WEEKS + 1)]


def forecast(visits: list[dict], today: int) -> dict:
    """``{"hours": [24 ints], "weeks": n}``: today's estimate per hour from the same weekday of the past weeks."""
    per_day: dict[int, list[dict]] = {d: [] for d in history_days(today)}
    for v in visits:
        d = local_day(v["in_at"])
        if d in per_day:
            per_day[d].append(v)
    rows = [by_hour(vs, d) for d, vs in sorted(per_day.items()) if vs]
    n = len(rows)
    hours = [(sum(r[h] for r in rows) + n // 2) // n if n else 0 for h in range(24)]
    return {"hours": hours, "weeks": n}


def quietest(hours: list[int], open_min: int, close_min: int, now_min: int) -> list[int] | None:
    """``[start, end]`` hours of the quietest two-hour window still ahead today (ties: the earliest), or None."""
    first = max(-(-open_min // 60), now_min // 60 + 1)
    last = close_min // 60 - SPAN
    best = None
    for h in range(first, last + 1):
        total = sum(hours[h:h + SPAN])
        if best is None or total < best[0]:
            best = (total, h)
    return [best[1], best[1] + SPAN] if best else None


def summary(visits: list[dict], fc: dict, now: int, gym: dict) -> dict:
    """What the member's home screen, the desk and the door show: the live count, its level and today's forecast
    (``fc`` is ``forecast(...)`` for today; it only changes once a day)."""
    count = live(visits, now)
    minute = (now - at_local(local_day(now), 0)) // MIN_MS
    return {"count": count, "capacity": gym["capacity"], "level": level(count, gym["capacity"], gym["levels"]),
            "pct": min(100, count * 100 // max(1, gym["capacity"])), "forecast": fc["hours"], "weeks": fc["weeks"],
            "quiet": quietest(fc["hours"], gym["open"], gym["close"], minute) if fc["weeks"] else None,
            "open": gym["open"], "close": gym["close"], "minute": minute, "at": now}
