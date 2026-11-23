// What the story "does with its fingers": taps and typing inside the phones' real Mini App screens and the real admin
// panel, so the guided story shows the very same UI a person would use.
import { readCanvas } from '../webapp/qrview.js';

export function makeUi({ apps, phones, env, wait, panel, uids: { AZIZ, MALIKA } }) {
  const paneOf = (who) => (who === 'panel' ? document.querySelector('[data-testid=panel-main]') : phones[who].appRoot);
  const $ = (who, sel) => (who === 'panel' ? document.querySelector('[data-testid=panel-app]') : phones[who].appRoot).querySelector(sel);
  async function until(who, sel, ms = 8000) {
    for (let i = 0; i < ms / 50; i++) {
      const el = $(who, sel);
      if (el && !el.disabled) return el;
      await wait(50);
    }
    throw new Error(`demo: ${sel} did not appear`);
  }
  async function scrollTo(who, sel, gap = 80) {
    const el = await until(who, sel);
    const root = who === 'panel' ? paneOf('panel') : phones[who].appRoot.querySelector('.app-body');
    if (root) root.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - gap), behavior: 'smooth' });
    await wait(450);
    return el;
  }
  const tap = async (who, sel, gap = 120) => { (await scrollTo(who, sel, gap)).click(); await wait(320); };
  const top = (who) => (who === 'panel' ? paneOf('panel') : phones[who].appRoot.querySelector('.app-body'))?.scrollTo({ top: 0, behavior: 'smooth' });
  async function tab(uid, name) {
    if (apps[uid].screen !== name) await apps[uid].switchTab(name);
    await until(uid, `[data-testid=tab-${name}].on`);
  }
  async function page(name) {
    await panel().ready;
    if (panel().page !== name) await panel().show(name);
    await until('panel', `[data-testid=nav-${name}].on`);
  }
  async function type(el, value) {
    el.focus?.();
    const v = String(value);
    for (let i = 1; i <= v.length; i++) {
      el.value = v.slice(0, i);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(40);
    }
    el.blur?.();
  }

  return {
    async home(uid) {
      await tab(uid, 'home');
      await until(uid, '[data-testid=live-card]');
      top(uid);
    },
    async sell(query, plan, paid) {
      await page('members');
      await type(await until('panel', '[data-testid=search]'), query);
      await wait(400);
      await tap('panel', '[data-testid=member-1]');
      await until('panel', '[data-testid=sell-form]');
      await tap('panel', `[data-testid=plan-${plan}]`, 200);
      await tap('panel', `[data-testid=paid-${paid}]`, 200);
      await wait(400);
      await tap('panel', '[data-testid=sell-go]', 240);
      await until('panel', '[data-testid=m-left]');
      top('panel');
    },
    async qr() {
      await tab(AZIZ, 'qr');
      const cv = await until(AZIZ, '.qr-frame canvas');
      const copy = document.createElement('canvas');
      copy.width = cv.width;
      copy.height = cv.height;
      copy.getContext('2d').drawImage(cv, 0, 0);
      env.shot = { canvas: copy, token: readCanvas(copy) };
      env.scanner.repaint();
      return env.shot;
    },
    async scan(which) {
      await page('desk');
      const prev = panel().ctx.state.lastScan;
      (await until('panel', `[data-testid=scan-${which}]`)).click();
      for (let i = 0; i < 160 && panel().ctx.state.lastScan === prev; i++) await wait(50);
      await until('panel', '[data-testid=scan-result][data-code]');
      top('panel');
    },
    async book(cls, day) {
      await tab(AZIZ, 'classes');
      await tap(AZIZ, `[data-testid=class-act-${cls}-${day}]`, 160);
      await until(AZIZ, `[data-testid=class-me-${cls}-${day}]`);
    },
    async classes(uid, cls, day) {
      await tab(uid, 'classes');
      await scrollTo(uid, `[data-testid=class-${cls}-${day}]`, 160);
    },
    async mark(cls, day, no) {
      apps[MALIKA].ctx.open = { class: cls, day };
      await tab(MALIKA, 'trainer');
      await apps[MALIKA].refresh();
      await tap(MALIKA, `[data-testid=mark-yes-${no}]`, 200);
      await until(MALIKA, `[data-testid=person-${no}].st-attended`);
    },
    async freeze(days) {
      await tab(AZIZ, 'abon');
      await tap(AZIZ, `[data-testid=fz-chip-${days}]`, 200);
      await wait(500);
      await tap(AZIZ, '[data-testid=fz-go]', 240);
      await until(AZIZ, '[data-testid=abon-frozen]');
      top(AZIZ);
    },
    async remind(no) {
      await page('dash');
      if (no) {
        await tap('panel', `[data-testid=remind-${no}]`, 220);
        await scrollTo('panel', `[data-testid=reminded-${no}]`, 200);
      }
    },
  };
}
