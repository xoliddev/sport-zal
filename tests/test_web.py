"""HTTP: initData HMAC + freshness for the Mini App; the panel's one-time sign-in link, the session cookie, CSRF and
the same-origin check; roles kept apart over both APIs; strict input checks, body caps, CSP, static files."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager

from aiohttp.test_utils import TestClient, TestServer

from sportzal.security import sign_init_data, sign_login_widget
from sportzal.web import make_app

from .helpers import ADMIN, AZIZ, MALIKA, OWNER, STRANGER, TODAY, member_no, service_env

TOKEN = "123456:TEST-ONLY-NOT-A-REAL-TOKEN"


class Spy:
    def __init__(self) -> None:
        self.notes: list[dict] = []

    async def send(self, notes):
        self.notes.extend(notes)


def init_data(uid: int, clock, age: int = 0, token: str = TOKEN) -> str:
    fields = {"auth_date": str(clock() // 1000 - age), "query_id": "AAE-test",
              "user": json.dumps({"id": uid, "first_name": f"U{uid}", "language_code": "uz"})}
    return sign_init_data(fields, token)


@asynccontextmanager
async def client(widget: bool = False):
    async with service_env() as (svc, clock):
        spy = Spy()
        app = make_app(svc, TOKEN, spy, login_rate=5, bot_username="sportzal_test_bot", login_widget=widget, secure_cookie=False)
        async with TestClient(TestServer(app)) as c:
            def h(uid, **kw):
                return {"Authorization": f"tma {init_data(uid, clock, **kw)}"}
            yield c, svc, clock, spy, h


async def panel_login(c, svc, uid: int, token: str = "") -> str:
    token = token or await svc.login_link(uid)
    r = await c.post("/admin/api/login", json={"token": token})
    assert r.status == 200 and "HttpOnly" in r.headers["Set-Cookie"] and "SameSite=Strict" in r.headers["Set-Cookie"]
    me = await (await c.get("/admin/api/me")).json()
    return me["csrf"]


async def test_mini_app_auth_and_member_isolation():
    async with client() as (c, _svc, _clock, _spy, h):
        assert (await c.get("/api/me")).status == 401
        assert (await c.get("/api/me", headers=h(AZIZ, age=7200))).status == 401  # stale initData
        assert (await c.get("/api/me", headers=h(AZIZ, token="999:other"))).status == 401
        me = await (await c.get("/api/me", headers=h(AZIZ))).json()
        assert me["role"] == "member" and me["no"] == 1
        live = await (await c.get("/api/live", headers=h(AZIZ))).json()
        assert live["level"] == "high" and live["quiet"] == [14, 16]
        qr = await (await c.get("/api/qr", headers=h(AZIZ))).json()
        assert qr["token"].startswith("SZ1.1.") and len(qr["code"]) == 9
        assert (await c.get("/api/qr", headers=h(MALIKA))).status == 403  # trainers have no member QR
        r = await c.post("/api/freeze", headers=h(AZIZ), json={"member": 2, "from": TODAY + 1, "days": 3})
        assert (await r.json())["error"] == "freeze_state"  # "member" is ignored: Aziz has no abonement yet
        assert (await c.get("/api/dashboard", headers=h(AZIZ))).status == 404
        assert (await c.get("/api/trainer", headers=h(AZIZ))).status == 403
        r = await c.post("/api/book", headers=h(AZIZ), data=b"x" * 20_000)
        assert r.status == 413
        r = await c.post("/api/book", headers=h(AZIZ), data=b"{not json")
        assert r.status == 400
        r = await c.post("/api/session", headers=h(MALIKA), json={"class": "boks20", "day": TODAY})
        assert r.status == 404  # someone else's class
        r = await c.get("/api/card", headers=h(AZIZ))
        assert "default-src 'self'" in r.headers["Content-Security-Policy"] and r.headers["Cache-Control"] == "no-store"
        assert r.headers["Permissions-Policy"].startswith("camera=()")


async def test_panel_sign_in_link_once_cookie_and_csrf():
    async with client() as (c, svc, _clock, spy, h):
        assert (await c.get("/admin/api/dashboard")).status == 401
        token = await svc.login_link(ADMIN)
        assert (await c.post("/admin/api/login", json={"token": token}, headers={"Origin": "https://evil.example"})).status == 403
        csrf = await panel_login(c, svc, ADMIN, token)  # refused from another site, so still unused
        r = await c.post("/admin/api/login", json={"token": token})
        assert r.status == 401  # the link works once
        dash = await (await c.get("/admin/api/dashboard")).json()
        assert dash["role"] == "admin" and dash["revenue"] is None and dash["live"]["count"] > 0
        aziz = await member_no(svc, AZIZ)
        sale = {"member": aziz, "plan": "t12", "paid": "cash"}
        assert (await c.post("/admin/api/sell", json=sale)).status == 403  # no CSRF header
        assert (await c.post("/admin/api/sell", json=sale, headers={"X-CSRF-Token": "x" * 32})).status == 403
        r = await c.post("/admin/api/sell", json=sale, headers={"X-CSRF-Token": csrf})
        assert r.status == 200 and (await r.json())["abon"]["visits_left"] == 12 and spy.notes[-1]["type"] == "sold"
        r = await c.post("/admin/api/price", json={"plan": "t12", "price": 400000}, headers={"X-CSRF-Token": csrf})
        assert r.status == 403  # administrators cannot change prices
        qr = await (await c.get("/api/qr", headers=h(AZIZ))).json()
        r = await c.post("/admin/api/scan", json={"token": qr["token"]}, headers={"X-CSRF-Token": csrf})
        res = await r.json()
        assert res["code"] == "ok" and res["abon"]["visits_left"] == 11 and res["count"] == dash["live"]["count"] + 1
        member = await (await c.get(f"/admin/api/member?no={aziz}")).json()
        assert member["abon"]["visits_left"] == 11 and member["inside"]
        assert (await c.get("/admin/api/member?no=abc")).status == 404
        found = await (await c.get("/admin/api/search?q=Aziz Kar")).json()
        assert found["items"][0]["no"] == aziz
        r = await c.get("/admin/")
        assert r.status == 200 and r.headers["Permissions-Policy"].startswith("camera=(self)")
        await c.post("/admin/api/logout")
        assert (await c.get("/admin/api/dashboard")).status == 401


async def test_owner_sees_revenue_and_changes_prices_staff_only_sign_in():
    async with client(widget=True) as (c, svc, clock, _spy, _h):
        csrf = await panel_login(c, svc, OWNER)
        dash = await (await c.get("/admin/api/dashboard")).json()
        rev = dash["revenue"]
        assert rev["total"] == sum(r["sum"] for r in rev["rows"]) == rev["cash"] + rev["card"]
        r = await c.post("/admin/api/price", json={"plan": "t12", "price": 380000}, headers={"X-CSRF-Token": csrf})
        assert next(p for p in (await r.json())["items"] if p["id"] == "t12")["price"] == 380000
        r = await c.post("/admin/api/price", json={"plan": "t12", "price": "380 000"}, headers={"X-CSRF-Token": csrf})
        assert (await r.json())["error"] == "price"
        user = sign_login_widget({"id": str(OWNER), "first_name": "R", "auth_date": str(clock() // 1000)}, TOKEN)
        assert (await c.post("/admin/api/login-widget", json={"user": user})).status == 200
        stranger = sign_login_widget({"id": str(STRANGER), "first_name": "S", "auth_date": str(clock() // 1000)}, TOKEN)
        assert (await c.post("/admin/api/login-widget", json={"user": stranger})).status == 401
        forged = {**user, "id": str(ADMIN)}
        assert (await c.post("/admin/api/login-widget", json={"user": forged})).status == 401
        statuses = [(await c.post("/admin/api/login", json={"token": "A" * 43})).status for _ in range(6)]
        assert 429 in statuses  # sign-in attempts are rate-limited per address


async def test_static_files_and_traversal():
    async with client() as (c, *_):
        for path in ("/webapp/", "/admin/", "/admin/login.html", "/shared/rotqr.js", "/shared/locales/uz.json"):
            assert (await c.get(path)).status == 200, path
        assert (await c.get("/webapp/../sportzal/config.py")).status in (403, 404)
        assert (await c.get("/healthz")).status == 200
