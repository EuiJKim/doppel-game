// 가계부 저장소 — 지금은 이 기기(localStorage)에만 저장한다.
// 모든 기록이 id · updatedAt · deleted(지움 표시)를 갖고 있어서, 나중에 동기화를 붙일 때
// 같은 형태 그대로 서버와 합칠 수 있다 (logic.js 의 mergeRecords).
import { dueRecurring, mergeRecords, monthOf } from './logic.js';

const KEY = 'ledger.v1';

const cat = (id, type, name, emoji, order) => ({ id, type, name, emoji, order, updatedAt: 0 });

export const DEFAULT_CATS = [
  cat('c_food', 'expense', '식비', '🍚', 1),
  cat('c_cafe', 'expense', '카페·간식', '☕', 2),
  cat('c_transit', 'expense', '교통', '🚌', 3),
  cat('c_living', 'expense', '생활용품', '🧴', 4),
  cat('c_home', 'expense', '주거·통신', '🏠', 5),
  cat('c_shop', 'expense', '쇼핑', '🛍️', 6),
  cat('c_health', 'expense', '의료·건강', '💊', 7),
  cat('c_fun', 'expense', '문화·여가', '🎬', 8),
  cat('c_edu', 'expense', '교육', '📚', 9),
  cat('c_gift', 'expense', '경조사', '🎁', 10),
  cat('c_etc', 'expense', '기타', '💬', 99),
  cat('i_pay', 'income', '월급', '💰', 1),
  cat('i_allow', 'income', '용돈', '🧧', 2),
  cat('i_side', 'income', '부수입', '💵', 3),
  cat('i_etc', 'income', '기타', '➕', 99),
  cat('s_bank', 'saving', '적금', '🏦', 1),
  cat('s_house', 'saving', '청약', '🔑', 2),
  cat('s_invest', 'saving', '투자', '📈', 3),
  cat('s_spare', 'saving', '비상금', '🐷', 4),
  cat('s_etc', 'saving', '기타', '💬', 99),
];

const isType = (t) => t === 'income' || t === 'expense' || t === 'saving';
const amountOf = (n) => Math.max(0, Math.round(n) || 0);

const empty = () => ({
  v: 1,
  txs: [],
  cats: DEFAULT_CATS.map((c) => ({ ...c })),
  rules: [],
  settings: { budget: 0, saveGoal: 0, updatedAt: 0 },
});

export const newId = () =>
  globalThis.crypto?.randomUUID
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 20)
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

function normalize(raw) {
  const base = empty();
  if (!raw || typeof raw !== 'object') return base;
  const arr = (x) => (Array.isArray(x) ? x.filter((r) => r && typeof r.id === 'string') : []);
  const txs = arr(raw.txs).filter(
    (t) => Number.isFinite(t.amount) && /^\d{4}-\d{2}-\d{2}$/.test(t.date || '') && isType(t.type),
  );
  return {
    v: 1,
    txs,
    // 기본 카테고리는 항상 존재하도록 합친다 (예전 백업에 없던 기본값 보충)
    cats: mergeRecords(base.cats, arr(raw.cats)),
    rules: arr(raw.rules),
    settings: { ...base.settings, ...(raw.settings || {}) },
  };
}

