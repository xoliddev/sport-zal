// The demo's in-page backend: the same rules as the server's service (sportzal/*.py) on plain arrays, using the very
// same core (shared/*.js): people and roles, abonements (sell, renew, freeze), the rotating QR and the scan (each
// 30-second step once and only upwards), the live count and the forecast. Classes, slots and the desk's numbers are in
// backend-classes.js and backend-desk.js. Errors are Refused with the server's codes.
import { atLocal, localDay, localMinute } from '../shared/clock.js';
import { forecast, historyDays, STAY_MAX_MS, summary } from '../shared/occupancy.js';
import * as planlib from '../shared/plans.js';
import * as rotqr from '../shared/rotqr.js';
import { clean, InputError } from '../shared/text.js';

export class Refused extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function checked(fn, ...args) {
  try {
    return fn(...args);
  } catch (e) {
    if (e instanceof InputError) throw new Refused(e.code);
    throw e;
  }
}

export const isId = (v, top = 1e9) => Number.isInteger(v) && v > 0 && v < top;

export function abonView(ab, freezes, plans, today, minute) {
  if (!ab) return null;
  const p = plans.find((x) => x.id === ab.plan) ?? { uz: ab.plan, ru: ab.plan, visits: null };
  const future = freezes.filter((f) => f.from_day + f.days - 1 >= today);
  return { id: ab.id, plan: ab.plan, uz: p.uz, ru: p.ru, price: ab.price, start_day: ab.start_day, end_day: ab.end_day, visits_left: ab.visits_left,
    visits_total: p.visits, window: ab.window, freeze_left: ab.freeze_left, freeze: future[0] ? { from_day: future[0].from_day, days: future[0].days } : null,
    days_left: ab.end_day - today, state: planlib.state(ab, freezes, today, minute), soon: planlib.soon(ab, today) };
}

export class Backend {
  constructor({ data, now = () => Date.now(), secret }) {
    Object.assign(this, { clock: now, offset: 0, gym: data.gym, schedule: data.schedule, kinds: data.schedule.kinds, secret });
    this.plans = data.plans.map((p) => ({ ...p }));
    this.users = new Map();
    this.listeners = [];
    this.sent = new Map();
    this.fc = null;
  }

  on(fn) { this.listeners.push(fn); }
  emit(ev) { for (const fn of this.listeners) fn(ev); }
  notify(notes) { for (const note of notes) this.emit({ type: 'note', note }); }
  changed() { this.emit({ type: 'changed' }); }
  nowMs() { return this.clock() + this.offset; }
  advance(ms) { this.offset += ms; this.changed(); }
  today() { return localDay(this.nowMs()); }
  minute() { return localMinute(this.nowMs()); }

  // ── people ──
  lang(uid) { return this.users.get(uid)?.lang ?? 'uz'; }
  setLang(uid, lang) {
    if (!['uz', 'ru'].includes(lang)) throw new Refused('generic');
    this.users.set(uid, { ...(this.users.get(uid) ?? {}), lang });
    return lang;
  }
  role(uid) {
    const st = this.staff.find((s) => s.user_id === uid);
    if (st) return { role: st.role, no: null, trainer: st.trainer, name: st.name, uid };
    const m = this.members.find((x) => x.user_id === uid);
    if (!m) throw new Refused('auth');
    return { role: 'member', no: m.no, trainer: null, name: m.name, uid };
  }
  need(uid, ...roles) {
    const who = this.role(uid);
    if (!roles.includes(who.role)) throw new Refused('forbidden');
    return who;
  }
  me(uid) { return { ...this.role(uid), lang: this.lang(uid), gym: this.gym.name, today: this.today(), now: this.nowMs() }; }
  member(no) {
    const m = isId(no) ? this.members[no - 1] : null;
    if (!m || m.no !== no) throw new Refused('not_found');
    return m;
  }
  abonsOf(no) { return this.byMember.get(no) ?? []; }
  freezesOf(id) { return this.freezes.filter((f) => f.abon === id); }
  current(no) {
    const all = this.abonsOf(no);
    const ab = planlib.pick(all, this.today());
    return [ab, ab ? this.freezesOf(ab.id) : [], all];
  }

