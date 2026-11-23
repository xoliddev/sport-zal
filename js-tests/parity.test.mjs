// The JS port of the core must give exactly what the Python core gives (shared/test_vectors.json).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as classes from '../shared/classes.js';
import * as clock from '../shared/clock.js';
import * as i18n from '../shared/i18n.js';
import * as occ from '../shared/occupancy.js';
import * as plans from '../shared/plans.js';
import * as qr from '../shared/qr.js';
import { readMatrix } from '../shared/qr-read.js';
import * as rotqr from '../shared/rotqr.js';
import * as seedgen from '../shared/seedgen.js';
import { hex, hmacSha256, sha256 } from '../shared/sha256.js';
import * as text from '../shared/text.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const V = read('../shared/test_vectors.json');
const data = Object.fromEntries(['names', 'plans', 'schedule', 'gym'].map((n) => [n, read(`../shared/data/${n}.json`)]));
const t = i18n.makeT({ uz: read('../shared/locales/uz.json'), ru: read('../shared/locales/ru.json') });
const { today: TODAY, now: NOW, morning: MORNING, nye: NYE } = V;
const PIN = { minute: 560, count: 41 };

function res(fn) {
  try {
    return { ok: fn() ?? null };
  } catch (e) {
    if (e instanceof text.InputError) return { error: e.code };
    throw e;
  }
}
const digest = (x) => text.h32(JSON.stringify(x));

test('Tashkent calendar, FNV-1a, SHA-256 and HMAC', () => {
  for (const v of V.civil) {
    assert.deepEqual(clock.civil(v.day), v.out, String(v.day));
    assert.equal(clock.daysFromCivil(...v.out), v.back);
  }
  for (const v of V.minute) assert.deepEqual([clock.localDay(v.ms), clock.localMinute(v.ms), clock.weekday(clock.localDay(v.ms))], [v.day, v.min, v.wd]);
  for (const v of V.h32) assert.equal(text.h32(v.in), v.out, v.in);
  for (const v of V.sha256) assert.equal(hex(sha256(v.in)), v.out);
  for (const v of V.hmac) assert.equal(hex(hmacSha256(v.key, v.msg)), v.out);
});

test('abonements: selling and renewing, the state on a day and minute, freezing, ending soon, reminders, prices', () => {
  const ps = data.plans;
  const t12 = plans.planOf(ps, 't12');
  const morning = plans.planOf(ps, 'morning');
  const a = { id: 1, ...plans.sell(t12, TODAY, []) };
  assert.deepEqual([plans.sell(t12, TODAY, []), plans.sell(t12, TODAY, [a]), plans.sell(t12, TODAY, [{ ...a, visits_left: 0 }]), plans.sell(morning, NYE - 3, [])], V.sell);
  for (const v of V.state) assert.deepEqual(plans.state(...v.in), v.out, JSON.stringify(v.in));
  for (const v of V.pick) assert.deepEqual(plans.pick(...v.in), v.out, JSON.stringify(v.in));
  for (const v of V.freeze) assert.deepEqual(res(() => plans.freeze(...v.in, TODAY)), v.out, JSON.stringify(v.in));
  for (const v of V.soon) {
    assert.equal(plans.soon(v.in, TODAY), v.soon);
    assert.deepEqual([plans.reminders(v.in, TODAY, false), plans.reminders(v.in, TODAY, true)], [v.rem, v.renewed]);
  }
  for (const v of V.price) assert.deepEqual(res(() => plans.validPrice(v.in)), v.out, String(v.in));
});

