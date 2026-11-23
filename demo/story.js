// The guided story. Each step does what a person would do, through Aziz's and Malika ustoz's phones (bot + Mini App)
// and the admin panel. Steps run in order (with pauses), all at once ("Hammasini ko'rsatish"), or clicked out of order:
// a step first quietly does whatever it needs from earlier steps. js-tests/demo.test.mjs runs the same steps headless.
import { atLocal } from '../shared/clock.js';
import { ADMIN, AZIZ, MALIKA, OWNER } from './seed.js';

export const STEPS = ['step1', 'step2', 'step3', 'step4', 'step5', 'step6', 'step7', 'step8', 'step9', 'step10'];
const YOGA = 'yoga19';

const azizNo = (b) => b.role(AZIZ).no;
const sold = (b) => b.abonsOf(azizNo(b)).some((a) => a.plan === 't12');
const booking = (b, env) => b.bookings.find((x) => x.member === azizNo(b) && x.class === YOGA && x.day === env.day0 && x.status !== 'cancelled') ?? null;

/** Move the demo clock to `minute` Tashkent time of the story's day (never backwards). */
function jumpTo(env, minute) {
  const target = atLocal(env.day0, minute);
  if (target > env.backend.nowMs()) env.backend.advance(target - env.backend.nowMs());
}

const ACTIONS = {
  // 1. Aziz opens the app: 41 people inside, busy; the forecast says the quietest time is 14:00–16:00.
  async 1(env) {
    const { backend: b, ui, focus, pause } = env;
    env.day0 ??= b.today();
    focus(AZIZ, 'app');
    await ui?.home(AZIZ);
    await pause(1800);
  },
  // 2. At the desk the administrator sells him "12 tashrif", cash; the bot confirms.
  async 2(env) {
    const { backend: b, ui, focus, pause } = env;
    if (!sold(b)) {
      focus('panel');
      if (ui) await ui.sell('Aziz', 't12', 'cash');
      else b.notify(b.sell(ADMIN, { member: azizNo(b), plan: 't12', paid: 'cash' })[1]);
      await pause(900);
    }
    focus(AZIZ, 'chat');
    await pause(1400);
  },
  // 3. Aziz opens his QR: it changes every 30 seconds (the ring counts down). A friend takes a screenshot of it.
  async 3(env) {
    const { backend: b, ui, focus, pause } = env;
    focus(AZIZ, 'app');
    if (ui) env.shot = await ui.qr();
    else env.shot = { token: b.qr(AZIZ).token };
    await pause(1600);
  },
  // 4. The desk scans it: "✅ Kirish: Aziz — 11 tashrif qoldi", and the live count goes 41 -> 42 on both screens.
  async 4(env) {
    const { backend: b, ui, focus, pause } = env;
    if (!env.checked) {
      focus('panel');
      if (ui) await ui.scan('aziz');
      else b.notify(b.scan(ADMIN, { token: b.qr(AZIZ).token })[1]);
      env.checked = true;
      await pause(1400);
    }
    focus(AZIZ, 'app');
    await ui?.home(AZIZ);
    await pause(1600);
  },
  // 5. The friend tries the old screenshot at the door: "❌ QR eskirgan yoki soxta".
  async 5(env) {
    const { backend: b, ui, focus, pause } = env;
    focus('panel');
    if (ui) await ui.scan('shot');
    else env.friend = b.scan(ADMIN, { token: env.shot.token })[0];
    await pause(1800);
  },
  // 6. Aziz books Yoga 19:00. It is full: he is number 1 on the waitlist.
  async 6(env) {
    const { backend: b, ui, focus, pause } = env;
    if (!booking(b, env)) {
      focus(AZIZ, 'app');
      if (ui) await ui.book(YOGA, env.day0);
      else b.book(AZIZ, { class: YOGA, day: env.day0 });
      await pause(1600);
    }
  },
  // 7. Someone cancels: the place goes to Aziz automatically, and the bot tells him.
  async 7(env) {
    const { backend: b, focus, pause, ui } = env;
    if (booking(b, env)?.status === 'wait') {
      jumpTo(env, 10 * 60 + 5);
      const other = b.bookings.find((x) => x.class === YOGA && x.day === env.day0 && x.status === 'booked' && x.member !== azizNo(b));
      b.notify(b.cancel(b.members[other.member - 1].user_id, { class: YOGA, day: env.day0 })[1]);
      env.cancelled = other.member;
      await pause(600);
    }
    focus(AZIZ, 'chat');
    await pause(1800);
    if (ui) {
      focus(AZIZ, 'app');
      await ui.classes(AZIZ, YOGA, env.day0);
      await pause(1200);
    }
  },
  // 8. 18:50 Aziz comes for Yoga; at 19:05 Malika ustoz sees her list (who is in the gym) and marks him present.
  async 8(env) {
    const { backend: b, ui, focus, pause } = env;
    if (!env.evening) {
      jumpTo(env, 18 * 60 + 50);
      b.notify(b.scan(ADMIN, { token: b.qr(AZIZ).token })[1]);
      env.evening = true;
    }
    jumpTo(env, 19 * 60 + 5);
    if (booking(b, env)?.status === 'booked') {
      focus(MALIKA, 'app');
      if (ui) await ui.mark(YOGA, env.day0, azizNo(b));
      else b.mark(MALIKA, { class: YOGA, day: env.day0, member: azizNo(b), status: 'attended' });
    }
    focus(MALIKA, 'app');
    await pause(1800);
  },
  // 9. After the class Aziz freezes his abonement for 7 days from tomorrow: the end date moves by exactly 7 days.
  async 9(env) {
    const { backend: b, ui, focus, pause } = env;
    const ab = b.current(azizNo(b))[0];
    if (!b.freezesOf(ab.id).length) {
      jumpTo(env, 20 * 60 + 10);
      env.endBefore = ab.end_day;
      focus(AZIZ, 'app');
      if (ui) await ui.freeze(7);
      else b.notify(b.freeze(AZIZ, { from: b.today() + 1, days: 7 })[1]);
      await pause(1200);
    }
    focus(AZIZ, 'chat');
    await pause(1600);
  },
  // 10. The owner's dashboard: revenue this month, the "tugayotganlar" list, and a reminder sent to one of them.
  async 10(env) {
    const { backend: b, ui, focus, pause } = env;
    env.setPanelUser?.(OWNER);
    env.panelUid = OWNER;
    focus('panel');
    const target = b.dashboard(OWNER).soon.find((s) => s.has_tg && !s.reminded);
    if (ui) await ui.remind(target?.no);
    else if (target) b.notify(b.remind(OWNER, target.abon.id)[1]);
    env.reminded = target?.no ?? null;
    await pause(1800);
  },
};

export async function runStep(n, env, quick = false, done = env.done ?? (env.done = new Set())) {
  for (let k = 1; k < n; k++) if (!done.has(k)) await runStep(k, env, true, done);
  const wait = quick ? async () => {} : env.wait ?? (async () => {});
  const ctx = new Proxy(env, { get: (target, key) => {
    if (key === 'ui') return quick ? null : target.ui;
    if (key === 'focus') return quick ? () => {} : target.focus ?? (() => {});
    if (key === 'pause') return (ms = 650) => wait(ms);
    return target[key];
  }, set: (target, key, value) => { target[key] = value; return true; } });
  await ACTIONS[n](ctx);
  done.add(n);
}
