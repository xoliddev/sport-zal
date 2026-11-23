// README media from the real demo: desktop + phone screenshots (JPEG), an 800x500 portfolio thumbnail and a GIF of the
// QR check-in, the live count going up and the waitlist moving. JPEG is encoded by the browser (canvas), the GIF by
// gifenc.
//   PW_CHANNEL=chrome node scripts/shots.mjs [outDir]       (needs playwright + gifenc)
import { mkdirSync, writeFileSync } from 'node:fs';
import gifenc from 'gifenc';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

const { GIFEncoder, quantize, applyPalette } = gifenc;
const OUT = process.argv[2] ?? 'docs/media';
const PORT = Number(process.env.SHOTS_PORT ?? 4383);
mkdirSync(OUT, { recursive: true });
const server = await startServer(PORT);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const b64 = (buf) => buf.toString('base64');
const ONLY = new Set((process.env.ONLY ?? 'desktop,thumb,mobile,gif').split(','));

async function open(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, timezoneId: 'Asia/Tashkent' });
  await ctx.route('https://telegram.org/**', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await ctx.addInitScript(() => { try { localStorage.setItem('sportzal.lang', 'uz'); } catch { /* */ } });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector('body[data-ready="1"]');
  return page;
}
const done = (page, n) => page.waitForFunction((k) => document.querySelector(`[data-testid=story-${k}]`).classList.contains('done'), n, { timeout: 120_000 });
const step = async (page, n) => { await page.evaluate((k) => document.querySelector(`[data-testid=story-${k}]`).click(), n); await done(page, n); };
const toStage = (page, gap = 40) => page.evaluate((g) => {
  const top = document.querySelector('[data-testid=aziz-phone]').getBoundingClientRect().top + window.scrollY;
  window.scrollTo(0, top - g);
}, gap);

