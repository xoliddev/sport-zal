// A'zolar: find a member by card number or name, see the abonement exactly as the member sees it, sell or renew an
// abonement (cash or card, taken at the desk and only recorded here), freeze it, and the recent history.
import { hhmm, localDay, localMinute } from '../shared/clock.js';
import { dateShort, leftText, money, planName, stateText, until } from '../shared/i18n.js';
import { sell as sellRule } from '../shared/plans.js';
import { h } from '../webapp/util.js';

function abonBox(ctx, ab, title) {
  const { T, lang } = ctx;
  if (!ab) return h('div', { class: 'abon-box none', 'data-testid': 'm-abon' }, T(lang, 'abon.none'));
  const ok = ab.state.code === 'ok';
  return h('div', { class: `abon-box${ok ? '' : ' warn'}`, 'data-testid': 'm-abon' }, title ? h('small', { class: 'muted' }, title) : null,
    h('div', { class: 'row' }, h('b', {}, planName(lang, ab)), h('span', { class: `pill${ok ? ' good' : ' warn'}` }, stateText(T, lang, ab.state))),
    h('div', { class: 'abon-nums' }, h('div', {}, h('strong', { 'data-testid': 'm-left' }, ab.visits_left === null ? '∞' : String(ab.visits_left)), h('small', {}, leftText(T, lang, ab))),
      h('div', {}, h('strong', { 'data-testid': 'm-end' }, until(T, lang, ab.end_day)), h('small', {}, T(lang, 'app.valid')))),
    ab.freeze ? h('p', { class: 'frozen-line' }, T(lang, 'abon.frozen_plan', { from: dateShort(T, lang, ab.freeze.from_day), to: dateShort(T, lang, ab.freeze.from_day + ab.freeze.days - 1) })) : null);
}

function sellForm(ctx, card) {
  const { T, lang, api } = ctx;
  const st = ctx.state;
  st.plan ??= 't12';
  st.paid ??= 'cash';
  const today = localDay(ctx.now());
  const plan = ctx.plans.find((p) => p.id === st.plan) ?? ctx.plans[0];
  const all = [card.abon, card.next].filter(Boolean);
  const preview = sellRule(plan, today, all);
  const pick = (k, v) => () => { st[k] = v; ctx.refresh(); };
  return h('section', { class: 'p-card', 'data-testid': 'sell-form' }, h('h2', {}, T(lang, card.abon && card.abon.state.code !== 'expired' ? 'adm.renew' : 'adm.sell')),
    h('div', { class: 'plan-grid' }, ctx.plans.map((p) => h('button', { type: 'button', class: `plan-opt${p.id === plan.id ? ' on' : ''}`, 'data-testid': `plan-${p.id}`, onclick: pick('plan', p.id) },
      h('b', {}, lang === 'ru' ? p.ru : p.uz), h('span', {}, money(T, lang, p.price)),
      h('small', {}, T(lang, 'adm.plan_terms', { days: p.days, visits: p.visits ?? T(lang, 'abon.unlimited'), freeze: p.freeze }))))),
    h('div', { class: 'segs' }, ['cash', 'card'].map((p) => h('button', { type: 'button', class: `seg${st.paid === p ? ' on' : ''}`, 'data-testid': `paid-${p}`, onclick: pick('paid', p) },
      T(lang, `paid.${p}`)))),
    h('p', { class: 'sell-sum', 'data-testid': 'sell-preview' }, T(lang, 'adm.sell_preview', { from: dateShort(T, lang, preview.start_day), to: dateShort(T, lang, preview.end_day),
      price: money(T, lang, plan.price), paid: T(lang, `paid.${st.paid}`) })),
    h('button', { type: 'button', class: 'p-btn solid wide', 'data-testid': 'sell-go', onclick: () => ctx.act(() => api.sell(card.no, plan.id, st.paid),
      T(lang, 'adm.sold', { name: card.name.split(' ')[0] })) }, T(lang, 'adm.sell_go', { price: money(T, lang, plan.price) })));
}

