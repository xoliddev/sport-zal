// The Mini App shell: tabs for a member (Zal, QR, Darslar, Abonement) or a trainer (Darslarim, Shaxsiy, Zal), the
// language switch, polling, toasts and errors. Each tab is drawn by its own module from the API's answers, so the
// same code runs inside Telegram (webapp/api.js over HTTP) and in the browser demo (demo/api.js, in the page).
import { makeT } from '../shared/i18n.js';
import { renderAbon } from './ui-abon.js';
import { renderClasses } from './ui-classes.js';
import { renderHome } from './ui-home.js';
import { renderQr } from './ui-qr.js';
import { renderSlots, renderTrainer } from './ui-trainer.js';
import { errText, h, haptic, makeText, toast } from './util.js';

const TABS = { member: ['home', 'qr', 'classes', 'abon'], trainer: ['trainer', 'slots', 'home'] };
const RENDER = { home: renderHome, qr: renderQr, classes: renderClasses, abon: renderAbon, trainer: renderTrainer, slots: renderSlots };
const ICON = {
  home: '<svg viewBox="0 0 24 24"><path d="M4 18a8 8 0 1 1 16 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 18l4-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  qr: '<svg viewBox="0 0 24 24"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2z" fill="currentColor"/></svg>',
  classes: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 10h16M9 3v4M15 3v4" stroke="currentColor" stroke-width="2"/></svg>',
  abon: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 11h6M7 14h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  trainer: '<svg viewBox="0 0 24 24"><path d="M6 9v6M18 9v6M3 11v2M21 11v2M6 12h12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  slots: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v4l3 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

export function mountApp(root, { api, catalogs, gym, plans, schedule, lang: lang0 = 'uz', onLang, poll = 15_000, now = () => Date.now(), tg = null }) {
  const t = makeT(catalogs);
  const T = makeText(catalogs);
  const ctx = { api, t, T, lang: lang0, gym, plans, schedule, kinds: schedule.kinds, now, tg, me: null };
  const body = h('main', { class: 'app-body', 'data-testid': 'app-body' });
  const nav = h('nav', { class: 'app-tabs', role: 'tablist' });
  const head = h('header', { class: 'app-head' });
  const shell = h('div', { class: 'app' }, head, body, nav);
  root.replaceChildren(shell);
  let tab = null;
  let alive = true;
  let busy = null;
  let cleanup = null;

  ctx.toast = (text, kind) => toast(shell, text, kind);
  ctx.fail = (e) => { haptic(tg, 'error'); ctx.toast(errText(t, ctx.lang, e), 'bad'); };
  ctx.act = async (fn, okText) => {
    try {
      const out = await fn();
      haptic(tg, 'success');
      if (okText) ctx.toast(okText, 'good');
      await draw();
      return out;
    } catch (e) {
      ctx.fail(e);
      return null;
    }
  };
  ctx.refresh = () => draw();
  ctx.switchTab = (name) => switchTab(name);

  function paintHead() {
    const me = ctx.me;
    head.replaceChildren(h('div', { class: 'app-brand' }, h('b', {}, gym.name),
      h('small', {}, me.role === 'trainer' ? T(ctx.lang, 'app.trainer_of', { name: me.name }) : T(ctx.lang, 'app.card_no', { no: me.no }))),
    h('button', { class: 'lang-btn', type: 'button', 'data-testid': 'lang', onclick: () => setLang(ctx.lang === 'uz' ? 'ru' : 'uz') }, ctx.lang === 'uz' ? 'RU' : 'UZ'));
  }

  function paintNav() {
    nav.replaceChildren(...TABS[ctx.me.role === 'trainer' ? 'trainer' : 'member'].map((name) => h('button', {
      class: `tab${name === tab ? ' on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(name === tab), 'data-testid': `tab-${name}`,
      onclick: () => switchTab(name) }, h('span', { class: 'tab-ico', html: ICON[name] }), h('span', {}, T(ctx.lang, `app.tab.${name}`)))));
  }

  async function draw() {
    if (!alive || !tab) return;
    const mine = tab;
    const run = (async () => {
      try {
        cleanup?.();
        cleanup = null;
        const el = await RENDER[mine](ctx, (fn) => { cleanup = fn; });
        if (alive && tab === mine) {
          const y = body.scrollTop;
          body.replaceChildren(el);
          body.scrollTop = y;
        }
      } catch (e) {
        if (alive) body.replaceChildren(h('p', { class: 'empty' }, errText(t, ctx.lang, e)));
      }
    })();
    busy = run;
    await run;
  }

  async function switchTab(name) {
    if (!TABS[ctx.me.role === 'trainer' ? 'trainer' : 'member'].includes(name)) return;
    if (name !== tab) body.scrollTop = 0;
    tab = name;
    paintNav();
    await draw();
  }

  async function setLang(l) {
    if (l === ctx.lang) return;
    ctx.lang = l;
    try { await api.setLang(l); } catch { /* the screen still switches */ }
    paintHead();
    paintNav();
    onLang?.(l);
    await draw();
  }

  const ready = (async () => {
    ctx.me = await api.me();
    ctx.lang = ctx.me.lang || ctx.lang;
    paintHead();
    const hash = (typeof window !== 'undefined' && window.location.hash.slice(1)) || '';
    await switchTab(TABS[ctx.me.role === 'trainer' ? 'trainer' : 'member'].includes(hash) ? hash : (ctx.me.role === 'trainer' ? 'trainer' : 'home'));
  })();
  const timer = setInterval(() => { if (tab !== 'qr' && !document.hidden) draw(); }, poll);

  return {
    ready,
    get screen() { return tab; },
    get lang() { return ctx.lang; },
    switchTab,
    setLang: async (l) => { await ready; await setLang(l); },
    refresh: async () => { await ready; if (busy) await busy; await draw(); },
    destroy() { alive = false; clearInterval(timer); cleanup?.(); },
    ctx,
  };
}
