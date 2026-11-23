// Panel entry: with a session the panel opens; without one it explains how to get the one-time link from the bot
// (and shows the Telegram Login Widget when the owner turned it on).
import { httpAdmin } from './api.js';
import { signInPage } from './login.js';
import { mountPanel } from './panel.js';
import { cameraScanner } from './scanner.js';
import { loadShared, makeText, store } from '../webapp/util.js';

const root = document.getElementById('panel');
const shared = await loadShared();
const T = makeText(shared.catalogs);
const api = httpAdmin();
let lang = store.get('sportzal.lang') === 'ru' ? 'ru' : 'uz';
try {
  await api.me();
  const panel = mountPanel(root, { ...shared, api, lang, scanner: cameraScanner(T),
    onLang: (l) => { lang = l; store.set('sportzal.lang', l); document.documentElement.lang = l; },
    onLogout: async () => { await api.logout().catch(() => {}); window.location.assign('./'); } });
  await panel.ready;
} catch {
  signInPage(root, { api, T, lang });
}
