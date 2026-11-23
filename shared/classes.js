// JS port of sportzal/core/classes.py: the weekly schedule, booking and cancelling rules, attendance marking, fill
// rates and personal-training slots; and of sportzal/core/stats.py: revenue this month and fill rates per class.
import { atLocal, civil, daysFromCivil, HOUR_MS, localDay, MIN_MS, weekday } from './clock.js';
import { InputError, whole } from './text.js';

export const AHEAD_DAYS = 7;
export const CANCEL_BEFORE_MS = 2 * HOUR_MS;
export const MARK_FROM_MS = 15 * MIN_MS;
export const PT_AHEAD_DAYS = 14;
export const PT_MINUTES = 60;

export function classOf(classes, cid) {
  const c = classes.find((x) => x.id === cid);
  if (!c) throw new InputError('not_found');
  return c;
}

export const starts = (c, day) => atLocal(day, c.start);
export const runsOn = (c, day) => c.days.includes(weekday(day));

export function sessions(classes, first, last) {
  const out = [];
  for (let d = first; d <= last; d++) for (const c of classes) if (runsOn(c, d)) out.push({ class: c.id, day: d });
  const byId = Object.fromEntries(classes.map((c) => [c.id, c]));
  return out.sort((a, b) => a.day - b.day || byId[a.class].start - byId[b.class].start || (a.class < b.class ? -1 : a.class > b.class ? 1 : 0));
}

export function checkBook(c, day, now) {
  const d = whole(day, 0, 10 ** 6, 'not_found');
  if (!runsOn(c, d)) throw new InputError('not_found');
  if (starts(c, d) <= now) throw new InputError('class_past');
  if (d > localDay(now) + AHEAD_DAYS) throw new InputError('class_far');
  return d;
}

export function checkCancel(c, day, now) {
  if (now > starts(c, day) - CANCEL_BEFORE_MS) throw new InputError('cancel_late');
}

export function checkMark(c, day, now) {
  if (now < starts(c, day) - MARK_FROM_MS) throw new InputError('mark_early');
  if (now >= atLocal(day + 2, 0)) throw new InputError('mark_late');
}

export const fill = (taken, cap) => Math.floor((taken * 100) / Math.max(1, cap));

export function checkSlot(data, gym, now) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new InputError('slot');
  const today = localDay(now);
  const day = whole(data.day, today, today + PT_AHEAD_DAYS, 'slot_day');
  const start = whole(data.start, gym.open, gym.close - PT_MINUTES, 'slot_time');
  if (start % 30 || atLocal(day, start) <= now) throw new InputError('slot_time');
  const price = whole(data.price, 0, 5_000_000, 'slot_price');
  if (price % 1000) throw new InputError('slot_price');
  return { day, start, price };
}

export const slotOverlaps = (slots, day, start) => slots.some((s) => s.day === day && Math.abs(s.start - start) < PT_MINUTES);
export const slotStarts = (s) => atLocal(s.day, s.start);

export function monthOf(day) {
  const [y, m] = civil(day);
  const [ny, nm] = m === 12 ? [y + 1, 1] : [y, m + 1];
  return [daysFromCivil(y, m, 1), daysFromCivil(ny, nm, 1) - 1];
}

export function revenue(sales, plans, day) {
  const [first, last] = monthOf(day);
  const rows = new Map(plans.map((p) => [p.id, { plan: p.id, count: 0, sum: 0 }]));
  const out = { from: first, to: last, total: 0, count: 0, cash: 0, card: 0 };
  for (const s of sales) {
    if (!(first <= s.day && s.day <= last)) continue;
    if (!rows.has(s.plan)) rows.set(s.plan, { plan: s.plan, count: 0, sum: 0 });
    const row = rows.get(s.plan);
    row.count += 1;
    row.sum += s.price;
    out.total += s.price;
    out.count += 1;
    out[s.paid] += s.price;
  }
  out.rows = [...rows.values()];
  return out;
}

export function fillRates(classes, taken, first, last) {
  const out = new Map(classes.map((c) => [c.id, { class: c.id, kind: c.kind, sessions: 0, taken: 0, places: 0, pct: 0 }]));
  const caps = Object.fromEntries(classes.map((c) => [c.id, c.cap]));
  for (const s of sessions(classes, first, last)) {
    const row = out.get(s.class);
    row.sessions += 1;
    row.places += caps[s.class];
    row.taken += Math.min(caps[s.class], taken[`${s.class}:${s.day}`] ?? 0);
  }
  for (const row of out.values()) row.pct = row.places ? fill(row.taken, row.places) : 0;
  return [...out.values()];
}
