// Narxlar: the abonement types with their terms. The owner changes a price (whole thousands of so'm; already sold
// abonements keep the price they were sold at); the administrator only sees them.
import { money } from '../shared/i18n.js';
import { h, num } from '../webapp/util.js';

export async function renderPrices(ctx) {
  const { T, lang, api } = ctx;
  const { items, can_edit: canEdit } = await api.prices();
  ctx.plans = items;
  const rows = items.map((p) => {
    const input = h('input', { inputmode: 'numeric', value: String(p.price).replace(/\B(?=(\d{3})+(?!\d))/g, ' '), maxlength: 14, 'aria-label': lang === 'ru' ? p.ru : p.uz,
      'data-testid': `price-${p.id}`, onfocus: () => { ctx.state.typing = true; }, onblur: () => { ctx.state.typing = false; } });
    return h('tr', { 'data-testid': `plan-row-${p.id}` }, h('td', {}, h('b', {}, lang === 'ru' ? p.ru : p.uz)),
      h('td', {}, T(lang, 'adm.plan_terms', { days: p.days, visits: p.visits ?? T(lang, 'abon.unlimited'), freeze: p.freeze })),
      h('td', { class: 'num' }, canEdit ? h('div', { class: 'code-form' }, input, h('button', { type: 'button', class: 'p-btn', 'data-testid': `price-save-${p.id}`,
        onclick: () => ctx.act(() => api.setPrice(p.id, num(input.value)), T(lang, 'adm.price_saved')) }, T(lang, 'adm.save'))) : h('b', {}, money(T, lang, p.price))));
  });
  return h('div', { class: 'prices', 'data-testid': 'prices' }, h('section', { class: 'p-card' }, h('h2', {}, T(lang, 'adm.prices_title')),
    h('p', { class: 'p-hint' }, T(lang, canEdit ? 'adm.prices_owner' : 'adm.prices_admin')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'p-table' }, h('tbody', {}, rows)))));
}
