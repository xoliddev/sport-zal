// The admin panel shell: the front desk (scanning, today's check-ins), members (find, sell or renew, freeze), the
// dashboard (live count and forecast, abonements ending soon, revenue for the owner, class fill rates) and prices.
// Desktop first; under 760 px the menu becomes a row of tabs. The same code runs on the server (admin/api.js) and in
// the browser demo (demo/admin-api.js), where the desk's camera is replaced by phones on the same page.
import { makeT } from '../shared/i18n.js';
import { errText, h, makeText, toast } from '../webapp/util.js';
import { renderDash } from './p-dash.js';
import { renderDesk } from './p-desk.js';
import { renderMembers } from './p-members.js';
import { renderPrices } from './p-prices.js';

const PAGES = { desk: renderDesk, members: renderMembers, dash: renderDash, prices: renderPrices };
const ICONS = {
  desk: '<svg viewBox="0 0 24 24"><path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M7 12h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  members: '<svg viewBox="0 0 24 24"><circle cx="9" cy="9" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 19c.8-3.2 3.2-5 6-5s5.2 1.8 6 5M16 6.5a3 3 0 0 1 0 5.6M18.5 14.5c1.3.8 2.1 2.3 2.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  dash: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  prices: '<svg viewBox="0 0 24 24"><path d="M3 12l9-9h8v8l-9 9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="16" cy="8" r="1.6" fill="currentColor"/></svg>',
};

export function mountPanel(root, { api, catalogs, gym, schedule, lang: lang0 = 'uz', onLang, scanner, now = () => Date.now(), poll = 10_000, start = 'desk', onLogout }) {
  const t = makeT(catalogs);
  const T = makeText(catalogs);
  const ctx = { api, t, T, lang: lang0, gym, schedule, kinds: schedule.kinds, now, scanner, me: null, plans: [], state: {} };
  const nav = h('nav', { class: 'p-nav' });
  const top = h('header', { class: 'p-top' });
  const main = h('main', { class: 'p-main', 'data-testid': 'panel-main' });
  const shell = h('div', { class: 'panel' }, h('aside', { class: 'p-side' }, h('div', { class: 'p-logo' }, h('span', { class: 'p-mark' }), gym.name), nav), h('div', { class: 'p-body' }, top, main));
  root.replaceChildren(shell);
  let page = null;
  let alive = true;
  let cleanup = null;
  let busy = null;

  ctx.toast = (text, kind) => toast(shell, text, kind);
  ctx.fail = (e) => ctx.toast(errText(t, ctx.lang, e), 'bad');
  ctx.act = async (fn, okText) => {
    try {
      const out = await fn();
      if (okText) ctx.toast(okText, 'good');
      await draw();
      return out;
    } catch (e) {
      ctx.fail(e);
      return null;
    }
  };
  ctx.refresh = () => draw();
  ctx.go = (name, params = {}) => { Object.assign(ctx.state, params); return show(name); };

  const pages = () => ['desk', 'members', 'dash', 'prices'];
  function paintChrome() {
    nav.replaceChildren(...pages().map((p) => h('button', { type: 'button', class: `p-link${p === page ? ' on' : ''}`, 'data-testid': `nav-${p}`, onclick: () => show(p) },
      h('span', { class: 'p-ico', html: ICONS[p] }), h('span', {}, T(ctx.lang, `adm.nav.${p}`)))));
    top.replaceChildren(h('h1', { 'data-testid': 'page-title' }, T(ctx.lang, `adm.title.${page ?? 'desk'}`)),
      h('div', { class: 'p-who' }, h('span', { class: 'p-user', 'data-testid': 'panel-user' }, ctx.me.name, h('small', {}, T(ctx.lang, `adm.role.${ctx.me.role}`))),
        h('button', { type: 'button', class: 'p-btn', 'data-testid': 'panel-lang', onclick: () => setLang(ctx.lang === 'uz' ? 'ru' : 'uz') }, ctx.lang === 'uz' ? 'RU' : 'UZ'),
        onLogout ? h('button', { type: 'button', class: 'p-btn', onclick: onLogout }, T(ctx.lang, 'adm.logout')) : null));
  }

  async function draw() {
    if (!alive || !page) return;
    const mine = page;
    busy = (async () => {
      try {
        const el = await PAGES[mine](ctx, (fn) => { cleanup?.(); cleanup = fn; });
        if (alive && page === mine) {
          const y = main.scrollTop;
          main.replaceChildren(el);
          main.scrollTop = y;
        }
      } catch (e) {
        if (alive) main.replaceChildren(h('p', { class: 'empty' }, errText(t, ctx.lang, e)));
      }
    })();
    await busy;
  }

  async function show(name) {
    if (!PAGES[name]) return;
    if (name !== page) {
      cleanup?.();
      cleanup = null;
      main.scrollTop = 0;
    }
    page = name;
    paintChrome();
    await draw();
  }

  async function setLang(l) {
    if (l === ctx.lang) return;
    ctx.lang = l;
    paintChrome();
    onLang?.(l);
    await draw();
  }

  const ready = (async () => {
    ctx.me = await api.me();
    ctx.plans = (await api.prices()).items;
    await show(start);
  })();
  const timer = setInterval(() => { if (!document.hidden && !ctx.state.typing) draw(); }, poll);
  return {
    ready, ctx, show,
    get page() { return page; },
    setLang: async (l) => { await ready; await setLang(l); },
    refresh: async () => { await ready; if (busy) await busy; await draw(); },
    destroy() { alive = false; clearInterval(timer); cleanup?.(); },
  };
}
