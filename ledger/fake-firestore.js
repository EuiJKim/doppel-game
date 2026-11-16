// 테스트용 가짜 Firestore — 앱에서는 쓰지 않는다.
// sync.js 가 쓰는 REST 두 가지(documents:commit, :runQuery)와 보안 규칙(firestore.rules)의 검사만 흉내 낸다.
export function createFakeFirestore() {
  const docs = new Map(); // 문서 이름 → { name, c, s }
  let tick = 0;
  const state = { offline: false, deny: false, commits: 0, queries: 0 };
  const stamp = () => new Date(Date.UTC(2026, 0, 1) + ++tick).toISOString().replace('Z', '000Z');
  const after = (d, cur) => d.s > cur.s || (d.s === cur.s && d.name > cur.n);

  function handle(url, body) {
    if (state.deny) return { status: 403, json: { error: { status: 'PERMISSION_DENIED' } } };
    const m = url.match(/\/v1\/(projects\/[^/]+\/databases\/\(default\)\/documents)(.*?)(\?.*)?$/);
    if (!m) return { status: 404, json: {} };
    const [, base, rest] = m;

    if (rest === ':commit') {
      state.commits++;
      const s = stamp(); // 한 번에 올린 문서는 모두 같은 시각
      for (const w of body.writes) {
        const name = w.update.name;
        const hid = name.match(new RegExp(`^${base.replace(/[()]/g, '\\$&')}/h/([^/]+)/r/[^/]+$`))?.[1];
        const fields = Object.keys(w.update.fields);
        const stamped = w.updateTransforms?.length === 1 && w.updateTransforms[0].fieldPath === 's' && w.updateTransforms[0].setToServerValue === 'REQUEST_TIME';
        const c = w.update.fields.c?.stringValue;
        if (!hid || hid.length !== 32 || fields.join() !== 'c' || !stamped || typeof c !== 'string' || c.length >= 6000) {
          return { status: 403, json: { error: { status: 'PERMISSION_DENIED' } } };
        }
      }
      for (const w of body.writes) docs.set(w.update.name, { name: w.update.name, c: w.update.fields.c.stringValue, s });
      return { status: 200, json: { commitTime: s } };
    }

    const q = rest.match(/^\/h\/([^/:]+):runQuery$/);
    if (q) {
      state.queries++;
      if (q[1].length !== 32) return { status: 403, json: { error: { status: 'PERMISSION_DENIED' } } };
      const sq = body.structuredQuery;
      const prefix = `${base}/h/${q[1]}/r/`;
      let rows = [...docs.values()].filter((d) => d.name.startsWith(prefix)).sort((a, b) => (after(a, { s: b.s, n: b.name }) ? 1 : -1));
      if (sq.startAt) {
        const cur = { s: sq.startAt.values[0].timestampValue, n: sq.startAt.values[1].referenceValue };
        rows = rows.filter((d) => after(d, cur));
      }
      rows = rows.slice(0, sq.limit || rows.length);
      const readTime = stamp();
      return {
        status: 200,
        json: rows.length
          ? rows.map((d) => ({ document: { name: d.name, fields: { c: { stringValue: d.c }, s: { timestampValue: d.s } } }, readTime }))
          : [{ readTime }],
      };
    }
    return { status: 404, json: {} };
  }

  return {
    state,
    docs,
    handle,
    // sync.js 에 넘길 fetch 대용
    fetch: async (url, init) => {
      if (state.offline) throw new TypeError('offline');
      const { status, json } = handle(String(url), JSON.parse(init.body));
      return { ok: status >= 200 && status < 300, status, json: async () => json };
    },
  };
}
