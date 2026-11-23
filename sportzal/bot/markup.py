"""(label, data) rows -> Telegram inline keyboards. Screens are built as plain rows so the JS demo can share them."""

from __future__ import annotations

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo


def markup(rows: list[list[tuple[str, str]]], webapp_url: str = "") -> InlineKeyboardMarkup:
    """``@app#qr`` opens the Mini App at that hash (skipped when no Mini App is set up), ``https://...`` is a link (the
    panel's one-time sign-in); the rest are callbacks."""
    out = []
    for row in rows:
        buttons = []
        for label, data in row:
            if data.startswith("@app"):
                if webapp_url:
                    buttons.append(InlineKeyboardButton(text=label, web_app=WebAppInfo(url=webapp_url + data[4:])))
            elif data.startswith("https://"):
                buttons.append(InlineKeyboardButton(text=label, url=data))
            else:
                buttons.append(InlineKeyboardButton(text=label, callback_data=data))
        if buttons:
            out.append(buttons)
    return InlineKeyboardMarkup(inline_keyboard=out)
