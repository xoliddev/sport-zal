"""Texts for the bot, read from shared/locales/*.json (the Mini App, the admin panel and the browser demo read the same
files), plus the sentences every screen needs: money, dates, the abonement's state, a scan's result, the live count.
shared/i18n.js is the same code for the browser, and shared/test_vectors.json checks that both write the same
sentence ("✅ Kirish: Aziz — 11 tashrif qoldi")."""

from __future__ import annotations

import html
import json
import re
from functools import cache
from pathlib import Path

from .core.clock import civil, hhmm

LOCALE_DIR = Path(__file__).resolve().parent.parent / "shared" / "locales"
_PLACEHOLDER = re.compile(r"\{(\w+)\}")


def norm_lang(code: str | None) -> str:
    return "ru" if code and str(code)[:2].lower() == "ru" else "uz"


class Raw(str):
    """A parameter that is already safe HTML (for example a nested, already-rendered text)."""


@cache
def catalog(lang: str) -> dict[str, str]:
    with open(LOCALE_DIR / f"{lang}.json", encoding="utf-8") as fh:
        return json.load(fh)


def render(template: str, params: dict) -> str:
    def sub(m: re.Match) -> str:
        if m.group(1) not in params:
            return m.group(0)
        value = params[m.group(1)]
        return value if isinstance(value, Raw) else html.escape(str(value), quote=False)

    return _PLACEHOLDER.sub(sub, template)


def t(lang: str, key: str, **params: object) -> str:
    """Localized text; parameters are HTML-escaped unless wrapped in ``Raw``."""
    lang = norm_lang(lang)
    template = catalog(lang).get(key) or catalog("uz").get(key) or key
    return render(template, params)


def plain(text: str) -> str:
    """For callback alerts, which show plain text."""
    return html.unescape(re.sub(r"<[^>]+>", "", text))


def group(n: int) -> str:
    """1250000 -> "1 250 000"."""
    s = str(abs(n))
    out = ""
    while len(s) > 3:
        out = " " + s[-3:] + out
        s = s[:-3]
    return ("-" if n < 0 else "") + s + out


def money(lang: str, n: int) -> str:
    return t(lang, "fmt.money", n=group(n))


def date_short(lang: str, day: int) -> str:
    _, m, d = civil(day)
    return t(lang, "fmt.day", d=d, month=t(lang, f"month.{m}"))


def until(lang: str, day: int) -> str:
    _, m, d = civil(day)
    return t(lang, "fmt.until", d=d, month=t(lang, f"month.{m}"))


def duration(lang: str, minutes: int) -> str:
    h, m = divmod(max(0, minutes), 60)
    if h and m:
        return t(lang, "fmt.hm", h=h, m=m)
    return t(lang, "fmt.h", h=h) if h else t(lang, "fmt.m", m=m)


def plan_name(lang: str, view: dict) -> str:
    return view["ru"] if norm_lang(lang) == "ru" else view["uz"]


def left_text(lang: str, view: dict) -> str:
    """"11 tashrif qoldi" or "cheksiz" — the same words in the app, the bot, the desk and the door."""
    if view["visits_left"] is None:
        return t(lang, "abon.unlimited")
    return t(lang, "abon.left", n=view["visits_left"])


def state_text(lang: str, state: dict) -> str:
    code = state["code"]
    if code in ("frozen", "expired", "not_started"):
        return t(lang, f"state.{code}", date=date_short(lang, state["day"]))
    if code == "window":
        return t(lang, "state.window", time=hhmm(state["minute"]))
    return t(lang, f"state.{code}")


def scan_text(lang: str, res: dict) -> str:
    """The desk's one line for a scan result."""
    code = res["code"]
    if code == "ok":
        tail = left_text(lang, res["abon"]) if res["abon"]["visits_left"] is not None else t(
            lang, "scan.unlimited_until", until=until(lang, res["abon"]["end_day"]))
        return t(lang, "scan.ok", name=res["name"].split(" ")[0], tail=Raw(tail))
    if code == "exit":
        return t(lang, "scan.exit", name=res["name"].split(" ")[0], time=duration(lang, res["minutes"]))
    if code == "bad":
        return t(lang, "scan.bad")
    if code in ("expired", "used_up"):
        return t(lang, "scan.ended")
    return t(lang, "scan.warn", text=Raw(state_text(lang, res)))


def scan_detail(lang: str, res: dict) -> str:
    """A second line under a refused scan: why, in a few words."""
    if res["code"] == "expired":
        return t(lang, "scan.expired_on", date=date_short(lang, res["day"]))
    if res["code"] == "used_up":
        return t(lang, "scan.used_up")
    return ""


def live_text(lang: str, live: dict) -> str:
    return t(lang, "live.now", n=live["count"])


def quiet_text(lang: str, live: dict) -> str:
    q = live["quiet"]
    if not q:
        return t(lang, "live.no_quiet")
    return t(lang, "live.quiet", time=f"{q[0]:02d}:00–{q[1]:02d}:00")