test('the rotating QR: tokens, fresh steps only, forged and edited codes fail; short codes; the QR matrix', () => {
  const R = V.rotqr;
  const secret = rotqr.secretFrom(R.seed);
  assert.equal(hex(secret), R.secret);
  assert.equal(rotqr.stepOf(R.now), R.step);
  assert.deepEqual([[1, R.step], [42, R.step - 1], [640, R.step + 3]].map(([m, s]) => rotqr.token(secret, m, s)), R.tokens);
  for (const v of R.verify) assert.deepEqual(rotqr.verify(secret, v.in, R.now), v.out, String(v.in));
  for (const v of R.codes) assert.equal(rotqr.shortCode(secret, v.m, v.s), v.out);
  for (const v of R.norm) assert.equal(rotqr.normCode(v.in), v.out, String(v.in));
  const members = Array.from({ length: 49 }, (_, i) => i + 1);
  for (const v of R.find) assert.deepEqual(rotqr.findCode(secret, v.in, members, R.now), v.out, v.in);
  assert.deepEqual([0, 1, 29_999, 30_000, R.now + 12_345].map(rotqr.secondsLeft), R.left);
  assert.deepEqual(V.qr_parts.format, [0, 1, 2, 3, 4, 5, 6, 7].map(qr.formatBits));
  assert.deepEqual(V.qr_parts.version, [7, 8, 9, 10].map(qr.versionBits));
  assert.deepEqual(qr.rsRemainder([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10), V.qr_parts.rs);
  for (const v of V.qr) {
    const m = qr.matrix(v.in);
    assert.equal(qr.asText(m), v.out);
    assert.equal(readMatrix(m), v.in);
    const broken = m.map((row) => row.slice());
    broken[m.length - 3][m.length - 4] ^= 1;
    assert.equal(readMatrix(broken), null, 'one wrong module is refused, not guessed');
  }
});

const args = [data.names, data.plans, data.schedule, data.gym];
const W = seedgen.world(...args, TODAY, 560);
const WP = seedgen.world(...args, TODAY, 560, PIN);

test('the seeded gym is the same world in both languages (server, pinned demo, New Year)', () => {
  const worlds = [W, WP, seedgen.world(...args, NYE, 18 * 60)];
  V.world.forEach((v, i) => {
    const w = worlds[i];
    assert.deepEqual(Object.fromEntries(Object.entries(w).map(([k, x]) => [k, x.length])), v.sizes);
    assert.deepEqual([w.members.slice(0, 3), w.abonements.slice(0, 2), w.visits.slice(-2)], [v.members, v.abon, v.visit]);
    assert.deepEqual(Object.fromEntries(Object.entries(w).map(([k, x]) => [k, digest(x)])), v.digest);
  });
});

test('occupancy: the live count, levels, the hourly forecast from the same weekday, the quietest window', () => {
  const O = V.occupancy;
  const vis = W.visits;
  const fc = occ.forecast(vis, TODAY);
  assert.deepEqual([MORNING, NOW, clock.atLocal(TODAY, 300)].map((ms) => occ.live(vis, ms)), O.live);
  assert.deepEqual([0, 19, 20, 37, 38, 50, 70].map((n) => occ.level(n, 50, data.gym.levels)), O.level);
  assert.deepEqual(occ.byHour(vis.filter((x) => clock.localDay(x.in_at) === TODAY - 7), TODAY - 7), O.by_hour);
  assert.deepEqual([fc, occ.forecast(vis, NYE)], [O.forecast, O.forecast_nye]);
  assert.deepEqual([0, 560, 840, 1200, 1300].map((m) => occ.quietest(fc.hours, data.gym.open, data.gym.close, m)), O.quiet);
  assert.deepEqual(occ.summary(vis, fc, NOW, data.gym), O.summary);
  assert.deepEqual(occ.summary(WP.visits, occ.forecast(WP.visits, TODAY), MORNING, data.gym), O.pinned);
  assert.equal(O.pinned.count, 41);
});

test('classes, personal training, revenue and fill rates', () => {
  const C = V.classes;
  const ks = data.schedule.classes.map((k) => ({ ...k, trainer: 0 }));
  const yoga = classes.classOf(ks, 'yoga19');
  const times = [0, 16 * 60 + 59, 17 * 60, 17 * 60 + 1, 18 * 60 + 45, 18 * 60 + 44, 19 * 60].map((m) => clock.atLocal(TODAY, m));
  assert.deepEqual(classes.sessions(ks, TODAY, TODAY + 6), C.sessions);
  assert.deepEqual([[TODAY, NOW], [TODAY, times.at(-1)], [TODAY + 7, NOW], [TODAY + 8, NOW], ['x', NOW]].map(([d, n]) => res(() => classes.checkBook(yoga, d, n))), C.book);
  assert.deepEqual(times.map((n) => res(() => classes.checkCancel(yoga, TODAY, n))), C.cancel);
  assert.deepEqual([...times, clock.atLocal(TODAY + 2, 0) - 1, clock.atLocal(TODAY + 2, 0)].map((n) => res(() => classes.checkMark(yoga, TODAY, n))), C.mark);
  assert.deepEqual([[0, 12], [11, 12], [12, 12], [1, 3], [5, 0]].map(([a, b]) => classes.fill(a, b)), C.fill);
  const slots = [{ day: TODAY + 1, start: 900, price: 150000 }, { day: TODAY, start: 900, price: 0 }, { day: TODAY + 15, start: 900, price: 0 },
    { day: TODAY + 1, start: 915, price: 0 }, { day: TODAY + 1, start: 1340, price: 0 }, { day: TODAY + 1, start: 900, price: 1500 },
    { day: TODAY + 1, start: 900 }, [], null];
  assert.deepEqual(slots.map((x) => res(() => classes.checkSlot(x, data.gym, NOW))), C.slot);
  assert.deepEqual([840, 841, 959, 960].map((s) => classes.slotOverlaps([{ day: TODAY, start: 900 }], TODAY, s)), C.overlap);
  const S = V.stats;
  assert.deepEqual([TODAY, NYE - 1, NYE, clock.daysFromCivil(2028, 2, 10)].map(classes.monthOf), S.month);
  const sales = W.abonements.map((a) => ({ plan: a.plan, price: a.price, paid: a.paid, day: a.sold_day }));
  assert.deepEqual([classes.revenue(sales, data.plans, TODAY), classes.revenue(sales, data.plans, TODAY - 30)], [S.revenue, S.revenue_prev]);
  const taken = {};
  for (const b of W.bookings) taken[`${b.class}:${b.day}`] = (taken[`${b.class}:${b.day}`] ?? 0) + 1;
  assert.deepEqual(classes.fillRates(ks, taken, TODAY - 28, TODAY - 1), S.fill);
  assert.equal(S.revenue.rows.reduce((s, r) => s + r.sum, 0), S.revenue.total, 'rows add up to the total');
  assert.equal(S.revenue.cash + S.revenue.card, S.revenue.total, 'cash and card add up to the total');
});

test('the same sentences in Uzbek and Russian: scan results, states, money, dates, the live count', () => {
  const t12 = plans.planOf(data.plans, 't12');
  const view = { uz: t12.uz, ru: t12.ru, visits_left: 11, end_day: TODAY + 29 };
  const unl = { ...view, visits_left: null };
  const results = [{ code: 'ok', name: 'Aziz Karimov', abon: view }, { code: 'ok', name: 'Laylo Saidova', abon: unl },
    { code: 'exit', name: 'Aziz Karimov', minutes: 85 }, { code: 'exit', name: 'Aziz', minutes: 120 }, { code: 'exit', name: 'Aziz', minutes: 7 },
    { code: 'bad' }, { code: 'expired', day: TODAY - 2 }, { code: 'used_up' }, { code: 'window', minute: 18 * 60 + 40 },
    { code: 'frozen', day: TODAY + 6 }, { code: 'not_started', day: NYE }, { code: 'none' }];
  const live = occ.summary(W.visits, occ.forecast(W.visits, TODAY), MORNING, data.gym);
  for (const v of V.sentences) {
    const L = v.lang;
    assert.deepEqual(results.map((r) => i18n.scanText(t, L, r)), v.scan);
    assert.deepEqual(results.map((r) => i18n.scanDetail(t, L, r)), v.detail);
    assert.deepEqual(results.slice(5).map((r) => i18n.stateText(t, L, r)), v.state);
    assert.deepEqual([view, unl].map((x) => i18n.leftText(t, L, x)), v.left);
    assert.deepEqual([0, 350000, 1200000, 141350000].map((n) => i18n.money(t, L, n)), v.money);
    assert.deepEqual([TODAY, NYE].map((d) => i18n.dateShort(t, L, d)), v.date);
    assert.deepEqual([TODAY, NYE].map((d) => i18n.until(t, L, d)), v.until);
    assert.deepEqual([i18n.liveText(t, L, live), i18n.quietText(t, L, live), i18n.quietText(t, L, { ...live, quiet: null })], [v.live, v.quiet, v.no_quiet]);
  }
  assert.deepEqual([0, 7, 999, 1000, 350000, 1234567, -4500].map(i18n.group), V.group);
});
