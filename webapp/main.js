// Mini App entry. Inside Telegram it passes the signed initData along (the server checks it on every call).
// "#qr" opens the check-in QR, "#trainer" the trainer's classes. Outside Telegram it only asks to open it there.
import { normLang } from '../shared/i18n.js';
import { httpApi } from './api.js';
import { mountApp } from './ui.js';
import { h, loadShared } from './util.js';

const tg = window.Telegram?.WebApp;
const root = document.getElementById('app');
const shared = await loadShared();

if (!tg?.initData) {
  root.replaceChildren(h('p', { class: 'g-outside' }, shared.catalogs.uz['app.open_in_telegram']),
    h('p', { class: 'g-outside' }, shared.catalogs.ru['app.open_in_telegram']));
} else {
  tg.ready();
  tg.expand();
  const lang = normLang(tg.initDataUnsafe?.user?.language_code);
  const app = mountApp(root, { ...shared, api: httpApi(tg.initData), tg, lang, poll: 10_000,
    onLang: (l) => { document.documentElement.lang = l; } });
  await app.ready;
  document.documentElement.lang = app.lang;
}
