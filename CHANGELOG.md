# Changelog

## 1.0.0 — 2026-11-23

Daily portfolio challenge #8.

- Pure core with a JavaScript port checked by shared vectors: Tashkent calendar, abonements (sell, renew, the state on
  a day and minute, freezing with an exact end-date shift, ending soon, reminders), the rotating HMAC check-in QR with
  the short code, the live count and the same-weekday hourly forecast with the quietest two hours, classes with the
  waitlist and personal-training slots, revenue and fill rates, a hand-written QR encoder and reader, the seeded gym.
- Service on SQLite (WAL, `BEGIN IMMEDIATE`, rules in the schema): selling and freezing, the scan (a fresh step,
  once, upwards; the visit taken off with a conditional UPDATE), the exit scan and the 3-hour check-out, booking and
  the automatic waitlist promotion, attendance, slots, the dashboard, reminders once each, prices for the owner only,
  one-time sign-in links and sessions.
- aiogram bot, buttons only, Uzbek and Russian; aiohttp API for the Mini App (initData) and for the panel (one-time
  link or Login Widget, HttpOnly SameSite=Strict cookie, CSRF, same-origin).
- Mini App: the live gauge and forecast, the rotating QR with its countdown ring, classes and slots, the abonement and
  freezing; the trainer's classes, attendance and slots. Admin panel: desk, members, dashboard, prices.
- Browser demo with two phones and the panel in a browser window and a ten-step story; pytest, node tests and
  Playwright e2e; Docker (non-root, read-only), CI and GitHub Pages.
