// JS port of sportzal/core/seedgen.py and seedclasses.py: the fictional gym relative to "today" (members, abonement
// chains, five weeks of visits, class bookings, personal-training slots). The browser demo builds its world with it;
// shared/test_vectors.json checks that it is the very same world the server seeds.
import { atLocal, HOUR_MS, weekday } from './clock.js';
import { sessions } from './classes.js';
import { h32 } from './text.js';

export const MEMBERS = 640;
export const HISTORY = 35;
export const OWNER = -1;
export const ADMIN = -2;
export const HERO = 1;
export const ARRIVE = [12, 22, 20, 14, 10, 8, 6, 4, 6, 12, 20, 26, 21, 13, 6, 1];
const MORNING = ARRIVE.slice(0, 4);
const PLAN_SPLIT = [['t12', 24], ['m1', 66], ['morning', 82], ['m3', 100]];
const PAST_DAYS = 28;
const STRIDE = 37;
const PT_PRICE = { malika: 150_000, sherzod: 180_000, kamola: 120_000 };
const PT_STARTS = [660, 900];
const FULL = 'yoga19';

export const memberId = (no) => -(100_000 + no);
export const trainerIds = (schedule) => Object.fromEntries(schedule.trainers.map((t, i) => [t.key, -(11 + i)]));

function weighted(weights, r0) {
  let r = r0 % weights.reduce((s, w) => s + w, 0);
  for (let i = 0; i < weights.length; i++) {
    if (r < weights[i]) return i;
    r -= weights[i];
  }
  return weights.length - 1;
}

export function habit(no, names) {
  const female = h32(`g:${no}`) % 2 === 1;
  const firsts = female ? names.female : names.male;
  const last = names.last[h32(`l:${no}`) % names.last.length] + (female ? 'a' : '');
  const r = h32(`p:${no}`) % 100;
  const plan = PLAN_SPLIT.find(([, top]) => r < top)[0];
  const hour = 7 + weighted(plan === 'morning' ? MORNING : ARRIVE, h32(`h:${no}`));
  const k = h32(`k:${no}`) % 3 === 0 ? 4 : 3;
  const days = [0, 1, 2, 3, 4, 5, 6].sort((a, b) => h32(`wd:${no}:${a}`) - h32(`wd:${no}:${b}`)).slice(0, k).sort((a, b) => a - b);
  return { name: `${firsts[h32(`f:${no}`) % firsts.length]} ${last}`, plan, minute: hour * 60 + (h32(`m:${no}`) % 60), days, stay: 55 + (h32(`s:${no}`) % 60) };
}

export function chain(no, days, today) {
  let start = today - (h32(`st:${no}`) % days);
  if (h32(`lap:${no}`) % 100 < 6) start -= days + 1 + (h32(`lp:${no}`) % 12);
  const out = [];
  while (start + days - 1 >= today - HISTORY) {
    out.push(start);
    start -= days;
  }
  return out.reverse();
}

function abonements(names, byPlan, today) {
  const members = [{ no: HERO, user_id: memberId(HERO), name: names.hero, joined_day: today - 1 }];
  const abons = [];
  const freezes = [];
  const habits = new Map();
  for (let no = 2; no <= MEMBERS; no++) {
    const hb = habit(no, names);
    habits.set(no, hb);
    members.push({ no, user_id: memberId(no), name: hb.name, joined_day: today - HISTORY - (h32(`j:${no}`) % 300) });
    const plan = byPlan[hb.plan];
    const starts = chain(no, plan.days, today);
    for (const start of starts) {
      const ab = { id: abons.length + 1, member: no, plan: plan.id, price: plan.price, paid: h32(`pay:${no}:${start}`) % 100 < 45 ? 'card' : 'cash',
        sold_day: start, start_day: start, end_day: start + plan.days - 1, visits_left: plan.visits, window: plan.window, freeze_left: plan.freeze };
      if (start === starts[starts.length - 1] && h32(`fz:${no}`) % 30 === 0 && ab.end_day >= today) {
        freezes.push({ abon: ab.id, from_day: start + 8, days: 5 });
        ab.end_day += 5;
        ab.freeze_left -= 5;
      }
      abons.push(ab);
    }
  }
  return { members, abons, freezes, habits };
}

