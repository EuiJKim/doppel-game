// 가계부 화면
import * as L from './logic.js';
import { createStore } from './store.js';
import { createSync, formatCode } from './sync.js';
import { SYNC } from './config.js';

const store = createStore();
const sync = createSync({ store, config: SYNC });
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const MAX_AMOUNT = 999999999;

const UI_KEY = 'ledger.ui';
const ui = { listMode: 'cal', lastCat: {}, installHidden: false, me: '', fontScale: 1, ...readJson(UI_KEY) }; // me: 이 기기에서 적은 내역에 붙는 이름
const saveUi = () => {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(ui));
  } catch { /* 화면 설정은 저장 못 해도 괜찮다 */ }
};
function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}') || {};
  } catch {
    return {};
  }
}

let today = L.dateStr();
const state = { tab: 'home', ym: L.monthOf(today), day: today, statsType: 'expense', finding: false, q: '', filterCat: null, allTime: false };

const won = L.formatWon;
const monthLabel = (ym) => `${Number(ym.slice(5, 7))}월`;
const dayLabel = (date) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 ${WEEK[L.weekdayOf(date)]}요일`;
const TYPES = ['expense', 'income', 'saving'];
const TYPE_WORD = { expense: '지출', income: '수입', saving: '저축' };
const amountHtml = (t) =>
  t.type === 'income' ? `<span class="amt income">+${won(t.amount)}</span>` : `<span class="amt${t.type === 'saving' ? ' saving' : ''}">${won(t.amount)}</span>`;
// 지출 · 수입 · 저축 고르기
const typeSeg = (act, cur, label) => `
    <div class="seg seg3" role="group" aria-label="${label}">${TYPES.map((t) => `<button data-act="${act}" data-type="${t}" class="${cur === t ? 'on' : ''}" aria-pressed="${cur === t}">${TYPE_WORD[t]}</button>`).join('')}</div>`;

// ───────── 화면 그리기 ─────────

function render() {
  for (const b of document.querySelectorAll('.tab')) {
    const on = b.dataset.tab === state.tab;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  renderTop();
  const typing = document.activeElement?.id === 'q'; // 찾는 중에 다시 그려져도 입력을 이어갈 수 있게
  $('#view').innerHTML = { home: viewHome, list: viewList, stats: viewStats, settings: viewSettings }[state.tab]();
  if (typing) focusFind();
}

function focusFind() {
  const q = $('#q');
  if (!q) return;
  q.focus({ preventScroll: true });
  q.setSelectionRange(q.value.length, q.value.length);
}

const FONT_SCALES = [[1, '보통'], [1.12, '크게'], [1.25, '아주 크게']];
function applyFontScale() {
  const fs = FONT_SCALES.some(([v]) => v === ui.fontScale) ? ui.fontScale : 1;
  document.documentElement.style.setProperty('--fs', fs);
  document.documentElement.classList.toggle('fs-big', fs > 1); // 큰 글자에서는 카테고리를 한 줄에 4개씩
}

function renderTop() {
  const top = $('#top');
  if (state.tab === 'settings') {
    top.innerHTML = '<h1 class="title">설정</h1>';
    return;
  }
  const [y, m] = state.ym.split('-').map(Number);
  top.innerHTML = `
    <div class="month-nav">
      <button class="icon-btn" data-act="prev" aria-label="이전 달"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg></button>
      <h1>${y}년 ${m}월</h1>
      <button class="icon-btn" data-act="next" aria-label="다음 달"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button>
    </div>
    <div class="top-right">
      ${state.ym !== L.monthOf(today) ? '<button class="chip" data-act="this-month">이번 달로</button>' : ''}
      ${syncButton()}
    </div>`;
}

// 가족과 연결되어 있으면 위쪽에 맞춤 상태를 보여 준다. 누르면 바로 맞춘다
function syncButton() {
  const s = sync.status;
  if (!s.linked) return '';
  const cls = s.phase === 'syncing' ? ' spin' : s.phase === 'error' ? ' bad' : s.phase === 'offline' ? ' off' : '';
  return `
    <button class="icon-btn sync-btn${cls}" data-act="sync-tap" aria-label="가족 기기와 맞추기. ${esc(syncStatusText())}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/></svg>
      ${cls === ' bad' || cls === ' off' ? '<i class="dot"></i>' : ''}
    </button>`;
}

function txRow(t, { showDate = false } = {}) {
  const c = store.cat(t.cat);
  const sub = [t.memo ? c.name : '', showDate ? `${Number(t.date.slice(5, 7))}월 ${Number(t.date.slice(8, 10))}일` : '', t.ruleId ? '고정' : '']
    .filter(Boolean)
    .join(' · ');
  const by = t.by ? `<span class="by">${esc(t.by)}</span>` : ''; // 적은 사람
  return `
    <button class="row" data-act="edit" data-id="${esc(t.id)}">
      <span class="emo" aria-hidden="true">${esc(c.emoji)}</span>
      <span class="row-main"><b>${esc(t.memo || c.name)}</b>${sub || by ? `<small>${esc(sub)}${by}</small>` : ''}</span>
      ${amountHtml(t)}
    </button>`;
}

const emptyBox = (title, hint) => `<div class="empty"><p class="empty-title">${title}</p><p>${hint}</p></div>`;

// ── 홈 ──
function viewHome() {
  const txs = L.monthTx(store.txs, state.ym);
  const sum = L.summarize(txs);
  const b = L.budgetStatus({ budget: store.budget, spent: sum.expense, ym: state.ym, today });
  const m = monthLabel(state.ym);
  const recent = L.byDay(txs).flatMap((g) => g.items).slice(0, 5);

  let hero;
  if (!b) {
    hero = `
      <section class="card hero">
        <p class="label">${m} 수입 − 지출${sum.saving ? ' − 저축' : ''}</p>
        <p class="big${sum.balance < 0 ? ' neg' : ''}">${won(sum.balance)}</p>
        <button class="soft-btn" data-act="budget">월 예산 정하기</button>
        <p class="note">예산을 정하면 하루에 쓸 수 있는 돈을 알려드려요.</p>
      </section>`;
  } else {
    const pct = Math.round((b.spent / b.budget) * 100);
    let label = `${m} 남은 예산`;
    let note = '';
    let todayBlock = '';
    if (b.over) {
      label = `${m} 예산 초과`;
      note = `예산보다 <b>${won(-b.remaining)}</b> 더 썼어요.`;
    } else if (b.phase === 'current') {
      const t = L.todayStatus({ budget: store.budget, txs, today });
      todayBlock = `
        <div class="today">
          <div><p class="label">${t.over ? '<span class="warn-ico" aria-hidden="true">!</span>오늘 초과' : '오늘 남은 돈'}</p><p class="today-val${t.over ? ' neg' : ''}">${won(Math.abs(t.left))}</p></div>
          <div><p class="label">오늘 쓴 돈</p><p class="today-val">${won(t.spentToday)}</p></div>
        </div>`;
      if (!t.over) note = `하루 ${won(t.allowance)} 기준 · ${t.daysLeft}일 남음`;
      else note = t.daysLeft > 1 ? `내일부터 하루 <b>${won(t.nextPerDay)}</b>씩 쓸 수 있어요 · ${t.daysLeft - 1}일 남음` : '이번 달 마지막 날이에요.';
    } else if (b.phase === 'past') {
      label = `${m} 남긴 예산`;
      note = '예산 안에서 잘 마무리했어요.';
    }
    hero = `
      <section class="card hero${b.over ? ' over' : ''}">
        <p class="label">${b.over ? '<span class="warn-ico" aria-hidden="true">!</span>' : ''}${label}</p>
        <p class="big">${won(Math.abs(b.remaining))}</p>
        <div class="meter" role="meter" aria-label="예산 사용률" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(pct, 100)}"><i style="width:${(b.ratio * 100).toFixed(1)}%"></i></div>
        <div class="meter-foot"><span>${won(b.spent)} 사용 (${pct}%)</span><button class="link-btn" data-act="budget">예산 ${won(b.budget)}</button></div>
        ${todayBlock}
        ${note ? `<p class="note">${note}</p>` : ''}
      </section>`;
  }

  const showInstall = !isStandalone() && !ui.installHidden;
  return `
    ${hero}
    <section class="tiles">
      <div class="card tile"><p class="label">수입</p><p class="tile-val income">+${won(sum.income)}</p></div>
      <div class="card tile"><p class="label">지출</p><p class="tile-val">${won(sum.expense)}</p></div>
    </section>
    ${savingCard(sum.saving, m)}
    <section class="card">
      <div class="card-head"><h2>최근 내역</h2>${recent.length ? '<button class="link-btn" data-act="go-list">전체 보기</button>' : ''}</div>
      ${recent.length ? `<div class="rows">${recent.map((t) => txRow(t, { showDate: true })).join('')}</div>` : emptyBox(`${m} 내역이 아직 없어요`, '아래 ＋ 버튼으로 첫 내역을 기록해 보세요.')}
    </section>
    ${showInstall ? `
    <section class="card install">
      <div><b>홈 화면에 설치하기</b><p>앱처럼 바로 열리고 인터넷이 없어도 기록돼요.</p></div>
      <button class="soft-btn" data-act="install">설치</button>
      <button class="icon-btn small" data-act="install-hide" aria-label="설치 안내 닫기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
    </section>` : ''}`;
}

// 저축: 이번 달에 모은 돈과 목표. 저축한 적도 목표도 없으면 목표를 정하는 한 줄만 보여 준다
function savingCard(saved, m) {
  const total = L.savedTotal(store.txs);
  const s = L.savingStatus({ goal: store.saveGoal, saved });
  if (!s && !total) {
    return `
    <section class="card slim">
      <button class="set-row" data-act="goal"><span>한 달 저축 목표</span><span class="set-val go">정하기</span></button>
    </section>`;
  }
  const pct = s ? Math.round((saved / s.goal) * 100) : 0;
  const note = s ? (s.done ? `${m} 목표를 채웠어요.` : `목표까지 <b>${won(s.left)}</b> 남았어요.`) : '';
  return `
    <section class="card savings">
      <div class="card-head"><h2>${m} 저축</h2><button class="link-btn" data-act="goal">${s ? `목표 ${won(s.goal)}` : '목표 정하기'}</button></div>
      <p class="save-val">${won(saved)}</p>
      ${s ? `<div class="meter" role="meter" aria-label="저축 목표 달성률" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(pct, 100)}"><i style="width:${(s.ratio * 100).toFixed(1)}%"></i></div>
      <div class="meter-foot"><span>${pct}% 모음</span><span>지금까지 저축 ${won(total)}</span></div>` : `<p class="note">지금까지 저축 ${won(total)}</p>`}
      ${note ? `<p class="note">${note}</p>` : ''}
      <button class="soft-btn wide" data-act="add-saving">저축 적기</button>
    </section>`;
}

// ── 내역 ──
function viewList() {
  const searchIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>';
  let head;
  if (state.finding) {
    const c = state.filterCat ? store.cat(state.filterCat) : null;
    head = `
      <div class="find-bar">
        <input type="search" id="q" value="${esc(state.q)}" placeholder="메모·카테고리·금액으로 찾기" aria-label="내역 찾기" autocomplete="off" enterkeyhint="search">
        <button class="text-btn" data-act="find-close">닫기</button>
      </div>
      ${c ? `<div class="find-chips"><button class="chip" data-act="filter-clear" aria-label="${esc(c.name)} 거르기 해제"><span aria-hidden="true">${esc(c.emoji)}</span> ${esc(c.name)} <span aria-hidden="true">✕</span></button></div>` : ''}`;
  } else {
    const sum = L.summarize(L.monthTx(store.txs, state.ym));
    head = `
      <div class="list-head">
        <div class="seg" role="group" aria-label="보기 방식">
          <button data-act="list-mode" data-mode="cal" class="${ui.listMode === 'cal' ? 'on' : ''}" aria-pressed="${ui.listMode === 'cal'}">달력</button>
          <button data-act="list-mode" data-mode="list" class="${ui.listMode === 'list' ? 'on' : ''}" aria-pressed="${ui.listMode === 'list'}">목록</button>
        </div>
        <p class="sum-line${sum.saving ? ' full' : ''}"><span>수입 <b class="income">+${won(sum.income)}</b></span><span>지출 <b>${won(sum.expense)}</b></span>${sum.saving ? `<span>저축 <b class="saving">${won(sum.saving)}</b></span>` : ''}</p>
        <button class="icon-btn" data-act="find-open" aria-label="내역 찾기">${searchIcon}</button>
      </div>`;
  }
  return `${head}<div class="list-body" id="list-body">${listBody()}</div>`;
}

// 내역 화면의 본문. 찾는 중에는 글자를 칠 때마다 이 부분만 다시 그린다 (입력창이 유지되도록)
function listBody() {
  if (state.finding) return findBody();
  const txs = L.monthTx(store.txs, state.ym);
  const groups = L.byDay(txs);

  if (ui.listMode === 'list') {
    if (!groups.length) return `<section class="card">${emptyBox(`${monthLabel(state.ym)} 내역이 없어요`, '아래 ＋ 버튼으로 기록해 보세요.')}</section>`;
    return groups.map((g) => `
      <section class="card">
        <div class="day-head"><h2>${Number(g.date.slice(8, 10))}일 ${WEEK[L.weekdayOf(g.date)]}요일</h2><span>${dayTotals(g)}</span></div>
        <div class="rows">${g.items.map((t) => txRow(t)).join('')}</div>
      </section>`).join('');
  }

  const map = new Map(groups.map((g) => [g.date, g]));
  const tight = (ui.fontScale || 1) > 1;
  const cells = [];
  for (let i = 0; i < L.firstWeekday(state.ym); i++) cells.push('<span class="day blank"></span>');
  for (let d = 1; d <= L.daysInMonth(state.ym); d++) {
    const date = `${state.ym}-${L.pad2(d)}`;
    const g = map.get(date);
    const wd = L.weekdayOf(date);
    const cls = ['day', date === state.day ? 'sel' : '', date === today ? 'today' : '', wd === 0 ? 'sun' : '', wd === 6 ? 'sat' : ''].filter(Boolean).join(' ');
    const aria = `${dayLabel(date)}${g ? `, 수입 ${won(g.income)}, 지출 ${won(g.expense)}${g.saving ? `, 저축 ${won(g.saving)}` : ''}` : ''}`;
    cells.push(`
      <button class="${cls}" data-act="day" data-date="${date}" aria-label="${aria}" aria-pressed="${date === state.day}">
        <i>${d}</i>
        ${g && g.income ? `<em class="in">+${L.calNum(g.income, tight)}</em>` : ''}
        ${g && g.expense ? `<em>${L.calNum(g.expense, tight)}</em>` : ''}
        ${g && g.saving ? `<em class="sv">${L.calNum(g.saving, tight)}</em>` : ''}
      </button>`);
  }
  const sel = state.day && state.day.startsWith(state.ym) ? state.day : null;
  const g = sel ? map.get(sel) : null;
  const panel = sel ? `
    <section class="card">
      <div class="day-head"><h2>${dayLabel(sel)}</h2><span>${g ? dayTotals(g) : ''}</span></div>
      ${g ? `<div class="rows">${g.items.map((t) => txRow(t)).join('')}</div>` : '<p class="muted pad">이 날은 내역이 없어요.</p>'}
      <button class="soft-btn wide" data-act="add" data-date="${sel}">이 날 내역 추가</button>
    </section>` : '<p class="muted center">날짜를 누르면 그날 내역이 보여요.</p>';

  return `
    <section class="card cal">
      <div class="cal-week" aria-hidden="true">${WEEK.map((w, i) => `<span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</span>`).join('')}</div>
      <div class="cal-grid">${cells.join('')}</div>
    </section>
    ${panel}`;
}

// 찾은 내역. 기본은 보고 있는 달 안에서, '전체 기간'을 누르면 모든 달에서 찾는다
const FIND_MAX = 300;
function findBody() {
  const base = state.allTime ? store.txs : L.monthTx(store.txs, state.ym);
  const found = L.filterTx(base, { q: state.q, cat: state.filterCat }, (id) => store.cat(id).name);
  const sum = L.summarize(found);
  const m = monthLabel(state.ym);
  const parts = [`${state.allTime ? '전체 기간' : m} ${found.length}건`, sum.expense ? `지출 ${won(sum.expense)}` : '', sum.income ? `수입 +${won(sum.income)}` : '', sum.saving ? `저축 ${won(sum.saving)}` : ''].filter(Boolean);
  const line = `
    <div class="find-sum">
      <span>${parts.join(' · ')}</span>
      <button class="link-btn" data-act="find-scope">${state.allTime ? `${m}만 보기` : '전체 기간에서 찾기'}</button>
    </div>`;
  if (!found.length) return `${line}<section class="card">${emptyBox('찾는 내역이 없어요', state.allTime ? '다른 말로 찾아보세요.' : '전체 기간에서 찾아볼 수 있어요.')}</section>`;
  let left = FIND_MAX;
  const cards = [];
  for (const g of L.byDay(found)) {
    if (left <= 0) break;
    const items = g.items.slice(0, left);
    left -= items.length;
    const [y, mo, d] = g.date.split('-').map(Number);
    const title = state.allTime ? `${y}년 ${mo}월 ${d}일 ${WEEK[L.weekdayOf(g.date)]}요일` : `${d}일 ${WEEK[L.weekdayOf(g.date)]}요일`;
    cards.push(`
      <section class="card">
        <div class="day-head"><h2>${title}</h2><span>${dayTotals(g)}</span></div>
        <div class="rows">${items.map((t) => txRow(t)).join('')}</div>
      </section>`);
  }
  const more = found.length > FIND_MAX ? `<p class="muted center small">최근 ${FIND_MAX}건까지 보여요. 검색어를 더 적어 좁혀 보세요.</p>` : '';
  return line + cards.join('') + more;
}

function dayTotals(g) {
  return [g.income ? `<b class="income">+${won(g.income)}</b>` : '', g.expense ? `<b>${won(g.expense)}</b>` : '', g.saving ? `<b class="saving">저축 ${won(g.saving)}</b>` : ''].filter(Boolean).join(' ');
}

// ── 통계 ──
function viewStats() {
  const type = state.statsType;
  const word = TYPE_WORD[type];
  const txs = L.monthTx(store.txs, state.ym);
  const { total, rows } = L.byCategory(txs, type);
  const m = monthLabel(state.ym);

  let cmpLine = '';
  if (type === 'expense') {
    const c = L.compareToLastMonth(store.txs, state.ym, today);
    if (c.before > 0) {
      const base = c.partial ? '지난달 이맘때' : '그 전 달';
      cmpLine = c.diff === 0 ? `${base}와 똑같이 썼어요.` : `${base}보다 <b>${won(Math.abs(c.diff))} ${c.diff > 0 ? '더' : '덜'}</b> 썼어요.`;
    }
  } else if (type === 'saving') {
    const s = L.savingStatus({ goal: store.saveGoal, saved: total });
    const all = `지금까지 저축 <b>${won(L.savedTotal(store.txs))}</b>`;
    cmpLine = s ? `${s.done ? `목표 ${won(s.goal)}을 채웠어요.` : `목표 ${won(s.goal)}까지 <b>${won(s.left)}</b> 남았어요.`} ${all}` : all;
  }
  const emptyHint = { expense: '기록이 쌓이면 어디에 많이 썼는지 보여드려요.', income: '기록이 쌓이면 어디서 들어왔는지 보여드려요.', saving: '＋ 버튼에서 저축을 고르면 따로 기록돼요.' }[type];

  const top = rows[0]?.total || 1;
  const catList = rows.length ? `
    <ol class="crows">${rows.map((r) => {
      const c = store.cat(r.cat);
      return `
      <li><button class="crow" data-act="cat-drill" data-cat="${esc(r.cat)}" aria-label="${esc(c.name)} ${Math.round(r.share * 100)}%, ${won(r.total)}. 내역 보기">
        <span class="emo" aria-hidden="true">${esc(c.emoji)}</span>
        <span class="crow-main">
          <span class="crow-top"><b>${esc(c.name)}</b><span class="pct">${Math.round(r.share * 100)}%</span><span class="amt">${won(r.total)}</span></span>
          <span class="bar"><i style="width:${Math.max((r.total / top) * 100, 1.5).toFixed(1)}%"></i></span>
        </span>
      </button></li>`;
    }).join('')}</ol>` : emptyBox(`${m} ${word} 내역이 없어요`, emptyHint);

  // 추이는 보통 '이번 달까지 6개월'. 더 옛날/앞날을 보고 있으면 그 달이 들어오게 옮긴다
  const cur = L.monthOf(today);
  const end = state.ym > cur || state.ym < L.addMonths(cur, -5) ? state.ym : cur;
  const trend = L.monthlyTrend(store.txs, end, 6);

  return `
    <div class="list-head">
      ${typeSeg('stats-type', type, '통계 종류')}
    </div>
    <section class="card hero">
      <p class="label">${m} ${word}</p>
      <p class="big">${won(total)}</p>
      ${cmpLine ? `<p class="note">${cmpLine}</p>` : ''}
    </section>
    <section class="card">
      <div class="card-head"><h2>카테고리별 ${word}</h2>${rows.length ? '<span class="muted small">누르면 내역 보기</span>' : ''}</div>
      ${catList}
    </section>
    <section class="card">
      <div class="card-head"><h2>월별 ${word}</h2><span class="muted small">막대를 누르면 그 달로 이동</span></div>
      ${trendChart(trend, type, word)}
    </section>`;
}

// 월별 막대: 보고 있는 달만 강조색, 나머지는 회색. 값은 강조한 달에만 적는다
function trendChart(rows, key, word) {
  const W = 320, H = 168, top = 26, bottom = 26;
  const plot = H - top - bottom;
  const max = Math.max(...rows.map((r) => r[key]), 1);
  const slot = W / rows.length;
  const bw = Math.min(30, slot * 0.52);
  const cols = rows.map((r, i) => {
    const v = r[key];
    const h = v > 0 ? Math.max(Math.round((v / max) * plot), 3) : 0;
    const x = i * slot + (slot - bw) / 2;
    const y = H - bottom - h;
    const rad = Math.min(4, h);
    const sel = r.ym === state.ym;
    const bar = h ? `<path class="col${sel ? ' sel' : ''}" d="M${x},${y + rad} a${rad},${rad} 0 0 1 ${rad},${-rad} h${bw - 2 * rad} a${rad},${rad} 0 0 1 ${rad},${rad} v${h - rad} h${-bw} z"/>` : '';
    return `
      <g class="col-g" data-act="goto-month" data-ym="${r.ym}" role="button" tabindex="0" aria-label="${monthLabel(r.ym)} ${word} ${won(v)}">
        <rect x="${i * slot}" y="0" width="${slot}" height="${H}" fill="transparent"/>
        ${bar}
        ${sel ? `<text class="col-val" x="${x + bw / 2}" y="${y - 8}" text-anchor="middle">${L.compactNum(v)}</text>` : ''}
        <text class="col-x${sel ? ' sel' : ''}" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${monthLabel(r.ym)}</text>
      </g>`;
  });
  return `
    <svg class="trend" viewBox="0 0 ${W} ${H}" role="group" aria-label="최근 6개월 ${word}">
      <line class="axis" x1="0" x2="${W}" y1="${H - bottom + 0.5}" y2="${H - bottom + 0.5}"/>
      ${cols.join('')}
    </svg>`;
}

// ── 설정 ──
function viewSettings() {
  const rules = store.rules.slice().sort((a, b) => a.day - b.day);
  return `
    <section class="card">
      <div class="card-head"><h2>예산과 저축</h2></div>
      <button class="set-row" data-act="budget"><span>월 예산</span><span class="set-val">${store.budget ? won(store.budget) : '정하지 않음'}</span></button>
      <button class="set-row" data-act="goal"><span>한 달 저축 목표</span><span class="set-val">${store.saveGoal ? won(store.saveGoal) : '정하지 않음'}</span></button>
    </section>

    <section class="card">
      <div class="card-head"><h2>고정 내역</h2><button class="link-btn" data-act="rule-add">추가</button></div>
      <p class="muted small pad-b">월세·통신비·월급·적금처럼 매달 같은 날 생기는 돈을 등록하면 그날 자동으로 기록돼요.</p>
      ${rules.length ? `<div class="rows">${rules.map((r) => {
        const c = store.cat(r.cat);
        return `
        <button class="row" data-act="rule-edit" data-id="${esc(r.id)}">
          <span class="emo" aria-hidden="true">${esc(c.emoji)}</span>
          <span class="row-main"><b>${esc(r.memo || c.name)}</b><small>매달 ${r.day >= 31 ? '말일' : `${r.day}일`}</small></span>
          ${amountHtml(r)}
        </button>`;
      }).join('')}</div>` : ''}
    </section>

    <section class="card">
      <div class="card-head"><h2>카테고리</h2></div>
      <button class="set-row" data-act="cats-open" data-type="expense"><span>지출 카테고리</span><span class="set-val">${store.cats('expense').length}개</span></button>
      <button class="set-row" data-act="cats-open" data-type="income"><span>수입 카테고리</span><span class="set-val">${store.cats('income').length}개</span></button>
      <button class="set-row" data-act="cats-open" data-type="saving"><span>저축 카테고리</span><span class="set-val">${store.cats('saving').length}개</span></button>
    </section>

    ${syncCard()}

    <section class="card">
      <div class="card-head"><h2>화면</h2></div>
      <div class="set-row static"><span>글자 크기</span>
        <div class="seg" role="group" aria-label="글자 크기">${FONT_SCALES.map(([v, name]) => `<button data-act="font-scale" data-v="${v}" class="${ui.fontScale === v ? 'on' : ''}" aria-pressed="${ui.fontScale === v}">${name}</button>`).join('')}</div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>앱과 백업</h2></div>
      ${isStandalone() ? '' : '<button class="set-row" data-act="install"><span>홈 화면에 설치</span><span class="set-val">방법 보기</span></button>'}
      <button class="set-row" data-act="export"><span>백업 파일 내보내기</span><span class="set-val">${store.txs.filter((t) => !t.deleted).length}건</span></button>
      <button class="set-row" data-act="import"><span>백업 파일 가져오기</span><span class="set-val">합치기</span></button>
      <button class="set-row danger" data-act="clear"><span>모든 기록 지우기</span></button>
    </section>
    <p class="muted center small">${sync.status.linked ? '가계부 · 기록은 이 기기에 저장되고 가족 기기와 맞춰집니다' : '가계부 · 기록은 이 기기에만 저장됩니다'}</p>`;
}

function syncCard() {
  const head = '<h2>가족과 같이 쓰기</h2>';
  if (!sync.configured) {
    return `
    <section class="card">
      <div class="card-head">${head}<span class="badge">준비 중</span></div>
      <p class="muted small">여러 기기·가족이 같은 가계부를 보는 기능은 준비 중입니다. 지금 기록은 이 기기에만 저장돼요.</p>
    </section>`;
  }
  if (!sync.status.linked) {
    return `
    <section class="card">
      <div class="card-head">${head}</div>
      <p class="muted small pad-b">한 폰에서 가족 코드를 만들고 다른 폰에서 그 코드를 입력하면 같은 가계부를 함께 씁니다. 로그인은 필요 없어요.</p>
      <div class="btn-pair">
        <button class="soft-btn" data-act="sync-create">가족 코드 만들기</button>
        <button class="soft-btn" data-act="sync-join">코드 입력하기</button>
      </div>
    </section>`;
  }
  return `
    <section class="card">
      <div class="card-head">${head}<span class="badge on">연결됨</span></div>
      <p class="muted small pad-b" id="sync-status">${esc(syncStatusText())}</p>
      <button class="set-row" data-act="name-edit"><span>내 이름</span><span class="set-val">${esc(ui.me) || '정하지 않음'}</span></button>
      <button class="set-row" data-act="sync-code"><span>가족 코드</span><span class="set-val">보기 · 공유</span></button>
      <button class="set-row" data-act="sync-now"><span>지금 맞추기</span></button>
      <button class="set-row danger" data-act="sync-unlink"><span>이 기기 연결 끊기</span></button>
    </section>`;
}

function syncStatusText() {
  const s = sync.status;
  if (s.phase === 'syncing') return '가족 기기와 맞추는 중…';
  if (s.phase === 'offline') return s.pending ? `오프라인 — 연결되면 ${s.pending}건을 올려요` : '오프라인 — 연결되면 다시 맞춰요';
  if (s.phase === 'error') return `맞추지 못했어요: ${s.error}`;
  if (!s.lastSyncAt) return '아직 맞춘 적이 없어요';
  const min = Math.floor((Date.now() - s.lastSyncAt) / 60000);
  const d = new Date(s.lastSyncAt);
  const when = min < 1 ? '방금' : min < 60 ? `${min}분 전` : `${d.getMonth() + 1}월 ${d.getDate()}일 ${L.pad2(d.getHours())}:${L.pad2(d.getMinutes())}`;
  return `마지막으로 맞춘 때: ${when}`;
}

// ───────── 시트(아래에서 올라오는 창) ─────────

let sheet = null; // { kind: 'entry' | 'cat' | 'guide', ... }

function openSheet(next) {
  const wasOpen = !!sheet;
  sheet = next;
  $('#sheet').innerHTML = sheetHtml();
  document.body.classList.add('sheet-open');
  if (!wasOpen) history.pushState({ sheet: true }, '');
  if (sheet.kind === 'entry') {
    paintAmount();
    paintCats();
  }
  $('#sheet .sheet')?.focus({ preventScroll: true });
}

function closeSheet(fromPop = false) {
  if (!sheet) return;
  sheet = null;
  $('#sheet').innerHTML = '';
  document.body.classList.remove('sheet-open');
  if (!fromPop && history.state?.sheet) history.back();
}

const xIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';

// ── 확인 창: 화면 가운데에 뜨고 시트 위에도 겹쳐진다. 답(true/false)을 돌려준다 ──
let dialog = null;
let afterPop = null; // 우리가 부른 history.back() 이 끝난 뒤 할 일

function ask({ title, body = '', ok = '확인', danger = false }) {
  return new Promise((resolve) => {
    dialog = { resolve };
    $('#dialog').innerHTML = `
      <div class="dlg-backdrop" data-act="dlg-no"></div>
      <section class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title"${body ? ' aria-describedby="dlg-body"' : ''}>
        <h2 id="dlg-title">${esc(title)}</h2>
        ${body ? `<p id="dlg-body">${esc(body)}</p>` : ''}
        <div class="dlg-btns">
          <button class="dlg-btn" data-act="dlg-no">취소</button>
          <button class="dlg-btn ${danger ? 'danger' : 'go'}" data-act="dlg-yes">${esc(ok)}</button>
        </div>
      </section>`;
    if (!sheet) history.pushState({ dialog: true }, ''); // 시트가 없을 때도 뒤로 가기로 닫히게
    $('#dialog .dlg-btn').focus({ preventScroll: true });
  });
}

function closeDialog(answer, fromPop = false) {
  if (!dialog) return;
  const { resolve } = dialog;
  dialog = null;
  $('#dialog').innerHTML = '';
  if (!fromPop && history.state?.dialog) {
    // 뒤로 가기가 끝난 다음에 답을 돌려준다 — 그 사이에 새 시트를 열면 같이 닫혀 버리기 때문
    const done = () => {
      clearTimeout(timer);
      afterPop = null;
      resolve(answer);
    };
    const timer = setTimeout(done, 400);
    afterPop = done;
    history.back();
  } else resolve(answer);
}

function sheetHtml() {
  if (sheet.kind === 'entry') return entryHtml();
  if (sheet.kind === 'cat') return catHtml();
  if (sheet.kind === 'cats') return catsHtml();
  if (sheet.kind === 'code') return codeHtml();
  if (sheet.kind === 'join') return joinHtml();
  if (sheet.kind === 'name') return nameHtml();
  return guideHtml();
}

// ── 금액 입력 시트: 내역(tx) · 고정 내역(rule) · 예산(budget) · 저축 목표(goal) 공용 ──
const amountOnly = (mode) => mode === 'budget' || mode === 'goal'; // 금액만 정하는 시트
function openEntry({ mode = 'tx', id = null, date = null, type = 'expense' } = {}) {
  const e = { kind: 'entry', mode, id, type, amount: '', cat: null, date: date || today, memo: '', day: Number(today.slice(8, 10)) };
  if (amountOnly(mode)) {
    const cur = mode === 'goal' ? store.saveGoal : store.budget;
    e.amount = cur ? String(cur) : '';
  } else if (id) {
    const src = mode === 'rule' ? store.rule(id) : store.tx(id);
    if (!src) return;
    Object.assign(e, { type: src.type, amount: String(src.amount), cat: src.cat, memo: src.memo || '', by: src.by || '' });
    if (mode === 'rule') e.day = src.day;
    else e.date = src.date;
  }
  if (!amountOnly(mode) && !e.cat) e.cat = defaultCat(e.type);
  openSheet(e);
}

function defaultCat(type) {
  const cats = store.cats(type);
  return (cats.find((c) => c.id === ui.lastCat[type]) || cats[0])?.id || null;
}

function entryHtml() {
  const e = sheet;
  const plain = amountOnly(e.mode);
  const title = e.mode === 'budget' ? '월 예산' : e.mode === 'goal' ? '한 달 저축 목표' : e.mode === 'rule' ? '고정 내역' : e.id ? '내역 수정' : '내역 추가';
  const canDelete = e.mode === 'budget' ? store.budget > 0 : e.mode === 'goal' ? store.saveGoal > 0 : !!e.id;
  const seg = typeSeg('e-type', e.type, '종류');
  const fields = e.mode === 'tx' ? `
    <div class="fields">
      <input type="date" id="e-date" value="${esc(e.date)}" aria-label="날짜" required>
      <input type="text" id="e-memo" value="${esc(e.memo)}" placeholder="메모 (선택)" maxlength="40" aria-label="메모" autocomplete="off" enterkeyhint="done">
    </div>` : e.mode === 'rule' ? `
    <div class="fields">
      <select id="e-day" aria-label="매달 기록할 날">${Array.from({ length: 31 }, (_, i) => i + 1).map((d) => `<option value="${d}"${d === e.day ? ' selected' : ''}>매달 ${d === 31 ? '말일' : `${d}일`}</option>`).join('')}</select>
      <input type="text" id="e-memo" value="${esc(e.memo)}" placeholder="${ruleNameHint(e.type)}" maxlength="40" aria-label="이름" autocomplete="off" enterkeyhint="done">
    </div>` : '';
  const quick = [[1000, '+1천'], [10000, '+1만'], [50000, '+5만'], [100000, '+10만']];
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'back'];
  return `
    <div class="backdrop" data-act="close"></div>
    <section class="sheet entry mode-${plain ? 'budget' : e.mode}" role="dialog" aria-modal="true" aria-label="${title}" tabindex="-1">
      <header class="sheet-head">
        <button class="icon-btn" data-act="close" aria-label="닫기">${xIcon}</button>
        ${plain ? `<h2>${title}</h2>` : seg}
        ${canDelete ? `<button class="text-btn danger" data-act="e-delete">${plain ? '없애기' : '삭제'}</button>` : whoChip(e)}
      </header>
      ${e.mode === 'rule' ? '<p class="sheet-hint">매달 정한 날에 자동으로 기록돼요.</p>' : ''}
      ${e.mode === 'budget' ? '<p class="sheet-hint">한 달에 쓸 돈을 정해 두면 남은 예산을 알려드려요.</p>' : ''}
      ${e.mode === 'goal' ? '<p class="sheet-hint">한 달에 모을 돈을 정해 두면 얼마나 모았는지 알려드려요. 저축은 지출 예산과 따로 셉니다.</p>' : ''}
      <div class="amount" id="e-amount" aria-live="polite"></div>
      ${plain ? '' : `
      <div class="cats-wrap">
        <div class="cats" id="e-cats" role="group" aria-label="카테고리"></div>
        <span class="cats-more" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></span>
      </div>`}
      ${fields}
      <div class="quick">${quick.map(([n, t]) => `<button data-act="e-add" data-n="${n}">${t}</button>`).join('')}</div>
      <div class="keypad">${keys.map((k) => k === 'back'
        ? '<button data-act="e-key" data-k="back" aria-label="지우기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5-6zM12 10l4 4M16 10l-4 4"/></svg></button>'
        : `<button data-act="e-key" data-k="${k}">${k}</button>`).join('')}</div>
      ${e.mode === 'tx' && !e.id
        ? '<div class="save-row"><button class="soft-btn" data-act="e-save-more" id="e-more">저장하고 계속</button><button class="primary" data-act="e-save" id="e-save">저장</button></div>'
        : '<button class="primary" data-act="e-save" id="e-save">저장</button>'}
    </section>`;
}

const ruleNameHint = (type) => `이름 (예: ${{ expense: '월세', income: '월급', saving: '적금' }[type]})`;

// 새 내역을 적을 때 누구 이름으로 적히는지 보여 준다. 가족과 연결했는데 이름이 없으면 정하라고 알려 준다
function whoChip(e) {
  if (e.mode !== 'tx' || e.id || !(ui.me || sync.status.linked)) return '<span class="head-pad"></span>';
  return ui.me
    ? `<button class="who-chip" data-act="e-who" aria-label="적는 사람 ${esc(ui.me)}. 눌러서 바꾸기">${esc(ui.me)}</button>`
    : '<button class="who-chip ask" data-act="e-who">이름 정하기</button>';
}

function paintAmount() {
  const n = Number(sheet.amount || 0);
  // 금액 아래 줄: 금액을 말로 푼 것 + (고칠 때) 누가 적었는지
  const read = [L.koreanAmount(n), sheet.id && sheet.by ? `${esc(sheet.by)} 적음` : ''].filter(Boolean).join(' · ');
  $('#e-amount').innerHTML = `
    <p class="amount-num${n ? '' : ' zero'}"><span>${L.formatNum(n)}</span>원</p>
    <p class="amount-read">${read || '&nbsp;'}</p>`;
  $('#e-save').disabled = n <= 0;
  if ($('#e-more')) $('#e-more').disabled = n <= 0;
}

// 카테고리가 아래로 더 있으면(스크롤해야 보이면) 아래쪽에 흐림과 화살표를 보여 준다
function paintCatsMore() {
  const box = $('#e-cats');
  if (box) box.parentElement.classList.toggle('more', box.scrollTop + box.clientHeight < box.scrollHeight - 6);
}

function paintCats() {
  const box = $('#e-cats');
  if (!box) return;
  box.innerHTML = store.cats(sheet.type).map((c) => `
    <button class="cat${c.id === sheet.cat ? ' on' : ''}" data-act="e-cat" data-id="${esc(c.id)}" aria-pressed="${c.id === sheet.cat}">
      <span class="cat-emo" aria-hidden="true">${esc(c.emoji)}</span><span class="cat-name">${esc(c.name)}</span>
    </button>`).join('');
  paintCatsMore();
}

function entryKey(k) {
  let a = sheet.amount;
  if (k === 'back') a = a.slice(0, -1);
  else a = String(Math.min(Number(a + k), MAX_AMOUNT));
  sheet.amount = a === '0' ? '' : a;
  paintAmount();
}

function entrySave(keepOpen = false) {
  const e = sheet;
  const amount = Number(e.amount || 0);
  if (amount <= 0) return;
  if (e.mode === 'budget') {
    store.setBudget(amount);
    closeSheet();
    toast('예산을 정했어요');
    return;
  }
  if (e.mode === 'goal') {
    store.setSaveGoal(amount);
    closeSheet();
    toast('저축 목표를 정했어요');
    return;
  }
  if (!e.cat) return toast('카테고리를 골라 주세요');
  const memo = ($('#e-memo')?.value || '').trim();
  ui.lastCat[e.type] = e.cat;
  saveUi();
  if (e.mode === 'rule') {
    const day = Number($('#e-day').value);
    const prev = e.id ? store.rule(e.id) : null;
    store.saveRule({ id: e.id || undefined, type: e.type, amount, cat: e.cat, memo, day, startYm: prev?.startYm || L.monthOf(today) });
    const made = store.applyRecurring(today);
    closeSheet();
    toast(made ? `등록했어요. 이번 달 내역 ${made}건을 기록했어요` : `등록했어요. 매달 ${day >= 31 ? '말일' : `${day}일`}에 기록돼요`);
    return;
  }
  const date = $('#e-date').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast('날짜를 골라 주세요');
  const fields = { id: e.id || undefined, type: e.type, amount, cat: e.cat, date, memo };
  if (!e.id && ui.me) fields.by = ui.me; // 처음 적은 사람
  store.saveTx(fields);
  navigator.storage?.persist?.().catch(() => {});
  // 방금 적은 내역이 보이도록 그 달·그 날로 맞춘다
  state.ym = L.monthOf(date);
  state.day = date;
  if (keepOpen) {
    // 종류·카테고리·날짜는 그대로 두고 금액과 메모만 비운다 (영수증 여러 장을 이어 적을 때)
    e.amount = '';
    e.memo = '';
    $('#e-memo').value = '';
    paintAmount();
    render();
    return toast(`${won(amount)} 기록했어요. 이어서 적어 주세요`);
  }
  closeSheet();
  render();
  toast(e.id ? '고쳤어요' : '기록했어요');
}

async function entryDelete() {
  const e = sheet;
  if (e.mode === 'budget') {
    store.setBudget(0);
    closeSheet();
    return toast('예산을 없앴어요');
  }
  if (e.mode === 'goal') {
    store.setSaveGoal(0);
    closeSheet();
    return toast('저축 목표를 없앴어요');
  }
  if (e.mode === 'rule') {
    if (!(await ask({ title: '이 고정 내역을 지울까요?', body: '이미 기록된 내역은 그대로 남아요.', ok: '지우기', danger: true }))) return;
    store.deleteRule(e.id);
    closeSheet();
    return toast('고정 내역을 지웠어요');
  }
  const id = e.id;
  store.deleteTx(id);
  closeSheet();
  toast('지웠어요', { label: '되돌리기', fn: () => store.restoreTx(id) });
}

// ── 카테고리 시트 ──
const EMOJIS = ['🍚', '🍜', '🍺', '☕', '🛒', '🚌', '🚗', '⛽', '🏠', '📱', '💡', '🧴', '🛍️', '👕', '💄', '💊', '🏋️', '🎬', '🎮', '✈️', '📚', '👶', '🐶', '🎁', '💸', '🏦', '💳', '💰', '🧧', '💵', '📈', '💬'];

// 카테고리 목록 (설정에서 연다). 누르면 편집, 편집이 끝나면 이 목록으로 돌아온다
function catsHtml() {
  const type = sheet.type;
  const chips = store.cats(type).map((c) => `<button class="cat-chip" data-act="cat-edit" data-id="${esc(c.id)}"><span aria-hidden="true">${esc(c.emoji)}</span>${esc(c.name)}</button>`).join('');
  return `
    <div class="backdrop" data-act="close"></div>
    <section class="sheet form" role="dialog" aria-modal="true" aria-label="${TYPE_WORD[type]} 카테고리" tabindex="-1">
      <header class="sheet-head">
        <button class="icon-btn" data-act="close" aria-label="닫기">${xIcon}</button>
        <h2>${TYPE_WORD[type]} 카테고리</h2>
        <button class="text-btn go" data-act="cat-add" data-type="${type}">추가</button>
      </header>
      <p class="muted small">눌러서 이름과 아이콘을 바꿀 수 있어요.</p>
      <div class="chips">${chips}</div>
      <button class="primary" data-act="close">완료</button>
    </section>`;
}

function catHtml() {
  const c = sheet;
  const canDelete = c.id && store.cats(c.type).length > 1;
  return `
    <div class="backdrop" data-act="close"></div>
    <section class="sheet form" role="dialog" aria-modal="true" aria-label="카테고리" tabindex="-1">
      <header class="sheet-head">
        <button class="icon-btn" data-act="cat-back" aria-label="목록으로"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg></button>
        <h2>${c.id ? '카테고리 수정' : '새 카테고리'}</h2>
        ${canDelete ? '<button class="text-btn danger" data-act="c-delete">삭제</button>' : '<span class="head-pad"></span>'}
      </header>
      <label class="field"><span>이름</span><input type="text" id="c-name" value="${esc(c.name)}" maxlength="8" placeholder="예: 반려동물" autocomplete="off" enterkeyhint="done"></label>
      <div class="field"><span>아이콘</span>
        <div class="emoji-grid" role="group" aria-label="아이콘">${EMOJIS.map((em) => `<button data-act="c-emoji" data-e="${em}" class="${em === c.emoji ? 'on' : ''}" aria-pressed="${em === c.emoji}">${em}</button>`).join('')}</div>
      </div>
      <button class="primary" data-act="c-save">저장</button>
    </section>`;
}

function catSave() {
  const name = $('#c-name').value.trim();
  if (!name) return toast('이름을 적어 주세요');
  const type = sheet.type;
  store.saveCat({ id: sheet.id || undefined, type, name, emoji: sheet.emoji });
  openSheet({ kind: 'cats', type });
  toast('저장했어요');
}

async function catDelete() {
  const { id, type } = sheet;
  if (!(await ask({ title: '이 카테고리를 지울까요?', body: '이미 기록된 내역에는 이름이 그대로 남아요.', ok: '지우기', danger: true }))) return;
  store.deleteCat(id);
  openSheet({ kind: 'cats', type });
  toast('카테고리를 지웠어요');
}

// ── 가족 코드 ──
function codeHtml() {
  const code = formatCode(sync.status.code);
  return `
    <div class="backdrop" data-act="close"></div>
    <section class="sheet form" role="dialog" aria-modal="true" aria-label="가족 코드" tabindex="-1">
      <header class="sheet-head">
        <button class="icon-btn" data-act="close" aria-label="닫기">${xIcon}</button>
        <h2>가족 코드</h2><span class="head-pad"></span>
      </header>
      <p class="code-box" id="code-text">${esc(code)}</p>
      <p class="muted small">다른 폰의 가계부에서 설정 → 가족과 같이 쓰기 → <b>코드 입력하기</b>에 이 코드를 넣으면 연결됩니다.</p>
      <p class="muted small">이 코드를 아는 사람은 가계부를 보고 고칠 수 있어요. 비밀번호처럼 가족에게만 알려 주세요.</p>
      <div class="btn-pair">
        <button class="soft-btn" data-act="code-copy">코드 복사</button>
        ${navigator.share ? '<button class="soft-btn" data-act="code-share">보내기</button>' : ''}
      </div>
      <button class="primary" data-act="code-done">확인</button>
    </section>`;
}

// ── 내 이름: 이 기기에서 적은 내역에 붙는다 (기기마다 따로 정한다) ──
function nameHtml() {
  return `
    <div class="backdrop" data-act="close"></div>
    <section class="sheet form" role="dialog" aria-modal="true" aria-label="내 이름" tabindex="-1">
      <header class="sheet-head">
        <button class="icon-btn" data-act="${sheet.back ? 'name-back' : 'close'}" aria-label="닫기">${xIcon}</button>
        <h2>내 이름</h2><span class="head-pad"></span>
      </header>
      <label class="field"><span>이 폰에서 적는 내역에 표시할 이름</span>
        <input type="text" id="n-name" value="${esc(ui.me)}" maxlength="6" placeholder="예: 엄마" autocomplete="off" enterkeyhint="done">
      </label>
      <p class="muted small">가족이 같이 쓸 때 누가 적었는지 내역 옆에 보여요. 지금부터 적는 내역에 붙습니다.</p>
      <button class="primary" data-act="name-save">저장</button>
    </section>`;
}

function nameSave() {
  const back = sheet.back;
  ui.me = $('#n-name').value.trim().slice(0, 6);
  saveUi();
  if (back) openSheet(back); // 적던 내역으로 돌아간다
  else closeSheet();
  render();
  toast(ui.me ? `이제 '${ui.me}' 이름으로 적혀요` : '이름을 지웠어요');
}

function joinHtml() {
  return `
    <div class="backdrop" data-act="close"></div>
    <section class="sheet form" role="dialog" aria-modal="true" aria-label="가족 코드 입력" tabindex="-1">
      <header class="sheet-head">
        <button class="icon-btn" data-act="close" aria-label="닫기">${xIcon}</button>
        <h2>가족 코드 입력</h2><span class="head-pad"></span>
      </header>
      <label class="field"><span>가족에게 받은 코드 20자</span>
        <input type="text" id="j-code" class="code-input" placeholder="ABCDE-FGHJK-LMNPQ-RSTUV" maxlength="30" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done">
      </label>
      <p class="muted small">연결하면 이 기기에 있던 기록도 가족 가계부에 합쳐집니다.</p>
      <button class="primary" data-act="join-save" id="j-save">연결하기</button>
    </section>`;
}

async function syncCreate() {
  if (!(await ask({ title: '가족 코드를 만들까요?', body: '이 기기의 기록이 가족 가계부에 올라갑니다.', ok: '만들기' }))) return;
  toast('가족 코드를 만드는 중…');
  try {
    await sync.create();
    render();
    openSheet({ kind: 'code' });
    toast('가족 코드를 만들었어요');
  } catch (err) {
    toast(err.message || '만들지 못했어요', null, 4000);
  }
}

async function syncTap() {
  await sync.syncNow();
  const s = sync.status;
  toast(s.phase === 'idle' ? '가족 기기와 맞췄어요' : syncStatusText(), null, s.phase === 'idle' ? 0 : 4000);
}

async function syncJoin() {
  const btn = $('#j-save');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = '연결하는 중…';
  try {
    await sync.join($('#j-code').value);
    if (ui.me) closeSheet();
    else openSheet({ kind: 'name' }); // 이어서 이름을 정한다
    render();
    toast('가족 가계부에 연결했어요');
  } catch (err) {
    toast(err.message || '연결하지 못했어요', null, 4000);
    if ($('#j-save')) {
      btn.disabled = false;
      btn.textContent = '연결하기';
    }
  }
}

async function codeCopy() {
  const text = formatCode(sync.status.code);
  try {
    await navigator.clipboard.writeText(text);
    toast('코드를 복사했어요');
  } catch {
    // 복사가 막힌 브라우저에서는 글자를 선택해 직접 복사할 수 있게 한다
    const range = document.createRange();
    range.selectNodeContents($('#code-text'));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    toast('코드를 길게 눌러 복사해 주세요');
  }
}

// ── 설치 안내 ──
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installEvent = null;

function guideHtml() {
  const steps = isIOS()
    ? ['Safari 아래쪽의 <b>공유 버튼</b>(네모에서 화살표가 위로 나가는 모양)을 누릅니다.', '목록을 내려 <b>홈 화면에 추가</b>를 누릅니다.', '오른쪽 위 <b>추가</b>를 누르면 홈 화면에 가계부 아이콘이 생깁니다.']
    : ['브라우저 오른쪽 위 <b>메뉴(⋮)</b>를 누릅니다.', '<b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 누릅니다.', '<b>설치</b>를 누르면 홈 화면에 가계부 아이콘이 생깁니다.'];
  return `
    <div class="backdrop" data-act="close"></div>
    <section class="sheet form" role="dialog" aria-modal="true" aria-label="홈 화면에 설치" tabindex="-1">
      <header class="sheet-head">
        <button class="icon-btn" data-act="close" aria-label="닫기">${xIcon}</button>
        <h2>홈 화면에 설치</h2><span class="head-pad"></span>
      </header>
      <ol class="steps">${steps.map((s) => `<li>${s}</li>`).join('')}</ol>
      ${isIOS() ? '<p class="muted small">아이폰은 설치한 앱과 Safari가 기록을 따로 보관합니다. 설치한 뒤에는 홈 화면의 가계부에서만 기록하세요.</p>' : ''}
      <button class="primary" data-act="close">확인</button>
    </section>`;
}

async function install() {
  if (installEvent) {
    installEvent.prompt();
    await installEvent.userChoice.catch(() => {});
    installEvent = null;
    return;
  }
  openSheet({ kind: 'guide' });
}

// ── 백업 ──
async function exportBackup() {
  const name = `가계부-백업-${today}.json`;
  const file = new File([JSON.stringify(store.exportData())], name, { type: 'application/json' });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '가계부 백업' });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // 사용자가 공유 창을 닫음
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast('백업 파일을 저장했어요');
}

async function importBackup(file) {
  try {
    const n = store.importData(JSON.parse(await file.text()));
    store.applyRecurring(today);
    toast(n ? `내역 ${n}건을 가져왔어요` : '새로 가져올 내역이 없어요');
  } catch (err) {
    toast(err instanceof SyntaxError ? '파일을 읽을 수 없어요' : err.message);
  }
}

// ── 토스트 ──
let toastTimer = 0;
let toastFn = null;
function toast(msg, action, ms) {
  const el = $('#toast');
  toastFn = action?.fn || null;
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button data-act="toast-action">${esc(action.label)}</button>` : ''}`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms || (action ? 5000 : 2200));
}

// ───────── 이벤트 ─────────

function setMonth(ym) {
  state.ym = ym;
  state.day = ym === L.monthOf(today) ? today : null;
  render();
  $('#view').scrollTop = 0;
}

const actions = {
  prev: () => setMonth(L.addMonths(state.ym, -1)),
  next: () => setMonth(L.addMonths(state.ym, 1)),
  'this-month': () => setMonth(L.monthOf(today)),
  'goto-month': (el) => setMonth(el.dataset.ym),
  add: (el) => openEntry({ date: el.dataset.date || (state.tab === 'list' && ui.listMode === 'cal' && state.day?.startsWith(state.ym) ? state.day : null) }),
  edit: (el) => openEntry({ id: el.dataset.id }),
  budget: () => openEntry({ mode: 'budget' }),
  goal: () => openEntry({ mode: 'goal' }),
  'add-saving': () => openEntry({ type: 'saving' }),
  'rule-add': () => openEntry({ mode: 'rule' }),
  'rule-edit': (el) => openEntry({ mode: 'rule', id: el.dataset.id }),
  'go-list': () => {
    state.tab = 'list';
    render();
  },
  'list-mode': (el) => {
    ui.listMode = el.dataset.mode;
    saveUi();
    render();
  },
  day: (el) => {
    state.day = el.dataset.date;
    render();
  },
  'stats-type': (el) => {
    state.statsType = el.dataset.type;
    render();
  },
  close: () => closeSheet(),
  'e-type': (el) => {
    sheet.type = el.dataset.type;
    sheet.cat = defaultCat(sheet.type);
    for (const b of document.querySelectorAll('[data-act="e-type"]')) {
      const on = b.dataset.type === sheet.type;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    }
    paintCats();
    if (sheet.mode === 'rule') $('#e-memo').placeholder = ruleNameHint(sheet.type);
  },
  'e-cat': (el) => {
    sheet.cat = el.dataset.id;
    paintCats();
  },
  'e-key': (el) => entryKey(el.dataset.k),
  'e-add': (el) => {
    sheet.amount = String(Math.min(Number(sheet.amount || 0) + Number(el.dataset.n), MAX_AMOUNT));
    paintAmount();
  },
  'e-save': () => entrySave(),
  'e-save-more': () => entrySave(true),
  'find-open': () => {
    state.finding = true;
    render();
    focusFind();
  },
  'find-close': () => {
    Object.assign(state, { finding: false, q: '', filterCat: null, allTime: false });
    render();
  },
  'filter-clear': () => {
    state.filterCat = null;
    render();
  },
  'find-scope': () => {
    state.allTime = !state.allTime;
    render();
    $('#view').scrollTop = 0;
  },
  // 통계에서 카테고리를 누르면 그 달 그 카테고리 내역을 보여 준다
  'cat-drill': (el) => {
    Object.assign(state, { tab: 'list', finding: true, q: '', filterCat: el.dataset.cat, allTime: false });
    render();
    $('#view').scrollTop = 0;
  },
  'font-scale': (el) => {
    ui.fontScale = Number(el.dataset.v);
    saveUi();
    applyFontScale();
    render();
  },
  'e-delete': entryDelete,
  'cat-add': (el) => openSheet({ kind: 'cat', id: null, type: el.dataset.type, name: '', emoji: { income: '💵', saving: '🏦' }[el.dataset.type] || '💸' }),
  'cat-edit': (el) => {
    const c = store.cat(el.dataset.id);
    openSheet({ kind: 'cat', id: c.id, type: c.type, name: c.name, emoji: c.emoji });
  },
  'cats-open': (el) => openSheet({ kind: 'cats', type: el.dataset.type }),
  'cat-back': () => openSheet({ kind: 'cats', type: sheet.type }),
  'c-emoji': (el) => {
    sheet.emoji = el.dataset.e;
    for (const b of document.querySelectorAll('[data-act="c-emoji"]')) {
      const on = b.dataset.e === sheet.emoji;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    }
  },
  'c-save': catSave,
  'c-delete': catDelete,
  install,
  'install-hide': () => {
    ui.installHidden = true;
    saveUi();
    render();
  },
  export: exportBackup,
  import: () => $('#import-file').click(),
  clear: async () => {
    const linked = sync.status.linked;
    const q = linked
      ? { title: '이 기기의 기록을 모두 지우고 가족 연결도 끊을까요?', body: '다른 기기의 기록은 그대로 남아요.' }
      : { title: '모든 기록을 지울까요?', body: '내역·예산·고정 내역·카테고리가 모두 사라지고 되돌릴 수 없어요.' };
    if (!(await ask({ ...q, ok: '지우기', danger: true }))) return;
    if (linked) sync.unlink(); // 먼저 끊어야 '지움'이 다른 기기로 퍼지지 않는다
    store.clearAll();
    toast(linked ? '이 기기의 기록을 지우고 연결을 끊었어요' : '모든 기록을 지웠어요');
  },
  'sync-create': syncCreate,
  'sync-join': () => openSheet({ kind: 'join' }),
  'join-save': syncJoin,
  'sync-code': () => openSheet({ kind: 'code' }),
  'code-copy': codeCopy,
  'code-share': () => navigator.share({ text: `가계부 가족 코드: ${formatCode(sync.status.code)}` }).catch(() => {}),
  'sync-now': syncTap,
  'sync-tap': syncTap,
  'code-done': () => {
    if (ui.me) closeSheet();
    else openSheet({ kind: 'name' }); // 코드를 만든 직후에는 이어서 이름을 정한다
  },
  'name-edit': () => openSheet({ kind: 'name' }),
  'name-back': () => openSheet(sheet.back),
  // 내역을 적다가 이름을 바꾼다 — 적던 금액·메모·날짜는 그대로 들고 갔다가 돌아온다
  'e-who': () => {
    const e = sheet;
    e.memo = $('#e-memo').value;
    e.date = $('#e-date').value || e.date;
    openSheet({ kind: 'name', back: e });
  },
  'name-save': nameSave,
  'dlg-yes': () => closeDialog(true),
  'dlg-no': () => closeDialog(false),
  'sync-unlink': async () => {
    if (!(await ask({ title: '이 기기의 가족 연결을 끊을까요?', body: '기록은 이 기기에 그대로 남고, 더 이상 맞춰지지 않아요.', ok: '끊기', danger: true }))) return;
    sync.unlink();
    render();
    toast('연결을 끊었어요');
  },
  'toast-action': () => {
    toastFn?.();
    toastFn = null;
    $('#toast').classList.remove('show');
  },
};

document.addEventListener('click', (ev) => {
  const tab = ev.target.closest('[data-tab]');
  if (tab) {
    state.tab = tab.dataset.tab;
    render();
    $('#view').scrollTop = 0;
    return;
  }
  const el = ev.target.closest('[data-act]');
  if (el) actions[el.dataset.act]?.(el);
});

// 차트 막대는 키보드로도 누를 수 있게
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && dialog) return closeDialog(false);
  if (ev.key === 'Escape' && sheet) return closeSheet();
  if (ev.key === 'Enter' && ev.target.matches?.('#n-name')) return nameSave();
  if (ev.key === 'Enter' && ev.target.matches?.('#q')) return ev.target.blur(); // 화면 키보드를 내린다
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches?.('g[data-act]')) {
    ev.preventDefault();
    actions[ev.target.dataset.act]?.(ev.target);
  }
  if (ev.key === 'Enter' && ev.target.matches?.('#e-memo, #c-name')) ev.target.blur();
  if (ev.key === 'Enter' && ev.target.matches?.('#j-code')) syncJoin();
});

// 글자를 치는 동안에는 숫자판을 접어 화면 키보드에 자리를 내준다
document.addEventListener('focusin', (ev) => {
  if (!ev.target.matches?.('.sheet input[type="text"]')) return;
  $('#sheet .sheet')?.classList.add('typing');
  paintCatsMore();
});
document.addEventListener('focusout', (ev) => {
  if (!ev.target.matches?.('.sheet input[type="text"]')) return;
  $('#sheet .sheet')?.classList.remove('typing');
  paintCatsMore();
});
// scroll 은 위로 전달되지 않아서 capture 로 받는다
document.addEventListener('scroll', (ev) => {
  if (ev.target.id === 'e-cats') paintCatsMore();
}, true);
window.addEventListener('resize', paintCatsMore);

// 찾는 말을 칠 때마다 결과만 다시 그린다
document.addEventListener('input', (ev) => {
  if (ev.target.id !== 'q') return;
  state.q = ev.target.value;
  $('#list-body').innerHTML = listBody();
});

$('#import-file').addEventListener('change', (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (file) importBackup(file);
});

// 뒤로 가기(안드로이드 버튼 포함)는 확인 창 → 시트 순서로 닫는다
window.addEventListener('popstate', () => {
  if (afterPop) return afterPop(); // 확인 창을 닫으며 우리가 부른 뒤로 가기
  if (dialog) {
    closeDialog(false, true);
    if (sheet) history.pushState({ sheet: true }, ''); // 방금 빠진 것은 시트 몫이었으니 다시 채운다
    return;
  }
  closeSheet(true);
});

window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  installEvent = ev;
});
window.addEventListener('appinstalled', () => {
  installEvent = null;
  render();
});

// 아이폰은 화면 키보드가 올라와도 화면 높이가 줄지 않아서, 시트를 키보드 위로 직접 올린다
if (window.visualViewport) {
  const vv = window.visualViewport;
  const sync = () => document.documentElement.style.setProperty('--kb', `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`);
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
}

// 다시 열었을 때 날짜가 바뀌었으면 맞추고, 도래한 고정 내역을 기록한다
function refreshDay() {
  const now = L.dateStr();
  if (now !== today) {
    const wasCurrent = state.ym === L.monthOf(today);
    today = now;
    if (wasCurrent) {
      state.ym = L.monthOf(today);
      state.day = today;
    }
  }
  if (!store.applyRecurring(today)) render();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (!sheet) refreshDay();
  sync.request(0);
});

// 동기화: 열 때, 다시 볼 때, 인터넷이 돌아올 때, 그리고 보고 있는 동안 30초마다 맞춘다
window.addEventListener('online', () => sync.request(0));
setInterval(() => {
  if (!document.hidden && navigator.onLine !== false) sync.request(0);
}, 30000);
sync.subscribe(() => {
  const el = $('#sync-status');
  if (el) el.textContent = syncStatusText();
  renderTop();
});

// 옆으로 밀어서 달 넘기기 (왼쪽으로 밀면 다음 달). 화면 가장자리에서 시작한 것은 기기의 뒤로 가기 동작이라 무시한다
(() => {
  const view = $('#view');
  let from = null;
  view.addEventListener('touchstart', (ev) => {
    const t = ev.touches[0];
    const ok = ev.touches.length === 1 && state.tab !== 'settings' && !sheet && !dialog && t.clientX > 24 && t.clientX < window.innerWidth - 24 && !ev.target.closest('input');
    from = ok ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
  }, { passive: true });
  view.addEventListener('touchend', (ev) => {
    if (!from) return;
    const t = ev.changedTouches[0];
    const dx = t.clientX - from.x;
    const dy = t.clientY - from.y;
    const quick = Date.now() - from.at < 700;
    from = null;
    if (!quick || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return;
    const dir = dx < 0 ? 1 : -1;
    setMonth(L.addMonths(state.ym, dir));
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      view.animate([{ transform: `translateX(${dir * 28}px)`, opacity: 0.3 }, { transform: 'none', opacity: 1 }], { duration: 170, easing: 'ease-out' });
    }
  }, { passive: true });
  view.addEventListener('touchcancel', () => {
    from = null;
  });
})();

// 당겨서 맞추기: 맨 위에서 아래로 당겼다 놓으면 가족 기기와 맞춘다 (연결된 경우만)
(() => {
  const view = $('#view');
  const ptr = $('#ptr');
  const NEED = 64;
  let startY = null;
  let pull = 0;
  const paint = () => {
    ptr.style.opacity = Math.min(pull / NEED, 1);
    ptr.style.transform = `translate(-50%, ${Math.round(pull * 0.6 - 20)}px)`;
    ptr.textContent = pull >= NEED ? '놓으면 맞춰요' : '당겨서 맞추기';
  };
  view.addEventListener('touchstart', (ev) => {
    const ok = !sheet && !dialog && sync.status.linked && view.scrollTop <= 0 && ev.touches.length === 1;
    startY = ok ? ev.touches[0].clientY : null;
    pull = 0;
  }, { passive: true });
  view.addEventListener('touchmove', (ev) => {
    if (startY === null) return;
    const dy = ev.touches[0].clientY - startY;
    pull = dy > 0 && view.scrollTop <= 0 ? Math.min(dy * 0.5, 90) : 0;
    paint();
  }, { passive: true });
  const end = async () => {
    if (startY === null) return;
    const go = pull >= NEED;
    startY = null;
    if (go) {
      ptr.textContent = '맞추는 중…';
      await syncTap();
      if (!sheet) refreshDay();
    }
    pull = 0;
    paint();
  };
  view.addEventListener('touchend', end);
  view.addEventListener('touchcancel', end);
})();
sync.request(300);

store.subscribe((ok) => {
  render();
  if (!ok) toast('저장 공간이 부족해 기록을 저장하지 못했어요');
});

applyFontScale();
if (history.state?.sheet) history.replaceState(null, ''); // 새로 고침으로 남은 시트 흔적 정리
refreshDay();

// 가족과 연결했는데 이 기기 이름이 없으면 한 번만 물어본다 (이름이 있어야 누가 적었는지 보인다)
if (sync.status.linked && !ui.me && !ui.nameAsked) {
  ui.nameAsked = true;
  saveUi();
  openSheet({ kind: 'name' });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