async function canvasOut(page, fn, args) { return Buffer.from(await page.evaluate(fn, args), 'base64'); }
async function jpeg(page, png, name, w, h) {
  const out = await canvasOut(page, async ([src, W, H]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${src}`;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, W, H);
    return cv.toDataURL('image/jpeg', 0.88).split(',')[1];
  }, [b64(png), w, h]);
  writeFileSync(`${OUT}/${name}`, out);
  console.log('wrote', name); // eslint-disable-line no-console
}

async function thumb(page, phone, win) {
  const out = await canvasOut(page, async ([a, b]) => {
    const load = async (s) => { const i = new Image(); i.src = `data:image/png;base64,${s}`; await i.decode(); return i; };
    const [ph, wn] = await Promise.all([a, b].map(load));
    const cv = document.createElement('canvas');
    cv.width = 1600;
    cv.height = 1000;
    const g = cv.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 1600, 1000);
    bg.addColorStop(0, '#1b2420');
    bg.addColorStop(0.5, '#101315');
    bg.addColorStop(1, '#0b0e10');
    g.fillStyle = bg;
    g.fillRect(0, 0, 1600, 1000);
    const glow = g.createRadialGradient(1120, 520, 30, 1120, 520, 640);
    glow.addColorStop(0, 'rgba(198,242,78,0.20)');
    glow.addColorStop(1, 'rgba(198,242,78,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, 1600, 1000);
    // the forecast as a row of bars, quiet hours in lime
    const bars = [6, 34, 42, 36, 27, 15, 9, 9, 7, 11, 16, 23, 30, 30, 14, 6];
    bars.forEach((v, i) => {
      g.fillStyle = i === 7 || i === 8 ? '#c6f24e' : i === 2 ? '#eef2ef' : '#3a434a';
      const h = v * 3.2;
      g.beginPath(); g.roundRect(82 + i * 24, 900 - h, 17, h, 4); g.fill();
    });
    g.fillStyle = '#c6f24e';
    g.font = '700 22px -apple-system, Segoe UI, Roboto, sans-serif';
    g.fillText('T E L E G R A M   M I N I   A P P   +   P A N E L', 82, 140);
    g.fillStyle = '#ffffff';
    g.font = '800 112px -apple-system, Segoe UI, Roboto, sans-serif';
    g.fillText('Sport', 74, 268);
    g.fillText('Zal', 74, 380);
    ['Zal hozir qanchalik band', 'Har 30 soniyada yangi QR', 'Navbat va avtomatik joy'].forEach((s, i) => {
      g.fillStyle = ['#ff6a55', '#c6f24e', '#5bd5e8'][i];
      g.beginPath(); g.arc(92, 462 + i * 58, 8, 0, 7); g.fill();
      g.fillStyle = '#e6ece8';
      g.font = '500 33px -apple-system, Segoe UI, Roboto, sans-serif';
      g.fillText(s, 118, 474 + i * 58);
    });
    g.fillStyle = 'rgba(198,242,78,0.9)';
    g.font = '600 25px -apple-system, Segoe UI, Roboto, sans-serif';
    g.fillText('xoliddev', 82, 690);
    const place = (img, x, y, h, radius) => {
      const w = (img.width * h) / img.height;
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.6)';
      g.shadowBlur = 50;
      g.shadowOffsetY = 24;
      g.beginPath();
      g.roundRect(x, y, w, h, radius);
      g.fillStyle = '#000';
      g.fill();
      g.shadowColor = 'transparent';
      g.clip();
      g.drawImage(img, x, y, w, h);
      g.restore();
      return w;
    };
    const winH = 640;
    const winW = (wn.width * winH) / wn.height;
    place(wn, 1600 - 60 - winW, 130, winH, 18);
    place(ph, 1600 - 60 - winW - 150, 210, 720, 52);
    const o = document.createElement('canvas');
    o.width = 800;
    o.height = 500;
    const og = o.getContext('2d');
    og.imageSmoothingQuality = 'high';
    og.drawImage(cv, 0, 0, 800, 500);
    return o.toDataURL('image/jpeg', 0.9).split(',')[1];
  }, [b64(phone), b64(win)]);
  writeFileSync(`${OUT}/thumb.jpg`, out);
  console.log('wrote thumb.jpg'); // eslint-disable-line no-console
}

if (ONLY.has('desktop') || ONLY.has('thumb')) {
  const page = await open(1440, 900);
  for (const n of [1, 2, 3, 4]) await step(page, n);
  await page.waitForTimeout(600);
  const phone = await page.getByTestId('aziz-phone').screenshot();
  const win = await page.getByTestId('panel-window').screenshot();
  if (ONLY.has('thumb')) await thumb(page, phone, win);
  if (ONLY.has('desktop')) {
    await toStage(page, 92);
    await page.waitForTimeout(300);
    await jpeg(page, await page.screenshot(), 'demo-desktop.jpg', 1440, 900);
  }
  await page.context().close();
}

if (ONLY.has('mobile')) {
  const page = await open(390, 844);
  for (const n of [1, 2, 3, 4]) await step(page, n);
  await page.getByTestId('switch-aziz').click();
  await toStage(page, 50);
  await page.waitForTimeout(500);
  await jpeg(page, await page.screenshot(), 'demo-mobile.jpg', 390, 844);
  await page.context().close();
}

if (ONLY.has('gif')) {
  const page = await open(1360, 860);
  await step(page, 1);
  await step(page, 2);
  await toStage(page, 4);
  const clip = await page.evaluate(() => {
    const a = document.querySelector('[data-testid=aziz-phone]').getBoundingClientRect();
    const c = document.querySelector('[data-testid=panel-window]').getBoundingClientRect();
    return { x: Math.max(0, a.left - 6), y: Math.max(0, a.top - 4), width: c.right - a.left + 12, height: Math.min(window.innerHeight - a.top - 4, a.height * 0.92) };
  });
  const W = 760;
  const H = Math.round((W * clip.height) / clip.width / 2) * 2;
  const gif = GIFEncoder();
  async function frame(delay) {
    const png = await page.screenshot({ clip });
    const rgba = await page.evaluate(async ([src, w, h]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${src}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, w, h);
      const bytes = g.getImageData(0, 0, w, h).data;
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    }, [b64(png), W, H]);
    const data = new Uint8Array(Buffer.from(rgba, 'base64'));
    const palette = quantize(data, 128);
    gif.writeFrame(applyPalette(data, palette), W, H, { palette, delay });
  }
  async function film(n, every = 550, max = 24) {
    await page.evaluate((k) => document.querySelector(`[data-testid=story-${k}]`).click(), n);
    for (let k = 0; k < max; k++) {
      await frame(every);
      if (await page.evaluate((s) => document.querySelector(`[data-testid=story-${s}]`).classList.contains('done'), n)) break;
      await page.waitForTimeout(every - 200);
    }
  }
  for (const n of [3, 4, 5, 6, 7]) await film(n);
  await frame(2600);
  gif.finish();
  writeFileSync(`${OUT}/qr-kirish-navbat.gif`, gif.bytes());
  console.log('wrote qr-kirish-navbat.gif'); // eslint-disable-line no-console
  await page.context().close();
}
await browser.close();
server.close();
