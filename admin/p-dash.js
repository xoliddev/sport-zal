// Boshqaruv: the live count and today's forecast (the same card the members see), today's numbers, the
// "tugayotganlar" list with a reminder per member (once a day), revenue this month by abonement type for the owner
// (whole so'm; the rows add up to the total), and how full each class was over the past four weeks.
import { hhmm, localMinute } from '../shared/clock.js';
import { dateShort, leftText, money, planName } from '../shared/i18n.js';
import { liveCard } from '../webapp/gauge.js';
import { h } from '../webapp/util.js';

function kpi(label, value, testid, kind = '') {
  return h('div', { class: `kpi ${kind}`, 'data-testid': testid }, h('small', {}, label), h('b', {}, value));
}

function soonList(ctx, d) {
  const { T, lang, api } = ctx;
  const items = d.soon.slice(0, 40);
  return h('section', { class: 'p-card', 'data-testid': 'soon' }, h('div', { class: 'p-card-head' }, h('h2', {}, T(lang, 'adm.soon_title')),
    h('span', { class: 'pill warn' }, T(lang, 'adm.total', { n: d.soon.length }))), h('p', { class: 'p-hint' }, T(lang, 'adm.soon_hint')),
  h('ul', { class: 'soon-list' }, items.map((s) => h('li', { 'data-testid': `soon-${s.no}` },
    h('div', { class: 'soon-who' }, h('b', {}, s.name), h('small', {}, `#${s.no} · ${planName(lang, s.abon)}`)),
    h('div', { class: 'soon-why' }, s.abon.days_left <= 3 ? h('span', { class: 'pill warn' }, T(lang, 'adm.ends', { date: dateShort(T, lang, s.abon.end_day) })) : null,
      s.abon.visits_left === 1 ? h('span', { class: 'pill warn' }, leftText(T, lang, s.abon)) : null),
    h('div', { class: 'soon-act' }, s.reminded ? h('span', { class: 'pill good', 'data-testid': `reminded-${s.no}` }, T(lang, 'adm.reminded', { time: hhmm(localMinute(s.reminded)) }))
      : s.has_tg ? h('button', { type: 'button', class: 'p-btn', 'data-testid': `remind-${s.no}`, onclick: () => ctx.act(() => api.remind(s.abon.id), T(lang, 'adm.remind_sent', { name: s.name.split(' ')[0] })) },
        T(lang, 'adm.remind')) : h('small', { class: 'muted' }, T(lang, 'adm.no_tg')))))));
}

function revenueCard(ctx, rev, plans) {
  const { T, lang } = ctx;
  const top = Math.max(1, ...rev.rows.map((r) => r.sum));
  const cashPct = rev.total ? Math.round((rev.cash * 100) / rev.total) : 0;
  return h('section', { class: 'p-card', 'data-testid': 'revenue' }, h('div', { class: 'p-card-head' }, h('h2', {}, T(lang, 'adm.revenue_title')),
    h('span', { class: 'pill' }, `${dateShort(T, lang, rev.from)} – ${dateShort(T, lang, rev.to)}`)),
  h('table', { class: 'p-table rev' }, h('tbody', {}, rev.rows.map((r) => {
    const p = plans.find((x) => x.id === r.plan);
    return h('tr', { 'data-testid': `rev-${r.plan}` }, h('td', {}, p ? (lang === 'ru' ? p.ru : p.uz) : r.plan), h('td', { class: 'num' }, T(lang, 'adm.sold_n', { n: r.count })),
      h('td', { class: 'bar-cell' }, h('i', { style: { width: `${Math.round((r.sum * 100) / top)}%` } })), h('td', { class: 'num' }, h('b', {}, money(T, lang, r.sum))));
  })), h('tfoot', {}, h('tr', {}, h('td', {}, T(lang, 'adm.total_label')), h('td', { class: 'num' }, T(lang, 'adm.sold_n', { n: rev.count })), h('td', {}),
    h('td', { class: 'num' }, h('b', { 'data-testid': 'rev-total' }, money(T, lang, rev.total)))))),
  h('div', { class: 'split' }, h('i', { style: { width: `${cashPct}%` } })),
  h('p', { class: 'p-hint' }, T(lang, 'adm.cash_card', { cash: money(T, lang, rev.cash), card: money(T, lang, rev.card) })));
}

function fillCard(ctx, fill) {
  const { T, lang } = ctx;
  return h('section', { class: 'p-card', 'data-testid': 'fill' }, h('h2', {}, T(lang, 'adm.fill_title')),
    h('p', { class: 'p-hint' }, T(lang, 'adm.fill_hint', { from: dateShort(T, lang, fill.from), to: dateShort(T, lang, fill.to) })),
    h('ul', { class: 'fill-list' }, fill.items.filter((r) => r.sessions).sort((a, b) => b.pct - a.pct).map((r) => {
      const k = ctx.state.classes?.[r.class];
      return h('li', { 'data-testid': `fill-${r.class}` }, h('span', {}, ctx.kinds[r.kind][lang], k ? h('small', {}, ` ${hhmm(k.start)}`) : null),
        h('div', { class: `fill-bar${r.pct >= 90 ? ' hot' : ''}` }, h('i', { style: { width: `${r.pct}%` } })), h('b', {}, T(lang, 'fmt.pct', { n: r.pct })),
        h('small', { class: 'muted' }, `${r.taken}/${r.places}`));
    })));
}

export async function renderDash(ctx) {
  const { T, lang } = ctx;
  const d = await ctx.api.dashboard();
  ctx.state.classes ??= Object.fromEntries(ctx.schedule.classes.map((k) => [k.id, k]));
  const kpis = h('div', { class: 'kpis' }, kpi(T(lang, 'adm.kpi_now'), String(d.live.count), 'kpi-now', `lvl-${d.live.level}`),
    kpi(T(lang, 'adm.kpi_today'), String(d.today), 'kpi-today'), kpi(T(lang, 'adm.kpi_soon'), String(d.soon.length), 'kpi-soon'),
    d.revenue ? kpi(T(lang, 'adm.kpi_month'), money(T, lang, d.revenue.total), 'kpi-month', 'money') : null);
  return h('div', { class: 'dash', 'data-testid': 'dash' }, kpis, h('div', { class: 'dash-grid' },
    h('div', {}, liveCard(d.live, T, lang), fillCard(ctx, d.fill)),
    h('div', {}, d.revenue ? revenueCard(ctx, d.revenue, d.plans) : h('section', { class: 'p-card', 'data-testid': 'revenue-owner' }, h('p', { class: 'p-hint' }, T(lang, 'adm.owner_only'))),
      soonList(ctx, d))));
}
