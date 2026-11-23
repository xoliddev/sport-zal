"""The admin panel's API (session cookie + CSRF, see web.py): signing in with a one-time link from the bot or the
Telegram Login Widget, the dashboard, scanning at the desk, today's check-ins, finding a member, selling and renewing,
freezing, reminders, a class list, and prices (the owner changes them; the administrator only reads them). Owner-only
numbers (revenue) are left out of the administrator's answers by the service itself."""

from __future__ import annotations

from aiohttp import web

from .common import Refused
from .web import COOKIE, body


def add_admin_routes(r: web.UrlDispatcher, svc, me_key, notify, *, bot_token: str, max_age: int, bot_username: str,
                     login_widget: bool, secure_cookie: bool) -> None:
    def ok(data) -> web.Response:
        return web.json_response(data)

    async def with_notes(result) -> web.Response:
        out, notes = result
        await notify(notes)
        return ok(out)

    def signed_in(sess: dict) -> web.Response:
        resp = web.json_response({"ok": True})
        resp.set_cookie(COOKIE, sess["session"], max_age=sess["max_age"], path="/admin/", httponly=True, secure=secure_cookie, samesite="Strict")
        return resp

    async def config(_):
        return ok({"widget": bool(login_widget and bot_username), "bot": bot_username if login_widget else ""})

    async def login(request):
        return signed_in(await svc.login_with_link((await body(request)).get("token")))

    async def login_widget_(request):
        if not login_widget:
            raise Refused("not_found")
        return signed_in(await svc.login_with_widget((await body(request)).get("user"), bot_token, max_age))

    async def logout(request):
        await svc.logout(request.cookies.get(COOKIE))
        resp = web.json_response({"ok": True})
        resp.del_cookie(COOKIE, path="/admin/")
        return resp

    async def me(request):
        sess = await svc.session_of(request.cookies.get(COOKIE))
        who = await svc.me(request[me_key])
        if who["role"] not in ("admin", "owner"):
            raise Refused("forbidden")
        return ok({**who, "csrf": sess["csrf"]})

    async def dashboard(request):
        return ok(await svc.dashboard(request[me_key]))

    async def live(request):
        await svc.need(request[me_key], "admin", "owner")
        return ok(await svc.live())

    async def visits(request):
        return ok(await svc.today_visits(request[me_key]))

    async def scan(request):
        return await with_notes(await svc.scan(request[me_key], await body(request)))

    async def search(request):
        return ok({"items": await svc.search(request[me_key], request.query.get("q", "")[:40])})

    async def member(request):
        no = request.query.get("no", "")
        return ok(await svc.member_card(request[me_key], int(no) if no.isdigit() and len(no) <= 9 else None))

    async def sell(request):
        return await with_notes(await svc.sell(request[me_key], await body(request)))

    async def freeze(request):
        await svc.need(request[me_key], "admin", "owner")
        return await with_notes(await svc.freeze(request[me_key], await body(request)))

    async def remind(request):
        return await with_notes(await svc.remind(request[me_key], (await body(request)).get("abon")))

    async def prices(request):
        return ok(await svc.prices(request[me_key]))

    async def price(request):
        return ok({"items": await svc.set_price(request[me_key], await body(request))})

    async def session(request):
        return ok(await svc.session_list(request[me_key], await body(request)))

    r.add_get("/admin/api/config", config)
    r.add_post("/admin/api/login", login)
    r.add_post("/admin/api/login-widget", login_widget_)
    r.add_post("/admin/api/logout", logout)
    r.add_get("/admin/api/me", me)
    r.add_get("/admin/api/dashboard", dashboard)
    r.add_get("/admin/api/live", live)
    r.add_get("/admin/api/visits", visits)
    r.add_post("/admin/api/scan", scan)
    r.add_get("/admin/api/search", search)
    r.add_get("/admin/api/member", member)
    r.add_post("/admin/api/sell", sell)
    r.add_post("/admin/api/freeze", freeze)
    r.add_post("/admin/api/remind", remind)
    r.add_get("/admin/api/prices", prices)
    r.add_post("/admin/api/price", price)
    r.add_post("/admin/api/session", session)
