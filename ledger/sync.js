// 가족 코드 동기화.
// - 로그인 없음. 가족 코드(20자)를 아는 기기끼리 같은 가계부를 본다.
// - 코드에서 '보관함 주소(hid)'와 '암호 열쇠'를 따로 뽑는다. 서버에는 암호문만 올라가므로
//   주소만 알아서는 내용을 읽을 수 없다.
// - 저장은 지금처럼 이 기기에 먼저 하고(오프라인 가능), 연결되면 바뀐 기록만 올리고 받는다.
// - 같은 기록을 두 기기가 고쳤으면 늦게 고친 쪽이 이긴다 (store.applyRemote).
// 서버는 Firestore REST API 두 개만 쓴다: documents:commit (올리기), :runQuery (받기).

const ALPHA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 헷갈리는 0·1·I·O 제외
const BODY = 18;
const STATE_KEY = 'ledger.sync';
// 앱이 새 종류의 기록을 알게 되면 올린다 (2: 저축). 예전 버전이 모르고 건너뛴 기록을 다시 받기 위해서다
const SCHEMA = 2;
const PAGE = 300;
const BATCH = 200;
const MAX_DOC = 6000; // firestore.rules 의 크기 제한과 같아야 한다

function checkChars(body) {
  let h = 7;
  for (const ch of body) h = (h * 33 + ALPHA.indexOf(ch) + 1) % 1024;
  return ALPHA[h >> 5] + ALPHA[h & 31];
}

export function makeCode() {
  let body = '';
  for (const b of crypto.getRandomValues(new Uint8Array(BODY))) body += ALPHA[b & 31];
  return body + checkChars(body);
}

// 사람이 적은 코드를 정리한다. 글자 수·글자 종류·검사 글자가 맞지 않으면 null (오타 감지)
export function normalizeCode(input) {
  const code = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== BODY + 2) return null;
  for (const ch of code) if (!ALPHA.includes(ch)) return null;
  return checkChars(code.slice(0, BODY)) === code.slice(BODY) ? code : null;
}

export const formatCode = (code) => code.match(/.{1,5}/g).join('-');

const enc = new TextEncoder();
const dec = new TextDecoder();
const sha = async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function deriveKeys(code) {
  const hid = hex(await sha(`ledger-sync-v1/id/${code}`)).slice(0, 32);
  const key = await crypto.subtle.importKey('raw', await sha(`ledger-sync-v1/key/${code}`), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { hid, key };
}

export async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
  let bin = '';
  for (const b of iv) bin += String.fromCharCode(b);
  for (const b of ct) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function unseal(key, b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
  return JSON.parse(dec.decode(pt));
}

// 'tx:아이디' → 서버 문서 이름. 문서 이름에 못 쓰는 글자가 있으면 16진수로 바꾼다
export function docId(key) {
  const i = key.indexOf(':');
  const id = key.slice(i + 1);
  return `${key.slice(0, i)}_${/^[A-Za-z0-9_-]{1,200}$/.test(id) ? id : `x${hex(enc.encode(id))}`}`;
}

export class SyncError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // offline | denied | notfound | badcode | server | unsupported
  }
}