export function createStore(storage = globalThis.localStorage) {
  let data;
  try {
    data = normalize(JSON.parse(storage.getItem(KEY) || 'null'));
  } catch {
    data = empty();
  }
  const listeners = new Set();
  const changeListeners = new Set();

  // touched: 이 기기에서 바꾼 기록의 키('tx:아이디' 등) 목록. null 이면 전부.
  // 다른 기기에서 받아 온 변경(applyRemote)은 touched 없이 저장한다 — 다시 올릴 필요가 없으므로.
  function commit(touched) {
    let ok = true;
    try {
      storage.setItem(KEY, JSON.stringify(data));
    } catch {
      ok = false; // 저장 공간 부족 등 — 화면에는 반영하고 호출자가 알린다
    }
    if (touched !== undefined) for (const fn of changeListeners) fn(touched);
    for (const fn of listeners) fn(ok);
    return ok;
  }

  const LISTS = { tx: 'txs', cat: 'cats', rule: 'rules' };
  const validRemote = {
    tx: (t) => Number.isFinite(t.amount) && /^\d{4}-\d{2}-\d{2}$/.test(t.date || '') && isType(t.type),
    cat: (c) => typeof c.name === 'string' && isType(c.type),
    rule: (r) => Number.isFinite(r.amount) && Number.isFinite(r.day) && typeof r.startYm === 'string',
  };

  const upsert = (list, rec) => {
    const i = list.findIndex((r) => r.id === rec.id);
    if (i >= 0) list[i] = rec;
    else list.push(rec);
  };

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    get txs() {
      return data.txs;
    },
    get rules() {
      return data.rules.filter((r) => !r.deleted);
    },
    get budget() {
      return data.settings.budget || 0;
    },
    // 한 달 저축 목표 (0 = 정하지 않음)
    get saveGoal() {
      return data.settings.saveGoal || 0;
    },
    // 고를 수 있는 카테고리 (지운 것은 빠진다)
    cats(type) {
      return data.cats.filter((c) => !c.deleted && c.type === type).sort((a, b) => a.order - b.order);
    },
    // 내역 표시용 — 지운 카테고리도 이름은 남아 있다
    cat(id) {
      return data.cats.find((c) => c.id === id) || { id, name: '미분류', emoji: '❔', type: 'expense' };
    },
    tx(id) {
      return data.txs.find((t) => t.id === id);
    },
    rule(id) {
      return data.rules.find((r) => r.id === id);
    },

    saveTx(fields) {
      const now = Date.now();
      const { id, ...rest } = fields;
      const prev = id ? data.txs.find((t) => t.id === id) : null;
      const rec = { ...(prev || { id: id || newId(), createdAt: now }), ...rest, deleted: false, updatedAt: now };
      upsert(data.txs, rec);
      commit([`tx:${rec.id}`]);
      return rec;
    },
    deleteTx(id) {
      const t = data.txs.find((x) => x.id === id);
      if (!t) return;
      t.deleted = true;
      t.updatedAt = Date.now();
      commit([`tx:${id}`]);
    },
    restoreTx(id) {
      const t = data.txs.find((x) => x.id === id);
      if (!t) return;
      t.deleted = false;
      t.updatedAt = Date.now();
      commit([`tx:${id}`]);
    },

    saveCat(fields) {
      const now = Date.now();
      const { id, ...rest } = fields;
      const prev = id ? data.cats.find((c) => c.id === id) : null;
      const order = prev ? prev.order : Math.max(0, ...data.cats.filter((c) => c.type === rest.type && c.order < 99).map((c) => c.order)) + 1;
      const rec = { ...(prev || { id: id || newId(), order }), ...rest, deleted: false, updatedAt: now };
      upsert(data.cats, rec);
      commit([`cat:${rec.id}`]);
      return rec;
    },
    deleteCat(id) {
      const c = data.cats.find((x) => x.id === id);
      if (!c) return;
      c.deleted = true;
      c.updatedAt = Date.now();
      commit([`cat:${id}`]);
    },

    saveRule(fields) {
      const now = Date.now();
      const { id, ...rest } = fields;
      const prev = id ? data.rules.find((r) => r.id === id) : null;
      const rec = { ...(prev || { id: id || newId(), createdAt: now, active: true }), ...rest, deleted: false, updatedAt: now };
      upsert(data.rules, rec);
      commit([`rule:${rec.id}`]);
      return rec;
    },
    deleteRule(id) {
      const r = data.rules.find((x) => x.id === id);
      if (!r) return;
      r.deleted = true;
      r.updatedAt = Date.now();
      commit([`rule:${id}`]);
    },

    setBudget(n) {
      data.settings = { ...data.settings, budget: amountOf(n), updatedAt: Date.now() };
      commit(['set:main']);
    },
    setSaveGoal(n) {
      data.settings = { ...data.settings, saveGoal: amountOf(n), updatedAt: Date.now() };
      commit(['set:main']);
    },

    // 도래한 고정 내역을 기록한다. 만든 건수를 돌려준다
    applyRecurring(today) {
      const known = new Set(data.txs.map((t) => t.id));
      const due = dueRecurring(data.rules, known, today);
      if (!due.length) return 0;
      const now = Date.now();
      for (const t of due) data.txs.push({ ...t, createdAt: now, updatedAt: now });
      commit(due.map((t) => `tx:${t.id}`));
      return due.length;
    },

    exportData() {
      return { app: 'ledger', exportedAt: new Date().toISOString(), ...data };
    },
    // 백업을 지금 기록과 합친다 (같은 내역은 늦게 고친 쪽). 새로 들어온 내역 수를 돌려준다
    importData(raw) {
      if (!raw || raw.app !== 'ledger' || !Array.isArray(raw.txs)) throw new Error('가계부 백업 파일이 아니에요');
      const inc = normalize(raw);
      const before = new Set(data.txs.map((t) => t.id));
      data = {
        v: 1,
        txs: mergeRecords(data.txs, inc.txs),
        cats: mergeRecords(data.cats, inc.cats),
        rules: mergeRecords(data.rules, inc.rules),
        settings: (inc.settings.updatedAt || 0) > (data.settings.updatedAt || 0) ? inc.settings : data.settings,
      };
      commit(null);
      return inc.txs.filter((t) => !before.has(t.id) && !t.deleted).length;
    },
    clearAll() {
      data = empty();
      commit(null);
    },

    // ── 동기화용 ──
    onLocalChange(fn) {
      changeListeners.add(fn);
      return () => changeListeners.delete(fn);
    },
    // 이 기기의 모든 기록 키
    keys() {
      return [
        ...data.txs.map((r) => `tx:${r.id}`),
        ...data.cats.map((r) => `cat:${r.id}`),
        ...data.rules.map((r) => `rule:${r.id}`),
        'set:main',
      ];
    },
    record(key) {
      const i = key.indexOf(':');
      const kind = key.slice(0, i);
      const id = key.slice(i + 1);
      if (kind === 'set') return { id: 'main', budget: data.settings.budget || 0, saveGoal: data.settings.saveGoal || 0, updatedAt: data.settings.updatedAt || 0 };
      return data[LISTS[kind]]?.find((r) => r.id === id) || null;
    },
    // 다른 기기의 기록을 합친다: 같은 기록은 늦게 고친 쪽이 이긴다.
    // localNewer = 이 기기 쪽이 더 최신이라 다시 올려야 하는 키, remoteNewer = 받아들인 키
    applyRemote(items) {
      const localNewer = [];
      const remoteNewer = [];
      const index = {};
      for (const { kind, rec } of items) {
        if (!rec || typeof rec !== 'object') continue;
        if (kind === 'set') {
          const mine = data.settings.updatedAt || 0;
          const theirs = rec.updatedAt || 0;
          if (theirs > mine) {
            // 저축 목표를 모르는 예전 버전이 올린 설정이면 이 기기의 목표를 그대로 둔다
            const saveGoal = rec.saveGoal === undefined ? data.settings.saveGoal || 0 : amountOf(rec.saveGoal);
            data.settings = { budget: amountOf(rec.budget), saveGoal, updatedAt: theirs };
            remoteNewer.push('set:main');
          } else if (mine > theirs) localNewer.push('set:main');
          continue;
        }
        const list = data[LISTS[kind]];
        if (!list || typeof rec.id !== 'string' || !validRemote[kind](rec)) continue;
        index[kind] ||= new Map(list.map((r, i) => [r.id, i]));
        const at = index[kind].get(rec.id);
        const key = `${kind}:${rec.id}`;
        if (at === undefined) {
          index[kind].set(rec.id, list.push(rec) - 1);
          remoteNewer.push(key);
        } else if ((rec.updatedAt || 0) > (list[at].updatedAt || 0)) {
          list[at] = rec;
          remoteNewer.push(key);
        } else if ((list[at].updatedAt || 0) > (rec.updatedAt || 0)) localNewer.push(key);
      }
      if (remoteNewer.length) commit();
      return { localNewer, remoteNewer };
    },
    get firstMonth() {
      const live = data.txs.filter((t) => !t.deleted);
      return live.length ? monthOf(live.reduce((m, t) => (t.date < m ? t.date : m), live[0].date)) : null;
    },
  };
}
