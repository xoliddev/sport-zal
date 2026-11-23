"""Regenerate shared/test_vectors.json from the Python core.

pytest checks that the file is up to date (so the Python core and the vectors never drift apart), and
``node --test`` checks the JS port against the very same vectors.

    python scripts/make_vectors.py
"""

from __future__ import annotations

import hashlib
import hmac
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sportzal import i18n  # noqa: E402
from sportzal.core import classes, clock, occupancy, plans, qr, rotqr, seedgen, stats, text  # noqa: E402

OUT = ROOT / "shared" / "test_vectors.json"
NOW = 1_795_000_000_000  # 2026-11-18 16:06 in Tashkent, a Wednesday
TODAY = clock.local_day(NOW)
MORNING = clock.at_local(TODAY, 9 * 60 + 20)
NYE = clock.days_from_civil(2027, 1, 1)
PIN = {"minute": 560, "count": 41}
SEED = "test-only-qr-seed"


def load(name: str):
    with open(ROOT / "shared" / "data" / f"{name}.json", encoding="utf-8") as fh:
        return json.load(fh)


def res(fn, *args):
    try:
        return {"ok": fn(*args)}
    except text.InputError as e:
        return {"error": e.code}


def digest(obj) -> int:
    return text.h32(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))


def basics(v: dict) -> None:
    days = [0, TODAY, NYE - 1, NYE, clock.days_from_civil(2028, 2, 29)]
    v["civil"] = [{"day": d, "out": list(clock.civil(d)), "back": clock.days_from_civil(*clock.civil(d))} for d in days]
    v["minute"] = [{"ms": ms, "day": clock.local_day(ms), "min": clock.local_minute(ms), "wd": clock.weekday(clock.local_day(ms))}
                   for ms in (NOW, MORNING, clock.at_local(NYE, 0) - 1, clock.at_local(NYE, 0), 0)]
    v["h32"] = [{"in": s, "out": text.h32(s)} for s in ("", "a", "1:20775", "Aziz Karimov", "Йога")]
    v["sha256"] = [{"in": s, "out": hashlib.sha256(s.encode()).hexdigest()} for s in ("", "abc", "x" * 200, "Sport Zal 🏋️")]
    v["hmac"] = [{"key": k, "msg": m, "out": hmac.new(k.encode(), m.encode(), hashlib.sha256).hexdigest()}
                 for k, m in (("key", "The quick brown fox"), ("k" * 100, "long key"))]


def abonements(v: dict) -> None:
    ps = load("plans")
    t12, morning = plans.plan_of(ps, "t12"), plans.plan_of(ps, "morning")
    a = {"id": 1, **plans.sell(t12, TODAY, [])}
    b = {"id": 2, **plans.sell(morning, TODAY - 40, [])}
    renew = plans.sell(t12, TODAY, [a])
    v["sell"] = [plans.sell(t12, TODAY, []), renew, plans.sell(t12, TODAY, [{**a, "visits_left": 0}]), plans.sell(morning, NYE - 3, [])]
    used = {**a, "visits_left": 0}
    fz = [{"from_day": TODAY + 2, "days": 7}]
    cases = [(a, [], TODAY, 600), (a, [], TODAY - 1, 600), (a, [], a["end_day"] + 1, 600), (used, [], TODAY, 600), (a, fz, TODAY + 3, 600),
             (a, fz, TODAY + 9, 600), ({**b, "start_day": TODAY, "end_day": TODAY + 29}, [], TODAY, 18 * 60 + 40),
             ({**b, "start_day": TODAY, "end_day": TODAY + 29}, [], TODAY, 420), ({**b, "start_day": TODAY, "end_day": TODAY + 29}, [], TODAY, 720),
             (None, [], TODAY, 600)]
    v["state"] = [{"in": [x, f, d, m], "out": plans.state(x, f, d, m)} for x, f, d, m in cases]
    v["pick"] = [{"in": [x, d], "out": plans.pick(x, d)} for x, d in
                 (([a, {**a, "id": 3, **renew}], TODAY), ([a, {**a, "id": 3, **renew}], renew["start_day"]), ([b], TODAY), ([], TODAY),
                  ([{**a, "visits_left": 0}, {**a, "id": 3, "start_day": TODAY + 5, "end_day": TODAY + 34}], TODAY))]
    freezes = [(a, [], TODAY + 1, 7), (a, [], TODAY, 1), (a, [], TODAY - 1, 7), (a, [], TODAY + 15, 7), (a, [], TODAY + 1, 8),
               (a, [], TODAY + 1, 0), (a, [], "x", 7), (a, fz, TODAY + 1, 3), (a, [{"from_day": TODAY - 9, "days": 7}], TODAY + 1, 3),
               (used, [], TODAY + 1, 3), ({**a, "freeze_left": 0}, [], TODAY + 1, 1), (None, [], TODAY, 1),
               ({**a, "end_day": TODAY + 3}, [], TODAY + 3, 7), ({**a, "start_day": TODAY + 3, "end_day": TODAY + 32}, [], TODAY + 1, 2)]
    v["freeze"] = [{"in": [x, f, s, n], "out": res(plans.freeze, x, f, s, n, TODAY)} for x, f, s, n in freezes]
    soon = [a, {**a, "end_day": TODAY + 3}, {**a, "end_day": TODAY + 4}, {**a, "visits_left": 1}, {**a, "visits_left": 1, "end_day": TODAY},
            {**a, "start_day": TODAY + 1}, used, None]
    v["soon"] = [{"in": x, "soon": plans.soon(x, TODAY), "rem": plans.reminders(x, TODAY, False), "renewed": plans.reminders(x, TODAY, True)}
                 for x in soon]
    v["price"] = [{"in": x, "out": res(plans.valid_price, x)} for x in (350000, "400000", 999, 1500, 50_000_000, 50_001_000, True, None, 2.5)]


