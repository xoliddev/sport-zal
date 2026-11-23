"""The seeded world's classes: four weeks of past sessions with attendance, the coming week's bookings (tonight's
Yoga is full, the story's waitlist needs it) and the trainers' personal-training slots."""

from __future__ import annotations

from .classes import sessions
from .clock import at_local
from .text import h32

PAST_DAYS = 28
STRIDE = 37
PT_PRICE = {"malika": 150_000, "sherzod": 180_000, "kamola": 120_000}
PT_STARTS = [660, 900]
FULL = "yoga19"


def trainer_ids(schedule: dict) -> dict[str, int]:
    return {t["key"]: -(11 + i) for i, t in enumerate(schedule["trainers"])}


def _eligible(mine: dict, frozen: set, no: int, day: int, minute: int) -> bool:
    for ab in mine.get(no, []):
        if ab["start_day"] <= day <= ab["end_day"] and (ab["id"], day) not in frozen:
            return not ab["window"] or ab["window"][0] <= minute < ab["window"][1]
    return False


def bookings(classes: list[dict], mine: dict, frozen: set, today: int, now_min: int, members: int) -> list[dict]:
    by_id = {c["id"]: c for c in classes}
    now = at_local(today, now_min)
    out = []
    for s in sessions(classes, today - PAST_DAYS, today + 7):
        c, day = by_id[s["class"]], s["day"]
        r = h32(f"b:{c['id']}:{day}")
        past = at_local(day, c["start"]) <= now
        if past:
            want = c["cap"] * (55 + r % 46) // 100
        elif c["id"] == FULL and day == today:
            want = c["cap"]
        else:
            want = c["cap"] * (25 + r % 55) // 100
        no = 2 + (r >> 8) % (members - 1)
        got = 0
        for _ in range(members - 1):
            if got >= want:
                break
            if _eligible(mine, frozen, no, day, c["start"]):
                status = "booked"
                if past and day < today:
                    status = "attended" if h32(f"att:{c['id']}:{day}:{no}") % 100 < 86 else "missed"
                out.append({"class": c["id"], "day": day, "member": no, "status": status})
                got += 1
            no = 2 + (no - 2 + STRIDE) % (members - 1)
    return out


def slots(schedule: dict, today: int, now_min: int, members: int) -> list[dict]:
    tids = trainer_ids(schedule)
    now = at_local(today, now_min)
    out = []
    for t in schedule["trainers"]:
        for day in range(today, today + 7):
            for start in PT_STARTS:
                r = h32(f"pt:{t['key']}:{day}:{start}")
                if r % 3 == 0 or at_local(day, start) <= now:
                    continue
                member = 2 + (r >> 8) % (members - 1) if (r >> 4) % 100 < 35 else None
                out.append({"trainer": tids[t["key"]], "day": day, "start": start, "price": PT_PRICE.get(t["key"], 150_000), "member": member})
    return out
