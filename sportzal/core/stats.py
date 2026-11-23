"""The owner's numbers: revenue this month by abonement type (whole so'm, totals exact) and class fill rates."""

from __future__ import annotations

from .classes import fill, sessions
from .clock import civil, days_from_civil


def month_of(day: int) -> tuple[int, int]:
    """First and last day of the calendar month that contains ``day``."""
    y, m, _ = civil(day)
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    return days_from_civil(y, m, 1), days_from_civil(ny, nm, 1) - 1


def revenue(sales: list[dict], plans: list[dict], day: int) -> dict:
    """Sales are ``{"plan", "price", "paid", "day"}``. Rows follow the plan order; every plan has a row."""
    first, last = month_of(day)
    rows = {p["id"]: {"plan": p["id"], "count": 0, "sum": 0} for p in plans}
    out = {"from": first, "to": last, "total": 0, "count": 0, "cash": 0, "card": 0}
    for s in sales:
        if not first <= s["day"] <= last:
            continue
        row = rows.setdefault(s["plan"], {"plan": s["plan"], "count": 0, "sum": 0})
        row["count"] += 1
        row["sum"] += s["price"]
        out["total"] += s["price"]
        out["count"] += 1
        out[s["paid"]] += s["price"]
    out["rows"] = list(rows.values())
    return out


def fill_rates(classes: list[dict], taken: dict[str, int], first: int, last: int) -> list[dict]:
    """Per class over the sessions from day ``first`` to ``last``: sessions, places taken (``taken`` is keyed
    ``"<class>:<day>"``), places offered and the whole percent (rounded down)."""
    out = {c["id"]: {"class": c["id"], "kind": c["kind"], "sessions": 0, "taken": 0, "places": 0, "pct": 0} for c in classes}
    caps = {c["id"]: c["cap"] for c in classes}
    for s in sessions(classes, first, last):
        row = out[s["class"]]
        row["sessions"] += 1
        row["places"] += caps[s["class"]]
        row["taken"] += min(caps[s["class"]], taken.get(f"{s['class']}:{s['day']}", 0))
    for row in out.values():
        row["pct"] = fill(row["taken"], row["places"]) if row["places"] else 0
    return list(out.values())
