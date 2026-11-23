"""Bot screens as (html, rows) built from the service's answers. demo/bot-views.js builds the same screens in the
browser. Every screen has "⬅️ Orqaga" (or the menu), and user text is escaped by ``t``."""

from __future__ import annotations

from ..core.clock import hhmm, local_day, weekday
from ..i18n import Raw, date_short, left_text, live_text, money, plan_name, quiet_text, state_text, t, until

Screen = tuple[str, list[list[tuple[str, str]]]]


def back(lang: str, to: str = "m") -> list[tuple[str, str]]:
    return [(t(lang, "btn.back"), to)]


def abon_line(lang: str, card: dict) -> str:
    ab = card["abon"]
    if ab is None:
        return t(lang, "bot.abon_none")
    line = t(lang, "bot.abon_line", plan=plan_name(lang, ab), left=left_text(lang, ab), until=until(lang, ab["end_day"]))
    if ab["state"]["code"] != "ok":
        line += "\n" + t(lang, "bot.abon_state", state=Raw(state_text(lang, ab["state"])))
    return line


def menu(lang: str, me: dict, card: dict | None, live: dict, hello: bool = False) -> Screen:
    head = t(lang, "bot.hello" if hello else "bot.menu", gym=me["gym"], name=me["name"].split(" ")[0])
    lines = [head, t(lang, "bot.live_line", live=live_text(lang, live), level=t(lang, f"level.{live['level']}"))]
    rows: list[list[tuple[str, str]]] = []
    if me["role"] == "member":
        lines.append(abon_line(lang, card))
        rows += [[(t(lang, "btn.app"), "@app#qr")], [(t(lang, "btn.live"), "live"), (t(lang, "btn.abon"), "ab")], [(t(lang, "btn.classes"), "cl")]]
    elif me["role"] == "trainer":
        rows += [[(t(lang, "btn.my_classes"), "tr")], [(t(lang, "btn.app"), "@app#trainer")], [(t(lang, "btn.live"), "live")]]
    else:
        rows += [[(t(lang, "btn.panel"), "panel")], [(t(lang, "btn.live"), "live")]]
    rows.append([(t(lang, "btn.lang"), "lang")])
    return "\n\n".join(lines), rows


