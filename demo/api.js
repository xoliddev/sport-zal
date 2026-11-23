// The Mini App's and the panel's APIs, answered by the in-page backend instead of HTTP (the same method names as
// webapp/api.js and admin/api.js, the same shapes and error codes as the server), so the app and the panel code is
// identical on the server and in the demo. Notes the backend returns become bot messages in the phones.
export function run(fn) {
  return Promise.resolve().then(() => {
    try {
      return structuredClone(fn());
    } catch (e) {
      if (!e.code) throw e;
      throw Object.assign(new Error(e.code), { code: e.code });
    }
  });
}

/** Runs an action that also returns notes: the notes go to the bots, the answer to the caller. */
const withNotes = (b, fn) => run(() => {
  const [out, notes] = fn();
  b.notify(notes);
  return out;
});

export function apiFor(b, uid) {
  const n = Number;
  return {
    me: () => run(() => b.me(uid)),
    setLang: (lang) => run(() => ({ lang: b.setLang(uid, lang) })),
    live: () => run(() => b.live()),
    card: () => run(() => b.myCard(uid)),
    qr: () => run(() => b.qr(uid)),
    freeze: (data) => withNotes(b, () => b.freeze(uid, { from: data.from, days: data.days })),
    classes: () => run(() => b.scheduleView(uid)),
    book: (cls, day) => withNotes(b, () => b.book(uid, { class: cls, day: n(day) })),
    cancel: (cls, day) => withNotes(b, () => b.cancel(uid, { class: cls, day: n(day) })),
    slots: () => run(() => b.slotsView(uid)),
    takeSlot: (id) => withNotes(b, () => b.takeSlot(uid, n(id))),
    giveSlot: (id) => withNotes(b, () => b.giveSlot(uid, n(id))),
    trainer: () => run(() => b.trainerView(uid)),
    session: (cls, day) => run(() => { b.need(uid, 'trainer'); return b.sessionList(uid, { class: cls, day: n(day) }); }),
    mark: (cls, day, member, status) => run(() => b.mark(uid, { class: cls, day: n(day), member: n(member), status })),
    addSlot: (data) => run(() => b.addSlot(uid, data)),
    removeSlot: (id) => run(() => b.removeSlot(uid, n(id))),
  };
}

export function adminFor(b, getUid) {
  const n = Number;
  const me = () => getUid();
  return {
    me: () => run(() => ({ ...b.me(me()), csrf: 'demo' })),
    config: () => run(() => ({ widget: false, bot: '' })),
    login: () => run(() => ({ ok: true })),
    loginWidget: () => run(() => ({ ok: true })),
    logout: () => run(() => ({ ok: true })),
    dashboard: () => run(() => b.dashboard(me())),
    live: () => run(() => { b.need(me(), 'admin', 'owner'); return b.live(); }),
    visits: () => run(() => b.todayVisits(me())),
    scan: (data) => withNotes(b, () => b.scan(me(), data)),
    search: (q) => run(() => ({ items: b.search(me(), q) })),
    member: (no) => run(() => b.memberCard(me(), n(no))),
    sell: (member, plan, paid) => withNotes(b, () => b.sell(me(), { member: n(member), plan, paid })),
    freeze: (member, from, days) => withNotes(b, () => b.freeze(me(), { member: n(member), from, days })),
    remind: (abon) => withNotes(b, () => b.remind(me(), n(abon))),
    prices: () => run(() => b.prices(me())),
    setPrice: (plan, price) => run(() => ({ items: b.setPrice(me(), { plan, price }) })),
    session: (cls, day) => run(() => b.sessionList(me(), { class: cls, day: n(day) })),
  };
}
