// node ledger/test.js
import assert from 'node:assert/strict';
import * as L from './logic.js';
import { createStore } from './store.js';
import { createSync, makeCode, normalizeCode, formatCode, deriveKeys, seal, unseal, docId } from './sync.js';
import { createFakeFirestore } from './fake-firestore.js';

let n = 0;
const test = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

const tx = (id, type, amount, cat, date, extra = {}) => ({ id, type, amount, cat, date, createdAt: 0, ...extra });

test('달 계산', () => {
  assert.equal(L.addMonths('2026-11', 1), '2026-12');
  assert.equal(L.addMonths('2026-12', 1), '2027-01');
  assert.equal(L.addMonths('2026-01', -1), '2025-12');
  assert.equal(L.addMonths('2026-03', -14), '2025-01');
  assert.equal(L.daysInMonth('2026-02'), 28);
  assert.equal(L.daysInMonth('2028-02'), 29);
  assert.equal(L.firstWeekday('2026-11'), 0); // 2026-11-01 은 일요일
  assert.equal(L.weekdayOf('2026-11-16'), 1);
});

test('월 합계는 지운 내역과 다른 달을 뺀다', () => {
  const txs = [
    tx('a', 'expense', 5000, 'food', '2026-11-03'),
    tx('b', 'income', 3000000, 'pay', '2026-11-10'),
    tx('c', 'expense', 9000, 'food', '2026-11-12', { deleted: true }),
    tx('d', 'expense', 7000, 'food', '2026-10-31'),
  ];
  const s = L.summarize(L.monthTx(txs, '2026-11'));
  assert.deepEqual(s, { income: 3000000, expense: 5000, saving: 0, balance: 2995000 });
});

test('카테고리별 합계는 큰 순서, 비율 합 1', () => {
  const txs = [
    tx('a', 'expense', 1000, 'cafe', '2026-11-01'),
    tx('b', 'expense', 6000, 'food', '2026-11-01'),
    tx('c', 'expense', 3000, 'food', '2026-11-02'),
    tx('d', 'income', 99999, 'pay', '2026-11-02'),
  ];
  const { total, rows } = L.byCategory(txs, 'expense');
  assert.equal(total, 10000);
  assert.deepEqual(rows.map((r) => [r.cat, r.total, r.count]), [['food', 9000, 2], ['cafe', 1000, 1]]);
  assert.equal(rows.reduce((s, r) => s + r.share, 0), 1);
});

test('날짜별 묶음은 최근 날짜 먼저', () => {
  const txs = [
    tx('a', 'expense', 1000, 'cafe', '2026-11-01', { createdAt: 1 }),
    tx('b', 'expense', 2000, 'food', '2026-11-05', { createdAt: 2 }),
    tx('c', 'income', 500, 'etc', '2026-11-05', { createdAt: 3 }),
  ];
  const g = L.byDay(txs);
  assert.deepEqual(g.map((x) => x.date), ['2026-11-05', '2026-11-01']);
  assert.deepEqual([g[0].income, g[0].expense], [500, 2000]);
  assert.deepEqual(g[0].items.map((x) => x.id), ['c', 'b']);
});

test('예산: 이번 달은 오늘 포함 남은 날로 나눈다', () => {
  const b = L.budgetStatus({ budget: 600000, spent: 150000, ym: '2026-11', today: '2026-11-16' });
  assert.equal(b.remaining, 450000);
  assert.equal(b.daysLeft, 15); // 16일~30일
  assert.equal(b.perDay, 30000);
  assert.equal(b.over, false);
  assert.equal(b.ratio, 0.25);
});

test('예산: 초과하면 하루 금액 0, 막대는 가득', () => {
  const b = L.budgetStatus({ budget: 100000, spent: 130000, ym: '2026-11', today: '2026-11-30' });
  assert.equal(b.remaining, -30000);
  assert.equal(b.over, true);
  assert.equal(b.perDay, 0);
  assert.equal(b.ratio, 1);
  assert.equal(b.daysLeft, 1);
});

test('예산: 지난 달·다음 달·예산 없음', () => {
  assert.equal(L.budgetStatus({ budget: 0, spent: 1, ym: '2026-11', today: '2026-11-16' }), null);
  assert.equal(L.budgetStatus({ budget: 10, spent: 1, ym: '2026-10', today: '2026-11-16' }).phase, 'past');
  assert.equal(L.budgetStatus({ budget: 10, spent: 1, ym: '2026-12', today: '2026-11-16' }).phase, 'future');
});

