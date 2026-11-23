"""Buttons only: ``/start`` (with the deep links ``ab``, ``cl`` and ``live``) is the one command. Members: the live
count with the forecast, the abonement and freezing, today's and tomorrow's classes with booking, the waitlist and
cancelling, the Mini App with the QR. Trainers: today's classes. The desk and the owner: a one-time sign-in link to the
panel. Every screen has "⬅️ Orqaga". Callback data is matched by strict regexes and every action is re-checked by the
service against the caller's Telegram id."""

from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import CommandObject, CommandStart
from aiogram.types import CallbackQuery, Message

from ..common import Refused
from ..i18n import t
from . import views
from .setup import show

router = Router(name="main")
fallback = Router(name="fallback")
SESSION = r"^(c|cb|cx):([a-z0-9]{1,16}):(\d{1,6})$"


async def menu(event, svc, me: int, cfg, hello: bool = False) -> None:
    who = await svc.me(me)
    card = await svc.my_card(me) if who["role"] == "member" else None
    await show(event, views.menu(who["lang"], who, card, await svc.live(), hello), cfg)


@router.message(CommandStart())
async def start(message: Message, svc, me, lang, cfg, command: CommandObject | None = None) -> None:
    arg = (command.args or "") if command else ""
    who = await svc.role(me)
    if arg == "ab" and who["role"] == "member":
        await show(message, views.abon_screen(lang, await svc.my_card(me)), cfg)
    elif arg == "cl" and who["role"] == "member":
        await show(message, views.classes_screen(lang, (await svc.schedule_view(me))["items"], svc.today(), svc.kinds), cfg)
    elif arg == "live":
        await show(message, views.live_screen(lang, await svc.live()), cfg)
    else:
        await menu(message, svc, me, cfg, hello=True)


@router.callback_query(F.data == "m")
async def nav_menu(cq: CallbackQuery, svc, me, cfg) -> None:
    await menu(cq, svc, me, cfg)


@router.callback_query(F.data == "lang")
async def switch_lang(cq: CallbackQuery, svc, me, lang, cfg) -> None:
    await svc.set_lang(me, "ru" if lang == "uz" else "uz")
    await menu(cq, svc, me, cfg)


@router.callback_query(F.data == "live")
async def live(cq: CallbackQuery, svc, lang, cfg) -> None:
    await show(cq, views.live_screen(lang, await svc.live()), cfg)


@router.callback_query(F.data == "ab")
async def abon(cq: CallbackQuery, svc, me, lang, cfg) -> None:
    await show(cq, views.abon_screen(lang, await svc.my_card(me)), cfg)


@router.callback_query(F.data == "fz")
async def freeze_ask(cq: CallbackQuery, svc, me, lang, cfg) -> None:
    card = await svc.my_card(me)
    if card["abon"] is None or not card["abon"]["freeze_left"]:
        raise Refused("freeze_none" if card["abon"] else "freeze_state")
    await show(cq, views.freeze_ask(lang, card), cfg)


@router.callback_query(F.data.regexp(r"^fz:(\d{1,2})$"))
async def freeze_confirm(cq: CallbackQuery, svc, me, lang, cfg) -> None:
    card = await svc.my_card(me)
    days = int(cq.data.split(":")[1])
    if card["abon"] is None or days not in views.freeze_options(card["abon"]):
        raise Refused("freeze_days")
    await show(cq, views.freeze_confirm(lang, card, days, svc.today()), cfg)


@router.callback_query(F.data.regexp(r"^fzok:(\d{1,2})$"))
async def freeze_do(cq: CallbackQuery, svc, me, lang, cfg, notifier) -> None:
    card, notes = await svc.freeze(me, {"from": svc.today() + 1, "days": int(cq.data.split(":")[1])})
    await notifier.send(notes)
    await show(cq, views.abon_screen(lang, card), cfg)


@router.callback_query(F.data == "cl")
async def classes(cq: CallbackQuery, svc, me, lang, cfg) -> None:
    await show(cq, views.classes_screen(lang, (await svc.schedule_view(me))["items"], svc.today(), svc.kinds), cfg)


@router.callback_query(F.data.regexp(SESSION))
async def session(cq: CallbackQuery, svc, me, lang, cfg, notifier) -> None:
    act, cid, day = cq.data.split(":")
    data = {"class": cid, "day": int(day)}
    if act == "cb":
        await svc.book(me, data)
    elif act == "cx":
        _, notes = await svc.cancel(me, data)
        await notifier.send(notes)
    item = next((s for s in (await svc.schedule_view(me))["items"] if s["class"] == cid and s["day"] == int(day)), None)
    if item is None:
        raise Refused("not_found")
    await show(cq, views.class_screen(lang, item, svc.today(), svc.kinds), cfg)


@router.callback_query(F.data == "tr")
async def trainer(cq: CallbackQuery, svc, me, lang, cfg) -> None:
    await show(cq, views.trainer_screen(lang, (await svc.trainer_view(me))["items"], svc.today(), svc.kinds), cfg)


@router.callback_query(F.data == "panel")
async def panel(cq: CallbackQuery, svc, me, lang, cfg) -> None:
    link = cfg.login_link(await svc.login_link(me)) if cfg.admin_url else ""
    await show(cq, views.panel(lang, link), cfg)


@fallback.callback_query()
async def stale(cq: CallbackQuery, lang) -> None:
    await cq.answer(t(lang, "bot.stale"), show_alert=True)


@fallback.message()
async def unknown(message: Message, svc, me, lang, cfg) -> None:
    await message.answer(t(lang, "bot.unknown"))
    await menu(message, svc, me, cfg)
