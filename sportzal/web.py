"""aiohttp server: the Mini App (/webapp/), the admin panel (/admin/), their JSON APIs and the shared files.

* ``/api/...`` (the Mini App) must carry ``Authorization: tma <initData>``: the HMAC and ``auth_date`` are checked,
  then the call runs *as* that Telegram user through the same Service the bot uses (web_api.py).
* ``/admin/api/...`` (the panel) needs the session cookie (HttpOnly, SameSite=Strict); every POST also needs the
  session's CSRF token in ``X-CSRF-Token`` and, when the browser sends one, a same-origin ``Origin``. Sign-in itself
  (a one-time link from the bot, or the Telegram Login Widget) is rate-limited per address (web_admin.py).

Bodies are capped at 16 KB, every response carries a strict CSP, and the camera is allowed only on the panel's pages
(the desk scans QR codes there)."""

from __future__ import annotations

import hmac
import json
import logging
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import web

from .common import Refused
from .security import AuthError, RateLimiter, validate_init_data
from .service import Service

log = logging.getLogger(__name__)
ME = web.RequestKey("me", int)
ROOT = Path(__file__).resolve().parent.parent
MAX_BODY = 16 * 1024
COOKIE = "sz_session"
CSP = ("default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
       "connect-src 'self'; frame-src https://oauth.telegram.org; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org; "
       "base-uri 'none'; form-action 'none'; object-src 'none'")
HEADERS = {"Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
           "Cross-Origin-Opener-Policy": "same-origin"}
STATUS = {"forbidden": 403, "not_found": 404, "auth": 401, "rate": 429, "too_big": 413, "csrf": 403}
PUBLIC = ("/admin/api/login", "/admin/api/login-widget", "/admin/api/config", "/admin/api/logout")


async def body(request: web.Request) -> dict:
    raw = await request.read()
    if len(raw) > MAX_BODY:
        raise Refused("too_big")
    try:
        data = json.loads(raw or b"{}")
    except (json.JSONDecodeError, UnicodeDecodeError) as err:
        raise Refused("generic") from err
    if not isinstance(data, dict) or len(data) > 24:
        raise Refused("generic")
    return data


def make_app(service: Service, bot_token: str, notifier=None, *, max_age: int = 3600, rate_per_minute: int = 120, panel_rate: int = 240,
             login_rate: int = 10, trust_proxy: bool = False, bot_username: str = "", login_widget: bool = False,
             secure_cookie: bool = True) -> web.Application:
    from .web_admin import add_admin_routes
    from .web_api import add_routes

    users, staff, logins = RateLimiter(rate_per_minute), RateLimiter(panel_rate), RateLimiter(login_rate)

    def address(request: web.Request) -> str:
        if trust_proxy:
            forwarded = request.headers.get("X-Forwarded-For", "")
            if forwarded:
                return forwarded.split(",")[0].strip()[:64]
        return request.remote or "?"

    def same_origin(request: web.Request) -> bool:
        origin = request.headers.get("Origin")
        return origin is None or urlsplit(origin).netloc == request.host

    async def guard_api(request: web.Request) -> None:
        header = request.headers.get("Authorization", "")
        if not header.startswith("tma "):
            raise AuthError("missing")
        user = validate_init_data(header[4:], bot_token, max_age, now=service.now() / 1000)
        if not users.allow(user["id"]):
            raise Refused("rate")
        await service.touch_user(user["id"], user["first_name"], user["language_code"])
        request[ME] = user["id"]

    async def guard_panel(request: web.Request) -> None:
        if request.method not in ("GET", "HEAD") and not same_origin(request):
            raise Refused("csrf")
        if request.path in PUBLIC:
            if request.method == "POST" and request.path != "/admin/api/logout" and not logins.allow(address(request)):
                raise Refused("rate")
            return
        sess = await service.session_of(request.cookies.get(COOKIE))
        if sess is None:
            raise AuthError("no session")
        if request.method not in ("GET", "HEAD") and not hmac.compare_digest(request.headers.get("X-CSRF-Token", ""), sess["csrf"]):
            raise Refused("csrf")
        if not staff.allow(sess["uid"]):
            raise Refused("rate")
        request[ME] = sess["uid"]

    @web.middleware
    async def guard(request: web.Request, handler):
        try:
            if request.path.startswith("/api/"):
                await guard_api(request)
            elif request.path.startswith("/admin/api/"):
                await guard_panel(request)
            resp = await handler(request)
        except AuthError:
            resp = web.json_response({"error": "auth"}, status=401)
        except Refused as err:
            resp = web.json_response({"error": err.code}, status=STATUS.get(err.code, 400))
        except (ValueError, KeyError, TypeError):
            resp = web.json_response({"error": "generic"}, status=400)
        resp.headers.update(HEADERS)
        camera = "self" if request.path.startswith("/admin/") and not request.path.startswith("/admin/api/") else ""
        resp.headers["Permissions-Policy"] = f"camera=({camera}), microphone=(), geolocation=()"
        if "/api/" in request.path:
            resp.headers["Cache-Control"] = "no-store"
        return resp

    async def notify(notes: list[dict]) -> None:
        if notifier is not None and notes:
            try:
                await notifier.send(notes)
            except Exception:  # a failed message never fails the action itself
                log.exception("notify failed")

    async def health(_: web.Request) -> web.Response:
        return web.json_response({"ok": True})

    async def index(_: web.Request) -> web.Response:
        raise web.HTTPFound("/webapp/")

    def page(folder: str):
        async def serve(_: web.Request) -> web.StreamResponse:
            return web.FileResponse(ROOT / folder / "index.html")

        return serve

    async def admin_root(_: web.Request) -> web.Response:
        raise web.HTTPFound("/admin/")

    async def unknown(_: web.Request) -> web.Response:
        raise Refused("not_found")

    app = web.Application(middlewares=[guard], client_max_size=MAX_BODY + 4096)
    r = app.router
    add_routes(r, service, ME, notify)
    add_admin_routes(r, service, ME, notify, bot_token=bot_token, max_age=max_age, bot_username=bot_username,
                     login_widget=login_widget, secure_cookie=secure_cookie)
    r.add_route("*", "/api/{tail:.*}", unknown)
    r.add_route("*", "/admin/api/{tail:.*}", unknown)
    r.add_get("/healthz", health)
    r.add_get("/", index)
    r.add_get("/admin", admin_root)
    r.add_get("/webapp/", page("webapp"))
    r.add_get("/admin/", page("admin"))
    r.add_static("/webapp/", ROOT / "webapp", append_version=False)
    r.add_static("/admin/", ROOT / "admin", append_version=False)
    r.add_static("/shared/", ROOT / "shared", append_version=False)
    return app
