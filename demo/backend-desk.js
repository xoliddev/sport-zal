// The demo backend's desk numbers (sportzal/desk.py): the dashboard, abonements ending soon with a reminder a day,
// revenue this month for the owner, class fill rates, prices (the owner only) and the scheduler's tick.
import { fillRates, monthOf, revenue } from '../shared/classes.js';
import * as planlib from '../shared/plans.js';
import { Backend, abonView, checked, isId, Refused } from './backend.js';

const FILL_DAYS = 28;

Object.assign(Backend.prototype, {
  soonList() {
    const today = this.today();
    const out = [];
    for (const ab of this.abonements) {
      if (!(ab.start_day <= today && ab.end_day >= today && (ab.end_day <= today + planlib.SOON_DAYS || ab.visits_left === 1))) continue;
      if (!planlib.soon(ab, today)) continue;
      if (this.abonsOf(ab.member).some((a) => a.start_day > ab.end_day)) continue;
      out.push({ ab, member: this.members[ab.member - 1] });
    }
    return out.sort((a, b) => a.ab.end_day - b.ab.end_day || a.ab.id - b.ab.id);
  },
  revenueNow() {
    const [first, last] = monthOf(this.today());
    const sales = this.abonements.filter((a) => a.sold_day >= first && a.sold_day <= last).map((a) => ({ plan: a.plan, price: a.price, paid: a.paid, day: a.sold_day }));
    return revenue(sales, this.plans, this.today());
  },
  fill() {
    const today = this.today();
    const first = today - FILL_DAYS;
    const last = today - 1;
    const taken = {};
    for (const b of this.bookings) {
      if (b.day < first || b.day > last || !['booked', 'attended', 'missed'].includes(b.status)) continue;
      taken[`${b.class}:${b.day}`] = (taken[`${b.class}:${b.day}`] ?? 0) + 1;
    }
    return { from: first, to: last, items: fillRates(this.classes, taken, first, last) };
  },
  dashboard(uid) {
    const who = this.need(uid, 'admin', 'owner');
    const today = this.today();
    const minute = this.minute();
    const soon = this.soonList().map(({ ab, member }) => ({ no: ab.member, name: member.name,
      abon: abonView(ab, this.freezesOf(ab.id), this.plans, today, minute), kinds: planlib.reminders(ab, today, false),
      reminded: this.sent.get(`manual:${ab.id}:${today}`) ?? null, has_tg: member.user_id > 0 }));
    return { role: who.role, live: this.live(), today: this.todayVisits(uid).total, soon, fill: this.fill(), plans: this.plans.map((p) => ({ ...p })),
      revenue: who.role === 'owner' ? this.revenueNow() : null };
  },
  remind(uid, id) {
    this.need(uid, 'admin', 'owner');
    if (!isId(id)) throw new Refused('not_found');
    const hit = this.soonList().find((s) => s.ab.id === id);
    if (!hit) throw new Refused('not_found');
    if (hit.member.user_id <= 0) throw new Refused('no_tg');
    const key = `manual:${id}:${this.today()}`;
    if (this.sent.has(key)) throw new Refused('reminded');
    this.sent.set(key, this.nowMs());
    this.changed();
    return [this.dashboard(uid), [{ type: 'remind', to: hit.member.user_id, abon: id, kinds: planlib.reminders(hit.ab, this.today(), false) }]];
  },
  prices(uid) {
    const who = this.need(uid, 'admin', 'owner');
    return { items: this.plans.map((p) => ({ ...p })), can_edit: who.role === 'owner' };
  },
  setPrice(uid, data) {
    this.need(uid, 'owner');
    const plan = checked(planlib.planOf, this.plans, data?.plan);
    plan.price = checked(planlib.validPrice, data.price);
    this.changed();
    return this.plans.map((p) => ({ ...p }));
  },
  tick() {
    const now = this.nowMs();
    for (const v of this.visits) if (v.out_at === null && v.in_at <= now - 3 * 3_600_000) Object.assign(v, { out_at: v.in_at + 3 * 3_600_000, auto: 1 });
    const m = this.minute();
    if (m < 9 * 60 || m >= 21 * 60) return [];
    const notes = [];
    for (const { ab, member } of this.soonList()) {
      if (member.user_id <= 0 || !this.watched?.has(member.user_id)) continue; // the demo only messages its own phones
      for (const kind of planlib.reminders(ab, this.today(), false)) {
        const key = `${kind}:${ab.id}`;
        if (this.sent.has(key)) continue;
        this.sent.set(key, now);
        notes.push({ type: 'remind', to: member.user_id, abon: ab.id, kinds: [kind] });
      }
    }
    return notes;
  },
});
