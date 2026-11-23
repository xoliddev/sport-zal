"""The Mini App API (signed initData, see web.py). The user always comes from the verified initData: a member sees and
changes only their own card, QR, bookings and slots; a trainer only their own classes and slots. Ids in a request are
looked up within what that person may touch, so anyone else's answers "not_found"."""

from __future__ import annotations

from aiohttp import web

from .web import body


def add_routes(r: web.UrlDispatcher, svc, me_key, notify) -> None:
    def ok(data) -> web.Response:
        return web.json_response(data)

    async def with_notes(result) -> web.Response:
        out, notes = result
        await notify(notes)
        return ok(out)

    async def me(request):
        return ok(await svc.me(request[me_key]))

    async def lang(request):
        return ok({"lang": await svc.set_lang(request[me_key], (await body(request)).get("lang"))})

    async def live(request):
        return ok(await svc.live())

    async def card(request):
        return ok(await svc.my_card(request[me_key]))

    async def qr(request):
        return ok(await svc.qr(request[me_key]))

    async def freeze(request):
        data = await body(request)
        data.pop("member", None)  # a member freezes only their own abonement
        return await with_notes(await svc.freeze(request[me_key], data))

    async def classes(request):
        return ok(await svc.schedule_view(request[me_key]))

    async def book(request):
        return await with_notes(await svc.book(request[me_key], await body(request)))

    async def cancel(request):
        return await with_notes(await svc.cancel(request[me_key], await body(request)))

    async def slots(request):
        return ok(await svc.slots_view(request[me_key]))

    async def take(request):
        return await with_notes(await svc.take_slot(request[me_key], (await body(request)).get("id")))

    async def give_back(request):
        return await with_notes(await svc.give_back_slot(request[me_key], (await body(request)).get("id")))

    async def trainer(request):
        return ok(await svc.trainer_view(request[me_key]))

    async def session(request):
        uid = request[me_key]
        await svc.need(uid, "trainer")
        return ok(await svc.session_list(uid, await body(request)))

    async def mark(request):
        return ok(await svc.mark(request[me_key], await body(request)))

    async def add_slot(request):
        return ok(await svc.add_slot(request[me_key], await body(request)))

    async def remove_slot(request):
        return ok(await svc.remove_slot(request[me_key], (await body(request)).get("id")))

    r.add_get("/api/me", me)
    r.add_post("/api/lang", lang)
    r.add_get("/api/live", live)
    r.add_get("/api/card", card)
    r.add_get("/api/qr", qr)
    r.add_post("/api/freeze", freeze)
    r.add_get("/api/classes", classes)
    r.add_post("/api/book", book)
    r.add_post("/api/cancel", cancel)
    r.add_get("/api/slots", slots)
    r.add_post("/api/slots/take", take)
    r.add_post("/api/slots/give", give_back)
    r.add_get("/api/trainer", trainer)
    r.add_post("/api/session", session)
    r.add_post("/api/mark", mark)
    r.add_post("/api/slots/add", add_slot)
    r.add_post("/api/slots/remove", remove_slot)