function planned(habits, mine, frozen, today, gym) {
  const out = [];
  for (let day = today - HISTORY; day <= today; day++) {
    const wd = weekday(day);
    for (const [no, hb] of habits) {
      if (!hb.days.includes(wd)) continue;
      const r = h32(`${no}:${day}`);
      if (r % 100 >= 82) continue;
      const ab = (mine.get(no) ?? []).find((a) => a.start_day <= day && day <= a.end_day) ?? null;
      if (!ab || frozen.has(`${ab.id}:${day}`)) continue;
      const start = Math.min(Math.max(gym.open, hb.minute + ((r >>> 8) % 21) - 10), gym.close - 30);
      if (ab.window && !(ab.window[0] <= start && start < ab.window[1])) continue;
      const end = Math.min(start + hb.stay + ((r >>> 24) % 21) - 10, gym.close);
      out.push({ member: no, abon: ab.id, day, in: start, out: end, auto: ((r >>> 16) % 100) < 4 });
    }
  }
  return out;
}

export function world(names, plans, schedule, gym, today, nowMin, pin = null) {
  const { members, abons, freezes, habits } = abonements(names, Object.fromEntries(plans.map((p) => [p.id, p])), today);
  const frozen = new Set();
  for (const f of freezes) for (let k = 0; k < f.days; k++) frozen.add(`${f.abon}:${f.from_day + k}`);
  const mine = new Map();
  for (const ab of abons) {
    if (!mine.has(ab.member)) mine.set(ab.member, []);
    mine.get(ab.member).push(ab);
  }
  const plan = planned(habits, mine, frozen, today, gym);
  if (pin) quiet(plan, pin, today, gym);
  const now = atLocal(today, nowMin);
  const used = new Map();
  let visits = [];
  for (const v of [...plan].sort((a, b) => a.day - b.day || a.in - b.in || a.member - b.member)) {
    const ab = abons[v.abon - 1];
    if (!pin && v.day === today && v.in > nowMin) continue;
    if (ab.visits_left !== null) {
      if ((used.get(ab.id) ?? 0) >= ab.visits_left) continue;
      used.set(ab.id, (used.get(ab.id) ?? 0) + 1);
    }
    const inAt = atLocal(v.day, v.in);
    let auto = v.auto && !pin;
    let outAt = auto ? inAt + 3 * HOUR_MS : atLocal(v.day, v.out);
    if (!pin && outAt > now) {
      outAt = null;
      auto = false;
    }
    visits.push({ member: v.member, abon: v.abon, in_at: inAt, out_at: outAt, auto: auto ? 1 : 0 });
  }
  if (pin) visits = count(visits, pin, abons, frozen, today, used);
  for (const ab of abons) if (ab.visits_left !== null) ab.visits_left -= used.get(ab.id) ?? 0;
  const tids = trainerIds(schedule);
  const staff = [{ user_id: OWNER, role: 'owner', name: names.staff.owner, trainer: null },
    { user_id: ADMIN, role: 'admin', name: names.staff.admin, trainer: null },
    ...schedule.trainers.map((t) => ({ user_id: tids[t.key], role: 'trainer', name: t.name, trainer: t.key }))];
  return { members, staff, abonements: abons, freezes, visits, bookings: bookings(schedule.classes, mine, frozen, today, nowMin, MEMBERS),
    slots: slots(schedule, today, nowMin, MEMBERS) };
}

function quiet(plan, pin, today, gym) {
  const lo = pin.minute - 5;
  const hi = pin.minute + 30;
  for (const v of plan) {
    if (v.day !== today) continue;
    if (lo <= v.in && v.in <= hi) {
      v.in = hi + 1 + (v.member % 25);
      v.out = Math.min(v.in + 70, gym.close);
    } else if (lo <= v.out && v.out <= hi) v.out = hi + 1 + (v.member % 40);
  }
}

