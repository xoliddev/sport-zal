// JS port of sportzal/core/plans.py: selling and renewing, the state on a day and minute, freezing with an exact
// shift of the end date, the "tugayotganlar" rule and which reminders are due.
import { InputError, whole } from './text.js';

export const FREEZE_AHEAD = 14;
export const SOON_DAYS = 3;

export function planOf(plans, pid) {
  const p = plans.find((x) => x.id === pid);
  if (!p) throw new InputError('plan');
  return p;
}

export function validPrice(value) {
  const n = whole(value, 1000, 50_000_000, 'price');
  if (n % 1000) throw new InputError('price');
  return n;
}

export const usable = (ab, day) => ab.end_day >= day && ab.visits_left !== 0;

const byStart = (a, b) => a.start_day - b.start_day || a.id - b.id;

export function pick(abons, day) {
  const now = abons.filter((a) => a.start_day <= day && day <= a.end_day && a.visits_left !== 0);
  if (now.length) return [...now].sort(byStart)[0];
  const ahead = abons.filter((a) => a.start_day > day);
  if (ahead.length) return [...ahead].sort(byStart)[0];
  if (!abons.length) return null;
  return [...abons].sort((a, b) => b.end_day - a.end_day || b.id - a.id)[0];
}

export function sell(plan, today, abons) {
  const ends = abons.filter((a) => usable(a, today)).map((a) => a.end_day);
  const start = ends.length ? Math.max(...ends) + 1 : today;
  return { plan: plan.id, price: plan.price, start_day: start, end_day: start + plan.days - 1, visits_left: plan.visits,
    window: plan.window ? [...plan.window] : null, freeze_left: plan.freeze };
}

export const frozenOn = (freezes, day) => freezes.find((f) => f.from_day <= day && day < f.from_day + f.days) ?? null;

export function state(ab, freezes, day, minute) {
  if (!ab) return { code: 'none' };
  if (day < ab.start_day) return { code: 'not_started', day: ab.start_day };
  if (day > ab.end_day) return { code: 'expired', day: ab.end_day };
  if (ab.visits_left === 0) return { code: 'used_up' };
  const f = frozenOn(freezes, day);
  if (f) return { code: 'frozen', day: f.from_day + f.days - 1 };
  const w = ab.window;
  if (w && !(w[0] <= minute && minute < w[1])) return { code: 'window', minute };
  return { code: 'ok' };
}

export function freeze(ab, freezes, start, days, today) {
  if (!ab || !usable(ab, today)) throw new InputError('freeze_state');
  if (freezes.some((f) => f.from_day + f.days - 1 >= today)) throw new InputError('freeze_twice');
  if (ab.freeze_left <= 0) throw new InputError('freeze_none');
  const first = Math.max(today, ab.start_day);
  if (first > ab.end_day) throw new InputError('freeze_from');
  const begin = whole(start, first, Math.min(today + FREEZE_AHEAD, ab.end_day), 'freeze_from');
  const n = whole(days, 1, ab.freeze_left, 'freeze_days');
  return { from_day: begin, days: n, end_day: ab.end_day + n, freeze_left: ab.freeze_left - n };
}

export function soon(ab, today) {
  if (!ab || !(ab.start_day <= today && today <= ab.end_day) || ab.visits_left === 0) return false;
  return ab.end_day - today <= SOON_DAYS || ab.visits_left === 1;
}

export function reminders(ab, today, renewed) {
  if (renewed || !soon(ab, today)) return [];
  const out = [];
  if (ab.end_day - today <= SOON_DAYS) out.push('end3');
  if (ab.visits_left === 1) out.push('last1');
  return out;
}
