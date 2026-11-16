// 가계부 계산 로직 — 화면·저장소와 무관한 순수 함수만 둔다 (node ledger/test.js 로 검증)

export const pad2 = (n) => String(n).padStart(2, '0');

export function dateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export const monthOf = (date) => date.slice(0, 7);

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad2((t % 12 + 12) % 12 + 1)}`;
}

export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

// 그 달 1일의 요일 (0 = 일요일)
export function firstWeekday(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).getDay();
}

export function weekdayOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

export const live = (list) => list.filter((x) => !x.deleted);

export function monthTx(txs, ym) {
  return txs.filter((t) => !t.deleted && t.date.startsWith(ym));
}

export function summarize(txs) {
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    if (t.deleted) continue;
    if (t.type === 'income') income += t.amount;
    else expense += t.amount;
  }
  return { income, expense, balance: income - expense };
}

// 카테고리별 합계, 큰 순서
export function byCategory(txs, type) {
  const map = new Map();
  let total = 0;
  for (const t of txs) {
    if (t.deleted || t.type !== type) continue;
    const row = map.get(t.cat) || { cat: t.cat, total: 0, count: 0 };
    row.total += t.amount;
    row.count += 1;
    map.set(t.cat, row);
    total += t.amount;
  }
  const rows = [...map.values()].sort((a, b) => b.total - a.total);
  for (const r of rows) r.share = total ? r.total / total : 0;
  return { total, rows };
}

// 날짜별 묶음, 최근 날짜 먼저. 같은 날 안에서는 나중에 적은 것이 위
export function byDay(txs) {
  const map = new Map();
  for (const t of txs) {
    if (t.deleted) continue;
    const g = map.get(t.date) || { date: t.date, income: 0, expense: 0, items: [] };
    g[t.type === 'income' ? 'income' : 'expense'] += t.amount;
    g.items.push(t);
    map.set(t.date, g);
  }
  const groups = [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const g of groups) g.items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return groups;
}

// 예산 상태. today 가 보는 달과 같을 때만 '하루에 쓸 수 있는 돈'을 계산한다
export function budgetStatus({ budget, spent, ym, today }) {
  if (!budget || budget <= 0) return null;
  const remaining = budget - spent;
  const ratio = Math.min(spent / budget, 1);
  const over = remaining < 0;
  const cur = monthOf(today);
  let phase = 'current';
  if (ym < cur) phase = 'past';
  else if (ym > cur) phase = 'future';
  let daysLeft = 0;
  let perDay = 0;
  if (phase === 'current') {
    daysLeft = daysInMonth(ym) - Number(today.slice(8, 10)) + 1; // 오늘 포함
    perDay = over ? 0 : Math.floor(remaining / daysLeft);
  }
  return { budget, spent, remaining, ratio, over, phase, daysLeft, perDay };
}

// 고정 지출 규칙의 그 달 날짜 (31일 규칙은 짧은 달에 말일로 당긴다)
export function ruleDate(rule, ym) {
  return `${ym}-${pad2(Math.min(rule.day, daysInMonth(ym)))}`;
}

export const ruleTxId = (ruleId, ym) => `r_${ruleId}_${ym}`;

// 오늘까지 도래했는데 아직 기록되지 않은 고정 내역을 만든다.
// knownIds 에는 지운 내역의 id 도 들어 있어야 한다 — 지운 달은 다시 만들지 않는다.
// id 가 규칙+달로 정해지므로 여러 기기가 각자 만들어도 한 건으로 합쳐진다.
export function dueRecurring(rules, knownIds, today, maxMonths = 24) {
  const out = [];
  const cur = monthOf(today);
  for (const rule of rules) {
    if (rule.deleted || rule.active === false) continue;
    let ym = rule.startYm;
    const floor = addMonths(cur, -(maxMonths - 1));
    if (ym < floor) ym = floor;
    for (; ym <= cur; ym = addMonths(ym, 1)) {
      const date = ruleDate(rule, ym);
      if (date > today) break;
      const id = ruleTxId(rule.id, ym);
      if (knownIds.has(id)) continue;
      out.push({
        id,
        type: rule.type,
        amount: rule.amount,
        cat: rule.cat,
        date,
        memo: rule.memo || '',
        ruleId: rule.id,
      });
    }
  }
  return out;
}

// ym 을 마지막으로 하는 n 개월의 합계
export function monthlyTrend(txs, ym, n = 6) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = addMonths(ym, -i);
    out.push({ ym: m, ...summarize(monthTx(txs, m)) });
  }
  return out;
}

// 지난달 같은 날짜까지 쓴 돈과 비교 (이번 달이 아니면 한 달 전체끼리)
export function compareToLastMonth(txs, ym, today) {
  const prev = addMonths(ym, -1);
  const partial = ym === monthOf(today);
  const day = Number(today.slice(8, 10));
  const upTo = (m) => {
    const limit = `${m}-${pad2(Math.min(day, daysInMonth(m)))}`;
    return monthTx(txs, m).filter((t) => !partial || t.date <= limit);
  };
  const now = summarize(upTo(ym)).expense;
  const before = summarize(upTo(prev)).expense;
  return { partial, now, before, diff: now - before };
}

export function formatWon(n) {
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
}

export const formatNum = (n) => Math.round(n).toLocaleString('ko-KR');

// 좁은 칸(달력·차트)용: 100만 이상은 '만' 단위로
export function compactNum(n) {
  n = Math.round(n);
  if (Math.abs(n) >= 100000000) return `${(n / 100000000).toFixed(1).replace(/\.0$/, '')}억`;
  if (Math.abs(n) >= 1000000) return `${Math.round(n / 10000).toLocaleString('ko-KR')}만`;
  return n.toLocaleString('ko-KR');
}

// 큰 금액을 말로 풀어 준다: 1250000 → '125만원'
export function koreanAmount(n) {
  n = Math.round(n);
  if (n < 10000) return '';
  const eok = Math.floor(n / 100000000);
  const man = Math.floor((n % 100000000) / 10000);
  const rest = n % 10000;
  const parts = [];
  if (eok) parts.push(`${eok.toLocaleString('ko-KR')}억`);
  if (man) parts.push(`${man.toLocaleString('ko-KR')}만`);
  if (rest) parts.push(rest.toLocaleString('ko-KR'));
  return `${parts.join(' ')}원`;
}

// 두 기기의 기록을 합친다: 같은 id 는 updatedAt 이 늦은 쪽이 이긴다 (백업 가져오기·동기화 공용)
export function mergeRecords(mine, theirs) {
  const map = new Map(mine.map((r) => [r.id, r]));
  for (const r of theirs) {
    const cur = map.get(r.id);
    if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) map.set(r.id, r);
  }
  return [...map.values()];
}