def bars(live: dict) -> str:
    """The forecast as a small monospace chart: one row per opening hour, the quietest window marked."""
    first, last = -(-live["open"] // 60), live["close"] // 60
    hours = live["forecast"]
    top = max([hours[h] for h in range(first, last)] + [1])
    quiet = live["quiet"] or [-1, -1]
    now = live["minute"] // 60
    rows = []
    for h in range(first, last):
        n = hours[h]
        mark = " ◀" if h == now else (" ✓" if quiet[0] <= h < quiet[1] else "")
        rows.append(f"{h:02d} {'█' * max(1 if n else 0, round(n * 10 / top))}{'·' if not n else ''} {n}{mark}")
    return "<pre>" + "\n".join(rows) + "</pre>"


def live_screen(lang: str, live: dict) -> Screen:
    day = t(lang, f"wdl.{weekday(local_day(live['at']))}")
    estimate = t(lang, "live.estimate", n=live["weeks"], day=day) if live["weeks"] else t(lang, "live.no_history")
    text = t(lang, "bot.live", live=live_text(lang, live), level=t(lang, f"level.{live['level']}"), pct=live["pct"],
             quiet=quiet_text(lang, live), estimate=estimate, bars=Raw(bars(live) if live["weeks"] else ""))
    return text, [[(t(lang, "btn.refresh"), "live")], back(lang)]


def abon_screen(lang: str, card: dict) -> Screen:
    ab = card["abon"]
    if ab is None:
        return t(lang, "abon.none") + "\n" + t(lang, "abon.none_hint"), [back(lang)]
    freeze = ""
    if ab["freeze"]:
        f = ab["freeze"]
        freeze = t(lang, "abon.frozen_plan", **{"from": date_short(lang, f["from_day"]), "to": date_short(lang, f["from_day"] + f["days"] - 1)})
    elif ab["freeze_left"]:
        freeze = t(lang, "abon.freeze_left", n=ab["freeze_left"])
    else:
        freeze = t(lang, "abon.freeze_none")
    text = t(lang, "bot.abon", plan=plan_name(lang, ab), state=Raw(state_text(lang, ab["state"])), left=left_text(lang, ab),
             to=date_short(lang, ab["end_day"]), freeze=Raw(freeze), **{"from": date_short(lang, ab["start_day"])})
    if card.get("next"):
        nx = card["next"]
        text += "\n" + t(lang, "abon.next", name=plan_name(lang, nx), **{"from": date_short(lang, nx["start_day"])})
    rows = []
    if ab["freeze_left"] and not ab["freeze"] and ab["days_left"] >= 1 and ab["state"]["code"] in ("ok", "window"):
        rows.append([(t(lang, "btn.freeze"), "fz")])
    rows.append(back(lang))
    return text, rows


def freeze_options(ab: dict) -> list[int]:
    left = ab["freeze_left"]
    return sorted({n for n in (3, 7, left) if 1 <= n <= left})


def freeze_ask(lang: str, card: dict) -> Screen:
    ab = card["abon"]
    rows = [[(t(lang, "btn.freeze_n", n=n), f"fz:{n}") for n in freeze_options(ab)], back(lang, "ab")]
    return t(lang, "bot.freeze_ask", n=ab["freeze_left"]), rows


def freeze_confirm(lang: str, card: dict, days: int, today: int) -> Screen:
    ab = card["abon"]
    text = t(lang, "bot.freeze_confirm", days=days, to=date_short(lang, today + days), end=date_short(lang, ab["end_day"] + days),
             old=date_short(lang, ab["end_day"]), **{"from": date_short(lang, today + 1)})
    return text, [[(t(lang, "btn.freeze_ok"), f"fzok:{days}")], back(lang, "fz")]


def when(lang: str, day: int, today: int) -> str:
    if day == today:
        return t(lang, "when.today")
    if day == today + 1:
        return t(lang, "when.tomorrow")
    return date_short(lang, day)


def session_label(lang: str, s: dict, kinds: dict) -> str:
    mark = {"booked": "✅ ", "wait": "⏳ "}.get(s["me"] or "", "")
    wait = " · " + t(lang, "class.wait", n=s["wait"]) if s["wait"] else ""
    return f"{mark}{hhmm(s['start'])} {kinds[s['kind']][lang]} — {s['taken']}/{s['cap']}{wait}"


def classes_screen(lang: str, items: list[dict], today: int, kinds: dict) -> Screen:
    near = [s for s in items if s["day"] <= today + 1 and not s["past"]]
    if not near:
        return t(lang, "bot.classes_none"), [back(lang)]
    rows = []
    for d in (today, today + 1):
        for s in (x for x in near if x["day"] == d):
            rows.append([(("" if d == today else when(lang, d, today) + " ") + session_label(lang, s, kinds), f"c:{s['class']}:{s['day']}")])
    return t(lang, "bot.classes"), [*rows[:12], back(lang)]


def class_screen(lang: str, s: dict, today: int, kinds: dict) -> Screen:
    places = t(lang, "class.places", taken=s["taken"], cap=s["cap"]) if s["taken"] < s["cap"] else t(lang, "class.full")
    wait = " · " + t(lang, "class.wait", n=s["wait"]) if s["wait"] else ""
    me = ""
    if s["me"] == "booked":
        cancel_at = hhmm(s["start"] - 120) if s["start"] >= 120 else "00:00"
        me = t(lang, "class.booked") + "\n" + (t(lang, "bot.class_cancel_until", time=cancel_at) if s["can_cancel"] else t(lang, "bot.class_no_cancel"))
    elif s["me"] == "wait":
        me = t(lang, "class.waiting", n=s["pos"])
    text = t(lang, "bot.class", kind=kinds[s["kind"]][lang], when=when(lang, s["day"], today), time=hhmm(s["start"]),
             trainer=t(lang, "class.trainer", name=s["trainer"]), places=places, wait=wait, me=Raw(me))
    key = f"{s['class']}:{s['day']}"
    rows = []
    if s["me"] is None and not s["past"]:
        rows.append([(t(lang, "btn.book") if s["taken"] < s["cap"] else t(lang, "btn.wait"), f"cb:{key}")])
    elif s["me"] == "booked" and s["can_cancel"]:
        rows.append([(t(lang, "btn.cancel"), f"cx:{key}")])
    elif s["me"] == "wait":
        rows.append([(t(lang, "btn.leave_wait"), f"cx:{key}")])
    rows.append(back(lang, "cl"))
    return text, rows


def trainer_screen(lang: str, items: list[dict], today: int, kinds: dict) -> Screen:
    mine = [s for s in items if s["day"] == today]
    if not mine:
        return t(lang, "bot.trainer_none"), [[(t(lang, "btn.app"), "@app#trainer")], back(lang)]
    rows = [t(lang, "bot.trainer_row", time=hhmm(s["start"]), kind=kinds[s["kind"]][lang], places=t(lang, "class.places", taken=s["taken"], cap=s["cap"]),
              wait=" · " + t(lang, "class.wait", n=s["wait"]) if s["wait"] else "") for s in mine]
    text = t(lang, "bot.trainer", list=Raw("\n".join(rows))) + "\n\n" + t(lang, "bot.trainer_hint")
    return text, [[(t(lang, "btn.app"), "@app#trainer")], back(lang)]


def panel(lang: str, link: str) -> Screen:
    if not link:
        return t(lang, "bot.panel_off"), [back(lang)]
    return t(lang, "bot.panel"), [[(t(lang, "btn.open_panel"), link)], back(lang)]


def money_line(lang: str, price: int, paid: str) -> tuple[str, str]:
    return money(lang, price), t(lang, f"paid.{paid}")
