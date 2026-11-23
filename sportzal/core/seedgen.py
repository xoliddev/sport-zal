"""The fictional gym, relative to "today": members with their habits (weekdays, hour, how long they stay), chains of
abonements sold at the desk, five weeks of visits (so the forecast has history), class bookings with attendance, and
the trainers' personal-training slots. Deterministic (FNV-1a of fixed strings), so Python and the JS port build the
very same world. Seeded people have negative ids: Telegram user ids are positive, so nobody can sign in as them.

``pin`` (the browser demo only) fixes how many people are inside at one minute today and keeps the half hour after it
free of arrivals and exits, so the story's "41 -> 42" is not disturbed by a stranger walking in. The demo also keeps
the rest of today's planned visits (they count only once their time comes); the server seeds only what has happened."""

from __future__ import annotations

from .clock import HOUR_MS, at_local, weekday
from .seedclasses import bookings, slots, trainer_ids
from .text import h32

MEMBERS = 640
HISTORY = 35
OWNER, ADMIN = -1, -2
HERO = 1
# arrivals per hour (07:00 .. 22:00): a morning peak, a quiet afternoon, the evening rush
ARRIVE = [12, 22, 20, 14, 10, 8, 6, 4, 6, 12, 20, 26, 21, 13, 6, 1]
MORNING = ARRIVE[:4]
PLAN_SPLIT = [("t12", 24), ("m1", 66), ("morning", 82), ("m3", 100)]


def member_id(no: int) -> int:
    return -(100_000 + no)


def _weighted(weights: list[int], r: int) -> int:
    r %= sum(weights)
    for i, w in enumerate(weights):
        if r < w:
            return i
        r -= w
    return len(weights) - 1  # pragma: no cover


def habit(no: int, names: dict) -> dict:
    female = h32(f"g:{no}") % 2 == 1
    firsts = names["female"] if female else names["male"]
    last = names["last"][h32(f"l:{no}") % len(names["last"])] + ("a" if female else "")
    r = h32(f"p:{no}") % 100
    plan = next(pid for pid, top in PLAN_SPLIT if r < top)
    hour = 7 + _weighted(MORNING if plan == "morning" else ARRIVE, h32(f"h:{no}"))
    k = 4 if h32(f"k:{no}") % 3 == 0 else 3
    days = sorted(sorted(range(7), key=lambda d: h32(f"wd:{no}:{d}"))[:k])
    return {"name": f"{firsts[h32(f'f:{no}') % len(firsts)]} {last}", "plan": plan, "minute": hour * 60 + h32(f"m:{no}") % 60,
            "days": days, "stay": 55 + h32(f"s:{no}") % 60}


def chain(no: int, days: int, today: int) -> list[int]:
    """Start days of the member's abonements, oldest first: renewed back to back, the last one running today (a few
    have lapsed)."""
    start = today - h32(f"st:{no}") % days
    if h32(f"lap:{no}") % 100 < 6:
        start -= days + 1 + h32(f"lp:{no}") % 12
    out = []
    while start + days - 1 >= today - HISTORY:
        out.append(start)
        start -= days
    return out[::-1]


def _abonements(names: dict, by_plan: dict, today: int) -> tuple[list, list, list, dict]:
    members = [{"no": HERO, "user_id": member_id(HERO), "name": names["hero"], "joined_day": today - 1}]
    abons, freezes, habits = [], [], {}
    for no in range(2, MEMBERS + 1):
        hb = habits[no] = habit(no, names)
        members.append({"no": no, "user_id": member_id(no), "name": hb["name"], "joined_day": today - HISTORY - h32(f"j:{no}") % 300})
        plan = by_plan[hb["plan"]]
        starts = chain(no, plan["days"], today)
        for start in starts:
            ab = {"id": len(abons) + 1, "member": no, "plan": plan["id"], "price": plan["price"],
                  "paid": "card" if h32(f"pay:{no}:{start}") % 100 < 45 else "cash", "sold_day": start, "start_day": start,
                  "end_day": start + plan["days"] - 1, "visits_left": plan["visits"], "window": plan["window"],
                  "freeze_left": plan["freeze"]}
            if start == starts[-1] and h32(f"fz:{no}") % 30 == 0 and ab["end_day"] >= today:
                freezes.append({"abon": ab["id"], "from_day": start + 8, "days": 5})
                ab["end_day"] += 5
                ab["freeze_left"] -= 5
            abons.append(ab)
    return members, abons, freezes, habits


def _planned(habits: dict, mine: dict, frozen: set, today: int, gym: dict) -> list[dict]:
    out = []
    for day in range(today - HISTORY, today + 1):
        wd = weekday(day)
        for no, hb in habits.items():
            if wd not in hb["days"]:
                continue
            r = h32(f"{no}:{day}")
            if r % 100 >= 82:
                continue
            ab = next((a for a in mine.get(no, []) if a["start_day"] <= day <= a["end_day"]), None)
            if ab is None or (ab["id"], day) in frozen:
                continue
            start = min(max(gym["open"], hb["minute"] + (r >> 8) % 21 - 10), gym["close"] - 30)
            if ab["window"] and not ab["window"][0] <= start < ab["window"][1]:
                continue
            end = min(start + hb["stay"] + (r >> 24) % 21 - 10, gym["close"])
            out.append({"member": no, "abon": ab["id"], "day": day, "in": start, "out": end, "auto": (r >> 16) % 100 < 4})
    return out