function count(visits0, pin, abons, frozen, today, used) {
  const at = atLocal(today, pin.minute);
  const inside = visits0.filter((v) => v.in_at <= at && at < v.out_at).sort((a, b) => b.member - a.member);
  const drop = new Set(inside.slice(0, Math.max(0, inside.length - pin.count)));
  for (const v of drop) if (abons[v.abon - 1].visits_left !== null) used.set(v.abon, used.get(v.abon) - 1);
  const visits = visits0.filter((v) => !drop.has(v));
  const here = new Set(visits.filter((v) => v.in_at >= atLocal(today, 0)).map((v) => v.member));
  let need = pin.count - Math.min(inside.length, pin.count);
  for (const ab of abons) {
    if (need <= 0) break;
    if (here.has(ab.member) || !(ab.start_day <= today && today <= ab.end_day) || ab.visits_left !== null || frozen.has(`${ab.id}:${today}`)) continue;
    const k = here.size;
    const start = pin.minute - 20 - ((k * 7) % 60);
    if (ab.window && !(ab.window[0] <= start && start < ab.window[1])) continue;
    visits.push({ member: ab.member, abon: ab.id, in_at: atLocal(today, start), out_at: atLocal(today, pin.minute + 35 + ((k * 11) % 50)), auto: 0 });
    here.add(ab.member);
    need -= 1;
  }
  return visits.sort((a, b) => a.in_at - b.in_at || a.member - b.member);
}

function eligible(mine, frozen, no, day, minute) {
  for (const ab of mine.get(no) ?? []) {
    if (ab.start_day <= day && day <= ab.end_day && !frozen.has(`${ab.id}:${day}`)) return !ab.window || (ab.window[0] <= minute && minute < ab.window[1]);
  }
  return false;
}

export function bookings(classes, mine, frozen, today, nowMin, members) {
  const byId = Object.fromEntries(classes.map((c) => [c.id, c]));
  const now = atLocal(today, nowMin);
  const out = [];
  for (const s of sessions(classes, today - PAST_DAYS, today + 7)) {
    const c = byId[s.class];
    const { day } = s;
    const r = h32(`b:${c.id}:${day}`);
    const past = atLocal(day, c.start) <= now;
    let want;
    if (past) want = Math.floor((c.cap * (55 + (r % 46))) / 100);
    else if (c.id === FULL && day === today) want = c.cap;
    else want = Math.floor((c.cap * (25 + (r % 55))) / 100);
    let no = 2 + ((r >>> 8) % (members - 1));
    let got = 0;
    for (let i = 0; i < members - 1; i++) {
      if (got >= want) break;
      if (eligible(mine, frozen, no, day, c.start)) {
        let status = 'booked';
        if (past && day < today) status = h32(`att:${c.id}:${day}:${no}`) % 100 < 86 ? 'attended' : 'missed';
        out.push({ class: c.id, day, member: no, status });
        got += 1;
      }
      no = 2 + ((no - 2 + STRIDE) % (members - 1));
    }
  }
  return out;
}

export function slots(schedule, today, nowMin, members) {
  const tids = trainerIds(schedule);
  const now = atLocal(today, nowMin);
  const out = [];
  for (const t of schedule.trainers) {
    for (let day = today; day < today + 7; day++) {
      for (const start of PT_STARTS) {
        const r = h32(`pt:${t.key}:${day}:${start}`);
        if (r % 3 === 0 || atLocal(day, start) <= now) continue;
        const member = ((r >>> 4) % 100) < 35 ? 2 + ((r >>> 8) % (members - 1)) : null;
        out.push({ trainer: tids[t.key], day, start, price: PT_PRICE[t.key] ?? 150_000, member });
      }
    }
  }
  return out;
}
