/* 섯다 온라인 — UI + 호스트/클라이언트 흐름
 * 호스트: SeotdaEngine.Game 을 갖고, 매 변화마다 각 플레이어에게 '그 사람 시점의 뷰'만 보낸다 (남의 패는 절대 전송 안 함).
 * 클라이언트: 뷰를 받아 그리고, 행동만 보낸다.
 */
(() => {
  const $ = id => document.getElementById(id);
  const R = SeotdaRules, E = SeotdaEngine, N = SeotdaNet;
  const LS = { name: 'seotda_name', token: 'seotda_token', mute: 'seotda_mute' };

  /* 내 고정 토큰 — 새로고침·재접속해도 같은 자리로 돌아온다 */
  let token = localStorage.getItem(LS.token);
  if (!token) { token = 'u' + N.makeCode(10).toLowerCase(); localStorage.setItem(LS.token, token); }

  let role = null, host = null, client = null, game = null;
  let myId = null, code = null, myName = '';
  let view = null, inSettings = false;
  let hostTimer = null, localDeadline = 0;
  let chatLines = [], resultHand = 0;
  let lastCardKey = {};   // 카드 애니메이션용: pid → "count:shown"
  let muted = localStorage.getItem(LS.mute) === '1';

  /* ── 소리 (합성) ── */
  const Snd = (() => {
    let ctx = null;
    function tone(freq, dur, type, peak, slide) {
      if (muted) return;
      try {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak || 0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.05);
      } catch (e) { }
    }
    return {
      deal: () => tone(300, 0.08, 'triangle', 0.06, 520),
      turn: () => { tone(660, 0.12, 'sine', 0.12); setTimeout(() => tone(880, 0.16, 'sine', 0.12), 120); },
      chip: () => tone(1400, 0.05, 'square', 0.04),
      win: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'triangle', 0.1), i * 90)); },
      lose: () => tone(220, 0.35, 'sawtooth', 0.06, 110),
    };
  })();

  /* ── 화면 ── */
  function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id)); }
  let toastT = null;
  function toast(msg, ms) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms || 1800); }
  const fmt = n => (n || 0).toLocaleString('ko-KR');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ── 카드 ── */
  const MOTIF = { 1: '🌲', 2: '🐦', 3: '🌸', 4: '🌿', 5: '🌉', 6: '🦋', 7: '🐗', 8: '🌕', 9: '🍶', 10: '🦌' };
  function cardHtml(id, big, anim) {
    const c = R.cardById(id);
    const k = c.k === '광' ? ['gwang', '광'] : c.k === '띠' ? ['tti', '띠'] : ['yeol', '열끗'];
    return `<div class="card ${big ? 'big' : ''} ${anim || ''}" title="${c.m}월 ${c.name} ${k[1]}"><span class="m">${c.m}</span><div class="motif">${MOTIF[c.m]}</div><div class="k ${k[0]}">${k[1]}</div></div>`;
  }
  function backHtml(big, anim) { return `<div class="card back ${big ? 'big' : ''} ${anim || ''}"></div>`; }
  function cardsHtml(p, big) {
    const key = `${p.cardCount}:${p.cards ? 1 : 0}`;
    const prev = lastCardKey[p.id] || '0:0';
    lastCardKey[p.id] = key;
    const [pc, ps] = prev.split(':').map(Number);
    const newCount = p.cardCount > pc;
    const justShown = p.cards && !ps && pc > 0;
    let s = '';
    for (let i = 0; i < p.cardCount; i++) {
      const isNew = newCount && i >= pc;
      if (p.cards) s += cardHtml(p.cards[i], big, isNew ? 'deal' : justShown ? 'flip' : '');
      else s += backHtml(big, isNew ? 'deal' : '');
    }
    return s;
  }

  /* ── 공통 명령 (호스트면 직접, 클라이언트면 전송) ── */
  function doAction(type) { if (role === 'host') game.act(myId, type); else client.send({ t: 'act', type }); }
  function doRebuy() { if (role === 'host') game.rebuy(myId); else client.send({ t: 'rebuy' }); }
  function doChat(text) {
    text = text.trim().slice(0, 60); if (!text) return;
    if (role === 'host') hostChat(myName, text); else client.send({ t: 'chat', text });
  }
  function doStart() { if (role !== 'host') return; inSettings = false; if (!game.startHand()) toast('2명 이상 있어야 시작할 수 있어요'); }

  /* ── 호스트 ── */
  function withTimer(v) {
    const s = v.settings;
    v.turnLeft = (v.phase === 'betting' && v.turn && s.turnSec > 0) ? Math.max(0, v.turnAt + s.turnSec * 1000 - Date.now()) : null;
    return v;
  }
  function hostBroadcast() {
    for (const p of game.players) if (p.id !== myId && p.connected) host.send(p.id, { t: 'state', view: withTimer(game.view(p.id)) });
    receiveView(withTimer(game.view(myId)));
    scheduleHostTimer();
  }
  function scheduleHostTimer() {
    clearTimeout(hostTimer);
    const h = game.hand; const s = game.settings;
    if (game.phase !== 'betting' || !h || !h.turn || !s.turnSec) return;
    const turn = h.turn, at = h.turnAt;
    const left = at + s.turnSec * 1000 - Date.now();
    hostTimer = setTimeout(() => { if (game.phase === 'betting' && game.hand === h && h.turn === turn && h.turnAt === at) game.autoAct(turn); }, left + 300);
  }
  function hostChat(from, text) {
    const line = { t: Date.now(), chat: true, from, text };
    host.broadcast({ t: 'chat', line });
    addChat(line);
  }
  function createRoom(name) {
    role = 'host'; myId = token; myName = name; code = N.makeCode(5);
    game = new E.Game();
    game.addPlayer(myId, name);
    game.onChange = hostBroadcast;
    $('connect-msg').textContent = '방을 여는 중…';
    show('screen-connect');
    host = new N.Host(code, {
      onOpen: () => { hostBroadcast(); },
      onJoin: (pid, nm) => !!game.addPlayer(pid, nm),
      onLeave: pid => game.disconnectPlayer(pid),
      onMessage: (pid, msg) => {
        const p = game.player(pid); if (!p) return;
        if (msg.t === 'act') game.act(pid, String(msg.type));
        else if (msg.t === 'rebuy') game.rebuy(pid);
        else if (msg.t === 'chat') hostChat(p.name, String(msg.text || '').slice(0, 60));
      },
      onError: (msg, err) => {
        if (err && err.type === 'unavailable-id') { host.close(); code = N.makeCode(5); host = null; setTimeout(() => createRoom(name), 200); return; }
        if (!view) { goHome(msg); } else toast(msg, 3000);
      },
    });
    host.start();
  }

  /* ── 클라이언트 ── */
  function joinRoom(c, name) {
    role = 'client'; myId = token; myName = name; code = c;
    $('connect-msg').textContent = `방 ${c}에 연결 중…`;
    show('screen-connect');
    client = new N.Client(c, name, token, {
      onOpen: () => { },
      onMessage: msg => {
        if (msg.t === 'state') receiveView(msg.view);
        else if (msg.t === 'chat') addChat(msg.line);
        else if (msg.t === 'err') { if (msg.fatal) goHome(msg.msg); else toast(msg.msg, 2500); }
        else if (msg.t === 'bye') goHome('방장이 방을 닫았어요.');
      },
      onError: msg => goHome(msg),
      onClose: msg => goHome(msg),
      onReconnecting: n => toast(`재접속 중… (${n})`, 1500),
    });
    client.connect();
  }

  /* ── 뷰 수신 → 렌더 ── */
  function receiveView(v) {
    const prev = view; view = v;
    localDeadline = v.turnLeft != null ? Date.now() + v.turnLeft : 0;
    /* 사운드 트리거 */
    if (prev) {
      if (v.phase === 'betting' && v.turn === myId && (prev.turn !== myId || prev.phase !== 'betting')) Snd.turn();
      else if (v.phase === 'betting' && v.round !== prev.round) Snd.deal();
      else if (v.phase === 'betting' && prev.phase === 'betting' && v.pot !== prev.pot) Snd.chip();
      if (v.phase === 'result' && prev.phase !== 'result' && v.result) {
        if (v.result.winners.includes(myId)) Snd.win();
        else if (v.result.revealed.includes(myId) || v.players.find(p => p.id === myId)?.inHand) Snd.lose();
      }
      if (v.handNo !== prev.handNo) { lastCardKey = {}; $('result').classList.add('hidden'); }
    }
    render();
  }
  function addChat(line) { chatLines.push(line); if (chatLines.length > 60) chatLines.shift(); renderLog(); }

  function render() {
    if (!view) return;
    const lobby = (view.phase === 'lobby' && view.handNo === 0) || inSettings;
    if (lobby) { show('screen-lobby'); renderLobby(); }
    else { show('screen-table'); renderTable(); }
    renderLog();
  }

  /* ── 대기실 ── */
  let settingsBound = false;
  function renderLobby() {
    const isHost = role === 'host';
    $('lobby-code').textContent = code;
    $('lobby-players').innerHTML = view.players.map(p => `
      <div class="lp"><span class="dot ${p.connected ? '' : 'off'}"></span><span>${esc(p.name)}</span>
        ${p.seat === 0 ? '<span class="tag">방장</span>' : ''}${p.id === myId ? '<span class="tag">나</span>' : ''}
        <span class="sp"></span><span class="muted">💰 ${fmt(p.chips)}</span>
        ${isHost && p.id !== myId ? `<button class="icon-btn kick" data-id="${p.id}" title="내보내기">✕</button>` : ''}</div>`).join('');
    if (isHost) $('lobby-players').querySelectorAll('.kick').forEach(b => b.onclick = () => { host.kick(b.dataset.id); game.removePlayer(b.dataset.id); });
    const s = view.settings;
    const box = $('settings');
    box.classList.toggle('readonly', !isHost);
    $('settings-who').textContent = isHost ? '' : '(방장만 변경)';
    const fill = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
    fill('set-chips', s.startChips); fill('set-ante', s.ante); fill('set-raises', s.maxRaises); fill('set-turn', s.turnSec); fill('set-max', s.maxPlayers);
    if (document.activeElement !== $('set-special')) $('set-special').checked = !!s.special;
    if (!settingsBound) {
      settingsBound = true;
      const push = () => { if (role !== 'host') return; game.updateSettings({ startChips: +$('set-chips').value, ante: +$('set-ante').value, maxRaises: +$('set-raises').value, turnSec: +$('set-turn').value, maxPlayers: +$('set-max').value, special: $('set-special').checked }); };
      ['set-chips', 'set-ante', 'set-raises', 'set-turn', 'set-max', 'set-special'].forEach(id => $(id).addEventListener('change', push));
    }
    const n = view.players.filter(p => p.connected).length;
    $('btn-start').disabled = !(isHost && view.canStart);
    $('btn-start').textContent = view.handNo ? '다음 판 시작' : '게임 시작';
    $('lobby-hint').textContent = isHost ? (view.canStart ? `${n}명 준비됨` : '2명 이상 모이면 시작할 수 있어요') : `방장이 시작하길 기다리는 중 (${n}명)`;
  }

  /* ── 테이블 ── */
  function renderTable() {
    const me = view.players.find(p => p.id === myId);
    const isHost = role === 'host';
    const res = view.result;
    $('top-code').textContent = code;
    $('top-hand').textContent = view.handNo ? `${view.handNo}판 · ${view.round === 1 ? '첫 장' : view.round === 2 ? '두 번째 장' : ''}` : '';
    $('pot').textContent = fmt(view.pot);

    /* 상대 자리 */
    const others = view.players.filter(p => p.id !== myId);
    const seats = $('seats');
    seats.className = `seats n${Math.min(others.length, 5)}`;
    seats.innerHTML = others.map(p => {
      const cls = ['seat'];
      if (p.isTurn) cls.push('turn');
      if (p.folded) cls.push('folded');
      if (!p.connected) cls.push('off');
      if (res && res.winners.includes(p.id)) cls.push('winner');
      if (view.handNo && !p.inHand) cls.push('out');
      let status = '', scls = '';
      if (!p.connected) status = '오프라인';
      else if (view.handNo && !p.inHand) status = p.chips === 0 ? '칩 없음' : '대기';
      else if (p.folded) { status = '다이'; scls = 'die'; }
      else if (res && p.hand) status = p.hand;
      else if (p.allin) { status = '올인'; scls = 'hot'; }
      else if (p.isTurn) { status = '생각 중…'; scls = 'hot'; }
      const net = res && p.inHand ? p.payout - p.contrib : 0;
      return `<div class="${cls.join(' ')}" data-id="${p.id}">
        ${p.isDealer ? '<div class="dealer">D</div>' : ''}
        ${res && p.inHand && net ? `<div class="seat-bet payout-badge ${net < 0 ? 'neg' : ''}">${net > 0 ? '+' : ''}${fmt(net)}</div>` : p.bet ? `<div class="seat-bet">${fmt(p.bet)}</div>` : ''}
        <div class="seat-name">${esc(p.name)}</div>
        <div class="seat-chips">💰 ${fmt(p.chips)}</div>
        <div class="seat-cards">${p.inHand ? cardsHtml(p, false) : ''}</div>
        <div class="seat-status ${scls}">${status}</div>
        ${p.isTurn && localDeadline ? '<div class="timer"></div>' : ''}
      </div>`;
    }).join('');

    /* 가운데 메시지 */
    const cm = $('center-msg');
    cm.classList.remove('me');
    if (view.phase === 'betting') {
      if (view.turn === myId) { cm.textContent = '내 차례'; cm.classList.add('me'); }
      else { const t = view.players.find(p => p.id === view.turn); cm.textContent = t ? `${t.name}의 차례` : ''; }
    } else if (view.phase === 'result' && res) {
      cm.textContent = res.redeal ? `재경기 — 팟 ${fmt(view.pot)} 이월` : `${res.winners.map(id => view.players.find(p => p.id === id)?.name).join(', ')} 승리`;
    } else cm.textContent = '';

    /* 나 */
    const meBox = $('me');
    meBox.classList.toggle('folded', !!(me && me.folded));
    $('me-name').innerHTML = `${esc(me ? me.name : myName)}${me && me.isDealer ? ' <span class="muted">딜러</span>' : ''}${!me || !me.inHand ? ' <span class="muted">(대기)</span>' : ''}`;
    $('me-cards').innerHTML = me && me.inHand ? cardsHtml(me, true) : '';
    const mh = $('me-hand');
    mh.textContent = me && me.inHand ? (me.folded ? '다이' : (me.hand || '')) : (me && me.chips === 0 ? '칩이 없어요' : '');
    mh.classList.toggle('special', !!(me && me.cards && me.cards.length === 2 && R.evalHand(me.cards).special));
    $('me-chips').textContent = fmt(me ? me.chips : 0);
    $('me-bet').textContent = me && me.bet ? `· 이번 라운드 ${fmt(me.bet)}` : (me && me.inHand && me.contrib ? `· 넣은 칩 ${fmt(me.contrib)}` : '');
    if (me && me.cards && me.cards.length === 2 && !me.folded) {
      const h = R.evalHand(me.cards); if (h.special) mh.textContent = `${h.name} · ${h.special}`;
    }

    /* 행동 버튼 */
    const ab = $('actions');
    if (view.phase === 'betting' && view.actions.length) {
      ab.innerHTML = view.actions.map(a => {
        const cls = a.type === 'die' ? 'die' : a.type === 'call' ? 'call' : (a.type === 'check' ? '' : 'raise');
        const sub = a.type === 'check' || a.type === 'die' ? '' : `<small>${fmt(a.amount)}${me && a.amount >= me.chips ? ' 올인' : ''}</small>`;
        return `<button class="btn ${cls}" data-type="${a.type}">${a.label}${sub}</button>`;
      }).join('');
      ab.querySelectorAll('button').forEach(b => b.onclick = () => { ab.querySelectorAll('button').forEach(x => x.disabled = true); doAction(b.dataset.type); });
    } else if (view.phase === 'betting') {
      const t = view.players.find(p => p.id === view.turn);
      ab.innerHTML = `<div class="wait">${me && me.folded ? '다이 — 이번 판은 구경' : me && !me.inHand ? '다음 판부터 참가해요' : t ? `${esc(t.name)} 차례를 기다리는 중` : '…'}</div>`;
    } else {
      let s = '';
      if (me && me.chips === 0) s += `<button class="btn raise" id="btn-rebuy">리바이<small>${fmt(view.settings.startChips)}</small></button>`;
      if (isHost) s += `<button class="btn call" id="btn-next">다음 판</button><button class="btn" id="btn-settings">설정</button>`;
      else s += `<div class="wait">방장이 다음 판을 시작하면 이어져요</div>`;
      ab.innerHTML = s;
      if ($('btn-next')) $('btn-next').onclick = doStart;
      if ($('btn-settings')) $('btn-settings').onclick = () => { inSettings = true; render(); };
      if ($('btn-rebuy')) $('btn-rebuy').onclick = doRebuy;
    }

    /* 결과 패널 */
    if (view.phase === 'result' && res) renderResult(me);
    tick();
  }

  function renderResult(me) {
    const res = view.result; const box = $('result');
    const nameOf = id => view.players.find(p => p.id === id)?.name || '?';
    const title = $('result-title'); title.className = 'result-title';
    if (res.redeal) { title.textContent = `${nameOf(res.by)}의 ${res.reason} — 재경기!`; title.classList.add('redeal'); }
    else if (res.byFold) { title.textContent = `${nameOf(res.winners[0])} 승리 — 모두 다이`; title.classList.add('win'); }
    else {
      const w = res.winners.map(id => `${nameOf(id)} (${res.hands[id].name})`).join(', ');
      title.textContent = res.catcher ? `${res.catcher}! ${w} 승리` : `${w} 승리`;
      title.classList.add('win');
    }
    const rows = view.players.filter(p => p.inHand).map(p => {
      const net = p.payout - p.contrib;
      const shown = p.cards && res.revealed.includes(p.id);
      return `<div class="rrow ${res.winners.includes(p.id) ? 'win' : ''}">
        <div class="rcards">${shown ? p.cards.map(c => cardHtml(c)).join('') : p.folded ? '' : backHtml() + backHtml()}</div>
        <span class="rn">${esc(p.name)}${p.id === myId ? ' <span class="muted">나</span>' : ''}</span>
        <span class="rh">${p.folded ? '<span class="muted">다이</span>' : shown ? (res.hands[p.id]?.name || '') : ''}</span>
        <span class="rp ${net < 0 ? 'neg' : ''}">${res.redeal ? '' : (net > 0 ? '+' : '') + fmt(net)}</span></div>`;
    }).join('');
    $('result-body').innerHTML = rows + (res.redeal ? `<div class="result-note">팟 ${fmt(view.pot)}이 다음 판으로 이월됩니다</div>` : '');
    let acts = '';
    if (role === 'host') acts += `<button class="btn primary" id="res-next">다음 판</button>`;
    else acts += `<div class="result-note">방장이 다음 판을 시작하면 이어져요</div>`;
    if (me && me.chips === 0) acts += `<button class="btn" id="res-rebuy">리바이 (${fmt(view.settings.startChips)})</button>`;
    acts += `<button class="btn ghost" id="res-close">닫고 테이블 보기</button>`;
    $('result-actions').innerHTML = acts;
    if ($('res-next')) $('res-next').onclick = doStart;
    if ($('res-rebuy')) $('res-rebuy').onclick = () => { doRebuy(); };
    $('res-close').onclick = () => box.classList.add('hidden');
    if (resultHand !== view.handNo) { resultHand = view.handNo; box.classList.remove('hidden'); }
  }

  /* 타이머 표시 (250ms) */
  function tick() {
    if (!view || view.phase !== 'betting' || !localDeadline) return;
    const left = Math.max(0, Math.ceil((localDeadline - Date.now()) / 1000));
    const el = document.querySelector('.seat.turn .timer');
    if (el) { el.textContent = `${left}s`; el.classList.toggle('low', left <= 5); }
    if (view.turn === myId) { const cm = $('center-msg'); cm.textContent = `내 차례 · ${left}초`; }
  }
  setInterval(tick, 250);

  function renderLog() {
    if (!view) return;
    const lines = view.log.map(l => ({ t: l.t, html: esc(l.text) }))
      .concat(chatLines.map(l => ({ t: l.t, html: `<span class="chat"><b>${esc(l.from)}</b> ${esc(l.text)}</span>` })))
      .sort((a, b) => a.t - b.t);
    const box = $('log');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
    box.innerHTML = lines.map(l => `<div>${l.html}</div>`).join('');
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  /* ── 나가기 / 홈 ── */
  function goHome(err) {
    clearTimeout(hostTimer);
    if (host) { const h = host; try { h.broadcast({ t: 'bye' }); } catch (e) { } setTimeout(() => h.close(), 200); }
    if (client) client.close();
    host = null; client = null; game = null; view = null; role = null; inSettings = false; chatLines = []; lastCardKey = {}; resultHand = 0;
    $('result').classList.add('hidden'); $('drawer').classList.add('hidden');
    $('home-err').textContent = err || '';
    show('screen-home');
    const ps = new URLSearchParams(location.search); ps.delete('room');
    history.replaceState(null, '', location.pathname + (ps.toString() ? '?' + ps : ''));
  }
  function leave() {
    if (role === 'host' && view && view.players.length > 1 && !confirm('방장이 나가면 방이 닫혀요. 나갈까요?')) return;
    if (role === 'client' && view && view.phase === 'betting' && !confirm('판 진행 중이에요. 나가면 다이 처리돼요.')) return;
    goHome('');
  }
  window.addEventListener('beforeunload', e => { if (role === 'host' && view && view.players.length > 1) { e.preventDefault(); e.returnValue = ''; } });

  /* ── 입력 바인딩 ── */
  const nameIn = $('in-name'), codeIn = $('in-code');
  nameIn.value = localStorage.getItem(LS.name) || '';
  const params = new URLSearchParams(location.search);
  if (params.get('room')) { codeIn.value = N.normCode(params.get('room')); }
  function getName() { const n = nameIn.value.trim().slice(0, 10) || '익명'; localStorage.setItem(LS.name, n); return n; }
  function requireLib() { if (typeof Peer === 'undefined') { $('home-err').textContent = '연결 라이브러리를 불러오지 못했어요. 새로고침 해주세요.'; return false; } return true; }
  $('btn-create').onclick = () => { if (!requireLib()) return; $('home-err').textContent = ''; createRoom(getName()); };
  $('btn-join').onclick = () => {
    if (!requireLib()) return;
    const c = N.normCode(codeIn.value);
    if (c.length < 4) { $('home-err').textContent = '방 코드를 입력해 주세요'; return; }
    $('home-err').textContent = ''; joinRoom(c, getName());
  };
  codeIn.addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join').click(); });
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') (codeIn.value ? $('btn-join') : $('btn-create')).click(); });
  $('btn-connect-cancel').onclick = () => goHome('');
  $('btn-start').onclick = doStart;
  $('btn-leave-lobby').onclick = () => { if (inSettings) { inSettings = false; render(); } else leave(); };
  $('btn-leave').onclick = leave;
  $('btn-copy-code').onclick = () => copy(code, '코드 복사됨');
  function inviteLink() { const ps = new URLSearchParams(location.search); const peer = ps.get('peer'); return `${location.origin}${location.pathname}?room=${code}${peer ? '&peer=' + encodeURIComponent(peer) : ''}`; }
  $('btn-copy-link').onclick = () => copy(inviteLink(), '초대 링크 복사됨');
  function copy(text, msg) {
    const done = () => { $('copied').textContent = msg; setTimeout(() => $('copied').textContent = '', 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => prompt('복사해 주세요', text));
    else prompt('복사해 주세요', text);
  }
  $('btn-log').onclick = () => { $('drawer').classList.toggle('hidden'); renderLog(); $('log').scrollTop = $('log').scrollHeight; };
  $('btn-drawer-close').onclick = () => $('drawer').classList.add('hidden');
  $('chat-form').onsubmit = e => { e.preventDefault(); doChat($('chat-in').value); $('chat-in').value = ''; };
  const muteBtn = $('btn-mute');
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.onclick = () => { muted = !muted; localStorage.setItem(LS.mute, muted ? '1' : '0'); muteBtn.textContent = muted ? '🔇' : '🔊'; };

  if (params.get('room')) nameIn.focus();
})();