def world(names: dict, plans: list[dict], schedule: dict, gym: dict, today: int, now_min: int, pin: dict | None = None) -> dict:
    members, abons, freezes, habits = _abonements(names, {p["id"]: p for p in plans}, today)
    frozen = {(f["abon"], f["from_day"] + k) for f in freezes for k in range(f["days"])}
    mine: dict[int, list[dict]] = {}
    for ab in abons:
        mine.setdefault(ab["member"], []).append(ab)
    planned = _planned(habits, mine, frozen, today, gym)
    if pin is not None:
        _quiet(planned, pin, today, gym)
    now = at_local(today, now_min)
    used: dict[int, int] = {}
    visits = []
    for v in sorted(planned, key=lambda v: (v["day"], v["in"], v["member"])):
        ab = abons[v["abon"] - 1]
        later = v["day"] == today and v["in"] > now_min
        if later and (pin is None or ab["visits_left"] is not None):
            continue  # the server seeds only the past; the demo keeps unlimited members' later visits as planned
        if ab["visits_left"] is not None:
            if used.get(ab["id"], 0) >= ab["visits_left"]:
                continue
            used[ab["id"]] = used.get(ab["id"], 0) + 1
        in_at = at_local(v["day"], v["in"])
        auto = v["auto"] and pin is None
        out_at = in_at + 3 * HOUR_MS if auto else at_local(v["day"], v["out"])
        if pin is None and out_at > now:
            out_at, auto = None, False  # still inside
        visits.append({"member": v["member"], "abon": v["abon"], "in_at": in_at, "out_at": out_at, "auto": int(auto)})
    if pin is not None:
        visits = _count(visits, pin, abons, frozen, today, used)
    for ab in abons:
        if ab["visits_left"] is not None:
            ab["visits_left"] -= used.get(ab["id"], 0)
    tids = trainer_ids(schedule)
    staff = [{"user_id": OWNER, "role": "owner", "name": names["staff"]["owner"], "trainer": None},
             {"user_id": ADMIN, "role": "admin", "name": names["staff"]["admin"], "trainer": None},
             *[{"user_id": tids[t["key"]], "role": "trainer", "name": t["name"], "trainer": t["key"]} for t in schedule["trainers"]]]
    return {"members": members, "staff": staff, "abonements": abons, "freezes": freezes, "visits": visits,
            "bookings": bookings(schedule["classes"], mine, frozen, today, now_min, MEMBERS),
            "slots": slots(schedule, today, now_min, MEMBERS)}


def _quiet(planned: list[dict], pin: dict, today: int, gym: dict) -> None:
    """No arrival or exit today in the half hour after ``pin["minute"]`` (and the five minutes before it)."""
    lo, hi = pin["minute"] - 5, pin["minute"] + 30
    for v in planned:
        if v["day"] != today:
            continue
        if lo <= v["in"] <= hi:
            v["in"] = hi + 1 + v["member"] % 25
            v["out"] = min(v["in"] + 70, gym["close"])
        elif lo <= v["out"] <= hi:
            v["out"] = hi + 1 + v["member"] % 40


def _count(visits: list[dict], pin: dict, abons: list[dict], frozen: set, today: int, used: dict) -> list[dict]:
    """Exactly ``pin["count"]`` inside at ``pin["minute"]`` today: drop the extra ones (highest member numbers first) or
    add unlimited members who had not come yet."""
    at = at_local(today, pin["minute"])
    inside = sorted((v for v in visits if v["in_at"] <= at < v["out_at"]), key=lambda v: -v["member"])
    drop = {id(v) for v in inside[:max(0, len(inside) - pin["count"])]}
    for v in visits:
        if id(v) in drop and abons[v["abon"] - 1]["visits_left"] is not None:
            used[v["abon"]] -= 1
    visits = [v for v in visits if id(v) not in drop]
    here = {v["member"] for v in visits if v["in_at"] >= at_local(today, 0)}
    need = pin["count"] - min(len(inside), pin["count"])
    for ab in abons:
        if need <= 0:
            break
        if (ab["member"] in here or not ab["start_day"] <= today <= ab["end_day"] or ab["visits_left"] is not None
                or (ab["id"], today) in frozen):
            continue
        k = len(here)
        start = pin["minute"] - 20 - (k * 7) % 60
        if ab["window"] and not ab["window"][0] <= start < ab["window"][1]:
            continue
        visits.append({"member": ab["member"], "abon": ab["id"], "in_at": at_local(today, start),
                       "out_at": at_local(today, pin["minute"] + 35 + (k * 11) % 50), "auto": 0})
        here.add(ab["member"])
        need -= 1
    return sorted(visits, key=lambda v: (v["in_at"], v["member"]))
