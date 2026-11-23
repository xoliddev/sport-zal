// Zal: how busy the gym is right now, today's forecast with the quietest time, and (for a member) the abonement in one
// line with a shortcut to the check-in QR.
import { leftText, planName, stateText, until } from '../shared/i18n.js';
import { liveCard } from './gauge.js';
import { h } from './util.js';

export function abonSummary(ctx, card, onQr) {
  const { T, lang } = ctx;
  const ab = card.abon;
  if (!ab) {
    return h('section', { class: 'card abon-mini none', 'data-testid': 'abon-mini' }, h('b', {}, T(lang, 'abon.none')),
      h('p', { class: 'muted' }, T(lang, 'abon.none_hint')), onQr ? h('button', { class: 'btn ghost', type: 'button', onclick: onQr }, T(lang, 'app.show_qr')) : null);
  }
  const ok = ab.state.code === 'ok';
  return h('section', { class: `card abon-mini${ok ? '' : ' warn'}`, 'data-testid': 'abon-mini' },
    h('div', { class: 'row' }, h('b', {}, planName(lang, ab)), h('span', { class: `pill${ok ? ' good' : ' warn'}` }, stateText(T, lang, ab.state))),
    h('div', { class: 'abon-nums' },
      h('div', {}, h('strong', { 'data-testid': 'visits-left' }, ab.visits_left === null ? '∞' : String(ab.visits_left)),
        h('small', {}, leftText(T, lang, ab))),
      h('div', {}, h('strong', { 'data-testid': 'end-date' }, until(T, lang, ab.end_day)), h('small', {}, T(lang, 'app.valid')))),
    onQr ? h('button', { class: 'btn primary', type: 'button', 'data-testid': 'go-qr', onclick: onQr }, T(lang, 'app.show_qr')) : null);
}

export async function renderHome(ctx) {
  const live = await ctx.api.live();
  const parts = [liveCard(live, ctx.T, ctx.lang)];
  if (ctx.me.role === 'member') {
    const card = await ctx.api.card();
    parts.push(abonSummary(ctx, card, () => ctx.switchTab?.('qr')));
  }
  return h('div', { class: 'screen', 'data-testid': 'home' }, ...parts);
}
