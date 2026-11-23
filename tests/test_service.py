"""The whole story on the service, and who may do what."""

from __future__ import annotations

import pytest

from sportzal.common import Refused
from sportzal.core import rotqr
from sportzal.core.clock import at_local
from sportzal.i18n import scan_text

from .helpers import ADMIN, AZIZ, MALIKA, OWNER, SHERZOD, STRANGER, TODAY, Clock, member_no, scan_now, service_env


async def test_the_story_from_the_busy_morning_to_the_reminder():
    async with service_env() as (svc, clock):
        live = await svc.live()
        assert (live["count"], live["level"], live["quiet"], live["weeks"]) == (live["count"], "high", [14, 16], 4)
        before = live["count"]
        aziz = await member_no(svc, AZIZ)
        assert (await svc.my_card(AZIZ))["abon"] is None
        card, notes = await svc.sell(ADMIN, {"member": aziz, "plan": "t12", "paid": "cash"})
        assert card["abon"]["visits_left"] == 12 and card["abon"]["price"] == 350_000 and notes[0]["type"] == "sold"
        shot = await svc.qr(AZIZ)  # a friend takes a screenshot now
        clock.skip(minutes=0.5)
        res = await scan_now(svc, AZIZ)
        assert scan_text("uz", res) == "✅ Kirish: Aziz — 11 tashrif qoldi" and res["count"] == before + 1
        assert (await svc.live())["count"] == before + 1  # the same number on the desk and in the app
        assert (await svc.my_card(AZIZ))["abon"]["visits_left"] == 11
        old, _ = await svc.scan(ADMIN, {"token": shot["token"]})
        assert old["code"] == "bad" and scan_text("uz", old) == "❌ QR eskirgan yoki soxta"
        # Yoga 19:00 is full: Aziz is first on the waitlist; someone cancels and he is moved up
        yoga = {"class": "yoga19", "day": TODAY}
        view, _ = await svc.book(AZIZ, yoga)
        assert (view["me"], view["pos"], view["taken"]) == ("wait", 1, 12)
        other = (await svc.db.one("SELECT m.user_id FROM bookings b JOIN members m ON m.no = b.member WHERE class = 'yoga19' AND day = ? "
                                  "AND status = 'booked' ORDER BY b.id DESC LIMIT 1", (TODAY,)))["user_id"]
        _, notes = await svc.cancel(other, yoga)
        assert notes == [{"type": "promoted", "to": AZIZ, "class": "yoga19", "day": TODAY}]
        mine = next(s for s in (await svc.schedule_view(AZIZ))["items"] if s["class"] == "yoga19" and s["day"] == TODAY)
        assert (mine["me"], mine["taken"], mine["wait"]) == ("booked", 12, 0)
        # the evening: Aziz comes back, the trainer sees him in the list and marks attendance
        clock.at(TODAY, 18 * 60 + 50)
        assert (await scan_now(svc, AZIZ))["code"] == "ok"
        lst = await svc.session_list(MALIKA, yoga)
        row = next(p for p in lst["people"] if p["no"] == aziz)
        assert row["inside"] and lst["can_mark"]
        lst = await svc.mark(MALIKA, {**yoga, "member": aziz, "status": "attended"})
        assert next(p for p in lst["people"] if p["no"] == aziz)["status"] == "attended"
        # he freezes for 7 days from tomorrow: the end date moves by exactly 7
        end = (await svc.my_card(AZIZ))["abon"]["end_day"]
        card, notes = await svc.freeze(AZIZ, {"from": TODAY + 1, "days": 7})
        assert card["abon"]["end_day"] == end + 7 and card["abon"]["freeze"] == {"from_day": TODAY + 1, "days": 7}
        assert notes[0]["old_end"] == end and notes[0]["end"] == end + 7
        # the owner's dashboard: revenue includes the sale, the "tugayotganlar" list, a reminder sent once a day
        dash = await svc.dashboard(OWNER)
        rev = dash["revenue"]
        assert rev["total"] == sum(r["sum"] for r in rev["rows"]) == rev["cash"] + rev["card"]
        assert next(r for r in rev["rows"] if r["plan"] == "t12")["sum"] % 350_000 == 0
        target = next(s for s in dash["soon"] if s["has_tg"])
        _, notes = await svc.remind(OWNER, target["abon"]["id"])
        assert notes[0]["type"] == "remind" and notes[0]["kinds"]
        with pytest.raises(Refused, match="reminded"):
            await svc.remind(ADMIN, target["abon"]["id"])


async def test_roles_members_trainers_admins_owner():
    async with service_env() as (svc, _):
        aziz = await member_no(svc, AZIZ)
        for call in (svc.dashboard(AZIZ), svc.sell(AZIZ, {"member": aziz, "plan": "m1", "paid": "cash"}), svc.search(MALIKA, "Aziz"),
                     svc.scan(MALIKA, {"token": "x"}), svc.set_price(ADMIN, {"plan": "t12", "price": 1000}), svc.member_card(AZIZ, 2),
                     svc.login_link(AZIZ), svc.login_link(MALIKA), svc.trainer_view(ADMIN), svc.qr(ADMIN)):
            with pytest.raises(Refused, match="forbidden"):
                await call
        admin = await svc.dashboard(ADMIN)
        assert admin["revenue"] is None and (await svc.dashboard(OWNER))["revenue"]["total"] > 0
        assert not (await svc.prices(ADMIN))["can_edit"] and (await svc.prices(OWNER))["can_edit"]
        plans = await svc.set_price(OWNER, {"plan": "t12", "price": 380_000})
        assert next(p for p in plans if p["id"] == "t12")["price"] == 380_000
        for bad in (380_500, 0, "lots", None):
            with pytest.raises(Refused, match="price"):
                await svc.set_price(OWNER, {"plan": "t12", "price": bad})
        # trainers see only their own classes
        with pytest.raises(Refused, match="not_found"):
            await svc.session_list(SHERZOD, {"class": "yoga19", "day": TODAY})
        with pytest.raises(Refused, match="not_found"):
            await svc.mark(SHERZOD, {"class": "yoga19", "day": TODAY, "member": aziz, "status": "attended"})
        assert all(s["class"] in ("yoga19", "yoga08", "pilates10") for s in (await svc.trainer_view(MALIKA))["items"])
        # a member's freeze is their own; the desk freezes anyone's
        with pytest.raises(Refused, match="freeze_state"):
            await svc.freeze(AZIZ, {"from": TODAY + 1, "days": 3, "member": 2})
        assert (await svc.search(ADMIN, "Aziz Karimov"))[0]["no"] == aziz
        assert (await svc.search(ADMIN, "%")) == [] and (await svc.search(ADMIN, "1"))[0]["no"] == 1


