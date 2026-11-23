// Demo page: Aziz's phone (bot + Mini App), Malika ustoz's phone (bot + the trainer's Mini App) and the admin panel in
// a browser window, all on the in-page backend; the guided story (in order, all at once, or out of order), the demo
// clock, the language switch. On narrow screens one frame at a time, with a tab switcher.
import { localDay } from '../shared/clock.js';
import { dateShort, makeT } from '../shared/i18n.js';
import { mountPanel } from '../admin/panel.js';
import { qrCanvas } from '../webapp/qrview.js';
import { mountApp } from '../webapp/ui.js';
import { h, loadShared, makeText, store } from '../webapp/util.js';
import { adminFor, apiFor } from './api.js';
import { BotSim } from './bot.js';
import { makeViews } from './bot-views.js';
import { createPhone } from './phone.js';
import { ADMIN, AZIZ, createDemo, MALIKA, OWNER } from './seed.js';
import { runStep, STEPS } from './story.js';
import { makeUi } from './story-ui.js';
import { createWindow, demoScanner } from './window.js';

const shared = await loadShared(new URL('../shared/', import.meta.url), true);
const t = makeT(shared.catalogs);
const T = makeText(shared.catalogs);
let lang = store.get('sportzal.lang') === 'ru' ? 'ru' : 'uz';
const P = (key, params) => T(lang, key, params);
const backend = createDemo({ data: shared, lang });
const views = makeViews(t, shared.schedule.kinds);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const UIDS = [AZIZ, MALIKA];
const people = { [AZIZ]: { who: 'aziz', label: 'demo.aziz', role: 'demo.role_member' }, [MALIKA]: { who: 'malika', label: 'demo.malika', role: 'demo.role_trainer' } };
const phones = {};
const bots = {};
const apps = {};
const env = { backend, bots, wait, done: new Set(), panelUid: ADMIN };
let shown = AZIZ;
let panel = null;

const narrow = () => window.matchMedia('(max-width: 760px)').matches;
function focus(who, pane) {
  if (who !== 'panel') phones[who].show(pane);
  if (narrow()) pick(who);
}
env.focus = focus;

async function openApp(uid, hash) {
  focus(uid, 'app');
  const name = hash.replace('#', '');
  if (name) await apps[uid].switchTab(name);
}

for (const uid of UIDS) {
  bots[uid] = new BotSim(backend, uid, t, views, { onChange: () => phones[uid]?.renderChat(), onAlert: (x) => phones[uid].alert(x), onApp: (hash) => openApp(uid, hash) });
  bots[uid].onLangChange = (l) => setLang(l);
  phones[uid] = createPhone({ who: people[uid].who, label: '', role: people[uid].role, bot: bots[uid], texts: { P }, now: () => backend.nowMs(),
    onOpenApp: (hash) => openApp(uid, hash), onShowApp: () => apps[uid]?.refresh() });
  apps[uid] = mountApp(phones[uid].appRoot, { api: apiFor(backend, uid), ...shared, lang, poll: 1500, now: () => backend.nowMs(), onLang: (l) => setLang(l) });
}

// the desk's camera looks at Aziz's phone, or at the friend's screenshot once it exists
const scanner = demoScanner({ P, sources: () => [
  { key: 'aziz', label: 'demo.cam_aziz', icon: '📱', ready: () => true, thumb: () => null,
    canvas: async () => {
      focus(AZIZ, 'app');
      if (apps[AZIZ].screen !== 'qr') await apps[AZIZ].switchTab('qr');
      if (narrow()) pick('panel');
      return phones[AZIZ].appRoot.querySelector('.qr-frame canvas');
    } },
  { key: 'shot', label: 'demo.cam_shot', icon: '🖼', ready: () => Boolean(env.shot?.canvas), canvas: async () => env.shot?.canvas ?? null,
    thumb: () => (env.shot?.canvas ? h('img', { class: 'cam-thumb', src: env.shot.canvas.toDataURL(), alt: '' }) : null) },
] });
env.scanner = scanner;
env.snapshot = (token) => qrCanvas(token, 196);

const win = createWindow({ P, users: [{ key: 'admin', uid: ADMIN, label: 'demo.as_admin' }, { key: 'owner', uid: OWNER, label: 'demo.as_owner' }],
  onUser: (uid) => setPanelUser(uid) });
function mountPanelAs(uid) {
  panel?.destroy();
  env.panelUid = uid;
  panel = mountPanel(win.root, { api: adminFor(backend, () => env.panelUid), ...shared, lang, scanner, now: () => backend.nowMs(), poll: 2000,
    start: panel?.page ?? 'desk', onLang: (l) => setLang(l) });
  env.panel = panel;
  win.paint(uid);
  return panel.ready;
}
function setPanelUser(uid) {
  if (uid === env.panelUid && panel) return panel.ready;
  return mountPanelAs(uid);
}
env.setPanelUser = setPanelUser;

let pending = false;
backend.on((ev) => {
  if (ev.type === 'note') {
    const msg = bots[ev.note.to]?.deliver(ev.note);
    if (msg) phones[ev.note.to].ping(msg.html);
  }
  if (ev.type === 'changed' && !pending) {
    pending = true;
    queueMicrotask(() => {
      pending = false;
      for (const uid of UIDS) apps[uid]?.refresh();
      panel?.refresh();
      paintClock();
      for (const uid of UIDS) phones[uid].tick();
    });
  }
});
setInterval(() => backend.notify(backend.tick()), 5000);

