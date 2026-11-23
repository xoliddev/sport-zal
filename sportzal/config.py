"""Settings from environment variables (see .env.example). Nothing secret has a default."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    """Minimal .env reader so beginners do not need extra packages. Real env vars win."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _ids(name: str, text: str) -> frozenset[int]:
    out = set()
    for part in text.replace(";", ",").split(","):
        part = part.strip()
        if part:
            if not part.isdigit():
                raise SystemExit(f"{name} must be numeric Telegram user ids, got {part!r}")
            out.add(int(part))
    return frozenset(out)


def _trainers(text: str) -> dict[str, int]:
    """``malika:123456789,sherzod:987654321`` -> the trainers of shared/data/schedule.json with their Telegram ids."""
    out = {}
    for part in text.replace(";", ",").split(","):
        part = part.strip()
        if not part:
            continue
        m = re.fullmatch(r"([a-z_]{1,32}):(\d{1,15})", part)
        if not m:
            raise SystemExit(f"TRAINERS must look like malika:123456789, got {part!r}")
        out[m.group(1)] = int(m.group(2))
    return out


def _int(name: str, default: int, lo: int, hi: int) -> int:
    raw = os.environ.get(name, str(default)).strip()
    if not raw.isdigit() or not lo <= int(raw) <= hi:
        raise SystemExit(f"{name} must be a whole number between {lo} and {hi}, got {raw!r}")
    return int(raw)


def _flag(name: str, default: str) -> bool:
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes")


@dataclass(frozen=True)
class Settings:
    bot_token: str
    public_url: str = ""
    db_path: str = "data/sportzal.db"
    host: str = "0.0.0.0"  # noqa: S104 - the container must listen on all interfaces
    port: int = 8080
    owner_ids: frozenset[int] = field(default_factory=frozenset)
    admin_ids: frozenset[int] = field(default_factory=frozenset)
    trainers: dict[str, int] = field(default_factory=dict)
    qr_secret: str = ""
    seed_demo: bool = True
    login_widget: bool = False
    initdata_max_age: int = 3600
    rate_per_minute: int = 30
    api_rate_per_minute: int = 120
    panel_rate_per_minute: int = 240
    login_rate_per_minute: int = 10
    trust_proxy: bool = False

    @property
    def webapp_url(self) -> str:
        return f"{self.public_url}/webapp/" if self.public_url else ""

    @property
    def admin_url(self) -> str:
        return f"{self.public_url}/admin/" if self.public_url else ""

    @classmethod
    def from_env(cls, dotenv: Path | None = Path(".env")) -> Settings:
        if dotenv is not None:
            _load_dotenv(dotenv)
        env = os.environ.get
        token = env("BOT_TOKEN", "").strip()
        if not token or ":" not in token or "replace-with" in token:
            raise SystemExit("BOT_TOKEN is missing. Copy .env.example to .env and paste the token from @BotFather.")
        url = env("PUBLIC_URL", "").strip().rstrip("/")
        if url and not url.startswith("https://"):
            raise SystemExit("PUBLIC_URL must start with https:// (Telegram opens Mini Apps only over HTTPS).")
        return cls(
            bot_token=token, public_url=url, db_path=env("DB_PATH", cls.db_path), host=env("HOST", cls.host),
            port=_int("PORT", cls.port, 1, 65535), owner_ids=_ids("OWNER_IDS", env("OWNER_IDS", "")),
            admin_ids=_ids("ADMIN_IDS", env("ADMIN_IDS", "")), trainers=_trainers(env("TRAINERS", "")),
            qr_secret=env("QR_SECRET", "").strip(), seed_demo=_flag("SEED_DEMO", "1"), login_widget=_flag("LOGIN_WIDGET", "0"),
            initdata_max_age=_int("INITDATA_MAX_AGE", cls.initdata_max_age, 60, 86_400),
            rate_per_minute=_int("RATE_PER_MINUTE", cls.rate_per_minute, 1, 1000),
            api_rate_per_minute=_int("API_RATE_PER_MINUTE", cls.api_rate_per_minute, 10, 5000),
            panel_rate_per_minute=_int("PANEL_RATE_PER_MINUTE", cls.panel_rate_per_minute, 10, 5000),
            login_rate_per_minute=_int("LOGIN_RATE_PER_MINUTE", cls.login_rate_per_minute, 1, 100),
            trust_proxy=_flag("TRUST_PROXY", "0"),
        )
