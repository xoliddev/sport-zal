"""The rotating check-in QR: ``SZ1.<member>.<step>.<sig>`` where ``step`` is the 30-second step of the clock and
``sig`` the first 96 bits of HMAC-SHA256 with the server's secret. The Mini App fetches a fresh token every step, so a
screenshot sent to a friend stops working within a minute; the desk accepts the current step and the one before
(network and camera delays), never a future one, and each member's steps only once and only upwards (the service keeps
the last accepted step). The short code (8 characters, 40 bits of the same HMAC) is for a desk without a camera."""

from __future__ import annotations

import base64
import hashlib
import hmac
import re

PREFIX = "SZ1"
STEP_MS = 30_000
CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # Crockford base32: no I, L, O, U
_TOKEN = re.compile(r"^SZ1\.([1-9][0-9]{0,8})\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{16})$")
_FOLD = str.maketrans({"O": "0", "I": "1", "L": "1"})


def secret_from(seed: str) -> bytes:
    """The QR key from QR_SECRET (or, without it, from the bot token): never the raw text itself."""
    return hashlib.sha256(f"sportzal-qr|{seed}".encode()).digest()


def _mac(secret: bytes, message: str) -> bytes:
    return hmac.new(secret, message.encode(), hashlib.sha256).digest()


def step_of(ms: int) -> int:
    return ms // STEP_MS


def seconds_left(ms: int) -> int:
    """Seconds until the QR changes (30 .. 1)."""
    return (STEP_MS - ms % STEP_MS + 999) // 1000


def token(secret: bytes, member: int, step: int) -> str:
    sig = base64.urlsafe_b64encode(_mac(secret, f"qr|{member}|{step}")[:12]).decode()
    return f"{PREFIX}.{member}.{step}.{sig}"


def short_code(secret: bytes, member: int, step: int) -> str:
    """``K7Q2-M9XD``: 40 bits of the HMAC over the member and the step."""
    n = int.from_bytes(_mac(secret, f"code|{member}|{step}")[:5], "big")
    chars = "".join(CODE_ALPHABET[(n >> (5 * (7 - k))) & 31] for k in range(8))
    return f"{chars[:4]}-{chars[4:]}"


def norm_code(text: object) -> str | None:
    """What a person typed -> ``XXXX-XXXX`` (O is read as 0, I and L as 1), or None."""
    if not isinstance(text, str) or len(text) > 32:
        return None
    s = "".join(ch for ch in text.upper() if ch.isascii() and ch.isalnum()).translate(_FOLD)
    if len(s) != 8 or any(ch not in CODE_ALPHABET for ch in s):
        return None
    return f"{s[:4]}-{s[4:]}"


def fresh(step: int, now_ms: int) -> bool:
    """The current 30-second step or the one before it."""
    return step_of(now_ms) - 1 <= step <= step_of(now_ms)


def verify(secret: bytes, text: object, now_ms: int) -> dict | None:
    """``{"member", "step"}`` for a genuine, fresh token; None for anything malformed, forged, old or from the future
    (constant-time comparison). Whether the step was already used is the service's check."""
    if not isinstance(text, str) or len(text) > 64:
        return None
    m = _TOKEN.match(text.strip())
    if not m:
        return None
    member, step = int(m.group(1)), int(m.group(2))
    if not hmac.compare_digest(token(secret, member, step), text.strip()) or not fresh(step, now_ms):
        return None
    return {"member": member, "step": step}


def find_code(secret: bytes, code: object, members: list[int], now_ms: int) -> dict | None:
    """A typed short code -> the member whose current (or previous) code it is, or None."""
    want = norm_code(code)
    if want is None:
        return None
    now = step_of(now_ms)
    for step in (now, now - 1):
        for member in members:
            if hmac.compare_digest(short_code(secret, member, step), want):
                return {"member": member, "step": step}
    return None