// ── page ──
const timeEl = h('span', { class: 'demo-date', 'data-testid': 'demo-time' });
const badgeText = h('span');
const langBtn = h('button', { class: 'demo-btn', type: 'button', 'data-testid': 'demo-lang', onclick: () => setLang(lang === 'uz' ? 'ru' : 'uz') });
const page = `${window.location.origin}${window.location.pathname.replace(/index\.html$/, '')}`;
const resetBtn = h('button', { class: 'demo-btn', type: 'button', onclick: () => window.location.assign(page) });
const playBtn = h('button', { class: 'demo-btn solid', type: 'button', 'data-testid': 'play', onclick: () => play() });
const MARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>';
const bar = h('header', { class: 'demo-bar' },
  h('a', { class: 'demo-logo', href: page }, h('span', { class: 'demo-mark', html: MARK }), 'Sport Zal'),
  h('span', { class: 'demo-badge', 'data-testid': 'demo-badge' }, h('span', { class: 'dot' }), badgeText),
  h('span', { class: 'demo-time' }, timeEl),
  h('div', { class: 'demo-tools' }, playBtn, langBtn, resetBtn,
    h('a', { class: 'demo-btn gh', href: 'https://github.com/xoliddev/sport-zal', target: '_blank', rel: 'noopener' }, 'GitHub')));
const title = h('h1');
const lead = h('p');
const foot = h('p', { class: 'demo-foot' });
env.ui = makeUi({ apps, phones, env, wait, panel: () => panel, uids: { AZIZ, MALIKA } });
let running = false;
async function step(i) {
  if (running) return;
  running = true;
  paintStory();
  try {
    await runStep(i + 1, env);
  } catch (err) {
    console.warn(err); // eslint-disable-line no-console
  }
  running = false;
  paintStory();
}
async function play() {
  for (let i = 0; i < STEPS.length; i++) if (!env.done.has(i + 1)) await step(i);
}
const storyBtns = STEPS.map((_, i) => h('button', { class: 'story-btn', type: 'button', 'data-testid': `story-${i + 1}`, onclick: () => step(i) },
  h('b', {}, String(i + 1)), h('span')));
function paintStory() {
  const next = STEPS.findIndex((_, i) => !env.done.has(i + 1));
  storyBtns.forEach((b, i) => {
    b.lastChild.textContent = P(`demo.${STEPS[i]}`);
    b.classList.toggle('done', env.done.has(i + 1));
    b.classList.toggle('next', i === next && !running);
    b.disabled = running;
  });
  playBtn.disabled = running || next < 0;
}
const WHO = [AZIZ, MALIKA, 'panel'];
const whoBtns = WHO.map((w) => h('button', { type: 'button', 'data-testid': `switch-${w === 'panel' ? 'panel' : people[w].who}`, onclick: () => pick(w) }));
const sides = () => [phones[AZIZ].side, phones[MALIKA].side, win.side];
function pick(w) {
  shown = w;
  whoBtns.forEach((b, i) => b.classList.toggle('on', WHO[i] === w));
  sides().forEach((s, i) => s.classList.toggle('show', WHO[i] === w));
}
const paintClock = () => {
  const ms = backend.nowMs();
  const m = Math.floor(((ms + 5 * 3_600_000) % 86_400_000) / 60_000);
  timeEl.textContent = P('demo.time', { date: dateShort(T, lang, localDay(ms)), time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` });
};
function paintTexts() {
  document.documentElement.lang = lang;
  badgeText.textContent = P('demo.badge');
  langBtn.textContent = lang === 'uz' ? 'RU' : 'UZ';
  resetBtn.textContent = P('demo.reset');
  playBtn.textContent = P('demo.play');
  title.textContent = P('demo.title');
  lead.textContent = P('demo.lead');
  foot.textContent = P('demo.foot');
  whoBtns.forEach((b, i) => { b.textContent = P(WHO[i] === 'panel' ? 'demo.panel' : people[WHO[i]].label); });
  paintStory();
  paintClock();
  for (const uid of UIDS) {
    phones[uid].renderLabels();
    phones[uid].side.querySelector('.side-label b').textContent = P(people[uid].label);
  }
  win.paint(env.panelUid);
  scanner.repaint();
}
function setLang(next) {
  if (next === lang) return;
  lang = next;
  store.set('sportzal.lang', lang);
  for (const uid of UIDS) {
    backend.setLang(uid, lang);
    apps[uid].setLang(lang);
  }
  for (const uid of [ADMIN, OWNER]) backend.setLang(uid, lang);
  panel?.setLang(lang);
  paintTexts();
}
setInterval(() => { paintClock(); for (const uid of UIDS) phones[uid].tick(); }, 10_000);

document.body.append(bar, h('section', { class: 'demo-intro' }, title, lead), h('nav', { class: 'story', 'aria-label': 'story' }, storyBtns),
  h('div', { class: 'who-switch', role: 'tablist' }, whoBtns), h('main', { class: 'demo-stage' }, sides()), foot);
for (const uid of UIDS) {
  bots[uid].start();
  phones[uid].show('app');
}
await mountPanelAs(ADMIN);
pick(AZIZ);
paintTexts();
await Promise.all(UIDS.map((uid) => apps[uid].ready));
document.body.dataset.ready = '1';
