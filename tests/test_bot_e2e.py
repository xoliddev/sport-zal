"""The real aiogram handlers against a mocked Bot API: Aziz's menu with the live count, the forecast chart, the
abonement after a sale and its freeze by buttons, booking a full class (the waitlist), being moved up when someone
cancels; the trainer's day; the panel's one-time link for the desk; the language; forged and stale buttons."""

from __future__ import annotations

from .helpers import ADMIN, AZIZ, MALIKA, TODAY, member_no, scan_now, service_env
from .tg_sim import TgSim


async def test_member_by_buttons():
    async with service_env() as (svc, clock):
        tg = TgSim(svc)
        await tg.say(AZIZ, "/start")
        text = tg.last(AZIZ)
        assert "Assalomu alaykum, Aziz!" in text and "Hozir zalda" in text and "Gavjum" in text and "Faol abonement yo'q" in text
        assert "⬅️ Orqaga" not in tg.buttons(AZIZ) and "👥 Zal hozir" in tg.buttons(AZIZ)
        await tg.tap(AZIZ, "Zal hozir")
        assert "Eng bo'sh vaqt: 14:00–16:00" in tg.last(AZIZ) and "<pre>" in tg.last(AZIZ) and "Taxmin" in tg.last(AZIZ)
        await tg.tap(AZIZ, "Orqaga")
        aziz = await member_no(svc, AZIZ)
        _, notes = await svc.sell(ADMIN, {"member": aziz, "plan": "t12", "paid": "cash"})
        await tg.notifier.send(notes)
        assert "Abonement rasmiylashtirildi: <b>12 tashrif</b>" in tg.last(AZIZ) and "350 000 so'm (naqd)" in tg.last(AZIZ)
        clock.skip(minutes=0.5)
        res = await scan_now(svc, AZIZ)
        assert res["code"] == "ok"
        await tg.notifier.send([{"type": "checkin", "to": AZIZ, "abon": res["abon_id"], "at": clock.now}])
        assert "Kirish qayd etildi, 09:20" in tg.last(AZIZ) and "11 tashrif qoldi" in tg.last(AZIZ)
        await tg.tap(AZIZ, "Menyu")
        await tg.tap(AZIZ, "Abonement")
        end = (await svc.my_card(AZIZ))["abon"]["end_day"]
        assert "11 tashrif qoldi" in tg.last(AZIZ) and "Muzlatish uchun 7 kun bor" in tg.last(AZIZ)
        await tg.tap(AZIZ, "Muzlatish")
        await tg.tap(AZIZ, "7 kun")
        assert "Yangi tugash sanasi" in tg.last(AZIZ)
        await tg.tap(AZIZ, "Ha, muzlatish")
        assert (await svc.my_card(AZIZ))["abon"]["end_day"] == end + 7
        assert any("Abonement muzlatildi" in x for x in tg.texts(AZIZ))
        await tg.tap_data(AZIZ, "fzok:7")  # pressed twice: refused, nothing changes
        assert "Abonement allaqachon muzlatilgan." in tg.alerts()
        assert (await svc.my_card(AZIZ))["abon"]["end_day"] == end + 7


async def test_waitlist_by_buttons_and_promotion_message():
    async with service_env() as (svc, clock):
        tg = TgSim(svc)
        aziz = await member_no(svc, AZIZ)
        await svc.sell(ADMIN, {"member": aziz, "plan": "m1", "paid": "card"})
        await tg.say(AZIZ, "/start cl")
        await tg.tap(AZIZ, "19:00 Yoga — 12/12")
        assert "Joy qolmagan" in tg.last(AZIZ)
        await tg.tap(AZIZ, "Navbatga turish")
        assert "Navbatda: 1-o'rin" in tg.last(AZIZ)
        other = (await svc.db.one("SELECT m.user_id FROM bookings b JOIN members m ON m.no = b.member WHERE b.class = 'yoga19' "
                                  "AND b.day = ? AND b.status = 'booked' LIMIT 1", (TODAY,)))["user_id"]
        await tg.say(other, "/start cl")
        await tg.tap(other, "✅ 19:00 Yoga")
        await tg.tap(other, "Bekor qilish")
        promoted = tg.last(AZIZ)
        assert "Joy bo'shadi!" in promoted and "<b>Yoga</b>ga yozildingiz: bugun, 19:00" in promoted and "17:00 gacha" in promoted
        clock.skip(minutes=8 * 60)  # 17:20: too late to cancel
        await tg.say(AZIZ, "/start cl")
        await tg.tap(AZIZ, "✅ 19:00 Yoga")
        assert "Bekor qilish muddati o'tgan" in tg.last(AZIZ) and "Bekor qilish" not in "".join(tg.buttons(AZIZ))
        await tg.tap_data(AZIZ, f"cx:yoga19:{TODAY}")
        assert any("2 soatdan kam" in a for a in tg.alerts())
        await tg.tap_data(AZIZ, "cb:nope:1")
        assert "Topilmadi." in tg.alerts()


async def test_staff_trainer_language_and_stale_buttons():
    async with service_env() as (svc, _):
        tg = TgSim(svc)
        await tg.say(MALIKA, "/start")
        await tg.tap(MALIKA, "Darslarim")
        assert "19:00 Yoga — 12/12 joy" in tg.last(MALIKA)
        await tg.say(ADMIN, "/start")
        await tg.tap(ADMIN, "Panelga kirish")
        _, link = tg.find(ADMIN, "Panelni ochish")
        assert link.url.startswith("https://zal.example/admin/login.html?t=") and len(link.url.split("t=")[1]) == 43
        await tg.tap(ADMIN, "Orqaga")
        await tg.tap(ADMIN, "Русский")
        assert "Сейчас в зале" in tg.last(ADMIN) and "Войти в панель" in "".join(tg.buttons(ADMIN))
        await tg.tap_data(AZIZ, "panel")
        assert "Это действие вам недоступно." not in tg.alerts() and "Bu amal sizga ruxsat etilmagan." in tg.alerts()
        await tg.tap_data(AZIZ, "something:old")
        assert "Bu tugma eskirgan. Menyuni oching." in tg.alerts()
        await tg.say(AZIZ, "salom")
        assert "Tugmalardan foydalaning" in tg.texts(AZIZ)[-2]
