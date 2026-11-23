// Signing in to the panel without passwords. login.html?t=<token> is the one-time link the bot sends: the token is
// taken out of the address bar at once and posted back (a link preview that merely opens the URL cannot use it up).
// The sign-in page also shows the Telegram Login Widget when the owner turned it on (LOGIN_WIDGET=1).
import { httpAdmin } from './api.js';
import { h, loadShared, makeText, store } from '../webapp/util.js';

export async function signInPage(root, { api, T, lang }) {
  const box = h('section', { class: 'p-card login-card', 'data-testid': 'login' }, h('div', { class: 'p-logo' }, h('span', { class: 'p-mark' }), 'Sport Zal'),
    h('h1', {}, T(lang, 'adm.login_title')), h('ol', { class: 'login-steps' }, [1, 2, 3].map((n) => h('li', {}, T(lang, `adm.login_step${n}`)))),
    h('p', { class: 'p-hint' }, T(lang, 'adm.login_safe')));
  root.replaceChildren(h('div', { class: 'login-wrap' }, box));
  try {
    const cfg = await api.config();
    if (cfg.widget && cfg.bot) {
      window.onTelegramAuth = async (user) => {
        try {
          await api.loginWidget(user);
          window.location.assign('./');
        } catch {
          box.append(h('p', { class: 'p-hint bad' }, T(lang, 'adm.login_denied')));
        }
      };
      const s = document.createElement('script');
      s.src = 'https://telegram.org/js/telegram-widget.js?22';
      s.async = true;
      s.dataset.telegramLogin = cfg.bot;
      s.dataset.size = 'large';
      s.dataset.onauth = 'onTelegramAuth(user)';
      s.dataset.requestAccess = 'write';
      box.append(h('p', { class: 'p-hint' }, T(lang, 'adm.login_widget')), s);
    }
  } catch { /* the link from the bot still works */ }
}

async function fromLink() {
  const root = document.getElementById('panel');
  const shared = await loadShared();
  const T = makeText(shared.catalogs);
  const lang = store.get('sportzal.lang') === 'ru' ? 'ru' : 'uz';
  const api = httpAdmin();
  const token = new URLSearchParams(window.location.search).get('t') ?? '';
  window.history.replaceState(null, '', window.location.pathname);
  if (token) {
    try {
      await api.login(token);
      window.location.replace('./');
      return;
    } catch {
      await signInPage(root, { api, T, lang });
      root.querySelector('.login-card')?.append(h('p', { class: 'p-hint bad', 'data-testid': 'login-used' }, T(lang, 'adm.login_used')));
      return;
    }
  }
  await signInPage(root, { api, T, lang });
}

if (window.location.pathname.endsWith('/login.html')) fromLink();
