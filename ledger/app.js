// 가계부 화면
import * as L from './logic.js';
import { createStore } from './store.js';

const store = createStore();
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const MAX_AMOUNT = 999999999;

const UI_KEY = 'ledger.ui';
const ui = { listMode: 'cal', lastCat: {}, installHidden: false, ...readJson(UI_KEY) };
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
const state = { tab: 'home', ym: L.monthOf(today), day: today, statsType: 'expense' };

const won = L.formatWon;
const monthLabel = (ym) => `${Number(ym.slice(5, 7))}월`;
const dayLabel = (date) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 ${WEEK[L.weekdayOf(date)]}요일`;
const amountHtml = (t) =>
  t.type === 'income' ? `<span class="amt income">+${won(t.amount)}</span>` : `<span class="amt">${won(t.amount)}</span>`;

// ───────── 화면 그리기 ─────────

function render() {
  for (const b of document.querySelectorAll('.tab')) {
    const on = b.dataset.tab === state.tab;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  renderTop();
  $('#view').innerHTML = { home: viewHome, list: viewList, stats: viewStats, settings: viewSettings }[state.tab]();
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
    ${state.ym !== L.monthOf(today) ? '<button class="chip" data-act="this-month">이번 달로</button>' : ''}`;
}

function txRow(t, { showDate = false } = {}) {
  const c = store.cat(t.cat);
  const sub = [t.memo ? c.name : '', showDate ? `${Number(t.date.slice(5, 7))}월 ${Number(t.date.slice(8, 10))}일` : '', t.ruleId ? '고정' : '']
    .filter(Boolean)
    .join(' · ');
  return `
    <button class="row" data-act="edit" data-id="${esc(t.id)}">
      <span class="emo" aria-hidden="true">${esc(c.emoji)}</span>
      <span class="row-main"><b>${esc(t.memo || c.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
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
        <p class="label">${m} 수입 − 지출</p>
        <p class="big${sum.balance < 0 ? ' neg' : ''}">${won(sum.balance)}</p>
        <button class="soft-btn" data-act="budget">월 예산 정하기</button>
        <p class="note">예산을 정하면 하루에 쓸 수 있는 돈을 알려드려요.</p>
      </section>`;
  } else {
    const pct = Math.round((b.spent / b.budget) * 100);
    let label = `${m} 남은 예산`;
    let note = '';
    if (b.over) {
      label = `${m} 예산 초과`;
      note = `예산보다 <b>${won(-b.remaining)}</b> 더 썼어요.`;
    } else if (b.phase === 'current') {
      note = `하루 <b>${won(b.perDay)}</b>씩 쓸 수 있어요 · ${b.daysLeft}일 남음`;
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

// ── 내역 ──
function viewList() {
  const txs = L.monthTx(store.txs, state.ym);
  const sum = L.summarize(txs);
  const groups = L.byDay(txs);
  const head = `
    <div class="list-head">
      <div class="seg" role="group" aria-label="보기 방식">
        <button data-act="list-mode" data-mode="cal" class="${ui.listMode === 'cal' ? 'on' : ''}" aria-pressed="${ui.listMode === 'cal'}">달력</button>
        <button data-act="list-mode" data-mode="list" class="${ui.listMode === 'list' ? 'on' : ''}" aria-pressed="${ui.listMode === 'list'}">목록</button>
      </div>
      <p class="sum-line"><span>수입 <b class="income">+${won(sum.income)}</b></span><span>지출 <b>${won(sum.expense)}</b></span></p>
    </div>`;

  if (ui.listMode === 'list') {
    if (!groups.length) return head + `<section class="card">${emptyBox(`${monthLabel(state.ym)} 내역이 없어요`, '아래 ＋ 버튼으로 기록해 보세요.')}</section>`;
    return head + groups.map((g) => `
      <section class="card">
        <div class="day-head"><h2>${Number(g.date.slice(8, 10))}일 ${WEEK[L.weekdayOf(g.date)]}요일</h2><span>${dayTotals(g)}</span></div>
        <div class="rows">${g.items.map((t) => txRow(t)).join('')}</div>
      </section>`).join('');
  }

  const map = new Map(groups.map((g) => [g.date, g]));
  const cells = [];
  for (let i = 0; i < L.firstWeekday(state.ym); i++) cells.push('<span class="day blank"></span>');
  for (let d = 1; d <= L.daysInMonth(state.ym); d++) {
    const date = `${state.ym}-${L.pad2(d)}`;
    const g = map.get(date);
    const wd = L.weekdayOf(date);
    const cls = ['day', date === state.day ? 'sel' : '', date === today ? 'today' : '', wd === 0 ? 'sun' : '', wd === 6 ? 'sat' : ''].filter(Boolean).join(' ');
    const aria = `${dayLabel(date)}${g ? `, 수입 ${won(g.income)}, 지출 ${won(g.expense)}` : ''}`;
    cells.push(`
      <button class="${cls}" data-act="day" data-date="${date}" aria-label="${aria}" aria-pressed="${date === state.day}">
        <i>${d}</i>
        ${g && g.income ? `<em class="in">+${L.compactNum(g.income)}</em>` : ''}
        ${g && g.expense ? `<em>${L.compactNum(g.expense)}</em>` : ''}
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

  return `${head}
    <section class="card cal">
      <div class="cal-week" aria-hidden="true">${WEEK.map((w, i) => `<span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</span>`).join('')}</div>
      <div class="cal-grid">${cells.join('')}</div>
    </section>
    ${panel}`;
}

function dayTotals(g) {
  return [g.income ? `<b class="income">+${won(g.income)}</b>` : '', g.expense ? `<b>${won(g.expense)}</b>` : ''].filter(Boolean).join(' ');
}

// ── 통계 ──
function viewStats() {
  const type = state.statsType;
  const word = type === 'income' ? '수입' : '지출';
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
  }

  const top = rows[0]?.total || 1;
  const catList = rows.length ? `
    <ol class="crows">${rows.map((r) => {
      const c = store.cat(r.cat);
      return `
      <li class="crow">
        <span class="emo" aria-hidden="true">${esc(c.emoji)}</span>
        <div class="crow-main">
          <div class="crow-top"><b>${esc(c.name)}</b><span class="pct">${Math.round(r.share * 100)}%</span><span class="amt">${won(r.total)}</span></div>
          <div class="bar"><i style="width:${Math.max((r.total / top) * 100, 1.5).toFixed(1)}%"></i></div>
        </div>
      </li>`;
    }).join('')}</ol>` : emptyBox(`${m} ${word} 내역이 없어요`, '기록이 쌓이면 어디에 많이 썼는지 보여드려요.');

  // 추이는 보통 '이번 달까지 6개월'. 더 옛날/앞날을 보고 있으면 그 달이 들어오게 옮긴다
  const cur = L.monthOf(today);
  const end = state.ym > cur || state.ym < L.addMonths(cur, -5) ? state.ym : cur;
  const trend = L.monthlyTrend(store.txs, end, 6);

  return `
    <div class="list-head">
      <div class="seg" role="group" aria-label="통계 종류">
        <button data-act="stats-type" data-type="expense" class="${type === 'expense' ? 'on' : ''}" aria-pressed="${type === 'expense'}">지출</button>
        <button data-act="stats-type" data-type="income" class="${type === 'income' ? 'on' : ''}" aria-pressed="${type === 'income'}">수입</button>
      </div>
    </div>
    <section class="card hero">
      <p class="label">${m} ${word}</p>
      <p class="big">${won(total)}</p>
      ${cmpLine ? `<p class="note">${cmpLine}</p>` : ''}
    </section>
    <section class="card">
      <div class="card-head"><h2>카테고리별 ${word}</h2></div>
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
  const catChips = (type) => store.cats(type).map((c) => `<button class="cat-chip" data-act="cat-edit" data-id="${esc(c.id)}"><span aria-hidden="true">${esc(c.emoji)}</span>${esc(c.name)}</button>`).join('');
  return `
    <section class="card">
      <div class="card-head"><h2>예산</h2></div>
      <button class="set-row" data-act="budget"><span>월 예산</span><span class="set-val">${store.budget ? won(store.budget) : '정하지 않음'}</span></button>
    </section>

    <section class="card">
      <div class="card-head"><h2>고정 내역</h2><button class="link-btn" data-act="rule-add">추가</button></div>
      <p class="muted small pad-b">월세·통신비·월급처럼 매달 같은 날 생기는 돈을 등록하면 그날 자동으로 기록돼요.</p>
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
      <div class="card-head"><h2>지출 카테고리</h2><button class="link-btn" data-act="cat-add" data-type="expense">추가</button></div>
      <div class="chips">${catChips('expense')}</div>
      <div class="card-head gap"><h2>수입 카테고리</h2><button class="link-btn" data-act="cat-add" data-type="income">추가</button></div>
      <div class="chips">${catChips('income')}</div>
    </section>

    <section class="card">
      <div class="card-head"><h2>가족과 같이 쓰기</h2><span class="badge">준비 중</span></div>
      <p class="muted small">로그인해서 여러 기기·가족이 같은 가계부를 보는 기능은 다음 단계에서 붙습니다. 지금 기록은 이 기기에만 저장돼요.</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>앱과 백업</h2></div>
      ${isStandalone() ? '' : '<button class="set-row" data-act="install"><span>홈 화면에 설치</span><span class="set-val">방법 보기</span></button>'}
      <button class="set-row" data-act="export"><span>백업 파일 내보내기</span><span class="set-val">${store.txs.filter((t) => !t.deleted).length}건</span></button>
      <button class="set-row" data-act="import"><span>백업 파일 가져오기</span><span class="set-val">합치기</span></button>
      <button class="set-row danger" data-act="clear"><span>모든 기록 지우기</span></button>
    </section>
    <p class="muted center small">가계부 · 기록은 이 기기에만 저장됩니다</p>`;
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

function sheetHtml() {
  if (sheet.kind === 'entry') return entryHtml();
  if (sheet.kind === 'cat') return catHtml();
  return guideHtml();
}

// ── 금액 입력 시트: 내역(tx) · 고정 내역(rule) · 예산(budget) 공용 ──
function openEntry({ mode = 'tx', id = null, date = null } = {}) {
  const e = { kind: 'entry', mode, id, type: 'expense', amount: '', cat: null, date: date || today, memo: '', day: Number(today.slice(8, 10)) };
  if (mode === 'budget') {
    e.amount = store.budget ? String(store.budget) : '';
  } else if (id) {
    const src = mode === 'rule' ? store.rule(id) : store.tx(id);
    if (!src) return;
    Object.assign(e, { type: src.type, amount: String(src.amount), cat: src.cat, memo: src.memo || '' });
    if (mode === 'rule') e.day = src.day;
    else e.date = src.date;
  }
  if (mode !== 'budget' && !e.cat) e.cat = defaultCat(e.type);
  openSheet(e);
}

function defaultCat(type) {
  const cats = store.cats(type);
  return (cats.find((c) => c.id === ui.lastCat[type]) || cats[0])?.id || null;
}

function entryHtml() {
  const e = sheet;
  const title = e.mode === 'budget' ? '월 예산' : e.mode === 'rule' ? '고정 내역' : e.id ? '내역 수정' : '내역 추가';
  const canDelete = e.mode === 'budget' ? store.budget > 0 : !!e.id;
  const seg = `
    <div class="seg" role="group" aria-label="종류">
      <button data-act="e-type" data-type="expense" class="${e.type === 'expense' ? 'on' : ''}" aria-pressed="${e.type === 'expense'}">지출</button>
      <button data-act="e-type" data-type="income" class="${e.type === 'income' ? 'on' : ''}" aria-pressed="${e.type === 'income'}">수입</button>
    </div>`;
  const fields = e.mode === 'tx' ? `
    <div class="fields">
      <input type="date" id="e-date" value="${esc(e.date)}" aria-label="날짜" required>
      <input type="text" id="e-memo" value="${esc(e.memo)}" placeholder="메모 (선택)" maxlength="40" aria-label="메모" autocomplete="off" enterkeyhint="done">
    </div>` : e.mode === 'rule' ? `
    <div class="fields">
      <select id="e-day" aria-label="매달 기록할 날">${Array.from({ length: 31 }, (_, i) => i + 1).map((d) => `<option value="${d}"${d === e.day ? ' selected' : ''}>매달 ${d === 31 ? '말일' : `${d}일`}</option>`).join('')}</select>
      <input type="text" id="e-memo" value="${esc(e.memo)}" placeholder="이름 (예: 월세)" maxlength="40" aria-label="이름" autocomplete="off" enterkeyhint="done">
    </div>` : '';
  const quick = [[1000, '+1천'], [10000, '+1만'], [50000, '+5만'], [100000, '+10만']];
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'back'];
  return `
    <div class="backdrop" data-act="close"></div>
    <section class="sheet entry mode-${e.mode}" role="dialog" aria-modal="true" aria-label="${title}" tabindex="-1">
      <header class="sheet-head">
        <button class="icon-btn" data-act="close" aria-label="닫기">${xIcon}</button>
        ${e.mode === 'budget' ? `<h2>${title}</h2>` : seg}
        ${canDelete ? `<button class="text-btn danger" data-act="e-delete">${e.mode === 'budget' ? '없애기' : '삭제'}</button>` : '<span class="head-pad"></span>'}
      </header>
      ${e.mode === 'rule' ? '<p class="sheet-hint">매달 정한 날에 자동으로 기록돼요.</p>' : ''}
      ${e.mode === 'budget' ? '<p class="sheet-hint">한 달에 쓸 돈을 정해 두면 남은 예산을 알려드려요.</p>' : ''}
      <div class="amount" id="e-amount" aria-live="polite"></div>
      ${e.mode === 'budget' ? '' : '<div class="cats" id="e-cats" role="group" aria-label="카테고리"></div>'}
      ${fields}
      <div class="quick">${quick.map(([n, t]) => `<button data-act="e-add" data-n="${n}">${t}</button>`).join('')}</div>
      <div class="keypad">${keys.map((k) => k === 'back'
        ? '<button data-act="e-key" data-k="back" aria-label="지우기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5-6zM12 10l4 4M16 10l-4 4"/></svg></button>'
        : `<button data-act="e-key" data-k="${k}">${k}</button>`).join('')}</div>
      <button class="primary" data-act="e-save" id="e-save">저장</button>
    </section>`;
}

function paintAmount() {
  const n = Number(sheet.amount || 0);
  $('#e-amount').innerHTML = `
    <p class="amount-num${n ? '' : ' zero'}"><span>${L.formatNum(n)}</span>원</p>
    <p class="amount-read">${L.koreanAmount(n) || '&nbsp;'}</p>`;
  $('#e-save').disabled = n <= 0;
}

function paintCats() {
  const box = $('#e-cats');
  if (!box) return;
  box.innerHTML = store.cats(sheet.type).map((c) => `
    <button class="cat${c.id === sheet.cat ? ' on' : ''}" data-act="e-cat" data-id="${esc(c.id)}" aria-pressed="${c.id === sheet.cat}">
      <span class="cat-emo" aria-hidden="true">${esc(c.emoji)}</span><span class="cat-name">${esc(c.name)}</span>
    </button>`).join('');
}

function entryKey(k) {
  let a = sheet.amount;
  if (k === 'back') a = a.slice(0, -1);
  else a = String(Math.min(Number(a + k), MAX_AMOUNT));
  sheet.amount = a === '0' ? '' : a;
  paintAmount();
}

function entrySave() {
  const e = sheet;
  const amount = Number(e.amount || 0);
  if (amount <= 0) return;
  if (e.mode === 'budget') {
    store.setBudget(amount);
    closeSheet();
    toast('예산을 정했어요');
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
  store.saveTx({ id: e.id || undefined, type: e.type, amount, cat: e.cat, date, memo });
  navigator.storage?.persist?.().catch(() => {});
  // 방금 적은 내역이 보이도록 그 달·그 날로 맞춘다
  state.ym = L.monthOf(date);
  state.day = date;
  closeSheet();
  render();
  toast(e.id ? '고쳤어요' : '기록했어요');
}

function entryDelete() {
  const e = sheet;
  if (e.mode === 'budget') {
    store.setBudget(0);
    closeSheet();
    return toast('예산을 없앴어요');
  }
  if (e.mode === 'rule') {
    if (!confirm('이 고정 내역을 지울까요?\n이미 기록된 내역은 그대로 남아요.')) return;
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

function catHtml() {
  const c = sheet;
  const canDelete = c.id && store.cats(c.type).length > 1;
  return `
    <div class="backdrop" data-act="close"></div>
    <section class="sheet form" role="dialog" aria-modal="true" aria-label="카테고리" tabindex="-1">
      <header class="sheet-head">
        <button class="icon-btn" data-act="close" aria-label="닫기">${xIcon}</button>
        <h2>${c.type === 'income' ? '수입' : '지출'} 카테고리</h2>
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
  store.saveCat({ id: sheet.id || undefined, type: sheet.type, name, emoji: sheet.emoji });
  closeSheet();
  toast('저장했어요');
}

function catDelete() {
  if (!confirm('이 카테고리를 지울까요?\n이미 기록된 내역에는 이름이 그대로 남아요.')) return;
  store.deleteCat(sheet.id);
  closeSheet();
  toast('카테고리를 지웠어요');
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
function toast(msg, action) {
  const el = $('#toast');
  toastFn = action?.fn || null;
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button data-act="toast-action">${esc(action.label)}</button>` : ''}`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2200);
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
  'e-save': entrySave,
  'e-delete': entryDelete,
  'cat-add': (el) => openSheet({ kind: 'cat', id: null, type: el.dataset.type, name: '', emoji: el.dataset.type === 'income' ? '💵' : '💸' }),
  'cat-edit': (el) => {
    const c = store.cat(el.dataset.id);
    openSheet({ kind: 'cat', id: c.id, type: c.type, name: c.name, emoji: c.emoji });
  },
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
  clear: () => {
    if (!confirm('모든 기록을 지울까요?\n내역·예산·고정 내역·카테고리가 모두 사라지고 되돌릴 수 없어요.')) return;
    store.clearAll();
    toast('모든 기록을 지웠어요');
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
  if (ev.key === 'Escape' && sheet) return closeSheet();
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches?.('g[data-act]')) {
    ev.preventDefault();
    actions[ev.target.dataset.act]?.(ev.target);
  }
  if (ev.key === 'Enter' && ev.target.matches?.('#e-memo, #c-name')) ev.target.blur();
});

// 글자를 치는 동안에는 숫자판을 접어 화면 키보드에 자리를 내준다
document.addEventListener('focusin', (ev) => {
  if (ev.target.matches?.('.sheet input[type="text"]')) $('#sheet .sheet')?.classList.add('typing');
});
document.addEventListener('focusout', (ev) => {
  if (ev.target.matches?.('.sheet input[type="text"]')) $('#sheet .sheet')?.classList.remove('typing');
});

$('#import-file').addEventListener('change', (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (file) importBackup(file);
});

// 뒤로 가기(안드로이드 버튼 포함)는 열린 시트를 닫는다
window.addEventListener('popstate', () => closeSheet(true));

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
  if (!document.hidden && !sheet) refreshDay();
});

store.subscribe((ok) => {
  render();
  if (!ok) toast('저장 공간이 부족해 기록을 저장하지 못했어요');
});

if (history.state?.sheet) history.replaceState(null, ''); // 새로 고침으로 남은 시트 흔적 정리
refreshDay();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
