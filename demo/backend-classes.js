// The demo backend's classes and personal training (sportzal/booking.py and pt.py): the week's schedule with places
// and the waitlist, booking, cancelling with the waitlist moving up, the trainer's lists and attendance, slots.
import * as cl from '../shared/classes.js';
import * as planlib from '../shared/plans.js';
import { Backend, checked, isId, Refused } from './backend.js';

const TAKEN = ['booked', 'attended', 'missed'];

Object.assign(Backend.prototype, {
  counts(cid, day) {
    const out = { taken: 0, wait: 0 };
    for (const b of this.bookings) {
      if (b.class !== cid || b.day !== day || b.status === 'cancelled') continue;
      out[TAKEN.includes(b.status) ? 'taken' : 'wait'] += 1;
    }
    return out;
  },
  trainerName(uid) { return this.staff.find((s) => s.user_id === uid)?.name ?? ''; },
  mine(no, cid, day) {
    const b = this.bookings.find((x) => x.member === no && x.class === cid && x.day === day && x.status !== 'cancelled');
    if (!b) return null;
    const pos = b.status === 'wait' ? this.bookings.filter((x) => x.class === cid && x.day === day && x.status === 'wait' && x.id <= b.id).length : null;
    return { status: b.status, pos };
  },
  sessionView(k, day, mine = null) {
    const n = this.counts(k.id, day);
    const start = cl.starts(k, day);
    const now = this.nowMs();
    return { class: k.id, kind: k.kind, trainer: this.trainerName(k.trainer), day, start: k.start, dur: k.dur, cap: k.cap, taken: n.taken, wait: n.wait,
      fill: cl.fill(n.taken, k.cap), past: start <= now, me: mine?.status ?? null, pos: mine?.pos ?? null, can_cancel: now <= start - cl.CANCEL_BEFORE_MS };
  },
  scheduleView(uid) {
    const who = this.role(uid);
    const today = this.today();
    const byId = Object.fromEntries(this.classes.map((k) => [k.id, k]));
    const items = cl.sessions(this.classes, today, today + cl.AHEAD_DAYS).filter((s) => cl.starts(byId[s.class], s.day) > this.nowMs() - 3_600_000)
      .map((s) => this.sessionView(byId[s.class], s.day, who.no ? this.mine(who.no, s.class, s.day) : null));
    return { items, today };
  },
  sessionOf(data) {
    if (!data || typeof data !== 'object') throw new Refused('generic');
    const k = checked(cl.classOf, this.classes, data.class);
    if (!isId(data.day, 1e6) || !cl.runsOn(k, data.day)) throw new Refused('not_found');
    return [k, data.day];
  },
  book(uid, data) {
    const who = this.need(uid, 'member');
    const [k, day] = this.sessionOf(data);
    checked(cl.checkBook, k, day, this.nowMs());
    const ab = planlib.pick(this.abonsOf(who.no), day);
    const st = planlib.state(ab, ab ? this.freezesOf(ab.id) : [], day, k.start);
    if (['none', 'expired', 'used_up', 'not_started'].includes(st.code)) throw new Refused('class_abon');
    if (['frozen', 'window'].includes(st.code)) throw new Refused(`class_${st.code}`);
    if (this.mine(who.no, k.id, day)) throw new Refused('class_twice');
    const status = this.counts(k.id, day).taken < k.cap ? 'booked' : 'wait';
    this.bookings.push({ id: this.bookings.length + 1, class: k.id, day, member: who.no, status });
    this.changed();
    return [this.sessionView(k, day, this.mine(who.no, k.id, day)), []];
  },
  cancel(uid, data) {
    const who = this.need(uid, 'member');
    const [k, day] = this.sessionOf(data);
    const b = this.bookings.find((x) => x.member === who.no && x.class === k.id && x.day === day && ['booked', 'wait'].includes(x.status));
    if (!b) throw new Refused('not_found');
    if (b.status === 'booked') checked(cl.checkCancel, k, day, this.nowMs());
    else if (cl.starts(k, day) <= this.nowMs()) throw new Refused('class_past');
    const was = b.status;
    b.status = 'cancelled';
    const notes = was === 'booked' ? this.promote(k, day) : [];
    this.changed();
    return [this.sessionView(k, day), notes];
  },
  promote(k, day) {
    const next = this.bookings.find((x) => x.class === k.id && x.day === day && x.status === 'wait');
    if (!next) return [];
    next.status = 'booked';
    const uid = this.members[next.member - 1].user_id;
    return uid > 0 ? [{ type: 'promoted', to: uid, class: k.id, day }] : [];
  },
  ownClass(uid, data) {
    const who = this.need(uid, 'trainer', 'admin', 'owner');
    const [k, day] = this.sessionOf(data);
    if (who.role === 'trainer' && k.trainer !== uid) throw new Refused('not_found');
    return [k, day, who];
  },
  trainerView(uid) {
    this.need(uid, 'trainer');
    const today = this.today();
    const ks = this.classes.filter((k) => k.trainer === uid);
    const byId = Object.fromEntries(ks.map((k) => [k.id, k]));
    return { items: cl.sessions(ks, today - 1, today + cl.AHEAD_DAYS).map((s) => this.sessionView(byId[s.class], s.day)), today };
  },
  sessionList(uid, data) {
    const [k, day] = this.ownClass(uid, data);
    const now = this.nowMs();
    const inside = new Set(this.visits.filter((v) => v.in_at > now - 3 * 3_600_000 && v.in_at <= now && (v.out_at === null || v.out_at > now)).map((v) => v.member));
    const rows = this.bookings.filter((b) => b.class === k.id && b.day === day && b.status !== 'cancelled')
      .sort((a, b) => (a.status === 'wait') - (b.status === 'wait') || a.id - b.id)
      .map((b) => ({ no: b.member, name: this.members[b.member - 1].name, status: b.status, inside: inside.has(b.member) }));
    let canMark = true;
    try { cl.checkMark(k, day, now); } catch { canMark = false; }
    return { ...this.sessionView(k, day), can_mark: canMark, people: rows };
  },
  mark(uid, data) {
    const [k, day, who] = this.ownClass(uid, data);
    if (who.role !== 'trainer') throw new Refused('forbidden');
    if (!['attended', 'missed'].includes(data.status) || !isId(data.member)) throw new Refused('generic');
    checked(cl.checkMark, k, day, this.nowMs());
    const b = this.bookings.find((x) => x.class === k.id && x.day === day && x.member === data.member && TAKEN.includes(x.status));
    if (!b) throw new Refused('not_found');
    b.status = data.status;
    this.changed();
    return this.sessionList(uid, data);
  },

  // ── personal training ──
  slotsView(uid) {
    const who = this.role(uid);
    const now = this.nowMs();
    const today = this.today();
    let rows;
    if (who.role === 'trainer') rows = this.slots.filter((s) => s.trainer === uid);
    else if (who.role === 'member') rows = this.slots.filter((s) => s.member === null || s.member === who.no);
    else throw new Refused('forbidden');
    const items = rows.filter((s) => s.day >= today && s.day <= today + cl.PT_AHEAD_DAYS && cl.slotStarts(s) > now)
      .sort((a, b) => a.day - b.day || a.start - b.start || a.id - b.id).map((s) => ({ id: s.id, trainer: this.trainerName(s.trainer), day: s.day, start: s.start, price: s.price,
        taken: s.member !== null, mine: who.role === 'member' && s.member === who.no, can_cancel: now <= cl.slotStarts(s) - cl.CANCEL_BEFORE_MS,
        ...(who.role === 'trainer' ? { member_name: s.member ? this.members[s.member - 1].name : null } : {}) }));
    return { items };
  },
  addSlot(uid, data) {
    this.need(uid, 'trainer');
    const slot = checked(cl.checkSlot, data, this.gym, this.nowMs());
    if (cl.slotOverlaps(this.slots.filter((s) => s.trainer === uid), slot.day, slot.start)) throw new Refused('slot_overlap');
    this.slots.push({ id: this.slots.length + 1, trainer: uid, ...slot, member: null });
    this.changed();
    return this.slotsView(uid);
  },
  removeSlot(uid, id) {
    this.need(uid, 'trainer');
    const s = this.slots.find((x) => x.id === id && x.trainer === uid && x.member === null);
    if (!s) throw new Refused('slot_taken');
    this.slots = this.slots.filter((x) => x !== s);
    this.changed();
    return this.slotsView(uid);
  },
  takeSlot(uid, id) {
    const who = this.need(uid, 'member');
    const s = this.slots.find((x) => x.id === id);
    if (!s || cl.slotStarts(s) <= this.nowMs()) throw new Refused('not_found');
    if (s.member !== null) throw new Refused('slot_taken');
    s.member = who.no;
    this.changed();
    return [this.slotsView(uid), s.trainer > 0 ? [{ type: 'pt', to: s.trainer, slot: s.id, name: who.name, day: s.day, start: s.start, taken: true }] : []];
  },
  giveSlot(uid, id) {
    const who = this.need(uid, 'member');
    const s = this.slots.find((x) => x.id === id && x.member === who.no);
    if (!s) throw new Refused('not_found');
    if (this.nowMs() > cl.slotStarts(s) - cl.CANCEL_BEFORE_MS) throw new Refused('cancel_late');
    s.member = null;
    this.changed();
    return [this.slotsView(uid), s.trainer > 0 ? [{ type: 'pt', to: s.trainer, slot: s.id, name: who.name, day: s.day, start: s.start, taken: false }] : []];
  },
});