export function createSync({ store, config, storage = globalThis.localStorage, fetch: fetchFn = (...a) => globalThis.fetch(...a), now = Date.now }) {
  const configured = !!config?.projectId;
  const supported = !!globalThis.crypto?.subtle;
  const blank = () => ({ v: SCHEMA, code: null, cursor: null, dirty: [], lastSyncAt: 0 });

  let st = blank();
  try {
    const saved = JSON.parse(storage.getItem(STATE_KEY) || 'null');
    if (saved?.code && normalizeCode(saved.code)) {
      st = { ...blank(), ...saved, v: SCHEMA };
      if (saved.v !== SCHEMA) st.cursor = null; // 처음부터 다시 받아 합친다 (같은 기록은 그대로 둔다)
    }
  } catch { /* 깨진 상태는 버리고 연결 안 된 것으로 본다 */ }
  const dirty = new Set(st.dirty);
  let keys = null; // 코드에서 뽑은 { hid, key }
  let phase = 'idle'; // idle | syncing | offline | error
  let error = '';
  let running = null;
  let again = false;
  let timer = 0;
  const listeners = new Set();

  const persist = () => {
    st.dirty = [...dirty];
    try {
      if (st.code) storage.setItem(STATE_KEY, JSON.stringify(st));
      else storage.removeItem(STATE_KEY);
    } catch { /* 다음 동기화 때 다시 맞춰진다 */ }
  };
  const emit = () => {
    for (const fn of listeners) fn();
  };
  const setPhase = (p, msg = '') => {
    phase = p;
    error = msg;
    emit();
  };

  const docsBase = `projects/${config?.projectId}/databases/(default)/documents`;
  const url = (path) => `${config.endpoint}/${docsBase}${path}${config.apiKey ? `?key=${encodeURIComponent(config.apiKey)}` : ''}`;

  async function post(path, body) {
    let res;
    try {
      res = await fetchFn(url(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: globalThis.AbortSignal?.timeout ? AbortSignal.timeout(20000) : undefined,
      });
    } catch {
      throw new SyncError('offline', '인터넷에 연결되면 다시 맞출게요');
    }
    if (res.status === 403 || res.status === 401) throw new SyncError('denied', '서버가 거부했어요 (보안 규칙을 확인해 주세요)');
    if (res.status === 429) throw new SyncError('server', '오늘 사용량을 넘었어요. 내일 다시 맞춰져요');
    if (!res.ok) throw new SyncError('server', `서버 오류 (${res.status})`);
    return res.json();
  }

  // 받기: 지난번에 받은 곳(cursor) 다음부터 서버 시각 순서로 가져와 합친다
  async function pull(k, seen) {
    for (;;) {
      const q = {
        from: [{ collectionId: 'r' }],
        orderBy: [
          { field: { fieldPath: 's' }, direction: 'ASCENDING' },
          { field: { fieldPath: '__name__' }, direction: 'ASCENDING' },
        ],
        limit: PAGE,
      };
      if (st.cursor) q.startAt = { values: [{ timestampValue: st.cursor.s }, { referenceValue: st.cursor.n }], before: false };
      const rows = await post(`/h/${k.hid}:runQuery`, { structuredQuery: q });
      const docs = (Array.isArray(rows) ? rows : []).map((r) => r.document).filter((d) => d?.fields?.c?.stringValue && d.fields.s?.timestampValue);
      const items = [];
      for (const d of docs) {
        try {
          const { k: kind, r: rec } = await unseal(k.key, d.fields.c.stringValue);
          items.push({ kind, rec });
          seen?.add(kind === 'set' ? 'set:main' : `${kind}:${rec.id}`);
        } catch { /* 풀 수 없는 문서는 건너뛴다 */ }
      }
      const { localNewer, remoteNewer } = store.applyRemote(items);
      for (const key of remoteNewer) dirty.delete(key); // 더 새 기록을 받았으니 올릴 필요 없음
      for (const key of localNewer) dirty.add(key); // 이 기기가 더 새롭다 → 다시 올린다
      if (docs.length) {
        const last = docs[docs.length - 1];
        st.cursor = { s: last.fields.s.timestampValue, n: last.name };
      }
      if (docs.length < PAGE) return;
    }
  }

  // 올리기: 바뀐 기록만 암호화해서 올린다. 서버가 받은 시각(s)을 찍어 준다
  async function push(k) {
    while (dirty.size) {
      const batch = [...dirty].slice(0, BATCH);
      const sent = [];
      const writes = [];
      for (const key of batch) {
        const rec = store.record(key);
        if (!rec) {
          dirty.delete(key);
          continue;
        }
        const c = await seal(k.key, { k: key.slice(0, key.indexOf(':')), r: rec });
        if (c.length >= MAX_DOC) {
          dirty.delete(key); // 서버가 받지 않는 크기 — 이 기록 하나 때문에 전체가 막히지 않게 건너뛴다
          continue;
        }
        sent.push([key, rec.updatedAt || 0]);
        writes.push({
          update: {
            name: `${docsBase}/h/${k.hid}/r/${docId(key)}`,
            fields: { c: { stringValue: c } },
          },
          updateTransforms: [{ fieldPath: 's', setToServerValue: 'REQUEST_TIME' }],
        });
      }
      if (writes.length) await post(':commit', { writes });
      // 올리는 사이에 또 고쳤으면 그대로 두어 다음에 다시 올린다
      for (const [key, at] of sent) if ((store.record(key)?.updatedAt || 0) === at) dirty.delete(key);
    }
  }

  async function cycle({ initial = false, mustExist = false } = {}) {
    keys ||= await deriveKeys(st.code);
    const seen = initial ? new Set() : null;
    await pull(keys, seen);
    if (initial) {
      if (mustExist && !seen.size) throw new SyncError('notfound', '이 코드로 만든 가계부를 찾을 수 없어요. 코드를 다시 확인해 주세요');
      for (const key of store.keys()) if (!seen.has(key)) dirty.add(key); // 서버에 없는 이 기기 기록을 올린다
    }
    await push(keys);
    st.lastSyncAt = now();
  }

  // 한 번에 하나만 돈다. 도는 중에 또 요청이 오면 끝난 뒤 한 번 더 돈다
  function run() {
    if (!st.code || !configured || !supported) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    setPhase('syncing');
    running = (async () => {
      try {
        do {
          again = false;
          await cycle();
          persist();
        } while (again);
        setPhase('idle');
      } catch (err) {
        persist(); // 받은 곳까지는 기억해 둔다
        setPhase(err.kind === 'offline' ? 'offline' : 'error', err.message);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  function request(delay = 0) {
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  }

  async function link(code, mustExist) {
    if (!configured) throw new SyncError('unsupported', '동기화가 아직 준비되지 않았어요');
    if (!supported) throw new SyncError('unsupported', '이 브라우저에서는 동기화를 쓸 수 없어요');
    if (st.code) throw new SyncError('badcode', '이미 연결되어 있어요');
    if (running) await running;
    // 첫 맞춤이 끝나기 전에는 상태를 저장하지 않는다 — 실패하면 연결하지 않은 것으로 되돌린다
    st = { ...blank(), code };
    dirty.clear();
    keys = null;
    setPhase('syncing');
    running = (async () => {
      try {
        await cycle({ initial: true, mustExist });
        persist();
        setPhase('idle');
      } catch (err) {
        st = blank();
        dirty.clear();
        keys = null;
        setPhase('idle');
        throw err;
      } finally {
        running = null;
      }
    })();
    await running;
    return code;
  }

  store.onLocalChange((touched) => {
    if (!st.code) return;
    for (const key of touched || store.keys()) dirty.add(key);
    persist();
    request(1200);
  });

  return {
    get configured() {
      return configured && supported;
    },
    get status() {
      return { linked: !!st.code, code: st.code, phase, error, lastSyncAt: st.lastSyncAt, pending: dirty.size };
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    create: () => link(makeCode(), false),
    join(input) {
      const code = normalizeCode(input);
      if (!code) return Promise.reject(new SyncError('badcode', '코드가 맞지 않아요. 글자를 다시 확인해 주세요'));
      return link(code, true);
    },
    // 이 기기만 연결을 끊는다. 기록은 이 기기와 서버에 그대로 남는다
    unlink() {
      clearTimeout(timer);
      st = blank();
      dirty.clear();
      keys = null;
      persist();
      setPhase('idle');
    },
    syncNow: run,
    request,
  };
}
