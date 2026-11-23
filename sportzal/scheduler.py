"""The background loop: every minute ``Service.tick()`` closes visits older than 3 hours and claims the renewal
reminders that are due (each exactly once, in the database); the notes it returns become bot messages."""

from __future__ import annotations

import asyncio
import logging

log = logging.getLogger(__name__)


async def run(service, notifier, every: float = 60.0) -> None:
    while True:
        try:
            notes = await service.tick()
            if notes and notifier is not None:
                await notifier.send(notes)
        except asyncio.CancelledError:
            raise
        except Exception:  # one bad tick must not stop the reminders for everyone
            log.exception("scheduler tick failed")
        await asyncio.sleep(every)
