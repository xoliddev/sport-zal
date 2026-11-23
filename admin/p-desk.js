// Qabulxona (the front desk): scan the member's QR (camera with BarcodeDetector where the browser has it, or the
// short code typed by hand), the answer in big letters, the live count, and today's check-ins. "Eshik ekrani" turns
// it into the door tablet view: only the scanner, the answer and the count.
import { hhmm, localMinute } from '../shared/clock.js';
import { dateShort, leftText, planName, scanDetail, scanText } from '../shared/i18n.js';
import { gauge } from '../webapp/gauge.js';
import { h } from '../webapp/util.js';

async function scan(ctx, data) {
  try {
    const res = await ctx.api.scan(data);
    ctx.state.lastScan = { res, at: ctx.now() };
  } catch (e) {
    ctx.fail(e);
  }
  await ctx.refresh();
}

function resultBox(ctx) {
  const { T, lang } = ctx;
  const last = ctx.state.lastScan;
  if (!last) return h('div', { class: 'scan-result idle', 'data-testid': 'scan-result' }, T(lang, 'adm.scan_wait'));
  const r = last.res;
  const kind = r.code === 'ok' ? 'ok' : r.code === 'exit' ? 'exit' : r.code === 'bad' ? 'bad' : 'warn';
  const extra = r.abon ? `${planName(lang, r.abon)} · ${leftText(T, lang, r.abon)} · ${T(lang, 'adm.until_date', { date: dateShort(T, lang, r.abon.end_day) })}` : scanDetail(T, lang, r);
  return h('div', { class: `scan-result ${kind}`, 'data-testid': 'scan-result', 'data-code': r.code },
    h('b', { 'data-testid': 'scan-text' }, scanText(T, lang, r)), extra ? h('span', {}, extra) : null,
    h('small', {}, hhmm(localMinute(last.at)), r.no ? ` · #${r.no}` : ''));
}

function scannerCard(ctx) {
  const { T, lang } = ctx;
  if (!ctx.state.scanEl) {
    ctx.state.scanEl = h('div', { class: 'scan-view', 'data-testid': 'scan-view' });
    ctx.state.scanStop = ctx.scanner?.mount(ctx.state.scanEl, (text) => scan(ctx, { token: text }), ctx);
  }
  const code = h('input', { placeholder: 'K7Q2-M9XD', maxlength: 12, autocomplete: 'off', 'aria-label': T(lang, 'adm.code'), 'data-testid': 'code-input',
    onfocus: () => { ctx.state.typing = true; }, onblur: () => { ctx.state.typing = false; } });
  const form = h('form', { class: 'code-form', onsubmit: (e) => {
    e.preventDefault();
    const v = code.value.trim();
    if (v) scan(ctx, { code: v });
  } }, code, h('button', { type: 'submit', class: 'p-btn solid', 'data-testid': 'code-go' }, T(lang, 'adm.check')));
  return h('section', { class: 'p-card scan-card' }, h('div', { class: 'p-card-head' }, h('h2', {}, T(lang, 'adm.scan_title')),
    h('button', { type: 'button', class: 'p-btn', 'data-testid': 'door-toggle', onclick: () => { ctx.state.door = !ctx.state.door; ctx.refresh(); } },
      T(lang, ctx.state.door ? 'adm.door_off' : 'adm.door_on'))),
  ctx.state.scanEl, resultBox(ctx), h('p', { class: 'p-hint' }, T(lang, 'adm.code_hint')), form);
}

function planLabel(ctx, id) {
  const p = ctx.plans.find((x) => x.id === id);
  return p ? (ctx.lang === 'ru' ? p.ru : p.uz) : '—';
}

export async function renderDesk(ctx) {
  const { T, lang } = ctx;
  const [live, visits] = await Promise.all([ctx.api.live(), ctx.api.visits()]);
  const liveBox = h('section', { class: `p-card live-mini lvl-${live.level}`, 'data-testid': 'desk-live' }, gauge(live, T, lang),
    h('div', {}, h('b', { class: 'big-num', 'data-testid': 'desk-count' }, T(lang, 'live.now', { n: live.count })),
      h('span', { class: `level-chip lvl-${live.level}` }, T(lang, `level.${live.level}`))));
  if (ctx.state.door) return h('div', { class: 'desk door', 'data-testid': 'desk' }, scannerCard(ctx), liveBox);
  const rows = visits.items.map((v) => h('tr', { 'data-testid': `visit-${v.no}` },
    h('td', {}, hhmm(localMinute(v.in_at))), h('td', {}, h('b', {}, v.name), h('small', {}, ` #${v.no}`)),
    h('td', {}, planLabel(ctx, v.plan)),
    h('td', {}, v.visits_left === null || v.visits_left === undefined ? T(lang, 'abon.unlimited') : T(lang, 'abon.left', { n: v.visits_left })),
    h('td', {}, h('span', { class: `pill${v.inside ? ' good' : ''}` }, T(lang, v.inside ? 'app.inside' : v.auto ? 'adm.auto_out' : 'adm.went_out')))));
  return h('div', { class: 'desk', 'data-testid': 'desk' }, h('div', { class: 'desk-left' }, scannerCard(ctx)),
    h('div', { class: 'desk-right' }, liveBox,
      h('section', { class: 'p-card' }, h('div', { class: 'p-card-head' }, h('h2', {}, T(lang, 'adm.today_visits')),
        h('span', { class: 'pill', 'data-testid': 'today-total' }, T(lang, 'adm.total', { n: visits.total }))),
      h('div', { class: 'table-wrap' }, h('table', { class: 'p-table', 'data-testid': 'visits' }, h('tbody', {}, rows.slice(0, 14)))))));
}
