// JS port of sportzal/i18n.py: locale templates with escaped params and the sentences every screen needs, so the Mini
// App, the admin panel and the demo's bot read exactly like the real bot ("✅ Kirish: Aziz — 11 tashrif qoldi").
import { civil, hhmm } from './clock.js';

export class Raw {
  constructor(html) {
    this.html = String(html);
  }

  toString() {
    return this.html;
  }
}

export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function render(template, params = {}) {
  return template.replace(/\{(\w+)\}/g, (m, k) => {
    if (!(k in params)) return m;
    const v = params[k];
    return v instanceof Raw ? v.html : escapeHtml(v);
  });
}

export const normLang = (code) => (code && String(code).slice(0, 2).toLowerCase() === 'ru' ? 'ru' : 'uz');

export function makeT(catalogs) {
  return (lang, key, params) => {
    const l = normLang(lang);
    const template = catalogs[l]?.[key] || catalogs.uz?.[key] || key;
    return render(template, params);
  };
}

export function group(n) {
  let s = String(Math.abs(n));
  let out = '';
  while (s.length > 3) {
    out = ` ${s.slice(-3)}${out}`;
    s = s.slice(0, -3);
  }
  return (n < 0 ? '-' : '') + s + out;
}

export const money = (t, lang, n) => t(lang, 'fmt.money', { n: group(n) });

export function dateShort(t, lang, day) {
  const [, m, d] = civil(day);
  return t(lang, 'fmt.day', { d, month: t(lang, `month.${m}`) });
}

export function until(t, lang, day) {
  const [, m, d] = civil(day);
  return t(lang, 'fmt.until', { d, month: t(lang, `month.${m}`) });
}

export function duration(t, lang, minutes) {
  const total = Math.max(0, minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return t(lang, 'fmt.hm', { h, m });
  return h ? t(lang, 'fmt.h', { h }) : t(lang, 'fmt.m', { m });
}

export const planName = (lang, view) => (normLang(lang) === 'ru' ? view.ru : view.uz);

export function leftText(t, lang, view) {
  if (view.visits_left === null) return t(lang, 'abon.unlimited');
  return t(lang, 'abon.left', { n: view.visits_left });
}

export function stateText(t, lang, state) {
  const { code } = state;
  if (['frozen', 'expired', 'not_started'].includes(code)) return t(lang, `state.${code}`, { date: dateShort(t, lang, state.day) });
  if (code === 'window') return t(lang, 'state.window', { time: hhmm(state.minute) });
  return t(lang, `state.${code}`);
}

const first = (name) => name.split(' ')[0];

export function scanText(t, lang, res) {
  const { code } = res;
  if (code === 'ok') {
    const tail = res.abon.visits_left !== null ? leftText(t, lang, res.abon) : t(lang, 'scan.unlimited_until', { until: until(t, lang, res.abon.end_day) });
    return t(lang, 'scan.ok', { name: first(res.name), tail: new Raw(tail) });
  }
  if (code === 'exit') return t(lang, 'scan.exit', { name: first(res.name), time: duration(t, lang, res.minutes) });
  if (code === 'bad') return t(lang, 'scan.bad');
  if (code === 'expired' || code === 'used_up') return t(lang, 'scan.ended');
  return t(lang, 'scan.warn', { text: new Raw(stateText(t, lang, res)) });
}

export function scanDetail(t, lang, res) {
  if (res.code === 'expired') return t(lang, 'scan.expired_on', { date: dateShort(t, lang, res.day) });
  if (res.code === 'used_up') return t(lang, 'scan.used_up');
  return '';
}

export const liveText = (t, lang, live) => t(lang, 'live.now', { n: live.count });

export function quietText(t, lang, live) {
  const q = live.quiet;
  if (!q) return t(lang, 'live.no_quiet');
  const two = (x) => String(x).padStart(2, '0');
  return t(lang, 'live.quiet', { time: `${two(q[0])}:00–${two(q[1])}:00` });
}
