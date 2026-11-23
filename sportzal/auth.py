"""Signing in to the admin panel, with no passwords anywhere.

* One-time link: an administrator or the owner presses "Panelga kirish" in the bot and gets a link valid for 10
  minutes. Opening it shows the panel's sign-in page, whose script sends the token back with a POST (so a link preview
  fetching the URL cannot use it up); the token works once. Only its SHA-256 is stored.
* Telegram Login Widget: the signed fields are checked like Telegram describes (security.py), for staff only.

A session is a random token in an HttpOnly, SameSite=Strict cookie (only its SHA-256 is stored) with its own CSRF
token, which every POST must send back in a header."""

from __future__ import annotations

import hashlib
import re
import secrets

from .common import Refused
from .security import AuthError, verify_login_widget

LINK_MS = 10 * 60_000
SESSION_MS = 12 * 3_600_000
TOKEN = re.compile(r"^[A-Za-z0-9_-]{43}$")


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Auth:
    async def login_link(self, uid: int) -> str:
        """A one-time sign-in token for the panel (the bot puts it into a link)."""
        await self.need(uid, "admin", "owner")
        token = secrets.token_urlsafe(32)
        async with self.db.tx() as c:
            await c.execute("DELETE FROM logins WHERE expires < ?", (self.now(),))
            await c.execute("INSERT INTO logins (hash, user_id, expires) VALUES (?, ?, ?)", (digest(token), uid, self.now() + LINK_MS))
        return token

    async def _open_session(self, c, uid: int) -> dict:
        session, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
        await c.execute("DELETE FROM sessions WHERE expires < ?", (self.now(),))
        await c.execute("INSERT INTO sessions (hash, user_id, csrf, expires, created_at) VALUES (?, ?, ?, ?, ?)",
                        (digest(session), uid, csrf, self.now() + SESSION_MS, self.now()))
        return {"session": session, "csrf": csrf, "uid": uid, "max_age": SESSION_MS // 1000}

    async def login_with_link(self, token: object) -> dict:
        if not isinstance(token, str) or not TOKEN.match(token):
            raise Refused("auth")
        async with self.db.tx() as c:
            row = await self.q1(c, "SELECT user_id FROM logins WHERE hash = ? AND used = 0 AND expires >= ?", (digest(token), self.now()))
            if row is None:
                raise Refused("auth")
            await c.execute("UPDATE logins SET used = 1 WHERE hash = ?", (digest(token),))
            staff = await self.q1(c, "SELECT role FROM staff WHERE user_id = ?", (row["user_id"],))
            if staff is None or staff["role"] not in ("admin", "owner"):
                raise Refused("auth")
            return await self._open_session(c, row["user_id"])

    async def login_with_widget(self, fields: object, bot_token: str, max_age: int) -> dict:
        try:
            user = verify_login_widget(fields, bot_token, max_age, now=self.now() // 1000)
        except AuthError as err:
            raise Refused("auth") from err
        async with self.db.tx() as c:
            staff = await self.q1(c, "SELECT role FROM staff WHERE user_id = ?", (user["id"],))
            if staff is None or staff["role"] not in ("admin", "owner"):
                raise Refused("auth")
            return await self._open_session(c, user["id"])

    async def session_of(self, token: object) -> dict | None:
        """``{"uid", "csrf"}`` for a live session cookie, or None."""
        if not isinstance(token, str) or not TOKEN.match(token):
            return None
        row = await self.db.one("SELECT user_id, csrf FROM sessions WHERE hash = ? AND expires >= ?", (digest(token), self.now()))
        return {"uid": row["user_id"], "csrf": row["csrf"]} if row else None

    async def logout(self, token: object) -> None:
        if isinstance(token, str) and TOKEN.match(token):
            async with self.db.tx() as c:
                await c.execute("DELETE FROM sessions WHERE hash = ?", (digest(token),))
