"""Pure core: the shared vectors are current, QR codes cannot be forged or reused across steps, the QR is readable,
the abonement and occupancy rules hold across New Year and midnight."""

from __future__ import annotations

import json

import pytest

from scripts import make_vectors
from sportzal import i18n
from sportzal.core import classes, clock, occupancy, plans, qr, rotqr, seedgen, stats, text

from .helpers import load

SECRET = rotqr.secret_from("core-test")
NOW = make_vectors.NOW
TODAY = make_vectors.TODAY


def test_vectors_are_up_to_date(vectors):
    fresh = json.loads(json.dumps(make_vectors.build(), ensure_ascii=False))
    assert fresh == vectors, "run: python scripts/make_vectors.py"


def test_locales_have_the_same_keys():
    uz, ru = i18n.catalog("uz"), i18n.catalog("ru")
    assert set(uz) == set(ru)
    for key, value in uz.items():
        assert set(i18n._PLACEHOLDER.findall(value)) == set(i18n._PLACEHOLDER.findall(ru[key])), key


def test_rotating_qr_changes_every_30_seconds_and_accepts_only_fresh_steps():
    step = rotqr.step_of(NOW)
    a, b = rotqr.token(SECRET, 7, step), rotqr.token(SECRET, 7, step + 1)
    assert a != b and rotqr.verify(SECRET, a, NOW) == {"member": 7, "step": step}
    assert rotqr.verify(SECRET, a, NOW + 30_000) is not None  # the step before is still fine (camera delays)
    assert rotqr.verify(SECRET, a, NOW + 60_000) is None  # a minute later the screenshot is dead
    assert rotqr.verify(SECRET, b, NOW) is None  # never a future step
    assert rotqr.verify(rotqr.secret_from("other"), a, NOW) is None
    forged = a.replace("SZ1.7.", "SZ1.8.")
    assert rotqr.verify(SECRET, forged, NOW) is None
    assert rotqr.verify(SECRET, a.lower(), NOW) is None and rotqr.verify(SECRET, None, NOW) is None
    code = rotqr.short_code(SECRET, 7, step)
    assert len(code) == 9 and code[4] == "-"
    assert rotqr.norm_code(code.lower().replace("-", " ")) == code
    assert rotqr.find_code(SECRET, code, [1, 7, 9], NOW) == {"member": 7, "step": step}
    assert rotqr.find_code(SECRET, code, [1, 7, 9], NOW + 60_000) is None
    assert 1 <= rotqr.seconds_left(NOW) <= 30


@pytest.mark.parametrize("n", [1, 20, 34, 60, 120, 213])
def test_qr_sizes_and_function_patterns(n):
    m = qr.matrix("x" * n)
    size = len(m)
    assert (size - 17) % 4 == 0 and all(len(r) == size for r in m)
    for r0, c0 in ((0, 0), (0, size - 7), (size - 7, 0)):  # three finder patterns
        assert [m[r0][c0 + k] for k in range(7)] == [1] * 7
        assert m[r0 + 3][c0 + 3] == 1 and m[r0 + 1][c0 + 1] == 0
    assert m[size - 8][8] == 1  # the dark module


def test_qr_too_long():
    with pytest.raises(qr.QrError):
        qr.matrix("x" * 300)


def test_freeze_shifts_the_end_exactly_and_blocks_check_in_only_on_frozen_days():
    t12 = plans.plan_of(load("plans"), "t12")
    ab = {"id": 1, **plans.sell(t12, TODAY, [])}
    res = plans.freeze(ab, [], TODAY + 1, 7, TODAY)
    assert res["end_day"] == ab["end_day"] + 7 and res["freeze_left"] == 0
    after = {**ab, "end_day": res["end_day"], "freeze_left": 0}
    fz = [{"from_day": res["from_day"], "days": 7}]
    assert plans.state(after, fz, TODAY, 600)["code"] == "ok"
    assert [plans.state(after, fz, TODAY + k, 600)["code"] for k in (1, 7, 8)] == ["frozen", "frozen", "ok"]
    assert plans.state(after, fz, res["end_day"], 600)["code"] == "ok" and plans.state(after, fz, res["end_day"] + 1, 600)["code"] == "expired"
    with pytest.raises(text.InputError, match="freeze_twice"):
        plans.freeze(after, fz, TODAY + 1, 1, TODAY)