async def test_scan_results_expired_window_frozen_and_exit():
    async with service_env() as (svc, clock):
        aziz = await member_no(svc, AZIZ)
        assert (await scan_now(svc, AZIZ))["code"] == "none"
        await svc.sell(ADMIN, {"member": aziz, "plan": "morning", "paid": "card"})
        clock.at(TODAY, 18 * 60 + 40)
        res = await scan_now(svc, AZIZ)
        assert scan_text("uz", res) == "⚠️ Ertalabki abonement: hozir 18:40"
        clock.at(TODAY + 1, 8 * 60)
        assert (await scan_now(svc, AZIZ))["code"] == "ok"
        clock.skip(minutes=75)
        assert scan_text("uz", await scan_now(svc, AZIZ)) == "👋 Chiqish: Aziz — 1 soat 15 daqiqa"
        await svc.freeze(AZIZ, {"from": TODAY + 2, "days": 3})
        clock.at(TODAY + 3, 9 * 60)
        assert (await scan_now(svc, AZIZ))["code"] == "frozen"
        clock.at(TODAY + 60, 9 * 60)
        assert scan_text("uz", await scan_now(svc, AZIZ)) == "⚠️ Abonement tugagan"


async def test_twelve_visits_then_used_up_and_auto_check_out():
    async with service_env() as (svc, clock):
        aziz = await member_no(svc, AZIZ)
        await svc.sell(ADMIN, {"member": aziz, "plan": "t12", "paid": "cash"})
        for k in range(12):
            clock.at(TODAY + k, 10 * 60)
            assert (await scan_now(svc, AZIZ))["code"] == "ok"  # no exit scan: the next day's entry is a new visit
        clock.at(TODAY + 12, 10 * 60)
        res = await scan_now(svc, AZIZ)
        assert res["code"] == "used_up" and scan_text("ru", res) == "⚠️ Абонемент закончился"
        auto = await svc.db.one("SELECT COUNT(*) AS n FROM visits WHERE member = ? AND auto = 1", (aziz,))
        assert auto["n"] == 12  # every visit closed at three hours
        clock.skip(minutes=0.5)  # the next QR step (the one just shown was used)
        await svc.sell(ADMIN, {"member": aziz, "plan": "t12", "paid": "card"})  # a used-up abonement renews from today
        assert (await scan_now(svc, AZIZ))["code"] == "ok"


async def test_short_code_replay_and_strangers():
    async with service_env() as (svc, clock):
        aziz = await member_no(svc, AZIZ)
        await svc.sell(ADMIN, {"member": aziz, "plan": "m1", "paid": "cash"})
        qr = await svc.qr(AZIZ)
        res, _ = await svc.scan(ADMIN, {"code": qr["code"].lower()})
        assert res["code"] == "ok" and res["no"] == aziz
        again, _ = await svc.scan(ADMIN, {"token": qr["token"]})
        assert again["code"] == "bad"  # the same step, once
        clock.skip(minutes=0.5)
        nxt = await svc.qr(AZIZ)
        assert nxt["token"] != qr["token"]
        clock.skip(minutes=1.5)
        assert (await svc.scan(ADMIN, {"token": nxt["token"]}))[0]["code"] == "bad"  # older than a minute
        forged = rotqr.token(b"not-the-server-secret", aziz, rotqr.step_of(clock.now))
        assert (await svc.scan(ADMIN, {"token": forged}))[0]["code"] == "bad"
        with pytest.raises(Refused, match="forbidden"):
            await svc.dashboard(STRANGER)


async def test_reminders_once_each_and_not_at_night():
    clock = Clock(at_local(TODAY, 3 * 60))
    async with service_env(clock) as (svc, _):
        assert await svc.tick() == []  # 03:00: nothing goes out
        clock.at(TODAY, 10 * 60)
        first = await svc.tick()  # the tests give seeded members Telegram ids: their reminders go out once
        assert first and all(n["type"] == "remind" for n in first)
        assert len({(n["abon"], n["kinds"][0]) for n in first}) == len(first)
        assert await svc.tick() == []
        aziz = await member_no(svc, AZIZ)
        await svc.sell(ADMIN, {"member": aziz, "plan": "t12", "paid": "cash"})
        await svc.db.conn.execute("UPDATE abonements SET end_day = ?, visits_left = 1 WHERE member = ?", (TODAY + 3, aziz))
        notes = await svc.tick()
        assert sorted(n["kinds"][0] for n in notes) == ["end3", "last1"] and all(n["to"] == AZIZ for n in notes)
        assert await svc.tick() == []
        await svc.sell(ADMIN, {"member": aziz, "plan": "t12", "paid": "cash"})  # renewed: nothing more
        clock.skip(days=1)
        assert [n for n in await svc.tick() if n["to"] == AZIZ] == []
