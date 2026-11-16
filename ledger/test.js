// node ledger/test.js
import assert from 'node:assert/strict';
import * as L from './logic.js';

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
  assert.deepEqual(s, { income: 3000000, expense: 5000, balance: 2995000 });
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

test('기록 합치기: 늦게 고친 쪽이 이긴다', () => {
  const mine = [{ id: 'a', v: 1, updatedAt: 10 }, { id: 'b', v: 1, updatedAt: 10 }];
  const theirs = [{ id: 'a', v: 2, updatedAt: 20 }, { id: 'b', v: 2, updatedAt: 5 }, { id: 'c', v: 2, updatedAt: 1 }];
  const m = L.mergeRecords(mine, theirs).sort((x, y) => (x.id < y.id ? -1 : 1));
  assert.deepEqual(m.map((r) => [r.id, r.v]), [['a', 2], ['b', 1], ['c', 2]]);
});

console.log(`\n${n}개 통과`);
