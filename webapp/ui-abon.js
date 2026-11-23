// Abonement: the plan, its state, visits left and the end date (the same numbers the desk sees), and freezing: pick
// the days and the start, see the new end date before confirming.
import { localDay } from '../shared/clock.js';
import { dateShort, leftText, money, planName, stateText, until } from '../shared/i18n.js';
import { h } from './util.js';

function freezeForm(ctx, ab, today) {
  const { T, lang, api } = ctx;
  let days = Math.min(7, ab.freeze_left);
  let start = today + 1;
  const daysOut = h('b', { class: 'stepper-n', 'data-testid': 'fz-days' });
  const preview = h('p', { class: 'fz-preview', 'data-testid': 'fz-preview' });
  const startBtns = [today + 1, today].map((d) => h('button', { type: 'button', class: 'seg', 'data-testid': `fz-start-${d === today ? 'today' : 'tomorrow'}`,
    onclick: () => { start = d; paint(); } }, T(lang, d === today ? 'app.from_today' : 'app.from_tomorrow')));
  const chips = [...new Set([3, 7, ab.freeze_left])].filter((n) => n >= 1 && n <= ab.freeze_left).sort((a, b) => a - b)
    .map((n) => h('button', { type: 'button', class: 'chip', 'data-testid': `fz-chip-${n}`, onclick: () => { days = n; paint(); } }, T(lang, 'fmt.days', { n })));
  function paint() {
    daysOut.textContent = T(lang, 'fmt.days', { n: days });
    startBtns.forEach((b, i) => b.classList.toggle('on', [today + 1, today][i] === start));
    chips.forEach((c) => c.classList.toggle('on', c.textContent === T(lang, 'fmt.days', { n: days })));
    preview.textContent = T(lang, 'app.fz_preview', { from: dateShort(T, lang, start), to: dateShort(T, lang, start + days - 1),
      end: dateShort(T, lang, ab.end_day + days), old: dateShort(T, lang, ab.end_day) });
  }
  const step = (d) => () => { days = Math.min(ab.freeze_left, Math.max(1, days + d)); paint(); };
  paint();
  return h('section', { class: 'card', 'data-testid': 'freeze-form' }, h('h3', {}, T(lang, 'app.fz_title')),
    h('p', { class: 'muted' }, T(lang, 'abon.freeze_left', { n: ab.freeze_left })),
    h('div', { class: 'stepper' }, h('button', { type: 'button', class: 'btn ghost small', onclick: step(-1), 'aria-label': '-1' }, '−'), daysOut,
      h('button', { type: 'button', class: 'btn ghost small', onclick: step(1), 'aria-label': '+1', 'data-testid': 'fz-plus' }, '+')),
    h('div', { class: 'chips' }, chips), h('div', { class: 'segs' }, startBtns), preview,
    h('button', { class: 'btn primary', type: 'button', 'data-testid': 'fz-go',
      onclick: () => ctx.act(() => api.freeze({ from: start, days }), T(lang, 'app.fz_done')) }, T(lang, 'app.fz_go')));
}

export async function renderAbon(ctx) {
  const { T, lang } = ctx;
  const card = await ctx.api.card();
  const ab = card.abon;
  const today = localDay(ctx.now());
  if (!ab) {
    return h('div', { class: 'screen', 'data-testid': 'abon' }, h('section', { class: 'card none' }, h('h2', {}, T(lang, 'abon.none')),
      h('p', { class: 'muted' }, T(lang, 'abon.none_hint')), h('ul', { class: 'plans' }, ctx.plans.map((p) => h('li', {},
        h('b', {}, lang === 'ru' ? p.ru : p.uz), h('span', {}, money(T, lang, p.price)))))));
  }
  const ok = ab.state.code === 'ok';
  const fz = ab.freeze;
  const card0 = h('section', { class: `card abon-card${ok ? '' : ' warn'}`, 'data-testid': 'abon-card' },
    h('div', { class: 'row' }, h('h2', {}, planName(lang, ab)), h('span', { class: `pill${ok ? ' good' : ' warn'}`, 'data-testid': 'abon-state' }, stateText(T, lang, ab.state))),
    h('div', { class: 'abon-nums big' },
      h('div', {}, h('strong', { 'data-testid': 'abon-left' }, ab.visits_left === null ? '∞' : String(ab.visits_left)), h('small', {}, leftText(T, lang, ab))),
      h('div', {}, h('strong', { 'data-testid': 'abon-end' }, until(T, lang, ab.end_day)), h('small', {}, T(lang, 'app.valid')))),
    h('dl', { class: 'facts' }, h('dt', {}, T(lang, 'app.started')), h('dd', {}, dateShort(T, lang, ab.start_day)),
      h('dt', {}, T(lang, 'app.price')), h('dd', {}, money(T, lang, ab.price)),
      ab.window ? [h('dt', {}, T(lang, 'app.window')), h('dd', {}, `${String(ab.window[0] / 60).padStart(2, '0')}:00–${String(ab.window[1] / 60).padStart(2, '0')}:00`)] : null),
    fz ? h('p', { class: 'frozen-line', 'data-testid': 'abon-frozen' }, T(lang, 'abon.frozen_plan', { from: dateShort(T, lang, fz.from_day), to: dateShort(T, lang, fz.from_day + fz.days - 1) })) : null,
    card.next ? h('p', { class: 'muted' }, T(lang, 'abon.next', { name: planName(lang, card.next), from: dateShort(T, lang, card.next.start_day) })) : null);
  const canFreeze = !fz && ab.freeze_left > 0 && ab.days_left >= 1 && ['ok', 'window'].includes(ab.state.code);
  return h('div', { class: 'screen', 'data-testid': 'abon' }, card0,
    canFreeze ? freezeForm(ctx, ab, today) : h('p', { class: 'hint' }, fz ? T(lang, 'app.fz_active') : T(lang, 'abon.freeze_none')),
    h('p', { class: 'hint' }, T(lang, 'app.renew_hint')));
}
