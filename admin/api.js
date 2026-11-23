// The admin panel's API over HTTP: the session is an HttpOnly cookie the script never sees; every POST sends the
// session's CSRF token in a header. The browser demo passes an object with the same method names (demo/admin-api.js).
export function httpAdmin(base = '/admin/api') {
  let csrf = '';
  async function call(method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      credentials: 'same-origin',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method === 'POST' ? { 'X-CSRF-Token': csrf } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'generic'), { code: data.error || 'generic' });
    return data;
  }
  const get = (p) => call('GET', p);
  const post = (p, b) => call('POST', p, b ?? {});
  return {
    me: async () => {
      const me = await get('/me');
      csrf = me.csrf;
      return me;
    },
    config: () => get('/config'),
    login: (token) => post('/login', { token }),
    loginWidget: (user) => post('/login-widget', { user }),
    logout: () => post('/logout'),
    dashboard: () => get('/dashboard'),
    live: () => get('/live'),
    visits: () => get('/visits'),
    scan: (data) => post('/scan', data),
    search: (q) => get(`/search?q=${encodeURIComponent(q)}`),
    member: (no) => get(`/member?no=${encodeURIComponent(no)}`),
    sell: (member, plan, paid) => post('/sell', { member, plan, paid }),
    freeze: (member, from, days) => post('/freeze', { member, from, days }),
    remind: (abon) => post('/remind', { abon }),
    prices: () => get('/prices'),
    setPrice: (plan, price) => post('/price', { plan, price }),
    session: (cls, day) => post('/session', { class: cls, day }),
  };
}