function freezeBox(ctx, card) {
  const { T, lang, api } = ctx;
  const ab = card.abon;
  if (!ab || ab.freeze || !ab.freeze_left || !['ok', 'window'].includes(ab.state.code)) return null;
  const today = localDay(ctx.now());
  const days = h('input', { type: 'number', min: 1, max: ab.freeze_left, value: Math.min(7, ab.freeze_left), 'aria-label': T(lang, 'adm.fz_days'), 'data-testid': 'm-fz-days' });
  return h('section', { class: 'p-card' }, h('h2', {}, T(lang, 'app.fz_title')), h('p', { class: 'p-hint' }, T(lang, 'abon.freeze_left', { n: ab.freeze_left })),
    h('div', { class: 'code-form' }, days, h('button', { type: 'button', class: 'p-btn', 'data-testid': 'm-fz-go',
      onclick: () => ctx.act(() => api.freeze(card.no, today + 1, Number(days.value)), T(lang, 'app.fz_done')) }, T(lang, 'adm.fz_from_tomorrow'))));
}

export async function renderMembers(ctx) {
  const { T, lang, api } = ctx;
  const st = ctx.state;
  const input = h('input', { type: 'search', placeholder: T(lang, 'adm.search_ph'), value: st.q ?? '', maxlength: 40, 'data-testid': 'search', 'aria-label': T(lang, 'adm.search_ph'),
    onfocus: () => { st.typing = true; }, onblur: () => { st.typing = false; },
    oninput: () => { st.q = input.value; clearTimeout(st.qTimer); st.qTimer = setTimeout(() => ctx.refresh().then(() => document.querySelector('[data-testid=search]')?.focus()), 250); } });
  const found = (st.q ?? '').trim().length >= 1 ? (await api.search(st.q.trim())).items : [];
  const list = h('ul', { class: 'm-list', 'data-testid': 'results' }, found.map((m) => h('li', {}, h('button', { type: 'button', class: `m-row${m.no === st.member ? ' on' : ''}`,
    'data-testid': `member-${m.no}`, onclick: () => { st.member = m.no; ctx.refresh(); } }, h('b', {}, m.name), h('small', {}, `#${m.no}`),
    h('span', { class: 'muted' }, m.abon ? `${planName(lang, m.abon)} · ${stateText(T, lang, m.abon.state)}` : T(lang, 'abon.none'))))));
  const left = h('div', { class: 'm-left' }, h('section', { class: 'p-card' }, input, found.length || !st.q ? list : h('p', { class: 'p-hint' }, T(lang, 'adm.no_results'))));
  if (!st.member) return h('div', { class: 'members', 'data-testid': 'members' }, left, h('div', { class: 'm-right' }, h('p', { class: 'empty' }, T(lang, 'adm.pick_member'))));
  const card = await api.member(st.member);
  const hist = (card.history ?? []).map((a) => h('tr', {}, h('td', {}, dateShort(T, lang, a.sold_day)), h('td', {}, planName(lang, a)), h('td', { class: 'num' }, money(T, lang, a.price)),
    h('td', {}, T(lang, `paid.${a.paid}`)), h('td', {}, `${dateShort(T, lang, a.start_day)} – ${dateShort(T, lang, a.end_day)}`)));
  const visits = (card.visits ?? []).map((v) => h('li', {}, `${dateShort(T, lang, localDay(v.in_at))}, ${hhmm(localMinute(v.in_at))}`));
  return h('div', { class: 'members', 'data-testid': 'members' }, left, h('div', { class: 'm-right' },
    h('section', { class: 'p-card', 'data-testid': 'member-card' }, h('div', { class: 'p-card-head' }, h('h2', {}, card.name), h('span', { class: 'pill' }, `#${card.no}`)),
      card.inside ? h('p', { class: 'pill good' }, T(lang, 'adm.inside_since', { time: hhmm(localMinute(card.inside)) })) : null,
      abonBox(ctx, card.abon), card.next ? abonBox(ctx, card.next, T(lang, 'adm.next')) : null,
      !card.has_tg ? h('p', { class: 'p-hint' }, T(lang, 'err.no_tg')) : null),
    sellForm(ctx, card), freezeBox(ctx, card),
    hist.length ? h('section', { class: 'p-card' }, h('h2', {}, T(lang, 'adm.history')), h('div', { class: 'table-wrap' }, h('table', { class: 'p-table' }, h('tbody', {}, hist))),
      visits.length ? h('p', { class: 'p-hint' }, T(lang, 'adm.last_visits'), ' ', h('span', {}, visits.map((x) => x.textContent).join(' · '))) : null) : null));
}
