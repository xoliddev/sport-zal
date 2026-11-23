// The admin panel's frame in the demo: a desktop browser window (on narrow screens it fills the tab), with a switch
// between the administrator at the desk and the owner, and the desk's "camera": in the demo it looks at Aziz's phone
// on the same page or at his friend's screenshot, and reads the QR from their pixels (shared/qr-read.js).
import { readCanvas } from '../webapp/qrview.js';
import { h } from '../webapp/util.js';

export function createWindow({ P, users, onUser }) {
  const root = h('div', { class: 'win-body', 'data-testid': 'panel-app' });
  const userBtns = users.map((u) => h('button', { type: 'button', class: 'win-user', 'data-testid': `panel-as-${u.key}`, onclick: () => onUser(u.uid) }));
  const label = h('div', { class: 'side-label' });
  const frame = h('div', { class: 'win', 'data-testid': 'panel-window' },
    h('div', { class: 'win-bar' }, h('span', { class: 'win-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
      h('span', { class: 'win-url' }, 'sport-zal / admin'), h('div', { class: 'win-users' }, userBtns)), root);
  const side = h('section', { class: 'side side-win', 'data-who': 'panel' }, label, frame);
  function paint(current) {
    label.replaceChildren(h('b', {}, P('demo.panel')), h('span', {}, P('demo.role_panel')));
    users.forEach((u, i) => {
      userBtns[i].textContent = P(u.label);
      userBtns[i].classList.toggle('on', u.uid === current);
    });
  }
  return { side, root, paint };
}

/** The desk's camera in the demo. `sources()` says what is in front of it: Aziz's phone and, once taken, the screenshot. */
export function demoScanner({ P, sources }) {
  const painters = new Set();
  return {
    repaint() { for (const fn of painters) fn(); },
    mount(el, onText) {
      const paint = () => {
        const src = sources();
        el.replaceChildren(h('div', { class: 'cam' }, h('p', { class: 'scan-note' }, P('demo.cam_hint')),
          h('div', { class: 'cam-row' }, src.map((s) => h('button', { type: 'button', class: `cam-src${s.ready() ? '' : ' off'}`, 'data-testid': `scan-${s.key}`,
            onclick: async () => {
              const canvas = await s.canvas();
              const text = canvas ? readCanvas(canvas) : null;
              if (text) onText(text);
            } }, s.thumb() ?? h('span', { class: 'cam-ico' }, s.icon), h('b', {}, P(s.label)))))));
      };
      painters.add(paint);
      paint();
      return () => painters.delete(paint);
    },
  };
}
