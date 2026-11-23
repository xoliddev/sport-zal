// The demo's world: the same fictional gym as the server's seed (shared/seedgen.js), relative to the demo's "today",
// with the clock at 09:20 and exactly 41 people inside (the seed keeps the next half hour free of arrivals and exits,
// so the story's 41 -> 42 is not disturbed). Ids are made positive, like real Telegram users, so the demo runs the
// server's rules unchanged. The rest of today's visits are planned ahead and count once their time comes.
import { atLocal, localDay } from '../shared/clock.js';
import { secretFrom } from '../shared/rotqr.js';
import { world } from '../shared/seedgen.js';
import './backend-classes.js';
import './backend-desk.js';
import { Backend } from './backend.js';

export const AZIZ = 100_001;
export const MALIKA = 11;
export const ADMIN = 2;
export const OWNER = 1;
export const START = 9 * 60 + 20;
export const PIN = { minute: START, count: 41 };

export function createDemo({ data, now = () => Date.now(), lang = 'uz' }) {
  const b = new Backend({ data, now, secret: secretFrom('sport-zal browser demo') });
  const today = localDay(b.nowMs());
  b.offset = atLocal(today, START) + 5_000 - b.clock();
  const w = world(data.names, data.plans, data.schedule, data.gym, today, START, PIN);
  const pos = Math.abs;
  b.members = w.members.map((m) => ({ ...m, user_id: pos(m.user_id), last_step: 0 }));
  b.staff = w.staff.map((s) => ({ ...s, user_id: pos(s.user_id) }));
  const tids = Object.fromEntries(b.staff.filter((s) => s.trainer).map((s) => [s.trainer, s.user_id]));
  b.classes = data.schedule.classes.map((k) => ({ id: k.id, kind: k.kind, trainer: tids[k.trainer], days: [...k.days], start: k.start, dur: k.dur, cap: k.cap }));
  b.abonements = w.abonements.map((a) => ({ ...a, window: a.window ? [...a.window] : null }));
  b.byMember = new Map();
  for (const a of b.abonements) {
    if (!b.byMember.has(a.member)) b.byMember.set(a.member, []);
    b.byMember.get(a.member).push(a);
  }
  b.freezes = w.freezes.map((f) => ({ ...f }));
  b.visits = w.visits.map((v) => ({ ...v }));
  b.bookings = w.bookings.map((x, i) => ({ id: i + 1, ...x }));
  b.slots = w.slots.map((s, i) => ({ id: i + 1, ...s, trainer: pos(s.trainer) }));
  for (const uid of [AZIZ, MALIKA, ADMIN, OWNER]) b.setLang(uid, lang);
  b.watched = new Set([AZIZ, MALIKA]);
  return b;
}