def qr_codes(v: dict) -> None:
    secret = rotqr.secret_from(SEED)
    step = rotqr.step_of(MORNING)
    toks = [rotqr.token(secret, m, s) for m, s in ((1, step), (42, step - 1), (640, step + 3))]
    bad = [toks[0][:-1] + ("A" if toks[0][-1] != "A" else "B"), toks[0].replace("SZ1.1.", "SZ1.2."), rotqr.token(secret, 1, step - 2),
           rotqr.token(secret, 1, step + 1), "SZ1.1.5", "", 12345, toks[0] + " ", "SZ1.0.5." + "A" * 16]
    v["rotqr"] = {"seed": SEED, "secret": secret.hex(), "step": step, "now": MORNING, "tokens": toks,
                  "verify": [{"in": x, "out": rotqr.verify(secret, x, MORNING)} for x in [*toks, *bad]],
                  "codes": [{"m": m, "s": s, "out": rotqr.short_code(secret, m, s)} for m, s in ((1, step), (1, step - 1), (999, 12))],
                  "norm": [{"in": x, "out": rotqr.norm_code(x)} for x in ("pwen-r1zr", "PWEN R1ZR", "kOqI-l9xd", "ABCD-EFG", "ABCD-EFGU", "", 5)],
                  "find": [{"in": x, "out": rotqr.find_code(secret, x, list(range(1, 50)), MORNING)}
                           for x in (rotqr.short_code(secret, 7, step), rotqr.short_code(secret, 49, step - 1), rotqr.short_code(secret, 7, step - 2), "zzzz")],
                  "left": [rotqr.seconds_left(ms) for ms in (0, 1, 29_999, 30_000, MORNING + 12_345)]}
    v["qr"] = [{"in": s, "out": qr.as_text(qr.matrix(s))} for s in ("A", toks[0], "Q" * 120, "w" * 213)]
    v["qr_parts"] = {"format": [qr.format_bits(m) for m in range(8)], "version": [qr.version_bits(x) for x in range(7, 11)],
                     "rs": qr.rs_remainder([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10)}


def gym_numbers(v: dict, w: dict, wp: dict) -> None:
    gym = load("gym")
    vis = w["visits"]
    fc = occupancy.forecast(vis, TODAY)
    v["occupancy"] = {"live": [occupancy.live(vis, ms) for ms in (MORNING, NOW, clock.at_local(TODAY, 300))],
                      "level": [occupancy.level(n, 50, gym["levels"]) for n in (0, 19, 20, 37, 38, 50, 70)],
                      "by_hour": occupancy.by_hour([x for x in vis if clock.local_day(x["in_at"]) == TODAY - 7], TODAY - 7),
                      "forecast": fc, "forecast_nye": occupancy.forecast(vis, NYE),
                      "quiet": [occupancy.quietest(fc["hours"], gym["open"], gym["close"], m) for m in (0, 560, 840, 1200, 1300)],
                      "summary": occupancy.summary(vis, fc, NOW, gym),
                      "pinned": occupancy.summary(wp["visits"], occupancy.forecast(wp["visits"], TODAY), MORNING, gym)}
    ks = [{**k, "trainer": 0} for k in load("schedule")["classes"]]
    yoga = classes.class_of(ks, "yoga19")
    times = [clock.at_local(TODAY, m) for m in (0, 16 * 60 + 59, 17 * 60, 17 * 60 + 1, 18 * 60 + 45, 18 * 60 + 44, 19 * 60)]
    v["classes"] = {"sessions": classes.sessions(ks, TODAY, TODAY + 6),
                    "book": [res(classes.check_book, yoga, d, n) for d, n in ((TODAY, NOW), (TODAY, times[-1]), (TODAY + 7, NOW), (TODAY + 8, NOW), ("x", NOW))],
                    "cancel": [res(classes.check_cancel, yoga, TODAY, n) for n in times],
                    "mark": [res(classes.check_mark, yoga, TODAY, n) for n in [*times, clock.at_local(TODAY + 2, 0) - 1, clock.at_local(TODAY + 2, 0)]],
                    "fill": [classes.fill(a, b) for a, b in ((0, 12), (11, 12), (12, 12), (1, 3), (5, 0))],
                    "slot": [res(classes.check_slot, x, load("gym"), NOW) for x in
                             ({"day": TODAY + 1, "start": 900, "price": 150000}, {"day": TODAY, "start": 900, "price": 0}, {"day": TODAY + 15, "start": 900, "price": 0},
                              {"day": TODAY + 1, "start": 915, "price": 0}, {"day": TODAY + 1, "start": 1340, "price": 0}, {"day": TODAY + 1, "start": 900, "price": 1500},
                              {"day": TODAY + 1, "start": 900}, [], None)],
                    "overlap": [classes.slot_overlaps([{"day": TODAY, "start": 900}], TODAY, s) for s in (840, 841, 959, 960)]}
    sales = [{"plan": a["plan"], "price": a["price"], "paid": a["paid"], "day": a["sold_day"]} for a in w["abonements"]]
    taken: dict[str, int] = {}
    for b in w["bookings"]:
        taken[f"{b['class']}:{b['day']}"] = taken.get(f"{b['class']}:{b['day']}", 0) + 1
    v["stats"] = {"month": [list(stats.month_of(d)) for d in (TODAY, NYE - 1, NYE, clock.days_from_civil(2028, 2, 10))],
                  "revenue": stats.revenue(sales, load("plans"), TODAY), "revenue_prev": stats.revenue(sales, load("plans"), TODAY - 30),
                  "fill": stats.fill_rates(ks, taken, TODAY - 28, TODAY - 1)}


def sentences(v: dict, w: dict) -> None:
    ps = load("plans")
    t12 = plans.plan_of(ps, "t12")
    view = {"uz": t12["uz"], "ru": t12["ru"], "visits_left": 11, "end_day": TODAY + 29}
    unl = {**view, "visits_left": None}
    results = [{"code": "ok", "name": "Aziz Karimov", "abon": view}, {"code": "ok", "name": "Laylo Saidova", "abon": unl},
               {"code": "exit", "name": "Aziz Karimov", "minutes": 85}, {"code": "exit", "name": "Aziz", "minutes": 120},
               {"code": "exit", "name": "Aziz", "minutes": 7}, {"code": "bad"}, {"code": "expired", "day": TODAY - 2},
               {"code": "used_up"}, {"code": "window", "minute": 18 * 60 + 40}, {"code": "frozen", "day": TODAY + 6},
               {"code": "not_started", "day": NYE}, {"code": "none"}]
    gym = load("gym")
    live = occupancy.summary(w["visits"], occupancy.forecast(w["visits"], TODAY), MORNING, gym)
    v["sentences"] = [{"lang": lang, "scan": [i18n.scan_text(lang, r) for r in results], "detail": [i18n.scan_detail(lang, r) for r in results],
                       "state": [i18n.state_text(lang, r) for r in results[5:]], "left": [i18n.left_text(lang, x) for x in (view, unl)],
                       "money": [i18n.money(lang, n) for n in (0, 350000, 1200000, 141350000)],
                       "date": [i18n.date_short(lang, d) for d in (TODAY, NYE)], "until": [i18n.until(lang, d) for d in (TODAY, NYE)],
                       "live": i18n.live_text(lang, live), "quiet": i18n.quiet_text(lang, live), "no_quiet": i18n.quiet_text(lang, {**live, "quiet": None})}
                      for lang in ("uz", "ru")]
    v["group"] = [i18n.group(n) for n in (0, 7, 999, 1000, 350000, 1234567, -4500)]


def seeded(v: dict) -> tuple[dict, dict]:
    args = (load("names"), load("plans"), load("schedule"), load("gym"))
    w = seedgen.world(*args, TODAY, 560)
    wp = seedgen.world(*args, TODAY, 560, PIN)
    wn = seedgen.world(*args, NYE, 18 * 60)
    v["world"] = [{"today": d, "minute": m, "pin": p, "sizes": {k: len(x) for k, x in ww.items()}, "digest": {k: digest(x) for k, x in ww.items()},
                   "members": ww["members"][:3], "abon": ww["abonements"][:2], "visit": ww["visits"][-2:]}
                  for d, m, p, ww in ((TODAY, 560, None, w), (TODAY, 560, PIN, wp), (NYE, 18 * 60, None, wn))]
    return w, wp


def build() -> dict:
    v: dict = {"now": NOW, "today": TODAY, "morning": MORNING, "nye": NYE}
    basics(v)
    abonements(v)
    qr_codes(v)
    w, wp = seeded(v)
    gym_numbers(v, w, wp)
    sentences(v, w)
    return v


def main() -> None:
    OUT.write_bytes((json.dumps(build(), ensure_ascii=False, indent=1) + "\n").encode("utf-8"))


if __name__ == "__main__":
    main()
