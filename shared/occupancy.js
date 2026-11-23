// JS port of sportzal/core/occupancy.py: the live count, the level against capacity, and today's forecast from the
// same weekday of the past 4 weeks (whole-number averages, halves round up), with the quietest two-hour window.
import { atLocal, HOUR_MS, localDay, MIN_MS } from './clock.js';

export const STAY_MAX_MS = 3 * HOUR_MS;
export const WEEKS = 4;
export const SPAN = 2;

export const outAt = (v) => (v.out_at !== null && v.out_at !== undefined ? v.out_at : v.in_at + STAY_MAX_MS);
export const inside = (v, at) => v.in_at <= at && at < outAt(v);
export const live = (visits, now) => visits.reduce((n, v) => n + (inside(v, now) ? 1 : 0), 0);

export function level(count, capacity, levels) {
  const pct = Math.floor((count * 100) / Math.max(1, capacity));
  if (pct < levels[0]) return 'low';
  return pct < levels[1] ? 'mid' : 'high';
}

export function byHour(visits, day) {
  const marks = Array.from({ length: 24 }, (_, h) => atLocal(day, h * 60 + 30));
  const out = new Array(24).fill(0);
  for (const v of visits) {
    const end = outAt(v);
    marks.forEach((at, h) => { if (v.in_at <= at && at < end) out[h] += 1; });
  }
  return out;
}

export const historyDays = (today) => Array.from({ length: WEEKS }, (_, k) => today - 7 * (k + 1));

export function forecast(visits, today) {
  const per = new Map(historyDays(today).map((d) => [d, []]));
  for (const v of visits) per.get(localDay(v.in_at))?.push(v);
  const rows = [...per.entries()].sort((a, b) => a[0] - b[0]).filter(([, vs]) => vs.length).map(([d, vs]) => byHour(vs, d));
  const n = rows.length;
  const hours = Array.from({ length: 24 }, (_, h) => (n ? Math.floor((rows.reduce((s, r) => s + r[h], 0) + Math.floor(n / 2)) / n) : 0));
  return { hours, weeks: n };
}

export function quietest(hours, openMin, closeMin, nowMin) {
  const first = Math.max(Math.ceil(openMin / 60), Math.floor(nowMin / 60) + 1);
  const last = Math.floor(closeMin / 60) - SPAN;
  let best = null;
  for (let h = first; h <= last; h++) {
    const total = hours.slice(h, h + SPAN).reduce((s, x) => s + x, 0);
    if (best === null || total < best[0]) best = [total, h];
  }
  return best ? [best[1], best[1] + SPAN] : null;
}

export function summary(visits, fc, now, gym) {
  const count = live(visits, now);
  const minute = Math.floor((now - atLocal(localDay(now), 0)) / MIN_MS);
  return { count, capacity: gym.capacity, level: level(count, gym.capacity, gym.levels),
    pct: Math.min(100, Math.floor((count * 100) / Math.max(1, gym.capacity))), forecast: fc.hours, weeks: fc.weeks,
    quiet: fc.weeks ? quietest(fc.hours, gym.open, gym.close, minute) : null, open: gym.open, close: gym.close, minute, at: now };
}
