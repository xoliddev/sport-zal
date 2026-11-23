// How busy the gym is, drawn in SVG: the gauge (Bo'sh / O'rtacha / Gavjum against capacity) and today's hourly
// forecast with the quietest two-hour window. The member's Mini App, the admin panel and the door screen all draw it
// from the same answer of the same server function, so the number is the same everywhere.
import { localDay, weekday } from '../shared/clock.js';
import { liveText, quietText } from '../shared/i18n.js';
import { h, s } from './util.js';

const R = 74;
const CX = 90;
const CY = 88;
const polar = (pct) => {
  const a = Math.PI * (1 - Math.min(100, Math.max(0, pct)) / 100);
  return [CX + R * Math.cos(a), CY - R * Math.sin(a)];
};
const arc = (from, to) => {
  const [x1, y1] = polar(from);
  const [x2, y2] = polar(to);
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
};

/** The semicircle gauge with the live count in the middle. */
export function gauge(live, T, lang, levels = [40, 75]) {
  const [lo, hi] = levels;
  const pct = Math.min(100, Math.round((live.count * 100) / Math.max(1, live.capacity)));
  const [nx, ny] = polar(pct);
  return s('svg', { class: `gauge lvl-${live.level}`, viewBox: '0 0 180 104', role: 'img', 'aria-label': liveText(T, lang, live), 'data-testid': 'gauge' },
    s('path', { d: arc(0, lo), class: 'g-zone z-low' }), s('path', { d: arc(lo, hi), class: 'g-zone z-mid' }), s('path', { d: arc(hi, 100), class: 'g-zone z-high' }),
    s('path', { d: arc(0, Math.max(0.5, pct)), class: 'g-fill' }),
    s('circle', { cx: nx.toFixed(1), cy: ny.toFixed(1), r: 7, class: 'g-knob' }),
    s('text', { x: CX, y: CY - 14, class: 'g-num', 'text-anchor': 'middle', 'data-testid': 'live-count' }, String(live.count)),
    s('text', { x: CX, y: CY + 4, class: 'g-cap', 'text-anchor': 'middle' }, T(lang, 'live.of', { n: live.count, cap: live.capacity })));
}

/** Today's forecast: one bar per opening hour, the quietest window marked, the current hour outlined. */
export function forecastChart(live, T, lang) {
  const first = Math.ceil(live.open / 60);
  const last = Math.floor(live.close / 60);
  const hours = [];
  for (let hr = first; hr < last; hr++) hours.push(hr);
  const W = 320;
  const H = 112;
  const bw = W / hours.length;
  const top = Math.max(live.capacity * 0.6, ...hours.map((hr) => live.forecast[hr]), 1);
  const now = Math.floor(live.minute / 60);
  const q = live.quiet ?? [-1, -1];
  const svg = s('svg', { class: 'fc', viewBox: `0 0 ${W} ${H + 18}`, role: 'img', 'aria-label': quietText(T, lang, live), 'data-testid': 'forecast' });
  const capY = H - (live.capacity * 0.75 * H) / top;
  if (capY > 6) svg.append(s('line', { x1: 0, x2: W, y1: capY.toFixed(1), y2: capY.toFixed(1), class: 'fc-busy' }));
  hours.forEach((hr, i) => {
    const v = live.forecast[hr];
    const bh = Math.max(2, (v * (H - 8)) / top);
    const cls = ['fc-bar', hr < now ? 'past' : '', q[0] <= hr && hr < q[1] ? 'quiet' : '', hr === now ? 'now' : ''].filter(Boolean).join(' ');
    svg.append(s('rect', { x: (i * bw + 2).toFixed(1), y: (H - bh).toFixed(1), width: (bw - 4).toFixed(1), height: bh.toFixed(1), rx: 3, class: cls,
      'data-h': hr }, s('title', {}, `${String(hr).padStart(2, '0')}:00 — ${v}`)));
    if ((hr - first) % 3 === 0) svg.append(s('text', { x: (i * bw + bw / 2).toFixed(1), y: H + 14, class: 'fc-x', 'text-anchor': 'middle' }, String(hr).padStart(2, '0')));
  });
  if (now >= first && now < last) {
    const x = (now - first) * bw + bw / 2;
    svg.append(s('line', { x1: x.toFixed(1), x2: x.toFixed(1), y1: 0, y2: H, class: 'fc-now' }));
  }
  return svg;
}

/** The whole card: headline, gauge, level, forecast, the quietest time and what the estimate is based on. */
export function liveCard(live, T, lang, { title = true } = {}) {
  const wd = T(lang, `wdl.${weekday(localDay(live.at))}`);
  const base = live.weeks ? T(lang, 'live.estimate', { n: live.weeks, day: wd }) : T(lang, 'live.no_history');
  return h('section', { class: `live-card lvl-${live.level}`, 'data-testid': 'live-card' },
    title ? h('h2', { class: 'live-title', 'data-testid': 'live-title' }, liveText(T, lang, live)) : null,
    h('div', { class: 'live-row' }, gauge(live, T, lang),
      h('div', { class: 'live-side' }, h('span', { class: `level-chip lvl-${live.level}`, 'data-testid': 'live-level' }, T(lang, `level.${live.level}`)),
        h('b', { class: 'live-pct' }, T(lang, 'fmt.pct', { n: live.pct })))),
    live.weeks ? forecastChart(live, T, lang) : null,
    h('p', { class: 'live-quiet', 'data-testid': 'live-quiet' }, quietText(T, lang, live)),
    h('p', { class: 'live-note' }, base));
}
