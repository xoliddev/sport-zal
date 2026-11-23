// Darslar: the coming week's group classes with places and the waitlist (book, join the waitlist, cancel up to 2 hours
// before), and the trainers' personal-training slots (one member per slot, paid at the desk).
import { hhmm } from '../shared/clock.js';
import { dateShort, money } from '../shared/i18n.js';
import { h } from './util.js';

export function whenText(T, lang, day, today) {
  if (day === today) return T(lang, 'when.today');
  if (day === today + 1) return T(lang, 'when.tomorrow');
  return dateShort(T, lang, day);
}

export function placesBar(sess) {
  const pct = Math.min(100, Math.round((sess.taken * 100) / Math.max(1, sess.cap)));
  return h('div', { class: `places${sess.taken >= sess.cap ? ' full' : ''}` }, h('i', { style: { width: `${pct}%` } }));
}

function classRow(ctx, sess, today) {
  const { T, lang, api } = ctx;
  const key = `${sess.class}-${sess.day}`;
  const full = sess.taken >= sess.cap;
  let status = null;
  let btn = null;
  if (sess.me === 'booked') {
    status = h('span', { class: 'pill good', 'data-testid': `class-me-${key}` }, T(lang, 'class.booked'));
    if (sess.can_cancel) btn = h('button', { class: 'btn small ghost', type: 'button', 'data-testid': `class-act-${key}`,
      onclick: () => ctx.act(() => api.cancel(sess.class, sess.day), T(lang, 'app.cancelled')) }, T(lang, 'app.cancel'));
  } else if (sess.me === 'wait') {
    status = h('span', { class: 'pill warn', 'data-testid': `class-me-${key}` }, T(lang, 'class.waiting', { n: sess.pos }));
    btn = h('button', { class: 'btn small ghost', type: 'button', 'data-testid': `class-act-${key}`,
      onclick: () => ctx.act(() => api.cancel(sess.class, sess.day), T(lang, 'app.left_wait')) }, T(lang, 'app.leave_wait'));
  } else if (!sess.past) {
    btn = h('button', { class: `btn small ${full ? 'ghost' : 'primary'}`, type: 'button', 'data-testid': `class-act-${key}`,
      onclick: async () => {
        const out = await ctx.act(() => api.book(sess.class, sess.day));
        if (out) ctx.toast(out.me === 'wait' ? T(lang, 'app.waiting_n', { n: out.pos }) : T(lang, 'app.booked'), 'good');
      } }, T(lang, full ? 'app.wait' : 'app.book'));
  }
  return h('li', { class: `class-row${sess.me ? ` me-${sess.me}` : ''}`, 'data-testid': `class-${key}` },
    h('div', { class: 'class-time' }, h('b', {}, hhmm(sess.start)), h('small', {}, T(lang, 'app.minutes', { n: sess.dur }))),
    h('div', { class: 'class-main' }, h('b', {}, ctx.kinds[sess.kind][lang]), h('small', {}, sess.trainer),
      placesBar(sess), h('small', { class: 'muted', 'data-testid': `class-places-${key}` }, T(lang, 'class.places', { taken: sess.taken, cap: sess.cap }),
        sess.wait ? ` · ${T(lang, 'class.wait', { n: sess.wait })}` : ''), status),
    h('div', { class: 'class-act' }, btn));
}

function slotRow(ctx, slot, today) {
  const { T, lang, api } = ctx;
  let btn = null;
  if (slot.mine && slot.can_cancel) {
    btn = h('button', { class: 'btn small ghost', type: 'button', 'data-testid': `slot-act-${slot.id}`,
      onclick: () => ctx.act(() => api.giveSlot(slot.id), T(lang, 'app.cancelled')) }, T(lang, 'app.cancel'));
  } else if (!slot.taken) {
    btn = h('button', { class: 'btn small primary', type: 'button', 'data-testid': `slot-act-${slot.id}`,
      onclick: () => ctx.act(() => api.takeSlot(slot.id), T(lang, 'app.slot_taken')) }, T(lang, 'app.take_slot'));
  }
  return h('li', { class: `class-row${slot.mine ? ' me-booked' : ''}`, 'data-testid': `slot-${slot.id}` },
    h('div', { class: 'class-time' }, h('b', {}, hhmm(slot.start)), h('small', {}, whenText(T, lang, slot.day, today))),
    h('div', { class: 'class-main' }, h('b', {}, slot.trainer), h('small', {}, money(T, lang, slot.price)),
      slot.mine ? h('span', { class: 'pill good' }, T(lang, 'app.slot_mine')) : null),
    h('div', { class: 'class-act' }, btn));
}

export async function renderClasses(ctx) {
  const { T, lang } = ctx;
  const [sched, slots] = await Promise.all([ctx.api.classes(), ctx.api.slots()]);
  const today = sched.today;
  const days = [...new Set(sched.items.map((x) => x.day))];
  const groups = days.map((d) => h('section', { class: 'day-group' }, h('h3', {}, whenText(T, lang, d, today)),
    h('ul', { class: 'list' }, sched.items.filter((x) => x.day === d && (!x.past || x.me)).map((x) => classRow(ctx, x, today)))));
  const pt = slots.items.slice(0, 12);
  return h('div', { class: 'screen', 'data-testid': 'classes' }, h('h2', {}, T(lang, 'app.classes_title')),
    h('p', { class: 'hint' }, T(lang, 'app.classes_hint')), ...groups,
    h('h2', { class: 'mt' }, T(lang, 'app.pt_title')), h('p', { class: 'hint' }, T(lang, 'app.pt_hint')),
    pt.length ? h('ul', { class: 'list' }, pt.map((x) => slotRow(ctx, x, today))) : h('p', { class: 'empty' }, T(lang, 'app.pt_none')));
}
