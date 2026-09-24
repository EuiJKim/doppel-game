/* 섯다 온라인 — UI + 호스트/클라이언트 흐름
 * 호스트: SeotdaEngine.Game 을 갖고, 매 변화마다 각 플레이어에게 '그 사람 시점의 뷰'만 보낸다 (남의 패는 절대 전송 안 함).
 * 클라이언트: 뷰를 받아 그리고, 행동만 보낸다.
 * 쪼기: 내 카드는 뒤집혀 오고 5가지 방식(위로·옆으로·모서리·뒤집기·살살)으로 직접 연다 — 로컬 연출, 판정과 무관.
 */
(() => {
  const $ = id => document.getElementById(id);
  const R = SeotdaRules, E = SeotdaEngine, N = SeotdaNet, CARDS = SeotdaCards;
  const LS = { name: 'seotda_name', token: 'seotda_token', mute: 'seotda_mute', peek: 'seotda_peek', bgm: 'seotda_bgm', char: 'seotda_char' };
  /* 캐릭터 3종: 자리 아바타 + 상황별 한마디 */
  const CHARS = {
    dog: { name: '블랙 강아지', img: 'avatars/dog.jpg', q: { bet: ['멍!', '컹컹!', '으르렁…', '왈!'], die: ['깨갱…', '낑…'], win: ['멍멍멍!!', '왈왈!'], call: ['멍.', '컹.'], allin: ['왈왈왈왈!!!', '으르르릉!!'] } },
    sunji: { name: '홍어먹는 순지형', img: 'avatars/sunji.jpg', q: { bet: ['홍어 한 점 하고 간다', '삭힌 만큼 간다', '이건 먹어야지'], die: ['아 삭았다…', '다음 판에 보자'], win: ['홍어값 나왔다', '크~ 알싸하다'], call: ['콜.', '한 점만 더'], allin: ['홍어 한 마리 통째로!', '삭힐 만큼 삭혔다, 간다!'] } },
    kang: { name: '일베하는 강현이', img: 'avatars/kang.jpg', q: { bet: ['가즈아~', 'ㅋㅋㅋ 받고 더', '이건 못 참지'], die: ['아 몰랑', '에바다 에바'], win: ['ㅋㅋㅋㅋ 개이득', '인정?'], call: ['ㅇㅇ 콜', '따라감'], allin: ['풀매수 가즈아!!', '인생은 한방 ㅋㅋ'] } },
  };
  let myChar = localStorage.getItem(LS.char) || 'dog'; if (!CHARS[myChar]) myChar = 'dog';
  const avatarSrc = key => (CHARS[key] || CHARS.dog).img;
  const bubbles = {};   // pid → { text, until }
  function say(pid, kind) {
    const p = view && view.players.find(x => x.id === pid); if (!p) return;
    const c = CHARS[p.avatar] || CHARS.dog; const list = c.q[kind] || c.q.bet;
    bubbles[pid] = { text: list[Math.floor(Math.random() * list.length)], until: Date.now() + 2500, k: Math.random() };
  }
  const bubbleHtml = pid => { const b = bubbles[pid]; return b && b.until > Date.now() ? `<div class="bubble" data-k="${b.k}">${esc(b.text)}</div>` : ''; };
  let bgmOn = localStorage.getItem(LS.bgm) !== '0';

  /* 토큰은 탭 단위(sessionStorage): 같은 브라우저에서 방장 탭 + 참가 탭을 열어도 다른 사람으로 잡힌다.
   * 새로고침은 같은 탭이라 같은 자리로 복귀. 탭을 닫았다 다시 열면 같은 닉네임의 빈자리를 이어받는다(엔진). */
  let token = null;
  try { token = sessionStorage.getItem(LS.token); } catch (e) { }
  if (!token) { token = 'u' + N.makeCode(10).toLowerCase(); try { sessionStorage.setItem(LS.token, token); } catch (e) { } }

  let role = null, host = null, client = null, game = null;
  let myId = null, code = null, myName = '';
  let view = null, inSettings = false;
  let hostTimer = null, localDeadline = 0, deadlineTotal = 0;
  let chatLines = [], resultHand = 0;
  let lastCardKey = {};
  let muted = localStorage.getItem(LS.mute) === '1';
  let peekMode = localStorage.getItem(LS.peek) || 'up';
  let revealed = new Set(), revealedHand = 0;   // 내가 연 카드 id (판마다 초기화)
  let selected = [];                            // 3장 섯다 선택 인덱스
  let meCardsKey = '', peekActive = false, peekPending = false, goodKey = '';
  let rebuyDismissed = 0;

  /* ── 소리 (합성) ── */
  const Snd = (() => {
    let ctx = null;
    function tone(freq, dur, type, peak, slide, delay) {
      if (muted) return;
      try {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        const t = ctx.currentTime + (delay || 0), o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak || 0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.05);
      } catch (e) { }
    }
    return {
      deal: () => tone(300, 0.08, 'triangle', 0.06, 520),
      turn: () => { tone(660, 0.12, 'sine', 0.12); tone(880, 0.16, 'sine', 0.12, null, 0.12); },
      chip: () => { tone(1500, 0.05, 'square', 0.04); tone(1900, 0.04, 'square', 0.03, null, 0.05); },
      peek: () => tone(180, 0.06, 'triangle', 0.05, 240),
      reveal: () => tone(520, 0.1, 'triangle', 0.08, 780),
      win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.1, null, i * 0.09)),
      big: () => [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.3, 'square', 0.05, null, i * 0.08)),
      lose: () => tone(220, 0.35, 'sawtooth', 0.06, 110),
      die: () => tone(140, 0.2, 'sawtooth', 0.05, 80),
      /* 내 패가 좋을 때: 땡·특수 = 짧은 팡파르, 광땡 = 긴 팡파르 */
      good: () => { [659, 784, 988].forEach((f, i) => tone(f, 0.18, 'triangle', 0.1, null, i * 0.07)); tone(1318, 0.5, 'triangle', 0.1, null, 0.24); },
      great: () => { [523, 659, 784, 1046, 1318, 1568, 2093].forEach((f, i) => tone(f, 0.35, 'square', 0.05, null, i * 0.09)); [262, 330].forEach((f, i) => tone(f, 1.2, 'sawtooth', 0.04, null, 0.3 + i * 0.05)); },
      ctx: () => ctx,
    };
  })();

  /* ── BGM: 합성 긴장감 루프 (A단조 베이스 + 하이햇 + 패드, 내 차례엔 심장박동) ── */
  const Bgm = (() => {
    let ctx = null, master = null, timer = null, step = 0, nextT = 0, playing = false, tense = false;
    const BPM = 96, STEP = 60 / BPM / 4;                       // 16분음표
    const BASS = [45, 0, 0, 45, 0, 0, 48, 0, 40, 0, 0, 40, 0, 0, 43, 0, 45, 0, 0, 45, 0, 0, 48, 0, 41, 0, 0, 41, 0, 0, 43, 43];
    const PAD = [[45, 52, 57], [41, 48, 53], [43, 50, 55], [40, 47, 52]];
    const hz = n => 440 * Math.pow(2, (n - 69) / 12);
    function ensure() {
      if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.0001; master.connect(ctx.destination); }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function bass(t, n, len) { const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.value = hz(n); f.type = 'lowpass'; f.frequency.setValueAtTime(420, t); f.frequency.exponentialRampToValueAtTime(140, t + len); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + len); o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + len + 0.05); }
    function hat(t, acc) { const n = Math.floor(ctx.sampleRate * 0.04), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n); const s = ctx.createBufferSource(); s.buffer = b; const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000; const g = ctx.createGain(); g.gain.value = acc ? 0.35 : 0.14; s.connect(f).connect(g).connect(master); s.start(t); }
    function kick(t) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.18); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22); o.connect(g).connect(master); o.start(t); o.stop(t + 0.25); }
    function pad(t, notes, len) { for (const n of notes) for (const det of [-6, 6]) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = hz(n); o.detune.value = det; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + len * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + len); o.connect(g).connect(master); o.start(t); o.stop(t + len + 0.1); } }
    function tickSched() {
      while (nextT < ctx.currentTime + 0.25) {
        const i = step % 32, bar = Math.floor(step / 16);
        if (BASS[i]) bass(nextT, BASS[i], STEP * 1.6);
        if (i % 2 === 0) hat(nextT, i % 4 === 0);
        if (i % 16 === 0) pad(nextT, PAD[bar % PAD.length], STEP * 16);
        if (tense && (i % 8 === 0 || i % 8 === 3)) kick(nextT);
        nextT += STEP; step++;
      }
    }
    return {
      unlock() { ensure(); },
      start() { if (!ensure() || playing) return; playing = true; step = 0; nextT = ctx.currentTime + 0.05; master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(0.0001, ctx.currentTime); master.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 1.5); timer = setInterval(tickSched, 100); },
      stop() { if (!playing) return; playing = false; clearInterval(timer); if (master) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(master.gain.value, ctx.currentTime); master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6); } },
      setTense(v) { tense = !!v; },
      playing: () => playing,
    };
  })();

  /* ── 화면 ── */
  function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id)); }
  let toastT = null;
  function toast(msg, ms) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms || 1800); }
  const fmt = n => (n || 0).toLocaleString('ko-KR');
  const won = n => fmt(n) + '원';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ── 카드 ── */
  function cardHtml(id, size, extra) {
    const c = R.cardById(id);
    return `<div class="card ${size || ''} ${extra || ''}" data-cid="${id}" title="${c.m}월 ${c.name} ${c.k === '열' ? '열끗' : c.k}"><div class="face">${CARDS.face(c)}</div></div>`;
  }
  function backHtml(size, extra) { return `<div class="card back ${size || ''} ${extra || ''}">${CARDS.BACK}</div>`; }
  function cardsHtml(p, size, usedIds, delayIdx) {
    const key = `${p.cardCount}:${p.cards ? 1 : 0}`;
    const prev = lastCardKey[p.id] || '0:0';
    lastCardKey[p.id] = key;
    const [pc, ps] = prev.split(':').map(Number);
    const newCount = p.cardCount > pc;
    const justShown = p.cards && !ps && pc > 0;
    let s = '';
    for (let i = 0; i < p.cardCount; i++) {
      const isNew = newCount && i >= pc;
      if (p.cards) {
        const used = usedIds && usedIds.includes(p.cards[i]);
        const dim = usedIds && usedIds.length && !used && p.cards.length > 2;
        const delay = justShown && delayIdx ? ` style="animation-delay:${(delayIdx * 0.35).toFixed(2)}s;opacity:0;animation-fill-mode:both"` : '';
        s += cardHtml(p.cards[i], size, (isNew ? 'deal' : justShown ? 'flip' : '') + (used ? ' used' : '') + (dim ? ' dim' : '')).replace('<div class="card', `<div${delay} class="card`);
      } else s += backHtml(size, isNew ? 'deal' : '');
    }
    return s;
  }

  /* ── 공통 명령 (호스트면 직접, 클라이언트면 전송) ── */
  function doAction(type) { if (role === 'host') game.act(myId, type); else client.send({ t: 'act', type }); }
  function doChoose(idxs) { if (role === 'host') game.choose(myId, idxs); else client.send({ t: 'choose', idxs }); }
  function doRebuy() { $('rebuy').classList.add('hidden'); if (role === 'host') game.rebuy(myId); else client.send({ t: 'rebuy' }); }
  function doChat(text) {
    text = text.trim().slice(0, 60); if (!text) return;
    if (role === 'host') hostChat(myName, text); else client.send({ t: 'chat', text });
  }
  function doStart() { if (role !== 'host') return; inSettings = false; if (!game.startHand()) toast('돈이 있는 사람이 2명 이상 있어야 시작할 수 있어요'); }
  function doSettings(patch) { if (role !== 'host') return; if (!game.updateSettings(patch)) toast('판이 끝난 뒤에 바꿀 수 있어요'); }

  /* ── 호스트 ── */
  function withTimer(v) {
    const s = v.settings;
    v.turnLeft = null;
    if (s.turnSec > 0) {
      if (v.phase === 'betting' && v.turn) v.turnLeft = Math.max(0, v.turnAt + s.turnSec * 1000 - Date.now());
      else if (v.phase === 'choosing') v.turnLeft = Math.max(0, v.chooseAt + s.turnSec * 1000 - Date.now());
    }
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
    if (!h || !s.turnSec) return;
    if (game.phase === 'betting' && h.turn) {
      const turn = h.turn, at = h.turnAt;
      hostTimer = setTimeout(() => { if (game.phase === 'betting' && game.hand === h && h.turn === turn && h.turnAt === at) game.autoAct(turn); }, at + s.turnSec * 1000 - Date.now() + 300);
    } else if (game.phase === 'choosing') {
      const at = h.chooseAt;
      hostTimer = setTimeout(() => { if (game.phase === 'choosing' && game.hand === h && h.chooseAt === at) game.autoChoose(); }, at + s.turnSec * 1000 - Date.now() + 300);
    }
  }
  function hostChat(from, text) {
    const line = { t: Date.now(), chat: true, from, text };
    host.broadcast({ t: 'chat', line });
    addChat(line);
  }
  function createRoom(name) {
    role = 'host'; myId = token; myName = name; code = N.makeCode(5);
    game = new E.Game();
    game.addPlayer(myId, name, myChar);
    game.onChange = hostBroadcast;
    $('connect-msg').textContent = '방을 여는 중…';
    show('screen-connect');
    host = new N.Host(code, {
      onOpen: () => { hostBroadcast(); },
      onJoin: (pid, nm, av) => !!game.addPlayer(pid, nm, CHARS[av] ? av : 'dog'),
      onLeave: pid => game.disconnectPlayer(pid),
      onMessage: (pid, msg) => {
        const p = game.player(pid); if (!p) return;
        if (msg.t === 'act') game.act(pid, String(msg.type));
        else if (msg.t === 'choose') game.choose(pid, Array.isArray(msg.idxs) ? msg.idxs.map(Number) : []);
        else if (msg.t === 'rebuy') game.rebuy(pid);
        else if (msg.t === 'chat') hostChat(p.name, String(msg.text || '').slice(0, 60));
      },
      onError: (msg, err) => {
        if (err && err.type === 'unavailable-id') { host.close(); host = null; setTimeout(() => createRoom(name), 200); return; }
        if (!view) goHome(msg); else toast(msg, 3000);
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
      onOpen: () => { $('connect-msg').textContent = '연결됐어요. 방 정보를 받는 중…'; },
      onStatus: msg => { if (!view) { $('connect-msg').textContent = msg; $('connect-hint').textContent = /직접 연결|중계/.test(msg) ? (inApp ? '카카오톡 등 앱 안 브라우저면 Safari/Chrome으로 열어 주세요' : '8초 넘게 걸리면 중계 서버로 자동 전환됩니다') : ''; } },
      onMessage: msg => {
        if (msg.t === 'state') receiveView(msg.view);
        else if (msg.t === 'chat') addChat(msg.line);
        else if (msg.t === 'err') { if (msg.fatal) goHome(msg.msg); else toast(msg.msg, 2500); }
        else if (msg.t === 'bye') goHome('방장이 방을 닫았어요.');
      },
      onError: msg => goHome(msg),
      onClose: msg => goHome(msg),
      onReconnecting: n => toast(`재접속 중… (${n})`, 1500),
    }, myChar);
    client.connect();
  }

  /* ── 뷰 수신 → 이펙트 판단 → 렌더 ── */
  function receiveView(v) {
    const prev = view; view = v;
    if (v.turnLeft != null) { localDeadline = Date.now() + v.turnLeft; deadlineTotal = v.settings.turnSec * 1000; } else localDeadline = 0;
    if (v.handNo !== revealedHand) { revealed = new Set(); revealedHand = v.handNo; selected = []; lastCardKey = {}; meCardsKey = ''; $('me-cards').innerHTML = ''; $('result').classList.add('hidden'); $('rebuy').classList.add('hidden'); }
    const me = v.players.find(p => p.id === myId);
    if (prev && prev.handNo === v.handNo) effects(prev, v, me);
    else if (prev && v.handNo !== prev.handNo) { Snd.deal(); }
    /* 선택 단계·결과에서는 내 카드를 자동으로 연다 */
    if (me && me.cards && (v.phase === 'choosing' || v.phase === 'result')) me.cards.forEach(c => revealed.add(c));
    render();
  }
  function addChat(line) { chatLines.push(line); if (chatLines.length > 60) chatLines.shift(); renderLog(); }

  function render() {
    if (!view) return;
    const lobby = (view.phase === 'lobby' && view.handNo === 0) || inSettings;
    if (lobby) { show('screen-lobby'); renderLobby(); }
    else { show('screen-table'); renderTable(); if (bgmOn) Bgm.start(); }
    renderLog();
  }

  /* ── 대기실 ── */
  let settingsBound = false;
  function renderLobby() {
    const isHost = role === 'host';
    $('lobby-code').textContent = code;
    $('lobby-players').innerHTML = view.players.map(p => `
      <div class="lp"><span class="dot ${p.connected ? '' : 'off'}"></span><img class="avatar" src="${avatarSrc(p.avatar)}" alt=""><span>${esc(p.name)}</span>
        ${p.seat === 0 ? '<span class="tag">방장</span>' : ''}${p.id === myId ? '<span class="tag">나</span>' : ''}
        <span class="sp"></span><span class="muted">💰 ${won(p.chips)}</span>
        ${isHost && p.id !== myId ? `<button class="icon-btn kick" data-id="${p.id}" title="내보내기">✕</button>` : ''}</div>`).join('');
    if (isHost) $('lobby-players').querySelectorAll('.kick').forEach(b => b.onclick = () => { host.kick(b.dataset.id); game.removePlayer(b.dataset.id); });
    const s = view.settings;
    $('settings').classList.toggle('readonly', !isHost);
    $('settings-who').textContent = isHost ? '' : '(방장만 변경)';
    $('set-mode').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.mode === s.mode));
    const fill = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
    fill('set-raises', s.maxRaises); fill('set-turn', s.turnSec); fill('set-max', s.maxPlayers);
    if (document.activeElement !== $('set-special')) $('set-special').checked = !!s.special;
    if (!settingsBound) {
      settingsBound = true;
      const push = () => doSettings({ maxRaises: +$('set-raises').value, turnSec: +$('set-turn').value, maxPlayers: +$('set-max').value, special: $('set-special').checked });
      ['set-raises', 'set-turn', 'set-max', 'set-special'].forEach(id => $(id).addEventListener('change', push));
      $('set-mode').querySelectorAll('button').forEach(b => b.onclick = () => doSettings({ mode: b.dataset.mode }));
    }
    const n = view.players.filter(p => p.connected).length;
    $('btn-start').disabled = !(isHost && view.canStart);
    $('btn-start').textContent = view.handNo ? `다음 판 시작 (${view.nextModeLabel})` : `게임 시작 (${view.nextModeLabel})`;
    $('lobby-hint').textContent = isHost ? (view.canStart ? `${n}명 준비됨` : '2명 이상 모이면 시작할 수 있어요') : `방장이 시작하길 기다리는 중 (${n}명)`;
  }

  /* ── 테이블 ── */
  function renderTable() {
    const me = view.players.find(p => p.id === myId);
    const isHost = role === 'host';
    const res = view.result;
    $('top-code').textContent = code;
    $('top-hand').textContent = view.handNo ? `${view.handNo}판 · ${view.stageLabel}` : '';
    $('mode-tag').textContent = view.modeLabel;
    const topSeg = $('top-mode');
    if (isHost) {
      topSeg.classList.remove('hidden');
      topSeg.querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.mode === view.settings.mode); if (!b.onclick) b.onclick = () => { doSettings({ mode: b.dataset.mode }); if (view.phase === 'betting' || view.phase === 'choosing') toast(`다음 판부터 ${E.MODES[b.dataset.mode].label}`); }; });
    } else topSeg.classList.add('hidden');
    $('pot').textContent = fmt(view.pot);

    /* 상대 자리 */
    const others = view.players.filter(p => p.id !== myId);
    const seats = $('seats');
    seats.className = `seats n${Math.min(others.length, 7)}`;
    seats.innerHTML = others.map((p, seatIdx) => {
      const cls = ['seat'];
      if (p.isTurn) cls.push('turn');
      if (p.folded) cls.push('folded');
      if (!p.connected) cls.push('off');
      if (res && res.winners.includes(p.id)) cls.push('winner');
      if (view.handNo && !p.inHand) cls.push('out');
      let status = '', scls = '';
      if (!p.connected) status = '오프라인';
      else if (view.handNo && !p.inHand) status = p.chips === 0 ? '돈 없음' : '대기';
      else if (p.folded) { status = '다이'; scls = 'die'; }
      else if (res && p.hand) status = p.hand;
      else if (view.phase === 'choosing') { status = p.chosen ? '선택 완료' : '고르는 중…'; scls = p.chosen ? '' : 'hot'; }
      else if (p.allin) { status = '올인'; scls = 'hot'; }
      else if (p.isTurn) { status = '생각 중…'; scls = 'hot'; }
      const net = res && p.inHand ? p.payout - p.contrib : 0;
      const usedIds = res && res.used ? res.used[p.id] : null;
      return `<div class="${cls.join(' ')}" data-id="${p.id}">
        ${p.isDealer ? '<div class="dealer">D</div>' : ''}
        ${res && p.inHand && net ? `<div class="seat-bet payout-badge ${net < 0 ? 'neg' : ''}">${net > 0 ? '+' : ''}${fmt(net)}</div>` : p.bet ? `<div class="seat-bet">${fmt(p.bet)}</div>` : ''}
        ${bubbleHtml(p.id)}
        <img class="avatar" src="${avatarSrc(p.avatar)}" alt="">
        <div class="seat-name">${esc(p.name)}</div>
        <div class="seat-chips">💰 ${fmt(p.chips)}</div>
        <div class="seat-cards">${p.inHand ? cardsHtml(p, '', usedIds, seatIdx) : ''}</div>
        <div class="seat-status ${scls}">${status}</div>
        ${p.folded && p.inHand && !res ? '<div class="stamp">DIE</div>' : ''}
        ${p.isTurn && localDeadline ? '<div class="timer"></div>' : ''}
      </div>`;
    }).join('');

    /* 공유 카드 (홀덤) */
    const board = $('board');
    if (view.boardMax) {
      const usedIds = me && me.best ? me.best : [];
      const shown = view.board.filter(c => c != null).length;
      let s = view.board.map((c, i) => c == null ? backHtml('mid', 'hidden-board') : cardHtml(c, 'mid', (shown > (board.dataset.shown | 0) ? 'flip ' : '') + (usedIds.includes(c) ? 'used' : ''))).join('');
      for (let i = view.board.length; i < view.boardMax; i++) s += '<div class="slot"></div>';
      s += `<div class="board-label">${view.board.length && view.board[0] == null ? '공유 카드 · 베팅 후 공개' : view.board.length ? '공유 카드' : ''}</div>`;
      board.innerHTML = s; board.dataset.n = view.board.length; board.dataset.shown = shown;
    } else { board.innerHTML = ''; board.dataset.n = 0; }

    /* 가운데 메시지 */
    const cm = $('center-msg');
    cm.classList.remove('me');
    if (view.phase === 'betting') {
      if (view.turn === myId) { cm.textContent = '내 차례'; cm.classList.add('me'); }
      else { const t = view.players.find(p => p.id === view.turn); cm.textContent = t ? `${t.name}의 차례` : ''; }
    } else if (view.phase === 'choosing') {
      cm.textContent = view.needChoose ? (view.mode === 'holdem' ? '내 2장 + 공유 1장 중 2장을 고르세요' : '3장 중 2장을 고르세요') : '다른 사람이 고르는 중…';
      if (view.needChoose) cm.classList.add('me');
    } else if (view.phase === 'result' && res) {
      cm.textContent = res.redeal ? `재경기 — 판돈 ${won(view.pot)} 이월` : `${res.winners.map(id => view.players.find(p => p.id === id)?.name).join(', ')} 승리`;
    } else cm.textContent = '';
    $('timer-bar').classList.toggle('on', !!localDeadline && (view.phase === 'betting' || view.phase === 'choosing'));

    /* 나 */
    const meBox = $('me');
    meBox.classList.toggle('folded', !!(me && me.folded));
    meBox.classList.toggle('myturn', view.phase === 'betting' && view.turn === myId);
    $('me-name').innerHTML = `<img class="avatar" src="${avatarSrc(me ? me.avatar : myChar)}" alt=""> ${esc(me ? me.name : myName)}${me && me.isDealer ? ' <span class="muted">딜러</span>' : ''}${!me || !me.inHand ? ' <span class="muted">(대기)</span>' : ''}`;
    const oldB = meBox.querySelector('.bubble'); if (oldB) oldB.remove();
    if (me) meBox.insertAdjacentHTML('afterbegin', bubbleHtml(me.id));
    Bgm.setTense(view.phase === 'betting' && view.turn === myId);
    renderMyCards(me);
    $('me-chips').textContent = fmt(me ? me.chips : 0);
    $('me-bet').textContent = me && me.bet ? `· 이번 라운드 ${won(me.bet)}` : (me && me.inHand && me.contrib ? `· 넣은 돈 ${won(me.contrib)}` : '');

    /* 행동 버튼 */
    const ab = $('actions');
    if (view.phase === 'betting' && view.actions.length) {
      ab.innerHTML = view.actions.map(a => {
        const cls = a.type === 'die' ? 'die' : a.type === 'call' ? 'call' : a.type === 'allin' ? 'allin' : (a.type === 'check' ? '' : 'raise');
        const sub = a.type === 'check' || a.type === 'die' ? '' : `<small>${won(a.amount)}${a.type !== 'allin' && me && a.amount >= me.chips ? ' 올인' : ''}</small>`;
        return `<button class="btn ${cls}" data-type="${a.type}">${a.label}${sub}</button>`;
      }).join('');
      ab.querySelectorAll('button').forEach(b => b.onclick = () => {
        if (b.dataset.type === 'allin' && !confirm(`남은 ${won(me ? me.chips : 0)} 전부 올인할까요?`)) return;
        ab.querySelectorAll('button').forEach(x => x.disabled = true); doAction(b.dataset.type);
      });
    } else if (view.phase === 'choosing') {
      if (view.needChoose) {
        ab.innerHTML = `<button class="btn call" id="btn-choose" ${selected.length === 2 ? '' : 'disabled'}>이 2장으로 확정${selected.length === 2 ? '' : `<small>${2 - selected.length}장 더 선택</small>`}</button><button class="btn" id="btn-choose-best">최선의 2장 자동</button>`;
        $('btn-choose').onclick = () => { if (selected.length === 2) doChoose(selected.slice()); };
        $('btn-choose-best').onclick = () => { const pool = view.pool || me.cards; const b = R.bestPair(pool); doChoose(b.cards.map(c => pool.indexOf(c))); };
      } else ab.innerHTML = `<div class="wait">${me && me.chosen ? '선택 완료 — 다른 사람을 기다리는 중' : me && me.folded ? '다이 — 이번 판은 구경' : '다른 사람이 고르는 중'}</div>`;
    } else if (view.phase === 'betting') {
      const t = view.players.find(p => p.id === view.turn);
      ab.innerHTML = `<div class="wait">${me && me.folded ? '다이 — 이번 판은 구경' : me && !me.inHand ? '다음 판부터 참가해요' : t ? `${esc(t.name)} 차례를 기다리는 중` : '…'}</div>`;
    } else {
      let s = '';
      if (me && me.canRebuy) s += `<button class="btn raise" id="btn-rebuy">다시 참가<small>10,000원</small></button>`;
      if (isHost) {
        s += `<button class="btn call" id="btn-next">다음 판<small>${view.nextModeLabel}</small></button><button class="btn" id="btn-settings">설정</button>`;
        s += `<div class="seg mini" id="mode-seg"><button data-mode="2">2장</button><button data-mode="3">3장</button><button data-mode="holdem">홀덤</button></div>`;
      } else s += `<div class="wait">방장이 다음 판(${view.nextModeLabel})을 시작하면 이어져요</div>`;
      ab.innerHTML = s;
      if ($('btn-next')) $('btn-next').onclick = doStart;
      if ($('btn-settings')) $('btn-settings').onclick = () => { inSettings = true; render(); };
      if ($('btn-rebuy')) $('btn-rebuy').onclick = doRebuy;
      if ($('mode-seg')) $('mode-seg').querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.mode === view.settings.mode); b.onclick = () => doSettings({ mode: b.dataset.mode }); });
    }

    /* 결과 패널 · 재참가 안내 */
    if (view.phase === 'result' && res) renderResult(me);
    if (me && me.canRebuy && rebuyDismissed !== view.handNo && $('result').classList.contains('hidden')) { $('rebuy').classList.remove('hidden'); }
    else if (!(me && me.canRebuy)) $('rebuy').classList.add('hidden');
    tick();
  }

  /* ── 내 카드: 쪼기 + 3장 선택 + 사용 카드 강조 ── */
  function renderMyCards(me) {
    const box = $('me-cards');
    const mh = $('me-hand');
    if (!me || !me.inHand || !me.cards) {
      box.innerHTML = ''; meCardsKey = '';
      mh.className = 'me-hand'; mh.textContent = me && me.chips === 0 ? '돈이 없어요' : '';
      $('peek-modes').innerHTML = '';
      return;
    }
    const usedIds = me.best || [];
    const canPick = view.phase === 'choosing' && view.needChoose;
    const pool = (view.pool && view.pool.length > me.cards.length) ? view.pool : me.cards;   // 홀덤: 공유 카드가 풀에 들어온다
    for (let i = me.cards.length; i < pool.length; i++) revealed.add(pool[i]);               // 공유 카드는 이미 공개된 카드
    const allRevealed = me.cards.every(c => revealed.has(c));
    const key = [pool.join(','), pool.map(c => revealed.has(c) ? 1 : 0).join(''), selected.join(','), canPick ? 1 : 0, allRevealed ? usedIds.join(',') : '', me.folded ? 1 : 0, view.phase].join('|');
    /* 다 열었는데 좋은 패면 효과음 (판마다 한 번) */
    if (allRevealed && pool.length >= 2 && !me.folded && goodKey !== `${view.handNo}:${pool.join(',')}`) {
      goodKey = `${view.handNo}:${pool.join(',')}`;
      const h = me.best && me.best.length === 2 ? R.evalHand(me.best) : R.bestPair(pool).hand;
      if (h.tier === '광땡') { Snd.great(); mh.classList.add('glow'); confetti(30); try { navigator.vibrate && navigator.vibrate([80, 40, 120]); } catch (e) { } }
      else if (h.tier === '땡' || h.tier === '특수' || h.special) { Snd.good(); mh.classList.add('glow'); try { navigator.vibrate && navigator.vibrate(60); } catch (e) { } }
    }
    if (key !== meCardsKey && peekActive) peekPending = true;   // 쪼는 중엔 카드 DOM을 갈아끼우지 않는다
    else if (key !== meCardsKey) {
      meCardsKey = key;
      const prevCount = box.querySelectorAll('.card').length;
      box.innerHTML = pool.map((c, i) => {
        const isRev = revealed.has(c);
        const shared = i >= me.cards.length;
        const used = allRevealed && usedIds.includes(c) && (view.phase === 'result' || me.chosen);
        const dim = allRevealed && view.phase === 'result' && pool.length > 2 && usedIds.length && !usedIds.includes(c);
        const sel = canPick && selected.includes(i);
        const cls = ['big', isRev ? '' : 'peek', i >= prevCount ? 'deal' : '', used ? 'used' : '', dim ? 'dim' : '', sel ? 'sel' : '', canPick ? 'pick' : '', shared ? 'shared' : ''].join(' ');
        const inner = isRev ? '' : `<div class="cover">${CARDS.BACK}</div><div class="hint">${PEEK_HINT[peekMode]}</div>`;
        const badge = (sel ? `<div class="badge">${selected.indexOf(i) + 1}</div>` : '') + (shared ? '<div class="tag">공유</div>' : '');
        return cardHtml(c, cls, '').replace('</div></div>', `</div>${inner}${badge}</div>`);
      }).join('');
      box.querySelectorAll('.card.peek').forEach(el => bindPeek(el));
      if (canPick) box.querySelectorAll('.card.pick').forEach((el, i) => el.onclick = () => {
        if (selected.includes(i)) selected = selected.filter(x => x !== i);
        else { selected.push(i); if (selected.length > 2) selected.shift(); }
        renderTable();
      });
    }
    /* 족보 표시: 다 열기 전엔 숨김 */
    mh.className = 'me-hand';
    if (me.folded) mh.textContent = '다이';
    else if (!allRevealed) { mh.classList.add('hidden-hand'); mh.textContent = revealed.size ? '더 열어보세요…' : '카드를 쪼아보세요'; }
    else {
      let name = me.hand || '';
      if (me.best && me.best.length === 2) { const h = R.evalHand(me.best); if (h.special) { name = `${h.name} · ${h.special}`; mh.classList.add('special'); } }
      if (view.phase === 'choosing' && !me.chosen && selected.length === 2) { const h = R.evalHand([pool[selected[0]], pool[selected[1]]]); name = `선택: ${h.name}${h.special ? ' · ' + h.special : ''}`; }
      mh.textContent = name;
    }
    /* 쪼기 방식 선택 */
    const pm = $('peek-modes');
    const hiddenLeft = me.cards.some(c => !revealed.has(c));
    pm.innerHTML = Object.entries(PEEK_LABEL).map(([k, l]) => `<button data-peek="${k}" class="${k === peekMode ? 'on' : ''}">${l}</button>`).join('') + (hiddenLeft ? '<button class="all" id="btn-reveal-all">한번에 보기</button>' : '');
    pm.querySelectorAll('button[data-peek]').forEach(b => b.onclick = () => { peekMode = b.dataset.peek; localStorage.setItem(LS.peek, peekMode); meCardsKey = ''; renderTable(); });
    if ($('btn-reveal-all')) $('btn-reveal-all').onclick = () => { box.querySelectorAll('.card.peek').forEach(el => finishReveal(el, true)); };
  }

  const PEEK_LABEL = { up: '위로', side: '옆으로', corner: '모서리', flip: '뒤집기', slow: '살살' };
  const PEEK_HINT = { up: '↑ 밀어 올려요', side: '→ 밀어요', corner: '↗ 모서리를 접어요', flip: '탭해서 뒤집기', slow: '꾹 누르고 있어요' };

  function peekEnd() { peekActive = false; if (peekPending) { peekPending = false; meCardsKey = ''; if (view) renderTable(); } }
  function finishReveal(el, flip) {
    const cid = +el.dataset.cid;
    if (revealed.has(cid)) return;
    revealed.add(cid);
    Snd.reveal();
    const done = () => { peekActive = false; peekPending = false; meCardsKey = ''; if (view) renderTable(); };
    if (flip) {
      el.classList.remove('tremble'); el.classList.add('flipping');
      setTimeout(() => { const cv = el.querySelector('.cover'); if (cv) cv.remove(); }, 300);
      setTimeout(done, 620);
    } else setTimeout(done, 120);
  }
  function bindPeek(el) {
    const cover = el.querySelector('.cover'); if (!cover) return;
    const mode = peekMode;
    let x0 = 0, y0 = 0, p = 0, active = false, raf = null, slowT0 = 0;
    const apply = (v) => {
      p = Math.max(0, Math.min(1, v));
      if (mode === 'up' || mode === 'slow') cover.style.transform = `translateY(${-p * 100}%)`;
      else if (mode === 'side') cover.style.transform = `translateX(${p * 100}%)`;
      else if (mode === 'corner') { const c = (p * 230).toFixed(1); cover.style.clipPath = `polygon(0 0, 100% 0, 100% calc(100% - ${c}%), calc(100% - ${c}%) 100%, 0 100%)`; }
    };
    const settle = () => {
      cover.classList.add('snap');
      if (p > (mode === 'slow' ? 0.98 : 0.55)) { apply(1); finishReveal(el, false); }
      else { apply(0); setTimeout(() => { cover.classList.remove('snap'); peekEnd(); }, 260); }
    };
    el.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    el.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    if (mode === 'flip') { el.addEventListener('pointerdown', e => { e.preventDefault(); finishReveal(el, true); }); return; }
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); active = true; peekActive = true; x0 = e.clientX; y0 = e.clientY; cover.classList.remove('snap');
      try { el.setPointerCapture(e.pointerId); } catch (_) { }
      Snd.peek();
      if (mode === 'slow') {
        el.classList.add('tremble');
        const t0 = performance.now(); slowT0 = t0;
        const step = (t) => {
          if (!active) return;
          /* 경과 시간 기준(프레임이 밀려도 진행) + 약간의 흔들림 */
          apply((t - t0) / 2600 + (Math.random() - 0.5) * 0.02);
          if ((t - t0) >= 2600) { active = false; el.classList.remove('tremble'); apply(1); finishReveal(el, false); return; }
          raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      }
    });
    el.addEventListener('pointermove', e => {
      if (!active || mode === 'slow') return;
      const h = el.clientHeight || 100, w = el.clientWidth || 66;
      if (mode === 'up') apply((y0 - e.clientY) / h);
      else if (mode === 'side') apply((e.clientX - x0) / w);
      else if (mode === 'corner') apply(((x0 - e.clientX) + (y0 - e.clientY)) / (h + w) * 1.6);
    });
    const end = () => { if (!active) return; active = false; if (raf) cancelAnimationFrame(raf); el.classList.remove('tremble'); if (mode === 'slow') p = Math.min(1, (performance.now() - slowT0) / 2600); settle(); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', () => { if (el.isConnected) end(); });
  }

  /* ── 이펙트: 뷰 변화를 비교해서 연출 ── */
  function seatEl(id) { return id === myId ? $('me') : document.querySelector(`.seat[data-id="${id}"]`); }
  function flyChip(fromEl, toEl, amount, big) {
    if (!fromEl || !toEl) return;
    const fx = $('fx'); const fr = fx.getBoundingClientRect();
    const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    const el = document.createElement('div'); el.className = 'chip-fly' + (big ? ' big' : ''); el.textContent = amount >= 1000 ? Math.round(amount / 1000) + 'k' : amount;
    el.style.left = (a.left + a.width / 2 - fr.left) + 'px'; el.style.top = (a.top + a.height / 2 - fr.top) + 'px';
    fx.appendChild(el);
    const dx = (b.left + b.width / 2) - (a.left + a.width / 2), dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    el.animate([{ transform: 'translate(-50%,-50%) scale(1)' }, { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.8)`, opacity: 0.9 }], { duration: 520, easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => el.remove();
  }
  function banner(text, cls, sub) {
    const b = $('banner'); b.className = 'banner ' + (cls || ''); b.innerHTML = esc(text) + (sub ? `<span class="sub">${esc(sub)}</span>` : '');
    b.classList.remove('hidden'); void b.offsetWidth;
    clearTimeout(banner.t); banner.t = setTimeout(() => b.classList.add('hidden'), 1800);
  }
  function confetti(n) {
    const fx = $('fx'); const colors = ['#e8c256', '#ff6b5e', '#4fc98a', '#7c6cf0', '#fff'];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('div'); c.className = 'confetti';
      c.style.left = Math.random() * 100 + '%'; c.style.background = colors[i % colors.length];
      c.style.animationDuration = (1.6 + Math.random() * 1.4) + 's'; c.style.animationDelay = (Math.random() * 0.6) + 's';
      fx.appendChild(c); setTimeout(() => c.remove(), 3500);
    }
  }
  function effects(prev, v, me) {
    const pm = {}; prev.players.forEach(p => pm[p.id] = p);
    /* 베팅: 기여액 증가 → 칩이 판돈으로 날아간다 */
    let anyBet = false;
    for (const p of v.players) {
      const q = pm[p.id]; if (!q) continue;
      if (p.inHand && p.contrib > q.contrib && v.phase !== 'result') {
        anyBet = true;
        setTimeout(() => flyChip(seatEl(p.id), $('pot-box'), p.contrib - q.contrib), 0);
        if (p.chips === 0 && q.chips > 0 && !p.folded) { banner('올인!', 'red small', p.name); Snd.big(); say(p.id, 'allin'); $('screen-table').querySelector('.felt').classList.add('shake'); setTimeout(() => $('screen-table').querySelector('.felt').classList.remove('shake'), 600); }
        else if (Math.random() < 0.6) say(p.id, p.bet > q.bet && p.bet > v.curBet - 1 && p.contrib - q.contrib > 100 ? 'bet' : 'call');
      }
      if (p.folded && !q.folded) { Snd.die(); say(p.id, 'die'); }
    }
    if (anyBet) { Snd.chip(); $('pot-box').classList.remove('bump'); void $('pot-box').offsetWidth; $('pot-box').classList.add('bump'); }
    /* 새 카드 */
    if (v.street !== prev.street) Snd.deal();
    /* 내 차례 */
    if (v.phase === 'betting' && v.turn === myId && (prev.turn !== myId || prev.phase !== 'betting')) Snd.turn();
    if (v.phase === 'choosing' && prev.phase !== 'choosing' && v.needChoose) Snd.turn();
    /* 결과 */
    if (v.phase === 'result' && prev.phase !== 'result' && v.result) {
      const r = v.result;
      const names = r.winners.map(id => v.players.find(p => p.id === id)?.name).join(', ');
      for (const id of r.winners) say(id, 'win');
      setTimeout(() => {
        if (r.redeal) { banner('재경기!', 'gold small', `${r.reason} — 판돈 이월`); Snd.deal(); return; }
        const top = r.winners.length ? r.hands[r.winners[0]] : null;
        const bigHand = top && (top.tier === '광땡' || top.tier === '땡');
        if (r.byFold) banner(`${names} 승리`, 'small', '모두 다이');
        else if (r.catcher) { banner(`${r.catcher}!`, 'red', `${names} 승리`); $('screen-table').querySelector('.felt').classList.add('shake'); }
        else if (bigHand) { banner(`${top.name}!`, 'gold', `${names} 승리`); $('screen-table').querySelector('.felt').classList.add('shake'); if (top.tier === '광땡') confetti(60); }
        else banner(`${top ? top.name : ''}`, 'small', `${names} 승리`);
        setTimeout(() => $('screen-table').querySelector('.felt').classList.remove('shake'), 600);
        if (r.winners.includes(myId)) { bigHand ? Snd.big() : Snd.win(); if (!bigHand) confetti(24); }
        else if (me && me.inHand) Snd.lose();
        /* 판돈 → 승자 */
        const pot = $('pot-box');
        for (const id of r.winners) setTimeout(() => flyChip(pot, seatEl(id), r.payouts[id] || 0, true), 250);
      }, 150);
    }
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
      const used = res.used && res.used[p.id] ? res.used[p.id] : [];
      return `<div class="rrow ${res.winners.includes(p.id) ? 'win' : ''}">
        <div class="rcards">${shown ? p.cards.map(c => cardHtml(c, '', (used.includes(c) ? 'used' : (used.length && p.cards.length > 2 ? 'dim' : '')))).join('') : p.folded ? '' : backHtml() + backHtml()}</div>
        <span class="rn">${esc(p.name)}${p.id === myId ? ' <span class="muted">나</span>' : ''}</span>
        <span class="rh">${p.folded ? '<span class="muted">다이</span>' : shown ? (res.hands[p.id]?.name || '') : ''}</span>
        <span class="rp ${net < 0 ? 'neg' : ''}">${res.redeal ? '' : (net > 0 ? '+' : '') + fmt(net)}</span></div>`;
    }).join('');
    $('result-body').innerHTML = rows + (res.redeal ? `<div class="result-note">판돈 ${won(view.pot)}이 다음 판으로 이월됩니다</div>` : '');
    let acts = '';
    if (role === 'host') acts += `<button class="btn primary" id="res-next">다음 판 (${view.nextModeLabel})</button>`;
    else acts += `<div class="result-note">방장이 다음 판(${view.nextModeLabel})을 시작하면 이어져요</div>`;
    if (me && me.canRebuy) acts += `<button class="btn" id="res-rebuy">10,000원으로 다시 참가</button>`;
    acts += `<button class="btn ghost" id="res-close">닫고 테이블 보기</button>`;
    $('result-actions').innerHTML = acts;
    if ($('res-next')) $('res-next').onclick = doStart;
    if ($('res-rebuy')) $('res-rebuy').onclick = doRebuy;
    $('res-close').onclick = () => { box.classList.add('hidden'); renderTable(); };
    if (resultHand !== view.handNo) { resultHand = view.handNo; setTimeout(() => { if (view && view.phase === 'result' && resultHand === view.handNo) box.classList.remove('hidden'); }, 1600); }
  }

  /* 타이머 표시 (250ms) */
  function tick() {
    if (!view || !localDeadline || !(view.phase === 'betting' || view.phase === 'choosing')) return;
    const leftMs = Math.max(0, localDeadline - Date.now());
    const left = Math.ceil(leftMs / 1000);
    const el = document.querySelector('.seat.turn .timer');
    if (el) { el.textContent = `${left}s`; el.classList.toggle('low', left <= 5); }
    const fill = $('timer-fill');
    fill.style.width = (deadlineTotal ? leftMs / deadlineTotal * 100 : 0) + '%'; fill.classList.toggle('low', left <= 5);
    if (view.phase === 'betting' && view.turn === myId) $('center-msg').textContent = `내 차례 · ${left}초`;
    if (view.phase === 'choosing' && view.needChoose) $('center-msg').textContent = `3장 중 2장을 고르세요 · ${left}초`;
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
    clearTimeout(hostTimer); Bgm.stop();
    if (host) { const h = host; try { h.broadcast({ t: 'bye' }); } catch (e) { } setTimeout(() => h.close(), 200); }
    if (client) client.close();
    host = null; client = null; game = null; view = null; role = null; inSettings = false; chatLines = []; lastCardKey = {}; resultHand = 0; meCardsKey = ''; revealed = new Set(); revealedHand = 0;
    ['result', 'drawer', 'invite', 'rebuy'].forEach(id => $(id).classList.add('hidden'));
    $('home-err').textContent = err || '';
    show('screen-home');
    const ps = new URLSearchParams(location.search); ps.delete('room');
    history.replaceState(null, '', location.pathname + (ps.toString() ? '?' + ps : ''));
  }
  function leave() {
    if (role === 'host' && view && view.players.length > 1 && !confirm('방장이 나가면 방이 닫혀요. 나갈까요?')) return;
    if (role === 'client' && view && (view.phase === 'betting' || view.phase === 'choosing') && !confirm('판 진행 중이에요. 나가면 다이 처리돼요.')) return;
    goHome('');
  }
  window.addEventListener('beforeunload', e => { if (role === 'host' && view && view.players.length > 1) { e.preventDefault(); e.returnValue = ''; } });

  /* ── 입력 바인딩 ── */
  const nameIn = $('in-name'), codeIn = $('in-code');
  nameIn.value = localStorage.getItem(LS.name) || '';
  const params = new URLSearchParams(location.search);
  if (params.get('room')) codeIn.value = N.normCode(params.get('room'));
  function getName() { const n = nameIn.value.trim().slice(0, 10) || '익명'; localStorage.setItem(LS.name, n); return n; }
  function requireLib() { if (typeof Peer === 'undefined') { $('home-err').textContent = '연결 라이브러리를 불러오지 못했어요. 새로고침 해주세요.'; return false; } return true; }

  /* 인앱 브라우저 안내 (카카오톡 등에서 링크를 열면 연결이 막히는 경우가 많다) */
  const inApp = N.inAppBrowser();
  if (inApp) {
    $('inapp').classList.remove('hidden');
    $('inapp').innerHTML = `<b>${esc(inApp)} 안의 브라우저</b>로 열려 있어요. 여기서는 연결이 안 될 수 있어요.<br>${N.isIOS() ? '오른쪽 아래(또는 위) <b>⋯ / 공유</b> 버튼 → <b>Safari로 열기</b>' : '오른쪽 위 <b>⋮</b> → <b>다른 브라우저로 열기(Chrome)</b>'} 를 눌러 다시 열어 주세요.`;
  }
  /* 연결 진단 */
  $('btn-diag').onclick = async () => {
    const box = $('diag'); box.classList.remove('hidden');
    const row = (label, v) => `<div>${label}: ${v}</div>`;
    const paint = d => {
      const sig = d.signaling == null ? '<span class="wait">확인 중…</span>' : d.signaling === 'ok' ? '<span class="ok">정상</span>' : `<span class="bad">실패 (${esc(d.signaling)})</span>`;
      const ice = `호스트 ${d.host} · 공인(STUN) ${d.srflx} · 중계(TURN) ${d.relay}`;
      box.innerHTML =
        row('브라우저', `${d.ios ? 'iOS' : ''} ${d.inApp ? `<span class="bad">${esc(d.inApp)} 인앱</span>` : '<span class="ok">일반 브라우저</span>'}`) +
        row('HTTPS', d.secure ? '<span class="ok">정상</span>' : '<span class="bad">아님 (WebRTC 불가)</span>') +
        row('WebRTC', d.webrtc ? '<span class="ok">지원</span>' : '<span class="bad">미지원</span>') +
        row('연결 서버', sig) +
        row('네트워크 경로', `${ice}${d.srflx ? ' <span class="ok">✓ 외부 연결 가능</span>' : ''}${!d.srflx && d.relay ? ' <span class="ok">✓ 중계로 가능</span>' : ''}`) +
        `<div class="ua">${esc(d.ua)}</div>`;
    };
    if (typeof Peer === 'undefined') { box.innerHTML = '<span class="bad">연결 라이브러리를 불러오지 못했어요 (오래된 iOS/브라우저일 수 있어요). iOS 14 이상, 최신 Safari/Chrome을 써주세요.</span>'; return; }
    const d = await N.diagnose(paint); paint(d);
    let advice = '';
    if (d.inApp) advice = '인앱 브라우저가 원인일 가능성이 커요. Safari/Chrome으로 다시 열어 주세요.';
    else if (d.signaling !== 'ok') advice = '연결 서버에 못 닿았어요. 와이파이/데이터를 바꿔 보거나, 잠시 후 다시 시도해 주세요.';
    else if (!d.srflx && !d.relay) advice = '외부로 나가는 경로가 없어요(회사망·공용 와이파이 방화벽). 다른 네트워크(휴대폰 데이터)로 시도해 주세요.';
    else if (!d.srflx && d.relay) advice = '직접 연결은 막혀 있지만 중계로는 가능해요. 참가 시 8초쯤 뒤 중계로 자동 전환됩니다.';
    else advice = '이 기기는 연결 조건이 정상이에요. 그래도 안 되면 방장 쪽 기기에서도 진단을 해보세요 (방장 브라우저가 닫히면 방이 사라져요).';
    box.innerHTML += `<div style="margin-top:8px;color:var(--ink)">→ ${advice}</div>`;
  };
  function renderCharPick() {
    $('char-pick').innerHTML = Object.entries(CHARS).map(([k, c]) => `<button type="button" data-char="${k}" class="${k === myChar ? 'on' : ''}"><img src="${c.img}" alt="">${esc(c.name)}</button>`).join('');
    $('char-pick').querySelectorAll('button').forEach(b => b.onclick = () => { myChar = b.dataset.char; localStorage.setItem(LS.char, myChar); renderCharPick(); });
  }
  renderCharPick();
  $('btn-create').onclick = () => { if (!requireLib()) return; Bgm.unlock(); $('home-err').textContent = ''; createRoom(getName()); };
  $('btn-join').onclick = () => {
    if (!requireLib()) return; Bgm.unlock();
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
  function inviteLink() { const ps = new URLSearchParams(location.search); const peer = ps.get('peer'); return `${location.origin}${location.pathname}?room=${code}${peer ? '&peer=' + encodeURIComponent(peer) : ''}`; }
  function copy(text, msg, outId) {
    const out = $(outId || 'copied');
    const done = () => { out.textContent = msg; setTimeout(() => out.textContent = '', 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => prompt('복사해 주세요', text));
    else prompt('복사해 주세요', text);
  }
  $('btn-copy-code').onclick = () => copy(code, '코드 복사됨');
  $('btn-copy-link').onclick = () => copy(inviteLink(), '초대 링크 복사됨');
  $('btn-invite').onclick = () => { $('invite-code').textContent = code; $('invite').classList.remove('hidden'); };
  $('inv-close').onclick = () => $('invite').classList.add('hidden');
  $('inv-copy-code').onclick = () => copy(code, '코드 복사됨', 'inv-copied');
  $('inv-copy-link').onclick = () => copy(inviteLink(), '초대 링크 복사됨', 'inv-copied');
  $('rb-yes').onclick = doRebuy;
  $('rb-no').onclick = () => { rebuyDismissed = view ? view.handNo : 0; $('rebuy').classList.add('hidden'); };
  $('btn-log').onclick = () => { $('drawer').classList.toggle('hidden'); renderLog(); $('log').scrollTop = $('log').scrollHeight; };
  $('btn-drawer-close').onclick = () => $('drawer').classList.add('hidden');
  $('chat-form').onsubmit = e => { e.preventDefault(); doChat($('chat-in').value); $('chat-in').value = ''; };
  const bgmBtn = $('btn-bgm');
  const paintBgm = () => { bgmBtn.textContent = bgmOn ? '🎵' : '🎵'; bgmBtn.style.opacity = bgmOn ? '1' : '0.35'; };
  paintBgm();
  bgmBtn.onclick = () => { bgmOn = !bgmOn; localStorage.setItem(LS.bgm, bgmOn ? '1' : '0'); paintBgm(); if (bgmOn) Bgm.start(); else Bgm.stop(); toast(bgmOn ? '배경음악 켜짐' : '배경음악 꺼짐', 1000); };
  const muteBtn = $('btn-mute');
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.onclick = () => { muted = !muted; localStorage.setItem(LS.mute, muted ? '1' : '0'); muteBtn.textContent = muted ? '🔇' : '🔊'; };

  if (params.get('room')) nameIn.focus();
})();
