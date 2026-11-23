// Browser test of the demo at 1440 px and 375 px. Fails on any console error, page error or failed request.
//   PW_CHANNEL=chrome node scripts/e2e.mjs        (needs `playwright`: npm i --no-save playwright)
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

const PORT = Number(process.env.E2E_PORT ?? 4382);
const BASE = process.env.E2E_URL ?? `http://127.0.0.1:${PORT}/`;
const server = process.env.E2E_URL ? null : await startServer(PORT);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const errors = [];
let checks = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks += 1;
};

async function open(width, height, { path = '', ready = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'uz-UZ', timezoneId: 'Asia/Tashkent' });
  await ctx.route('https://telegram.org/**', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await ctx.addInitScript(() => { try { localStorage.setItem('sportzal.lang', 'uz'); } catch { /* */ } });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${width}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${width}] ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`[${width}] request failed ${r.url()} ${r.failure()?.errorText}`));
  await page.goto(BASE + path);
  if (ready) await page.waitForSelector('body[data-ready="1"]', { timeout: 60_000 });
  return page;
}

const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? '', sel);
const has = (page, sel, s) => page.waitForFunction(([q, v]) => document.querySelector(q)?.textContent.includes(v), [sel, s], { timeout: 30_000 });
const noScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const done = (page, n) => page.waitForFunction((k) => document.querySelector(`[data-testid=story-${k}]`).classList.contains('done'), n, { timeout: 120_000 });
async function step(page, n) {
  await page.getByTestId(`story-${n}`).click();
  await done(page, n);
}
const A = '[data-testid=aziz-app]';
const M = '[data-testid=malika-app]';
const W = '[data-testid=panel-app]';
const chat = (who) => `[data-testid=${who}-chat]`;
const today = (page) => page.evaluate(() => Math.floor((Date.now() + 5 * 3_600_000) / 86_400_000));

async function story(page, mobile) {
  ok((await text(page, '[data-testid=demo-badge]')).includes('brauzeringizda'), 'demo badge');
  if (mobile) ok(await page.getByTestId('aziz-phone').isVisible() && !(await page.getByTestId('panel-window').isVisible()), 'one frame at a time');
  else ok(await page.getByTestId('malika-phone').isVisible() && await page.getByTestId('panel-window').isVisible(), 'two phones and the panel at 1440 px');
  ok(await noScroll(page), 'no horizontal scroll');
  ok((await text(page, `${A} [data-testid=live-title]`)) === 'Hozir zalda 41 kishi', 'the live count');
  ok((await text(page, `${A} [data-testid=live-level]`)) === 'Gavjum', 'busy');
  ok((await text(page, `${A} [data-testid=live-quiet]`)) === "Eng bo'sh vaqt: 14:00–16:00", 'the quietest time');
  ok((await text(page, `${A} .live-note`)).includes('Taxmin'), 'the forecast says it is an estimate');
  await step(page, 1);
  await step(page, 2);
  await has(page, chat('aziz'), "Abonement rasmiylashtirildi: 12 tashrif");
  ok((await text(page, chat('aziz'))).includes("350 000 so'm (naqd)"), 'the sale message with the price');
  ok((await text(page, `${W} [data-testid=m-left]`)) === '12', 'the desk sees 12 visits');
  await step(page, 3);
  ok(await page.locator(`${A} .qr-frame canvas`).count() === 1, 'the QR is drawn');
  ok(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(await text(page, `${A} [data-testid=qr-code]`)), 'the short code');
  ok((await text(page, `${A} [data-testid=qr-left]`)).includes('soniya'), 'the countdown');
  await step(page, 4);
  await has(page, `${W} [data-testid=scan-text]`, '✅ Kirish: Aziz — 11 tashrif qoldi');
  ok(true, 'the scan lets him in');
  await has(page, `${A} [data-testid=live-title]`, 'Hozir zalda 42 kishi');
  ok((await text(page, `${W} [data-testid=desk-count]`)) === 'Hozir zalda 42 kishi', 'the same 42 at the desk');
  ok((await text(page, `${A} [data-testid=visits-left]`)) === '11', 'the app says 11 visits left');
  await has(page, chat('aziz'), 'Kirish qayd etildi');
  await step(page, 5);
  await has(page, `${W} [data-testid=scan-text]`, '❌ QR eskirgan yoki soxta');
  ok(true, 'the old screenshot is refused');
  const day = await today(page);
  await step(page, 6);
  await has(page, `${A} [data-testid=class-me-yoga19-${day}]`, "Navbatda: 1-o'rin");
  ok(true, 'waitlist number 1');
  await step(page, 7);
  await has(page, chat('aziz'), "Joy bo'shadi! Siz Yogaga yozildingiz: bugun, 19:00");
  await has(page, `${A} [data-testid=class-me-yoga19-${day}]`, 'Siz yozilgansiz');
  ok(true, 'moved up from the waitlist and told by the bot');
  await step(page, 8);
  ok(await page.locator(`${M} [data-testid=person-1].st-attended`).count() === 1, 'the trainer marked him present');
  ok(await page.locator(`${M} [data-testid=inside-1]`).count() === 1, 'the trainer sees he is in the gym');
  await step(page, 9);
  await has(page, chat('aziz'), 'Abonement muzlatildi');
  ok((await text(page, chat('aziz'))).includes('Yangi tugash sanasi'), 'the new end date in the bot');
  ok((await text(page, `${A} [data-testid=abon-left]`)) === '10', 'ten visits left after the evening class');
  await step(page, 10);
  ok((await text(page, `${W} [data-testid=rev-total]`)).endsWith("so'm"), 'revenue for the owner');
  ok(await page.locator(`${W} [data-testid^=reminded-]`).count() >= 1, 'the story ends on a sent reminder');
  ok(await noScroll(page), 'still no horizontal scroll');
}

async function more(page) {
  await page.getByTestId('demo-lang').click();
  await has(page, '[data-testid=demo-badge]', 'браузере');
  await has(page, `${A} [data-testid=tab-home]`, 'Зал');
  await has(page, W, 'Выручка за месяц');
  ok(true, 'Russian switch');
}

async function rotates() {
  const page = await open(1440, 900);
  await page.getByTestId('aziz-tab-app').click();
  await page.locator(`${A} [data-testid=tab-qr]`).click();
  await page.waitForSelector(`${A} [data-testid=qr-frame][data-step]`);
  const first = await page.getAttribute(`${A} [data-testid=qr-frame]`, 'data-step');
  await page.waitForFunction(([s, f]) => document.querySelector(s)?.dataset.step !== f, [`${A} [data-testid=qr-frame]`, first], { timeout: 40_000 });
  ok(true, 'the QR changes within 30 seconds');
  await page.context().close();
}

try {
  for (const [w, h] of [[1440, 900], [375, 812]]) {
    const page = await open(w, h);
    await story(page, w < 760);
    if (w > 760) await more(page);
    await page.context().close();
  }
  await rotates();
  const outside = await open(375, 700, { path: 'webapp/index.html', ready: false });
  await has(outside, '#app', 'Telegram ichida');
  ok(true, 'the Mini App outside Telegram asks to open it in Telegram');
  await outside.context().close();
  assert.deepEqual(errors, [], `console errors:\n${errors.join('\n')}`);
  console.log(`e2e: ${checks} checks passed at 1440 px and 375 px, 0 console errors`); // eslint-disable-line no-console
} finally {
  await browser.close();
  server?.close();
}