test('오늘 남은 돈: 하루 기준액에서 오늘 쓴 돈을 뺀다', () => {
  const txs = [
    tx('a', 'expense', 150000, 'c', '2026-11-10'),
    tx('b', 'expense', 12000, 'c', '2026-11-16'),
    tx('c', 'income', 99999, 'c', '2026-11-16'),
    tx('d', 'expense', 7000, 'c', '2026-10-16'), // 다른 달
  ];
  // 오늘 쓰기 전 남은 예산 450,000 ÷ 15일 = 30,000
  const t = L.todayStatus({ budget: 600000, txs, today: '2026-11-16' });
  assert.deepEqual(t, { allowance: 30000, spentToday: 12000, left: 18000, over: false, daysLeft: 15, nextPerDay: Math.floor(438000 / 14) });
  assert.equal(L.todayStatus({ budget: 0, txs, today: '2026-11-16' }), null);
});

test('오늘 남은 돈: 초과, 고정 내역 제외, 말일', () => {
  const over = L.todayStatus({ budget: 600000, txs: [tx('a', 'expense', 50000, 'c', '2026-11-16')], today: '2026-11-16' });
  assert.equal(over.allowance, 40000);
  assert.equal(over.left, -10000);
  assert.equal(over.over, true);
  // 오늘 나간 월세(고정)는 '오늘 쓴 돈'이 아니지만 예산에서는 빠진다
  const rent = L.todayStatus({ budget: 600000, txs: [tx('r', 'expense', 300000, 'c', '2026-11-16', { ruleId: 'x' })], today: '2026-11-16' });
  assert.deepEqual([rent.spentToday, rent.allowance, rent.left], [0, 20000, 20000]);
  // 말일: 내일 기준액은 0, 이미 예산을 넘겼으면 기준액도 0
  const last = L.todayStatus({ budget: 100000, txs: [tx('a', 'expense', 130000, 'c', '2026-11-20')], today: '2026-11-30' });
  assert.deepEqual([last.allowance, last.left, last.daysLeft, last.nextPerDay], [0, 0, 1, 0]);
});

test('고정 지출: 도래한 달만, 이미 있는 달은 건너뛴다', () => {
  const rule = { id: 'rent', type: 'expense', amount: 500000, cat: 'home', memo: '월세', day: 25, startYm: '2026-09' };
  const made = L.dueRecurring([rule], new Set(), '2026-11-16');
  // 9월 25일, 10월 25일은 지났고 11월 25일은 아직
  assert.deepEqual(made.map((t) => t.date), ['2026-09-25', '2026-10-25']);
  assert.equal(made[0].id, 'r_rent_2026-09');
  assert.equal(made[0].ruleId, 'rent');
  // 지운 달(id 가 알려진 달)은 다시 만들지 않는다
  const again = L.dueRecurring([rule], new Set(['r_rent_2026-09']), '2026-11-25');
  assert.deepEqual(again.map((t) => t.date), ['2026-10-25', '2026-11-25']);
});

test('고정 지출: 31일 규칙은 말일로, 꺼진 규칙은 무시', () => {
  const rule = { id: 'x', type: 'expense', amount: 1, cat: 'c', day: 31, startYm: '2026-02' };
  assert.deepEqual(L.dueRecurring([rule], new Set(), '2026-04-30').map((t) => t.date), [
    '2026-02-28', '2026-03-31', '2026-04-30',
  ]);
  assert.equal(L.dueRecurring([{ ...rule, active: false }], new Set(), '2026-04-30').length, 0);
  assert.equal(L.dueRecurring([{ ...rule, deleted: true }], new Set(), '2026-04-30').length, 0);
});

test('고정 지출: 아주 오래된 규칙도 최근 24개월까지만 소급', () => {
  const rule = { id: 'x', type: 'expense', amount: 1, cat: 'c', day: 1, startYm: '2020-01' };
  const made = L.dueRecurring([rule], new Set(), '2026-11-16');
  assert.equal(made.length, 24);
  assert.equal(made[0].date, '2024-12-01');
});

