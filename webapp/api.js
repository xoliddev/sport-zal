// The Mini App's API over HTTP: every call carries Telegram's signed initData (checked on the server). The browser
// demo passes an object with the same method names answered by its in-page backend (demo/api.js).
export function httpApi(initData, base = '/api') {
  async function call(method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `tma ${initData}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'generic'), { code: data.error || 'generic' });
    return data;
  }
  const get = (p) => call('GET', p);
  const post = (p, b) => call('POST', p, b);
  return {
    me: () => get('/me'),
    setLang: (lang) => post('/lang', { lang }),
    live: () => get('/live'),
    card: () => get('/card'),
    qr: () => get('/qr'),
    freeze: (data) => post('/freeze', data),
    classes: () => get('/classes'),
    book: (cls, day) => post('/book', { class: cls, day }),
    cancel: (cls, day) => post('/cancel', { class: cls, day }),
    slots: () => get('/slots'),
    takeSlot: (id) => post('/slots/take', { id }),
    giveSlot: (id) => post('/slots/give', { id }),
    trainer: () => get('/trainer'),
    session: (cls, day) => post('/session', { class: cls, day }),
    mark: (cls, day, member, status) => post('/mark', { class: cls, day, member, status }),
    addSlot: (data) => post('/slots/add', data),
    removeSlot: (id) => post('/slots/remove', { id }),
  };
}
