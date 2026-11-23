// The trainer's side: Darslarim (their own sessions, who booked, who is in the gym now, attendance from 15 minutes
// before the start) and Shaxsiy (personal-training slots they offer, and who took them).
import { hhmm, localDay } from '../shared/clock.js';
import { money } from '../shared/i18n.js';
import { placesBar, whenText } from './ui-classes.js';
import { h, num } from './util.js';

function people(ctx, list) {
  const { T, lang, api } = ctx;
  if (!list.people.length) return h('p', { class: 'empty' }, T(lang, 'app.nobody'));
  const mark = (p, status) => () => ctx.act(() => api.mark(list.class, list.day, p.no, status));
  return h('ul', { class: 'people', 'data-testid': `people-${list.class}-${list.day}` }, list.people.map((p) => h('li', { class: `person st-${p.status}`, 'data-testid': `person-${p.no}` },
    h('div', {}, h('b', {}, p.name), h('small', {}, p.status === 'wait' ? T(lang, 'app.st_wait') : T(lang, `app.st_${p.status}`)),
      p.inside ? h('span', { class: 'pill good', 'data-testid': `inside-${p.no}` }, T(lang, 'app.inside')) : null),
    list.can_mark && p.status !== 'wait' ? h('div', { class: 'mark' },
      h('button', { type: 'button', class: `btn small${p.status === 'attended' ? ' primary' : ' ghost'}`, 'data-testid': `mark-yes-${p.no}`, onclick: mark(p, 'attended') }, '✓'),
      h('button', { type: 'button', class: `btn small${p.status === 'missed' ? ' danger' : ' ghost'}`, 'data-testid': `mark-no-${p.no}`, onclick: mark(p, 'missed') }, '✕')) : null)));
}

export async function renderTrainer(ctx) {
  const { T, lang, api } = ctx;
  const view = await api.trainer();
  const today = view.today;
  if (!ctx.open) ctx.open = view.items.find((s) => s.day === today && !s.past) ?? view.items.find((s) => s.day === today) ?? null;
  const key = (s) => `${s.class}-${s.day}`;
  const openKey = ctx.open ? key(ctx.open) : '';
  const list = ctx.open ? await api.session(ctx.open.class, ctx.open.day).catch(() => null) : null;
  const days = [...new Set(view.items.map((s) => s.day))].filter((d) => d >= today - 1);
  return h('div', { class: 'screen', 'data-testid': 'trainer' }, h('h2', {}, T(lang, 'app.my_classes')),
    h('p', { class: 'hint' }, T(lang, 'app.trainer_hint')),
    ...days.map((d) => h('section', { class: 'day-group' }, h('h3', {}, d === today - 1 ? T(lang, 'app.yesterday') : whenText(T, lang, d, today)),
      h('ul', { class: 'list' }, view.items.filter((s) => s.day === d).map((s) => {
        const open = key(s) === openKey;
        return h('li', { class: `class-row t-row${open ? ' open' : ''}`, 'data-testid': `tclass-${key(s)}` },
          h('button', { type: 'button', class: 't-head', onclick: () => { ctx.open = open ? { class: '', day: -1 } : s; ctx.refresh(); } },
            h('div', { class: 'class-time' }, h('b', {}, hhmm(s.start))),
            h('div', { class: 'class-main' }, h('b', {}, ctx.kinds[s.kind][lang]), placesBar(s),
              h('small', { class: 'muted' }, T(lang, 'class.places', { taken: s.taken, cap: s.cap }), s.wait ? ` · ${T(lang, 'class.wait', { n: s.wait })}` : ''))),
          open && list ? people(ctx, list) : null);
      })))));
}

export async function renderSlots(ctx) {
  const { T, lang, api, gym } = ctx;
  const view = await api.slots();
  const today = localDay(ctx.now());
  const day = h('select', { 'aria-label': T(lang, 'app.day'), 'data-testid': 'slot-day' },
    Array.from({ length: 14 }, (_, k) => h('option', { value: today + k }, whenText(T, lang, today + k, today))));
  const times = [];
  for (let m = gym.open; m <= gym.close - 60; m += 30) times.push(m);
  const time = h('select', { 'aria-label': T(lang, 'app.time'), 'data-testid': 'slot-time' }, times.map((m) => h('option', { value: m }, hhmm(m))));
  time.value = '900';
  const price = h('input', { inputmode: 'numeric', value: '150 000', 'aria-label': T(lang, 'app.price'), 'data-testid': 'slot-price', maxlength: 12 });
  const add = h('form', { class: 'card slot-form', onsubmit: (e) => {
    e.preventDefault();
    ctx.act(() => api.addSlot({ day: Number(day.value), start: Number(time.value), price: num(price.value) }), T(lang, 'app.slot_added'));
  } }, h('h3', {}, T(lang, 'app.slot_new')), h('div', { class: 'grid3' }, day, time, price),
  h('button', { class: 'btn primary', type: 'submit', 'data-testid': 'slot-add' }, T(lang, 'app.slot_add')));
  return h('div', { class: 'screen', 'data-testid': 'slots' }, h('h2', {}, T(lang, 'app.pt_title')), add,
    view.items.length ? h('ul', { class: 'list' }, view.items.map((s) => h('li', { class: `class-row${s.taken ? ' me-booked' : ''}`, 'data-testid': `tslot-${s.id}` },
      h('div', { class: 'class-time' }, h('b', {}, hhmm(s.start)), h('small', {}, whenText(T, lang, s.day, today))),
      h('div', { class: 'class-main' }, h('b', {}, s.taken ? s.member_name : T(lang, 'app.slot_free')), h('small', {}, money(T, lang, s.price))),
      h('div', { class: 'class-act' }, s.taken ? null : h('button', { class: 'btn small ghost', type: 'button', onclick: () => ctx.act(() => api.removeSlot(s.id)) }, '✕')))))
      : h('p', { class: 'empty' }, T(lang, 'app.pt_none')));
}