test('월별 추이', () => {
  const txs = [tx('a', 'expense', 100, 'c', '2026-09-10'), tx('b', 'expense', 300, 'c', '2026-11-10')];
  const t = L.monthlyTrend(txs, '2026-11', 3);
  assert.deepEqual(t.map((x) => [x.ym, x.expense]), [['2026-09', 100], ['2026-10', 0], ['2026-11', 300]]);
});

test('지난달 이맘때와 비교', () => {
  const txs = [
    tx('a', 'expense', 100, 'c', '2026-10-05'),
    tx('b', 'expense', 900, 'c', '2026-10-28'), // 16일 이후라 이번 달 비교에서는 빠진다
    tx('c', 'expense', 250, 'c', '2026-11-10'),
  ];
  assert.deepEqual(L.compareToLastMonth(txs, '2026-11', '2026-11-16'), { partial: true, now: 250, before: 100, diff: 150 });
  // 지난 달을 볼 때는 한 달 전체끼리
  assert.deepEqual(L.compareToLastMonth(txs, '2026-10', '2026-11-16'), { partial: false, now: 1000, before: 0, diff: 1000 });
});

test('금액 표시', () => {
  assert.equal(L.formatWon(1234567), '1,234,567원');
  assert.equal(L.compactNum(999999), '999,999');
  assert.equal(L.compactNum(1250000), '125만');
  assert.equal(L.compactNum(250000000), '2.5억');
  assert.equal(L.koreanAmount(9000), '');
  assert.equal(L.koreanAmount(1250000), '125만원');
  assert.equal(L.koreanAmount(123456789), '1억 2,345만 6,789원');
});

test('달력 칸 숫자', () => {
  assert.equal(L.calNum(56500), '56,500');
  assert.equal(L.calNum(99999), '99,999');
  assert.equal(L.calNum(123456), '12.3만');
  assert.equal(L.calNum(500000), '50만');
  assert.equal(L.calNum(3000000), '300만');
  assert.equal(L.calNum(250000000), '2.5억');
  assert.equal(L.calNum(56500, true), '5.6만');
  assert.equal(L.calNum(9900, true), '9,900');
});

test('내역 찾기: 메모·카테고리·적은 사람·금액, 카테고리 거르기', () => {
  const txs = [
    tx('a', 'expense', 12500, 'c_cafe', '2026-11-01', { memo: '아메리카노', by: '엄마' }),
    tx('b', 'expense', 32400, 'c_food', '2026-11-02', { memo: '장보기' }),
    tx('c', 'expense', 9000, 'c_food', '2026-11-03', { memo: '', by: '아빠' }),
    tx('d', 'expense', 1000, 'c_food', '2026-11-04', { memo: '지운 것', deleted: true }),
  ];
  const name = (id) => ({ c_cafe: '카페·간식', c_food: '식비' })[id];
  const ids = (f) => L.filterTx(txs, f, name).map((t) => t.id).join('');
  assert.equal(ids({}), 'abc');
  assert.equal(ids({ q: '아메' }), 'a');
  assert.equal(ids({ q: '식비' }), 'bc'); // 메모가 없어도 카테고리 이름으로
  assert.equal(ids({ q: '아빠' }), 'c');
  assert.equal(ids({ q: '12,500' }), 'a');
  assert.equal(ids({ q: '32400' }), 'b');
  assert.equal(ids({ q: '식비 장' }), 'b'); // 띄어 쓴 말은 모두 들어 있어야
  assert.equal(ids({ cat: 'c_food' }), 'bc');
  assert.equal(ids({ cat: 'c_food', q: '장' }), 'b');
  assert.equal(ids({ q: '없는말' }), '');
});

test('기록 합치기: 늦게 고친 쪽이 이긴다', () => {
  const mine = [{ id: 'a', v: 1, updatedAt: 10 }, { id: 'b', v: 1, updatedAt: 10 }];
  const theirs = [{ id: 'a', v: 2, updatedAt: 20 }, { id: 'b', v: 2, updatedAt: 5 }, { id: 'c', v: 2, updatedAt: 1 }];
  const m = L.mergeRecords(mine, theirs).sort((x, y) => (x.id < y.id ? -1 : 1));
  assert.deepEqual(m.map((r) => [r.id, r.v]), [['a', 2], ['b', 1], ['c', 2]]);
});


// ───────── 동기화 ─────────

