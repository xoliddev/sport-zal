"""The one service the bot, the Mini App API, the admin panel and the scheduler share: every rule is enforced here,
with the caller's Telegram id, so a button, an API call and a panel click are checked the same way."""

from __future__ import annotations

from .auth import Auth
from .base import Base
from .booking import Booking
from .checkin import Checkin
from .desk import Desk
from .membership import Membership
from .pt import Personal
from .seeding import Seeding


class Service(Membership, Checkin, Booking, Personal, Desk, Auth, Seeding, Base):
    pass
