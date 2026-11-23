"""Run everything in one process: ``python -m sportzal``.

* the Telegram bot (long polling),
* the aiohttp server: the Mini App (/webapp/), the admin panel (/admin/) and their APIs,
* the scheduler: the 3-hour automatic check-outs and renewal reminders (each sent exactly once).
State lives in SQLite, so a restart loses nothing.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os

from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.types import MenuButtonWebApp, WebAppInfo
from aiohttp import web

from . import scheduler
from .base import load
from .bot.notify import Notifier
from .bot.setup import BotConfig, build_dispatcher
from .config import Settings
from .core import rotqr, seedgen
from .db import Database
from .service import Service
from .web import make_app

log = logging.getLogger("sportzal")


async def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = Settings.from_env()
    db = await Database.open(cfg.db_path)
    service = Service(db, qr_secret=rotqr.secret_from(cfg.qr_secret or cfg.bot_token))
    if cfg.seed_demo:
        world = seedgen.world(load("names"), load("plans"), load("schedule"), load("gym"), service.today(), service.minute())
        if await service.seed(world):
            log.info("seeded the fictional gym (members, five weeks of visits, classes)")
    await service.register_staff(cfg.owner_ids, cfg.admin_ids, cfg.trainers)
    bot = Bot(cfg.bot_token, default=DefaultBotProperties(parse_mode="HTML"))
    me = await bot.get_me()
    bcfg = BotConfig(me.username or "", cfg.webapp_url, cfg.admin_url)
    dp = build_dispatcher(service, bot, bcfg, cfg.rate_per_minute)
    notifier = Notifier(bot, service, bcfg)
    if cfg.webapp_url:
        await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Sport Zal", web_app=WebAppInfo(url=cfg.webapp_url)))
    app = make_app(service, cfg.bot_token, notifier, max_age=cfg.initdata_max_age, rate_per_minute=cfg.api_rate_per_minute,
                   panel_rate=cfg.panel_rate_per_minute, login_rate=cfg.login_rate_per_minute, trust_proxy=cfg.trust_proxy,
                   bot_username=me.username or "", login_widget=cfg.login_widget, secure_cookie=bool(cfg.public_url))
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, cfg.host, cfg.port).start()
    ticker = asyncio.create_task(scheduler.run(service, notifier))
    log.info("Mini App on http://%s:%s/webapp/  panel on /admin/  bot: @%s", cfg.host, cfg.port, me.username)
    try:
        await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())
    finally:
        ticker.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await ticker
        await runner.cleanup()
        await bot.session.close()
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