const atest = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok - ${name}`);
};
const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const CONFIG = { projectId: 'demo', apiKey: '', endpoint: 'https://firestore.googleapis.com/v1' };
const device = (server, storage = memStorage()) => {
  const store = createStore(storage);
  const sync = createSync({ store, config: CONFIG, storage, fetch: server.fetch });
  return { store, sync, storage };
};
const tick = () => new Promise((r) => setTimeout(r, 3)); // 고친 시각이 겹치지 않게
const liveTx = (d) => d.store.txs.filter((t) => !t.deleted).map((t) => `${t.memo}:${t.amount}`).sort();

test('저축: 지출·예산과 따로 세고 목표 대비 상태를 알려 준다', () => {
  const txs = [
    tx('a', 'expense', 20000, 'c_food', '2026-11-16'),
    tx('b', 'income', 3000000, 'i_pay', '2026-11-10'),
    tx('c', 'saving', 300000, 's_bank', '2026-11-16', { createdAt: 2 }),
    tx('d', 'saving', 100000, 's_spare', '2026-10-25'),
    tx('e', 'saving', 999, 's_bank', '2026-11-02', { deleted: true }),
  ];
  const nov = L.monthTx(txs, '2026-11');
  assert.deepEqual(L.summarize(nov), { income: 3000000, expense: 20000, saving: 300000, balance: 2980000 });
  assert.equal(L.savedTotal(txs), 400000);
  // 저축은 예산에서 빠지지 않고 '오늘 쓴 돈'에도 들지 않는다
  const t = L.todayStatus({ budget: 600000, txs, today: '2026-11-16' });
  assert.equal(t.spentToday, 20000);
  assert.equal(t.allowance, 40000);
  const day = L.byDay(nov).find((g) => g.date === '2026-11-16');
  assert.deepEqual([day.income, day.expense, day.saving], [0, 20000, 300000]);
  assert.deepEqual(L.byCategory(nov, 'saving').rows.map((r) => [r.cat, r.total]), [['s_bank', 300000]]);
  assert.deepEqual(L.monthlyTrend(txs, '2026-11', 2).map((m) => m.saving), [100000, 300000]);
  assert.equal(L.savingStatus({ goal: 0, saved: 300000 }), null);
  assert.deepEqual(L.savingStatus({ goal: 500000, saved: 300000 }), { goal: 500000, saved: 300000, left: 200000, ratio: 0.6, done: false });
  const done = L.savingStatus({ goal: 500000, saved: 650000 });
  assert.deepEqual([done.left, done.ratio, done.done], [0, 1, true]);
  // 매달 적금도 고정 내역으로 기록된다
  const due = L.dueRecurring([{ id: 'sv', type: 'saving', amount: 300000, cat: 's_bank', day: 25, startYm: '2026-10' }], new Set(), '2026-11-16');
  assert.deepEqual(due.map((x) => [x.date, x.type]), [['2026-10-25', 'saving']]);
});

test('남은 돈: 수입 − 지출이 달을 넘어 이어진다. 저축은 빼지 않는다', () => {
  const txs = [
    tx('a', 'income', 300000, 'i_pay', '2026-01-25'),
    tx('b', 'saving', 150000, 's_bank', '2026-01-26'),
    tx('c', 'income', 350000, 'i_pay', '2026-02-25'),
    tx('d', 'saving', 150000, 's_bank', '2026-02-26'),
    tx('e', 'expense', 999, 'c_food', '2026-02-27', { deleted: true }),
    tx('f', 'expense', 40000, 'c_food', '2026-03-02'),
  ];
  assert.deepEqual(L.leftover(txs, '2026-01'), { carry: 0, month: 300000, total: 300000, hasPrior: false });
  assert.deepEqual(L.leftover(txs, '2026-02'), { carry: 300000, month: 350000, total: 650000, hasPrior: true });
  assert.deepEqual(L.leftover(txs, '2026-03'), { carry: 650000, month: -40000, total: 610000, hasPrior: true });
  assert.deepEqual(L.leftover(txs, '2025-12'), { carry: 0, month: 0, total: 0, hasPrior: false });
  // 저축만 적은 달: 남은 돈이 마이너스가 되지 않는다
  assert.deepEqual(L.leftover([tx('s', 'saving', 10000, 's_bank', '2026-04-01')], '2026-04'), { carry: 0, month: 0, total: 0, hasPrior: false });
});

test('저축: 저장소가 저축 카테고리·내역·목표를 다룬다 (예전 기록에도 카테고리가 생긴다)', () => {
  const mem = memStorage();
  mem.setItem('ledger.v1', JSON.stringify({ v: 1, txs: [], cats: [{ id: 'c_food', type: 'expense', name: '밥', emoji: '🍚', order: 1, updatedAt: 5 }], rules: [], settings: { budget: 100, updatedAt: 1 } }));
  const s = createStore(mem);
  assert.equal(s.cat('c_food').name, '밥');
  assert.deepEqual(s.cats('saving').map((c) => c.name), ['적금', '청약', '투자', '비상금', '기타']);
  assert.equal(s.saveGoal, 0);
  s.setSaveGoal(500000);
  s.saveTx({ type: 'saving', amount: 300000, cat: 's_bank', date: '2026-11-16', memo: '' });
  const again = createStore(mem);
  assert.equal(again.saveGoal, 500000);
  assert.equal(again.budget, 100);
  assert.equal(again.txs[0].type, 'saving');
  const back = createStore(memStorage());
  assert.equal(back.importData(JSON.parse(JSON.stringify(again.exportData()))), 1);
  assert.equal(back.saveGoal, 500000);
  // 저축 목표를 모르는 예전 버전이 올린 설정은 목표를 지우지 않는다
  back.applyRemote([{ kind: 'set', rec: { id: 'main', budget: 900, updatedAt: Date.now() + 1000 } }]);
  assert.deepEqual([back.budget, back.saveGoal], [900, 500000]);
  back.applyRemote([{ kind: 'set', rec: { id: 'main', budget: 900, saveGoal: 0, updatedAt: Date.now() + 2000 } }]);
  assert.equal(back.saveGoal, 0);
});

await atest('저축: 다른 기기로 전달되고, 앱이 새 버전이 되면 건너뛴 기록을 다시 받는다', async () => {
  const server = createFakeFirestore();
  const A = device(server);
  const B = device(server);
  const code = await A.sync.create();
  await B.sync.join(code);
  A.store.setSaveGoal(500000);
  A.store.saveTx({ type: 'saving', amount: 300000, cat: 's_bank', date: '2026-11-16', memo: '적금' });
  await A.sync.syncNow();
  await B.sync.syncNow();
  assert.equal(B.store.saveGoal, 500000);
  assert.deepEqual(liveTx(B), ['적금:300000']);
  // 예전 버전처럼: 받은 곳(cursor)은 앞으로 갔는데 저축 내역은 버린 기기
  const C = device(server);
  await C.sync.join(code);
  const raw = { ...JSON.parse(C.storage.getItem('ledger.v1')), txs: [] };
  C.storage.setItem('ledger.v1', JSON.stringify(raw));
  const st = JSON.parse(C.storage.getItem('ledger.sync'));
  delete st.v;
  C.storage.setItem('ledger.sync', JSON.stringify(st));
  const C2 = device(server, C.storage);
  await C2.sync.syncNow();
  assert.deepEqual(liveTx(C2), ['적금:300000']);
  assert.equal(JSON.parse(C.storage.getItem('ledger.sync')).v, 2);
});

await atest('가족 코드: 만들기·정리·오타 감지', async () => {
  const code = makeCode();
  assert.equal(code.length, 20);
  assert.equal(normalizeCode(formatCode(code).toLowerCase()), code);
  assert.equal(normalizeCode(` ${formatCode(code)} `), code);
  // 한 글자만 틀려도 거의 다 걸러진다 (검사 글자 2개)
  let caught = 0;
  for (let i = 0; i < 20; i++) if (!normalizeCode(code.slice(0, i) + (code[i] === 'A' ? 'B' : 'A') + code.slice(i + 1))) caught++;
  assert(caught >= 18, `오타 감지 ${caught}/20`);
  assert.equal(normalizeCode(code.slice(1)), null);
  assert.equal(normalizeCode('0'.repeat(20)), null); // 0 은 쓰지 않는 글자
  assert.notEqual(makeCode(), code);
});

await atest('암호화: 같은 코드로만 풀린다', async () => {
  const a = await deriveKeys(makeCode());
  const b = await deriveKeys(makeCode());
  assert.equal(a.hid.length, 32);
  assert.notEqual(a.hid, b.hid);
  const boxed = await seal(a.key, { k: 'tx', r: { memo: '비밀 메모' } });
  assert.deepEqual(await unseal(a.key, boxed), { k: 'tx', r: { memo: '비밀 메모' } });
  await assert.rejects(unseal(b.key, boxed));
  assert.equal(docId('tx:abc_1-2'), 'tx_abc_1-2');
  assert.equal(docId('tx:a/b'), 'tx_x612f62');
});

await atest('두 기기: 만들기 → 참여 → 서로 합쳐진다', async () => {
  const server = createFakeFirestore();
  const A = device(server);
  const B = device(server);
  A.store.saveTx({ type: 'expense', amount: 5000, cat: 'c_food', date: '2026-11-01', memo: 'A점심' });
  A.store.setBudget(700000);
  B.store.saveTx({ type: 'expense', amount: 3000, cat: 'c_cafe', date: '2026-11-02', memo: 'B커피' });

  const code = await A.sync.create();
  assert.equal(A.sync.status.linked, true);
  assert.equal(A.sync.status.pending, 0);
  await B.sync.join(formatCode(code));
  // B 는 A 의 기록을 받고, 자기 기록을 올렸다
  assert.deepEqual(liveTx(B), ['A점심:5000', 'B커피:3000']);
  assert.equal(B.store.budget, 700000);
  await A.sync.syncNow();
  assert.deepEqual(liveTx(A), ['A점심:5000', 'B커피:3000']);

  // 서버에는 암호문만 있다
  for (const d of server.docs.values()) assert(!d.c.includes('점심') && !Buffer.from(d.c, 'base64').toString('utf8').includes('점심'));
});

await atest('두 기기: 수정은 늦게 고친 쪽, 삭제도 전달', async () => {
  const server = createFakeFirestore();
  const A = device(server);
  const B = device(server);
  const t = A.store.saveTx({ type: 'expense', amount: 1000, cat: 'c_food', date: '2026-11-01', memo: '원본' });
  await B.sync.join(await A.sync.create());

  await tick();
  A.store.saveTx({ id: t.id, amount: 2000, memo: 'A가 고침' });
  await tick();
  B.store.saveTx({ id: t.id, amount: 3000, memo: 'B가 나중에 고침' });
  // 늦게 고친 B 가 먼저 올리고, 일찍 고친 A 가 나중에 올려 서버를 덮어써도 결국 B 것으로 모인다
  await B.sync.syncNow();
  await A.sync.syncNow();
  assert.deepEqual(liveTx(A), ['B가 나중에 고침:3000']);
  await B.sync.syncNow();
  await A.sync.syncNow();
  await B.sync.syncNow();
  assert.deepEqual(liveTx(A), ['B가 나중에 고침:3000']);
  assert.deepEqual(liveTx(B), ['B가 나중에 고침:3000']);
  assert.equal(A.sync.status.pending + B.sync.status.pending, 0);

  await tick();
  A.store.deleteTx(t.id);
  await A.sync.syncNow();
  await B.sync.syncNow();
  assert.deepEqual(liveTx(B), []);
});

await atest('참여: 없는 코드·틀린 코드는 연결하지 않는다', async () => {
  const server = createFakeFirestore();
  const B = device(server);
  B.store.saveTx({ type: 'expense', amount: 1, cat: 'c_food', date: '2026-11-01', memo: 'x' });
  await assert.rejects(B.sync.join(makeCode()), (e) => e.kind === 'notfound');
  await assert.rejects(B.sync.join('AAAAA-BBBBB-CCCCC-DDDDD'), (e) => e.kind === 'badcode');
  assert.equal(B.sync.status.linked, false);
  assert.equal(B.storage.getItem('ledger.sync'), null);
  assert.equal(server.docs.size, 0); // 아무것도 올리지 않았다
});

await atest('오프라인: 기록은 쌓아 두었다가 연결되면 올린다', async () => {
  const server = createFakeFirestore();
  const A = device(server);
  const B = device(server);
  await B.sync.join(await A.sync.create());
  server.state.offline = true;
  A.store.saveTx({ type: 'expense', amount: 4200, cat: 'c_food', date: '2026-11-03', memo: '오프라인' });
  await A.sync.syncNow();
  assert.equal(A.sync.status.phase, 'offline');
  assert.equal(A.sync.status.pending, 1);

  // 앱을 껐다 켜도 올릴 목록이 남아 있다
  const A2 = device(server, A.storage);
  assert.equal(A2.sync.status.linked, true);
  assert.equal(A2.sync.status.pending, 1);
  server.state.offline = false;
  await A2.sync.syncNow();
  assert.equal(A2.sync.status.phase, 'idle');
  assert.equal(A2.sync.status.pending, 0);
  await B.sync.syncNow();
  assert.deepEqual(liveTx(B), ['오프라인:4200']);
});

await atest('많은 기록: 여러 번에 나눠 올리고 받는다 (같은 시각 묶음 포함)', async () => {
  const server = createFakeFirestore();
  const A = device(server);
  const B = device(server);
  for (let i = 0; i < 730; i++) A.store.saveTx({ type: 'expense', amount: i + 1, cat: 'c_food', date: '2026-10-01', memo: `m${i}` });
  await B.sync.join(await A.sync.create());
  assert.equal(liveTx(B).length, 730);
  assert(server.state.commits >= 4, `나눠 올림: ${server.state.commits}`);
  // 다시 맞춰도 새로 받을 것이 없다
  const before = server.state.commits;
  await A.sync.syncNow();
  await B.sync.syncNow();
  assert.equal(server.state.commits, before);
});

await atest('연결 끊기: 기록은 남고 더 올리지 않는다. 서버 거부는 오류로 표시', async () => {
  const server = createFakeFirestore();
  const A = device(server);
  await A.sync.create();
  server.state.deny = true;
  A.store.saveTx({ type: 'expense', amount: 10, cat: 'c_food', date: '2026-11-01', memo: 'x' });
  await A.sync.syncNow();
  assert.equal(A.sync.status.phase, 'error');
  server.state.deny = false;
  A.sync.unlink();
  assert.equal(A.sync.status.linked, false);
  const count = server.docs.size;
  A.store.saveTx({ type: 'expense', amount: 20, cat: 'c_food', date: '2026-11-01', memo: 'y' });
  await A.sync.syncNow();
  assert.equal(server.docs.size, count);
  assert.equal(liveTx(A).length, 2);
});

await atest('화면을 떠날 때: 받기 전에 먼저 올린다 (적자마자 닫아도 다른 기기에 보인다)', async () => {
  const server = createFakeFirestore();
  const order = [];
  const spy = { ...server, fetch: (url, init) => (order.push(url.includes(':commit') ? 'commit' : 'query'), server.fetch(url, init)) };
  const A = device(spy);
  const B = device(server);
  const code = await A.sync.create();
  await B.sync.join(code);
  // 올릴 것이 없으면 아무것도 하지 않는다
  order.length = 0;
  await A.sync.flush();
  assert.deepEqual(order, []);
  A.store.saveTx({ type: 'expense', amount: 10000, cat: 'c_food', date: '2026-11-16', memo: '만원' });
  B.store.saveTx({ type: 'expense', amount: 7000, cat: 'c_cafe', date: '2026-11-16', memo: '커피' });
  await B.sync.syncNow();
  await A.sync.flush();
  assert.equal(order[0], 'commit'); // 올리기가 먼저
  assert.equal(A.sync.status.pending, 0);
  assert.deepEqual(liveTx(A), ['만원:10000', '커피:7000']); // 이어서 받기도 한다
  await B.sync.syncNow();
  assert.deepEqual(liveTx(B), ['만원:10000', '커피:7000']);
  // 같은 기록을 B 가 더 늦게 고쳤는데 A 가 예전 것을 먼저 올려 덮어써도, 결국 늦게 고친 쪽으로 맞춰진다
  const t = A.store.txs.find((x) => x.memo === '만원');
  A.store.saveTx({ id: t.id, amount: 11000 });
  await tick();
  B.store.saveTx({ id: t.id, amount: 12000 });
  await B.sync.syncNow();
  await A.sync.flush();
  await B.sync.syncNow();
  await A.sync.syncNow();
  assert.deepEqual(liveTx(A), ['만원:12000', '커피:7000']);
  assert.deepEqual(liveTx(B), ['만원:12000', '커피:7000']);
});

console.log(`\n${n}개 통과`);
process.exit(0); // 예약된 동기화 타이머를 기다리지 않는다