def test_morning_window_across_midnight_and_new_year():
    morning = plans.plan_of(load("plans"), "morning")
    nye = clock.days_from_civil(2026, 12, 31)
    ab = {"id": 1, **plans.sell(morning, nye - 10, [])}
    assert ab["end_day"] == nye + 19 and clock.civil(ab["end_day"]) == (2027, 1, 19)
    at = [clock.at_local(nye, 23 * 60 + 59), clock.at_local(nye + 1, 0), clock.at_local(nye + 1, 7 * 60), clock.at_local(nye + 1, 11 * 60 + 59)]
    codes = [plans.state(ab, [], clock.local_day(ms), clock.local_minute(ms))["code"] for ms in at]
    assert codes == ["window", "window", "ok", "ok"]
    assert i18n.state_text("uz", plans.state(ab, [], nye + 1, 18 * 60 + 40)) == "Ertalabki abonement: hozir 18:40"


def test_live_count_and_auto_check_out_after_three_hours():
    t0 = clock.at_local(TODAY, 9 * 60)
    vs = [{"in_at": t0, "out_at": None}, {"in_at": t0, "out_at": t0 + 3_600_000}, {"in_at": t0 + 600_000, "out_at": None}]
    assert occupancy.live(vs, t0) == 2 and occupancy.live(vs, t0 + 3_599_999) == 3 and occupancy.live(vs, t0 + 3_600_000) == 2
    assert occupancy.live(vs, t0 + 3 * 3_600_000) == 1 and occupancy.live(vs, t0 + 3 * 3_600_000 + 600_000) == 0


def test_forecast_uses_the_same_weekday_and_says_how_many_weeks():
    gym = load("gym")
    w = seedgen.world(load("names"), load("plans"), load("schedule"), gym, TODAY, 560)
    fc = occupancy.forecast(w["visits"], TODAY)
    assert fc["weeks"] == 4 and max(fc["hours"][7:12]) > 3 * min(fc["hours"][13:16])
    assert occupancy.quietest(fc["hours"], gym["open"], gym["close"], 560) == [14, 16]
    assert occupancy.forecast([], TODAY) == {"hours": [0] * 24, "weeks": 0}
    assert occupancy.quietest(fc["hours"], gym["open"], gym["close"], 22 * 60) is None


def test_seeded_world_over_30_days_and_across_new_year():
    args = (load("names"), load("plans"), load("schedule"), load("gym"))
    for day in [*range(TODAY, TODAY + 30), clock.days_from_civil(2026, 12, 31), clock.days_from_civil(2027, 1, 1)]:
        w = seedgen.world(*args, day, 18 * 60)
        now = clock.at_local(day, 18 * 60)
        assert all(a["visits_left"] is None or 0 <= a["visits_left"] <= 12 for a in w["abonements"])
        assert all(v["in_at"] <= now and (v["out_at"] is None or v["in_at"] < v["out_at"] <= now) for v in w["visits"])
        assert 10 <= occupancy.live(w["visits"], now) <= 60
        rev = stats.revenue([{"plan": a["plan"], "price": a["price"], "paid": a["paid"], "day": a["sold_day"]} for a in w["abonements"]], args[1], day)
        assert sum(r["sum"] for r in rev["rows"]) == rev["total"] == rev["cash"] + rev["card"] and rev["total"] % 1000 == 0
        yoga = [b for b in w["bookings"] if b["class"] == "yoga19" and b["day"] == day]
        assert len(yoga) == 12  # tonight's Yoga is full in every seeded world


def test_class_rules_at_the_edges():
    ks = [{**k, "trainer": 0} for k in load("schedule")["classes"]]
    yoga = classes.class_of(ks, "yoga19")
    start = classes.starts(yoga, TODAY)
    classes.check_cancel(yoga, TODAY, start - 2 * 3_600_000)
    with pytest.raises(text.InputError, match="cancel_late"):
        classes.check_cancel(yoga, TODAY, start - 2 * 3_600_000 + 1)
    with pytest.raises(text.InputError, match="class_past"):
        classes.check_book(yoga, TODAY, start)
    assert stats.month_of(clock.days_from_civil(2026, 12, 31)) == (clock.days_from_civil(2026, 12, 1), clock.days_from_civil(2026, 12, 31))
