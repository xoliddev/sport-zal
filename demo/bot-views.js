// Bot screens in the browser: a line-by-line port of sportzal/bot/views.py and the notifier's messages, so the demo's
// chat reads exactly like the real bot. Screens are {html, kb}; a button is {text, data} or {text, app: '#qr'}.
import { hhmm, localDay, localMinute, weekday } from '../shared/clock.js';
import { dateShort, duration, leftText, liveText, money, planName, quietText, Raw, stateText, until } from '../shared/i18n.js';

export function makeViews(t, kinds) {
  const back = (lang, to = 'm') => [{ text: t(lang, 'btn.back'), data: to }];
  const btn = (text, data) => ({ text, data });
  const when = (lang, day, today) => (day === today ? t(lang, 'when.today') : day === today + 1 ? t(lang, 'when.tomorrow') : dateShort(t, lang, day));

  function abonLine(lang, card) {
    const ab = card.abon;
    if (!ab) return t(lang, 'bot.abon_none');
    let line = t(lang, 'bot.abon_line', { plan: planName(lang, ab), left: leftText(t, lang, ab), until: until(t, lang, ab.end_day) });
    if (ab.state.code !== 'ok') line += `\n${t(lang, 'bot.abon_state', { state: new Raw(stateText(t, lang, ab.state)) })}`;
    return line;
  }

  function menu(lang, me, card, live, hello = false) {
    const lines = [t(lang, hello ? 'bot.hello' : 'bot.menu', { gym: me.gym, name: me.name.split(' ')[0] }),
      t(lang, 'bot.live_line', { live: liveText(t, lang, live), level: t(lang, `level.${live.level}`) })];
    let kb;
    if (me.role === 'member') {
      lines.push(abonLine(lang, card));
      kb = [[{ text: t(lang, 'btn.app'), app: '#qr' }], [btn(t(lang, 'btn.live'), 'live'), btn(t(lang, 'btn.abon'), 'ab')], [btn(t(lang, 'btn.classes'), 'cl')]];
    } else {
      kb = [[btn(t(lang, 'btn.my_classes'), 'tr')], [{ text: t(lang, 'btn.app'), app: '#trainer' }], [btn(t(lang, 'btn.live'), 'live')]];
    }
    kb.push([btn(t(lang, 'btn.lang'), 'lang')]);
    return { html: lines.join('\n\n'), kb };
  }

  function bars(live) {
    const first = Math.ceil(live.open / 60);
    const last = Math.floor(live.close / 60);
    const hours = live.forecast;
    const top = Math.max(...hours.slice(first, last), 1);
    const q = live.quiet ?? [-1, -1];
    const now = Math.floor(live.minute / 60);
    const rows = [];
    for (let h = first; h < last; h++) {
      const n = hours[h];
      const mark = h === now ? ' ◀' : q[0] <= h && h < q[1] ? ' ✓' : '';
      rows.push(`${String(h).padStart(2, '0')} ${'█'.repeat(Math.max(n ? 1 : 0, Math.round((n * 10) / top)))}${n ? '' : '·'} ${n}${mark}`);
    }
    return `<pre>${rows.join('\n')}</pre>`;
  }

  function liveScreen(lang, live) {
    const day = t(lang, `wdl.${weekday(localDay(live.at))}`);
    const estimate = live.weeks ? t(lang, 'live.estimate', { n: live.weeks, day }) : t(lang, 'live.no_history');
    const html = t(lang, 'bot.live', { live: liveText(t, lang, live), level: t(lang, `level.${live.level}`), pct: live.pct, quiet: quietText(t, lang, live), estimate,
      bars: new Raw(live.weeks ? bars(live) : '') });
    return { html, kb: [[btn(t(lang, 'btn.refresh'), 'live')], back(lang)] };
  }

  function abonScreen(lang, card) {
    const ab = card.abon;
    if (!ab) return { html: `${t(lang, 'abon.none')}\n${t(lang, 'abon.none_hint')}`, kb: [back(lang)] };
    let freeze;
    if (ab.freeze) freeze = t(lang, 'abon.frozen_plan', { from: dateShort(t, lang, ab.freeze.from_day), to: dateShort(t, lang, ab.freeze.from_day + ab.freeze.days - 1) });
    else freeze = ab.freeze_left ? t(lang, 'abon.freeze_left', { n: ab.freeze_left }) : t(lang, 'abon.freeze_none');
    let html = t(lang, 'bot.abon', { plan: planName(lang, ab), state: new Raw(stateText(t, lang, ab.state)), left: leftText(t, lang, ab),
      from: dateShort(t, lang, ab.start_day), to: dateShort(t, lang, ab.end_day), freeze: new Raw(freeze) });
    if (card.next) html += `\n${t(lang, 'abon.next', { name: planName(lang, card.next), from: dateShort(t, lang, card.next.start_day) })}`;
    const kb = [];
    if (ab.freeze_left && !ab.freeze && ab.days_left >= 1 && ['ok', 'window'].includes(ab.state.code)) kb.push([btn(t(lang, 'btn.freeze'), 'fz')]);
    kb.push(back(lang));
    return { html, kb };
  }

  const freezeOptions = (ab) => [...new Set([3, 7, ab.freeze_left])].filter((n) => n >= 1 && n <= ab.freeze_left).sort((a, b) => a - b);
  const freezeAsk = (lang, card) => ({ html: t(lang, 'bot.freeze_ask', { n: card.abon.freeze_left }),
    kb: [freezeOptions(card.abon).map((n) => btn(t(lang, 'btn.freeze_n', { n }), `fz:${n}`)), back(lang, 'ab')] });
  function freezeConfirm(lang, card, days, today) {
    const ab = card.abon;
    return { html: t(lang, 'bot.freeze_confirm', { days, from: dateShort(t, lang, today + 1), to: dateShort(t, lang, today + days),
      end: dateShort(t, lang, ab.end_day + days), old: dateShort(t, lang, ab.end_day) }), kb: [[btn(t(lang, 'btn.freeze_ok'), `fzok:${days}`)], back(lang, 'fz')] };
  }

  function sessionLabel(lang, s) {
    const mark = { booked: '✅ ', wait: '⏳ ' }[s.me ?? ''] ?? '';
    const wait = s.wait ? ` · ${t(lang, 'class.wait', { n: s.wait })}` : '';
    return `${mark}${hhmm(s.start)} ${kinds[s.kind][lang]} — ${s.taken}/${s.cap}${wait}`;
  }

  function classesScreen(lang, items, today) {
    const near = items.filter((s) => s.day <= today + 1 && !s.past);
    if (!near.length) return { html: t(lang, 'bot.classes_none'), kb: [back(lang)] };
    const rows = [];
    for (const d of [today, today + 1]) {
      for (const s of near.filter((x) => x.day === d)) rows.push([btn(`${d === today ? '' : `${when(lang, d, today)} `}${sessionLabel(lang, s)}`, `c:${s.class}:${s.day}`)]);
    }
    return { html: t(lang, 'bot.classes'), kb: [...rows.slice(0, 12), back(lang)] };
  }

  function classScreen(lang, s, today) {
    const places = s.taken < s.cap ? t(lang, 'class.places', { taken: s.taken, cap: s.cap }) : t(lang, 'class.full');
    const wait = s.wait ? ` · ${t(lang, 'class.wait', { n: s.wait })}` : '';
    let me = '';
    if (s.me === 'booked') {
      me = `${t(lang, 'class.booked')}\n${s.can_cancel ? t(lang, 'bot.class_cancel_until', { time: hhmm(Math.max(0, s.start - 120)) }) : t(lang, 'bot.class_no_cancel')}`;
    } else if (s.me === 'wait') me = t(lang, 'class.waiting', { n: s.pos });
    const html = t(lang, 'bot.class', { kind: kinds[s.kind][lang], when: when(lang, s.day, today), time: hhmm(s.start), trainer: t(lang, 'class.trainer', { name: s.trainer }),
      places, wait, me: new Raw(me) });
    const key = `${s.class}:${s.day}`;
    const kb = [];
    if (s.me === null && !s.past) kb.push([btn(s.taken < s.cap ? t(lang, 'btn.book') : t(lang, 'btn.wait'), `cb:${key}`)]);
    else if (s.me === 'booked' && s.can_cancel) kb.push([btn(t(lang, 'btn.cancel'), `cx:${key}`)]);
    else if (s.me === 'wait') kb.push([btn(t(lang, 'btn.leave_wait'), `cx:${key}`)]);
    kb.push(back(lang, 'cl'));
    return { html, kb };
  }

  function trainerScreen(lang, items, today) {
    const mine = items.filter((s) => s.day === today);
    const app = [{ text: t(lang, 'btn.app'), app: '#trainer' }];
    if (!mine.length) return { html: t(lang, 'bot.trainer_none'), kb: [app, back(lang)] };
    const rows = mine.map((s) => t(lang, 'bot.trainer_row', { time: hhmm(s.start), kind: kinds[s.kind][lang], places: t(lang, 'class.places', { taken: s.taken, cap: s.cap }),
      wait: s.wait ? ` · ${t(lang, 'class.wait', { n: s.wait })}` : '' }));
    return { html: `${t(lang, 'bot.trainer', { list: new Raw(rows.join('\n')) })}\n\n${t(lang, 'bot.trainer_hint')}`, kb: [app, back(lang)] };
  }

  /** The messages the bot sends on its own (sportzal/bot/notify.py). */
  function note(lang, n, b) {
    if (['sold', 'checkin', 'frozen', 'remind'].includes(n.type)) {
      const ab = b.abonFor(n.abon, lang);
      const name = planName(lang, ab);
      if (n.type === 'sold') return t(lang, 'note.sold', { plan: name, from: dateShort(t, lang, ab.start_day), to: dateShort(t, lang, ab.end_day), left: leftText(t, lang, ab),
        price: money(t, lang, ab.price), paid: t(lang, `paid.${ab.paid}`) });
      if (n.type === 'checkin') return t(lang, 'note.checkin', { time: hhmm(localMinute(n.at)), plan: name, left: leftText(t, lang, ab), until: until(t, lang, ab.end_day) });
      if (n.type === 'frozen') return t(lang, 'note.frozen', { from: dateShort(t, lang, n.from), to: dateShort(t, lang, n.from + n.days - 1), days: n.days,
        end: dateShort(t, lang, n.end), old: dateShort(t, lang, n.old_end) });
      return [...n.kinds.map((k) => (k === 'end3' ? t(lang, 'note.end3', { plan: name, date: dateShort(t, lang, ab.end_day) }) : t(lang, 'note.last1', { plan: name }))),
        t(lang, 'note.renew')].join('\n');
    }
    if (n.type === 'checkout') return t(lang, 'note.checkout', { time: hhmm(localMinute(n.at)), duration: duration(t, lang, n.minutes ?? 0) });
    if (n.type === 'promoted') {
      const k = b.classes.find((c) => c.id === n.class);
      return t(lang, 'note.promoted', { kind: kinds[k.kind][lang], when: when(lang, n.day, b.today()), time: hhmm(k.start), until: hhmm(Math.max(0, k.start - 120)) });
    }
    if (n.type === 'pt') return t(lang, n.taken ? 'note.pt_taken' : 'note.pt_free', { name: n.name, date: dateShort(t, lang, n.day), time: hhmm(n.start) });
    return '';
  }

  return { menu, liveScreen, abonScreen, freezeAsk, freezeConfirm, freezeOptions, classesScreen, classScreen, trainerScreen, note, back };
}
