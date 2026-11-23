"""Messages the bot sends on its own, from the service's notes: an abonement sold, every entry and exit (so a member
knows at once if someone else used their QR), a place that came free on the waitlist, a freeze, renewal reminders and
personal-training bookings for the trainer. Used by the bot handlers, the Mini App API, the admin panel and the
scheduler."""

from __future__ import annotations

import logging

from aiogram import Bot
from aiogram.exceptions import TelegramAPIError

from ..core.clock import hhmm, local_minute
from ..i18n import date_short, duration, left_text, money, plan_name, t, until
from .markup import markup
from .views import when

log = logging.getLogger(__name__)


class Notifier:
    def __init__(self, bot: Bot, service, cfg) -> None:
        self.bot, self.svc, self.cfg = bot, service, cfg

    async def _send(self, uid: int, text: str, rows=None) -> bool:
        if not uid or uid <= 0:  # the seeded, fictional people
            return False
        try:
            await self.bot.send_message(uid, text, reply_markup=markup(rows or [], self.cfg.webapp_url), disable_web_page_preview=True)
            return True
        except TelegramAPIError as err:  # blocked the bot, deleted account...
            log.info("could not notify %s: %s", uid, err)
            return False

    async def send(self, notes: list[dict]) -> None:
        for n in notes:
            try:
                lang = ((await self.svc.user(n["to"])) or {}).get("lang", "uz")
                text = await self.render(n, lang)
                if text:
                    await self._send(n["to"], text, [[(t(lang, "btn.menu"), "m")]])
            except Exception:  # one failed message never stops the rest
                log.exception("note %s failed", n.get("type"))

    async def render(self, n: dict, lang: str) -> str:
        kind = n["type"]
        if kind in ("sold", "checkin", "frozen", "remind"):
            ab = await self.svc.abon_for(n["abon"], lang)
            if ab is None:
                return ""
            name = plan_name(lang, ab)
            if kind == "sold":
                return t(lang, "note.sold", plan=name, to=date_short(lang, ab["end_day"]), left=left_text(lang, ab), price=money(lang, ab["price"]),
                         paid=t(lang, f"paid.{ab['paid']}"), **{"from": date_short(lang, ab["start_day"])})
            if kind == "checkin":
                return t(lang, "note.checkin", time=hhmm(local_minute(n["at"])), plan=name, left=left_text(lang, ab), until=until(lang, ab["end_day"]))
            if kind == "frozen":
                return t(lang, "note.frozen", to=date_short(lang, n["from"] + n["days"] - 1), days=n["days"], end=date_short(lang, n["end"]),
                         old=date_short(lang, n["old_end"]), **{"from": date_short(lang, n["from"])})
            lines = [t(lang, "note.end3", plan=name, date=date_short(lang, ab["end_day"])) if k == "end3" else t(lang, "note.last1", plan=name)
                     for k in n["kinds"]]
            return "\n".join([*lines, t(lang, "note.renew")])
        if kind == "checkout":
            return t(lang, "note.checkout", time=hhmm(local_minute(n["at"])), duration=duration(lang, n["minutes"] or 0))
        if kind == "promoted":
            k = next(c for c in await self.svc.classes() if c["id"] == n["class"])
            today = self.svc.today()
            return t(lang, "note.promoted", kind=self.svc.kinds[k["kind"]][lang], when=when(lang, n["day"], today), time=hhmm(k["start"]),
                     until=hhmm(max(0, k["start"] - 120)))
        if kind == "pt":
            return t(lang, "note.pt_taken" if n["taken"] else "note.pt_free", name=n["name"], date=date_short(lang, n["day"]), time=hhmm(n["start"]))
        log.warning("unknown note %s", kind)
        return ""
