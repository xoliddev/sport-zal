// The demo's story headless: the in-page backend runs the server's rules, steps work in order and out of order, on
// any day (30 days in a row, across New Year), and the simulated bots get the same messages the real bot sends.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { atLocal, daysFromCivil } from '../shared/clock.js';
import { makeT, scanText } from '../shared/i18n.js';
import { apiFor, adminFor } from '../demo/api.js';
import { BotSim } from '../demo/bot.js';
import { makeViews } from '../demo/bot-views.js';
import { ADMIN, AZIZ, createDemo, MALIKA, OWNER } from '../demo/seed.js';
import { runStep, STEPS } from '../demo/story.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const data = { ...Object.fromEntries(['names', 'plans', 'schedule', 'gym'].map((n) => [n, read(`../shared/data/${n}.json`)])) };
const catalogs = { uz: read('../shared/locales/uz.json'), ru: read('../shared/locales/ru.json') };
const t = makeT(catalogs);

function world(day = daysFromCivil(2026, 11, 18)) {
  const real = atLocal(day, 8 * 60);
  const started = Date.now();
  const backend = createDemo({ data, now: () => real + (Date.now() - started) });
  const views = makeViews(t, data.schedule.kinds);
  const bots = { [AZIZ]: new BotSim(backend, AZIZ, t, views), [MALIKA]: new BotSim(backend, MALIKA, t, views) };
  backend.on((ev) => { if (ev.type === 'note') bots[ev.note.to]?.deliver(ev.note); });
  return { backend, bots, env: { backend, done: new Set() } };
}
const texts = (bot) => bot.messages.map((m) => m.html).join('\n');

test('the whole story in order: 41 -> 42, the dead screenshot, the waitlist, attendance, the freeze, the reminder', async () => {
  const { backend: b, bots, env } = world();
  assert.equal(b.live().count, 41);
  assert.equal(b.live().level, 'high');
  assert.deepEqual(b.live().quiet, [14, 16]);
  for (let n = 1; n <= 4; n++) await runStep(n, env);
  assert.equal(b.live().count, 42, 'the check-in is counted at once');
  const card = b.myCard(AZIZ);
  assert.equal(card.abon.visits_left, 11);
  assert.match(texts(bots[AZIZ]), /Abonement rasmiylashtirildi: <b>12 tashrif<\/b>[\s\S]*350 000 so'm \(naqd\)/);
  assert.match(texts(bots[AZIZ]), /Kirish qayd etildi, 09:2\d\.\n12 tashrif: 11 tashrif qoldi/);
  await runStep(5, env);
  assert.equal(scanText(t, 'uz', env.friend), '❌ QR eskirgan yoki soxta');
  await runStep(6, env);
  const mine = b.scheduleView(AZIZ).items.find((s) => s.class === 'yoga19' && s.day === env.day0);
  assert.deepEqual([mine.me, mine.pos, mine.taken], ['wait', 1, 12]);
  await runStep(7, env);
  assert.match(texts(bots[AZIZ]), /Joy bo'shadi! Siz <b>Yoga<\/b>ga yozildingiz: bugun, 19:00/);
  await runStep(8, env);
  const list = b.sessionList(MALIKA, { class: 'yoga19', day: env.day0 });
  const aziz = list.people.find((p) => p.no === 1);
  assert.deepEqual([aziz.status, aziz.inside], ['attended', true]);
  assert.equal(b.myCard(AZIZ).abon.visits_left, 10, 'the evening entry took one more visit');
  const end = b.myCard(AZIZ).abon.end_day;
  await runStep(9, env);
  assert.equal(b.myCard(AZIZ).abon.end_day, end + 7);
  assert.match(texts(bots[AZIZ]), /Abonement muzlatildi: .* \(7 kun\)\.\nYangi tugash sanasi: <b>/);
  await runStep(10, env);
  const dash = b.dashboard(OWNER);
  assert.ok(dash.revenue.rows.find((r) => r.plan === 't12').sum >= 350_000);
  assert.equal(dash.revenue.total, dash.revenue.cash + dash.revenue.card);
  assert.ok(dash.soon.some((s) => s.no === env.reminded && s.reminded), 'the story ends on a sent reminder');
  assert.equal(b.dashboard(ADMIN).revenue, null, 'the administrator does not see revenue');
});

test('steps clicked out of order quietly do what they need first', async () => {
  for (const n of [10, 5, 8]) {
    const { backend: b, env } = world();
    await runStep(n, env);
    assert.deepEqual([...env.done].sort((x, y) => x - y), Array.from({ length: n }, (_, i) => i + 1));
    if (n >= 5) assert.equal(env.friend?.code ?? 'bad', 'bad');
    if (n >= 4) assert.ok(b.myCard(AZIZ).abon.visits_left <= 11);
  }
});

test('the story on 30 days in a row and across New Year', async () => {
  const days = [...Array.from({ length: 30 }, (_, k) => daysFromCivil(2026, 12, 10) + k), daysFromCivil(2027, 1, 1)];
  for (const day of days) {
    const { backend: b, env } = world(day);
    assert.equal(b.live().count, 41, String(day));
    for (let n = 1; n <= STEPS.length; n++) await runStep(n, env);
    assert.equal(b.myCard(AZIZ).abon.visits_left, 10, String(day));
    assert.ok(env.reminded, `a reminder on ${day}`);
  }
});

test('the API stand-ins answer like the server: roles, errors, prices', async () => {
  const { backend: b } = world();
  const member = apiFor(b, AZIZ);
  const panel = adminFor(b, () => ADMIN);
  await assert.rejects(member.freeze({ from: b.today() + 1, days: 3 }), { code: 'freeze_state' });
  await assert.rejects(panel.setPrice('t12', 400000), { code: 'forbidden' });
  await assert.rejects(apiFor(b, MALIKA).qr(), { code: 'forbidden' });
  const owner = adminFor(b, () => OWNER);
  await assert.rejects(owner.setPrice('t12', 400500), { code: 'price' });
  const { items } = await owner.setPrice('t12', 400000);
  assert.equal(items.find((p) => p.id === 't12').price, 400000);
  const found = await panel.search('Aziz Karimov');
  assert.equal(found.items[0].no, 1);
  const scan = await panel.scan({ code: 'ZZZZ-ZZZZ' });
  assert.equal(scan.code, 'bad');
});