  // ── abonements ──
  card(no) {
    const m = this.member(no);
    const [ab, fz, all] = this.current(no);
    const later = all.filter((a) => ab && a.start_day > ab.end_day);
    const now = this.nowMs();
    const inside = this.visits.find((v) => v.member === no && v.out_at === null && v.in_at > now - STAY_MAX_MS && v.in_at <= now);
    return { no, name: m.name, joined_day: m.joined_day, abon: abonView(ab, fz, this.plans, this.today(), this.minute()),
      next: later.length ? abonView(later[0], [], this.plans, this.today(), this.minute()) : null, inside: inside ? inside.in_at : null, has_tg: m.user_id > 0 };
  }
  myCard(uid) { return this.card(this.need(uid, 'member').no); }
  memberCard(uid, no) {
    this.need(uid, 'admin', 'owner');
    const card = this.card(this.member(no).no);
    card.history = this.abonsOf(card.no).slice(-8).reverse().map((a) => ({ ...abonView(a, [], this.plans, this.today(), this.minute()), paid: a.paid, sold_day: a.sold_day }));
    card.visits = this.visits.filter((v) => v.member === card.no && v.in_at <= this.nowMs()).slice(-8).reverse().map((v) => ({ in_at: v.in_at, out_at: v.out_at, auto: v.auto }));
    return card;
  }
  search(uid, q) {
    this.need(uid, 'admin', 'owner');
    const text = typeof q === 'string' ? clean(q, 40) : '';
    let rows = [];
    if (/^[0-9]{1,9}$/.test(text)) rows = this.members.filter((m) => m.no === Number(text));
    else if (text.length >= 2) {
      const low = text.toLowerCase();
      rows = this.members.filter((m) => m.name.toLowerCase().includes(low)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.no - b.no)).slice(0, 20);
    }
    return rows.map((m) => this.card(m.no));
  }
  sell(uid, data) {
    const who = this.need(uid, 'admin', 'owner');
    if (!data || !['cash', 'card'].includes(data.paid)) throw new Refused('paid');
    const m = this.member(data.member);
    const plan = checked(planlib.planOf, this.plans, data.plan);
    const fresh = planlib.sell(plan, this.today(), this.abonsOf(m.no));
    const ab = { id: this.abonements.length + 1, member: m.no, ...fresh, paid: data.paid, sold_by: who.uid, sold_day: this.today() };
    this.abonements.push(ab);
    if (!this.byMember.has(m.no)) this.byMember.set(m.no, []);
    this.byMember.get(m.no).push(ab);
    this.changed();
    return [{ ...this.card(m.no), sold: ab.id }, m.user_id > 0 ? [{ type: 'sold', to: m.user_id, abon: ab.id }] : []];
  }
  abonFor(id, lang) {
    const ab = this.abonements[id - 1];
    if (!ab) return null;
    const view = abonView(ab, this.freezesOf(ab.id), this.plans, this.today(), this.minute());
    return { ...view, name: lang === 'ru' ? view.ru : view.uz, paid: ab.paid };
  }
  freeze(uid, data) {
    const who = this.role(uid);
    if (!data || typeof data !== 'object') throw new Refused('generic');
    let no;
    if (who.role === 'member') no = who.no;
    else if (['admin', 'owner'].includes(who.role)) no = this.member(data.member).no;
    else throw new Refused('forbidden');
    const [ab, fz] = this.current(no);
    const res = checked(planlib.freeze, ab, fz, data.from, data.days, this.today());
    const oldEnd = ab.end_day;
    ab.end_day = res.end_day;
    ab.freeze_left = res.freeze_left;
    this.freezes.push({ abon: ab.id, from_day: res.from_day, days: res.days });
    const m = this.member(no);
    this.changed();
    return [this.card(no), m.user_id > 0 ? [{ type: 'frozen', to: m.user_id, abon: ab.id, from: res.from_day, days: res.days, old_end: oldEnd, end: res.end_day }] : []];
  }

  // ── check-in ──
  qr(uid) {
    const who = this.need(uid, 'member');
    const now = this.nowMs();
    const step = rotqr.stepOf(now);
    return { token: rotqr.token(this.secret, who.no, step), code: rotqr.shortCode(this.secret, who.no, step), step, left: rotqr.secondsLeft(now), no: who.no, name: who.name };
  }
  forecast() {
    const today = this.today();
    if (!this.fc || this.fc[0] !== today) {
      const days = new Set(historyDays(today));
      this.fc = [today, forecast(this.visits.filter((v) => days.has(localDay(v.in_at))), today)];
    }
    return this.fc[1];
  }
  live() {
    const now = this.nowMs();
    const rows = this.visits.filter((v) => v.in_at > now - STAY_MAX_MS && v.in_at <= now);
    return summary(rows, this.forecast(), now, this.gym);
  }
  scan(uid, data) {
    this.need(uid, 'admin', 'owner');
    const now = this.nowMs();
    if (!data || typeof data !== 'object') throw new Refused('generic');
    let found;
    if (typeof data.token === 'string') found = rotqr.verify(this.secret, data.token, now);
    else if (typeof data.code === 'string') found = rotqr.findCode(this.secret, data.code, this.members.map((m) => m.no), now);
    else throw new Refused('generic');
    const m = found ? this.members[found.member - 1] : null;
    if (!m || (m.last_step ?? 0) >= found.step) return [{ code: 'bad', count: this.live().count }, []];
    m.last_step = found.step;
    const out = this.enterOrLeave(m, uid, now);
    const notes = ['ok', 'exit'].includes(out.code) && m.user_id > 0
      ? [{ type: out.code === 'ok' ? 'checkin' : 'checkout', to: m.user_id, abon: out.abon_id ?? null, at: now, minutes: out.minutes ?? null }] : [];
    this.changed();
    return [{ ...out, count: this.live().count }, notes];
  }
  enterOrLeave(m, uid, now) {
    const { no } = m;
    for (const v of this.visits) if (v.member === no && v.out_at === null && v.in_at <= now - STAY_MAX_MS) Object.assign(v, { out_at: v.in_at + STAY_MAX_MS, auto: 1 });
    const base = { no, name: m.name };
    const open = this.visits.find((v) => v.member === no && v.out_at === null && v.in_at <= now);
    if (open) {
      open.out_at = now;
      return { ...base, code: 'exit', minutes: Math.floor((now - open.in_at) / 60_000) };
    }
    const [ab, fz] = this.current(no);
    const st = planlib.state(ab, fz, this.today(), this.minute());
    if (st.code !== 'ok') return { ...base, ...st };
    if (ab.visits_left !== null) ab.visits_left -= 1;
    this.visits.push({ member: no, abon: ab.id, in_at: now, out_at: null, auto: 0, by: uid });
    return { ...base, code: 'ok', abon: abonView(ab, fz, this.plans, this.today(), this.minute()), abon_id: ab.id };
  }
  todayVisits(uid) {
    this.need(uid, 'admin', 'owner');
    const now = this.nowMs();
    const start = atLocal(this.today(), 0);
    const rows = this.visits.filter((v) => v.in_at >= start && v.in_at <= now).sort((a, b) => b.in_at - a.in_at);
    return { total: rows.length, items: rows.slice(0, 50).map((v) => {
      const ab = this.abonements[v.abon - 1];
      const gone = v.out_at !== null && v.out_at <= now;
      return { no: v.member, name: this.members[v.member - 1].name, in_at: v.in_at, out_at: v.out_at, auto: v.auto, plan: ab?.plan ?? null,
        visits_left: ab ? ab.visits_left : null, inside: !gone && now - v.in_at < STAY_MAX_MS };
    }) };
  }
}
