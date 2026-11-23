// The bot, simulated in the page: the same callback data, screens and messages as sportzal/bot (the menu with the
// live count, the forecast chart, the abonement and freezing, classes with booking and the waitlist, the trainer's
// day), and every message the real bot sends on its own. Messages are {id, from: 'bot' | 'me', html, kb, at}.
import { Refused } from './backend.js';

const strip = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const SESSION = /^(c|cb|cx):([a-z0-9]{1,16}):(\d{1,6})$/;

export class BotSim {
  constructor(backend, uid, t, views, { onChange = () => {}, onAlert = () => {}, onApp = () => {} } = {}) {
    Object.assign(this, { b: backend, uid, t, v: views, onChange, onAlert, onApp });
    this.messages = [];
    this.ids = 1;
  }

  get lang() { return this.b.lang(this.uid); }

  push(screen, from = 'bot') {
    const msg = { id: this.ids++, from, html: screen.html, kb: screen.kb ?? [], at: this.b.nowMs() };
    this.messages.push(msg);
    this.onChange();
    return msg;
  }

  show(id, screen) {
    const msg = id && this.messages.find((m) => m.id === id);
    if (!msg) return this.push(screen);
    Object.assign(msg, { html: screen.html, kb: screen.kb ?? [] });
    this.onChange();
    return msg;
  }

  guard(fn) {
    try {
      return fn();
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      const key = this.t(this.lang, `err.${e.code}`) === `err.${e.code}` ? 'err.generic' : `err.${e.code}`;
      this.onAlert(strip(this.t(this.lang, key)));
      return null;
    }
  }

  menuScreen(hello = false) {
    const me = this.b.me(this.uid);
    return this.v.menu(this.lang, me, me.role === 'member' ? this.b.myCard(this.uid) : null, this.b.live(), hello);
  }

  start() {
    this.push({ html: '/start' }, 'me');
    return this.push(this.menuScreen(true));
  }

  type(text) {
    this.push({ html: text.replace(/&/g, '&amp;').replace(/</g, '&lt;') }, 'me');
    this.push({ html: this.t(this.lang, 'bot.unknown') });
    return this.push(this.menuScreen());
  }

  press(id, data) {
    const L = this.lang;
    const b = this.b;
    const uid = this.uid;
    const screen = this.guard(() => {
      if (data === 'm') return this.menuScreen();
      if (data === 'lang') {
        b.setLang(uid, L === 'uz' ? 'ru' : 'uz');
        this.onLangChange?.(this.lang);
        return this.menuScreen();
      }
      if (data === 'live') return this.v.liveScreen(L, b.live());
      if (data === 'ab') return this.v.abonScreen(L, b.myCard(uid));
      if (data === 'fz') {
        const card = b.myCard(uid);
        if (!card.abon?.freeze_left) throw new Refused(card.abon ? 'freeze_none' : 'freeze_state');
        return this.v.freezeAsk(L, card);
      }
      let m = /^fz:(\d{1,2})$/.exec(data);
      if (m) {
        const card = b.myCard(uid);
        if (!card.abon || !this.v.freezeOptions(card.abon).includes(Number(m[1]))) throw new Refused('freeze_days');
        return this.v.freezeConfirm(L, card, Number(m[1]), b.today());
      }
      m = /^fzok:(\d{1,2})$/.exec(data);
      if (m) {
        const [card, notes] = b.freeze(uid, { from: b.today() + 1, days: Number(m[1]) });
        b.notify(notes);
        return this.v.abonScreen(L, card);
      }
      if (data === 'cl') return this.v.classesScreen(L, b.scheduleView(uid).items, b.today());
      if (data === 'tr') return this.v.trainerScreen(L, b.trainerView(uid).items, b.today());
      m = SESSION.exec(data);
      if (m) {
        const req = { class: m[2], day: Number(m[3]) };
        if (m[1] === 'cb') b.book(uid, req);
        if (m[1] === 'cx') b.notify(b.cancel(uid, req)[1]);
        const item = b.scheduleView(uid).items.find((s) => s.class === req.class && s.day === req.day);
        if (!item) throw new Refused('not_found');
        return this.v.classScreen(L, item, b.today());
      }
      this.onAlert(this.t(L, 'bot.stale'));
      return null;
    });
    if (screen) this.show(id, screen);
  }

  /** A message the bot sends on its own (a note from the backend). */
  deliver(note) {
    const html = this.v.note(this.lang, note, this.b);
    if (!html) return null;
    return this.push({ html, kb: [[{ text: this.t(this.lang, 'btn.menu'), data: 'm' }]] });
  }
}
