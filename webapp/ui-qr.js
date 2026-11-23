// QR: the member's check-in code. The server signs a new one every 30 seconds (a screenshot sent to a friend stops
// working within a minute, and each code is accepted once); the ring counts down to the next one. The short code under
// it is for a desk without a camera.
import { leftText, planName, stateText, until } from '../shared/i18n.js';
import { STEP_MS } from '../shared/rotqr.js';
import { qrCanvas } from './qrview.js';
import { h, s } from './util.js';

const RING = 2 * Math.PI * 46;

export async function renderQr(ctx, onCleanup) {
  const { T, lang } = ctx;
  const [first, card] = await Promise.all([ctx.api.qr(), ctx.api.card()]);
  let qr = first;
  const frame = h('div', { class: 'qr-frame', 'data-testid': 'qr-frame' });
  const ring = s('circle', { cx: 50, cy: 50, r: 46, class: 'ring-fg', 'stroke-dasharray': RING.toFixed(1) });
  const secs = h('span', { class: 'qr-secs', 'data-testid': 'qr-left' });
  const code = h('b', { class: 'qr-code', 'data-testid': 'qr-code' });
  const wrap = h('div', { class: 'qr-wrap' }, s('svg', { class: 'qr-ring', viewBox: '0 0 100 100', 'aria-hidden': 'true' },
    s('circle', { cx: 50, cy: 50, r: 46, class: 'ring-bg' }), ring), frame);

  function paint() {
    frame.replaceChildren(qrCanvas(qr.token, 196, T(lang, 'app.qr_label')));
    frame.dataset.step = String(qr.step);
    code.textContent = qr.code;
  }
  function tick() {
    const left = (qr.step + 1) * STEP_MS - ctx.now();
    const sec = Math.max(0, Math.ceil(left / 1000));
    secs.textContent = T(lang, 'app.qr_secs', { n: sec });
    ring.setAttribute('stroke-dashoffset', (RING * (1 - Math.max(0, Math.min(1, left / STEP_MS)))).toFixed(1));
    ring.classList.toggle('low', sec <= 5);
    return left;
  }
  let loading = false;
  async function step() {
    if (tick() > 0 || loading) return;
    loading = true;
    try {
      qr = await ctx.api.qr();
      paint();
    } catch { /* the next tick tries again */ }
    loading = false;
  }
  paint();
  tick();
  const timer = setInterval(step, 250);
  onCleanup(() => clearInterval(timer));
  const ab = card.abon;
  const line = ab ? `${planName(lang, ab)} · ${leftText(T, lang, ab)} · ${until(T, lang, ab.end_day)}` : T(lang, 'abon.none');
  return h('div', { class: 'screen qr-screen', 'data-testid': 'qr-screen' },
    h('h2', {}, T(lang, 'app.qr_title')), h('p', { class: 'muted center' }, qr.name, ' · ', T(lang, 'app.card_no', { no: qr.no })),
    wrap, h('div', { class: 'qr-meta' }, secs, h('span', {}, T(lang, 'app.qr_code'), ' ', code)),
    h('p', { class: `qr-abon${ab && ab.state.code !== 'ok' ? ' warn' : ''}`, 'data-testid': 'qr-abon' }, line,
      ab && ab.state.code !== 'ok' ? ` — ${stateText(T, lang, ab.state)}` : ''),
    h('p', { class: 'hint' }, T(lang, 'app.qr_hint')));
}
