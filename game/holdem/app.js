/* 홀덤 온라인 — UI + 호스트/클라이언트 흐름 (섯다 온라인과 같은 뼈대)
 * 호스트: HoldemEngine.Game 을 갖고, 매 변화마다 각 플레이어에게 '그 사람 시점의 뷰'만 보낸다 (남의 패는 절대 전송 안 함).
 * 클라이언트: 뷰를 받아 그리고, 행동만 보낸다.
 */
(() => {
  const $ = id => document.getElementById(id);
  const R = HoldemRules, E = HoldemEngine, N = SeotdaNet, CARDS = HoldemCards;
  N.setPrefix('doppel-holdem-');
  const ASSETS = '../seotda/';
  const LS = { name: 'seotda_name', token: 'holdem_token', mute: 'seotda_mute', peek: 'seotda_peek', bgm: 'seotda_bgm', char: 'seotda_char' };
  const CHARS = {
    dog: { name: '블랙 강아지', img: ASSETS + 'avatars/dog.jpg', q: { bet: ['멍!', '컹컹!', '으르렁…', '왈!'], die: ['깨갱…', '낑…'], win: ['멍멍멍!!', '왈왈!'], call: ['멍.', '컹.'], allin: ['왈왈왈왈!!!', '으르르릉!!'] } },
    sunji: { name: '홍어먹는 순지형', img: ASSETS + 'avatars/sunji.jpg', q: { bet: ['홍어 한 점 하고 간다', '삭힌 만큼 간다', '이건 먹어야지'], die: ['아 삭았다…', '다음 판에 보자'], win: ['홍어값 나왔다', '크~ 알싸하다'], call: ['콜.', '한 점만 더'], allin: ['홍어 한 마리 통째로!', '삭힐 만큼 삭혔다, 간다!'] } },
    kang: { name: '일베하는 강현이', img: ASSETS + 'avatars/kang.jpg', q: { bet: ['가즈아~', 'ㅋㅋㅋ 받고 더', '이건 못 참지'], die: ['아 몰랑', '에바다 에바'], win: ['ㅋㅋㅋㅋ 개이득', '인정?'], call: ['ㅇㅇ 콜', '따라감'], allin: ['풀매수 가즈아!!', '인생은 한방 ㅋㅋ'] } },
    woo: { name: '헛둘우영', img: ASSETS + 'avatars/woo.webp', still: ASSETS + 'avatars/woo.jpg', anim: true, q: { bet: ['헛둘헛둘!', '헛둘! 받고 더', '헛둘… 간다!'], die: ['헛… 둘…', '헛둘 다음 판에', '헛둘 삐끗'], win: ['헛둘헛둘 이겼다!', '헛둘! 접수', '헛둘헛둘 헛둘헛둘~'], call: ['헛둘 콜', '둘… 콜'], allin: ['헛둘헛둘헛둘 올인!!', '헛둘! 다 걸어!'] } },
  };
  let myChar = localStorage.getItem(LS.char) || 'dog'; if (!CHARS[myChar]) myChar = 'dog';
  const avatarSrc = key => (CHARS[key] || CHARS.dog).img;
  const avatarCls = key => 'avatar' + ((CHARS[key] || CHARS.dog).anim ? ' anim' : '');
  const bubbles = {};
  function say(pid, kind) {
    const p = view && view.players.find(x => x.id === pid); if (!p) return;
    const c = CHARS[p.avatar] || CHARS.dog; const list = c.q[kind] || c.q.bet;
    bubbles[pid] = { text: list[Math.floor(Math.random() * list.length)], until: Date.now() + 3500, k: Math.random() };
  }
  const bubbleHtml = pid => { const b = bubbles[pid]; return b && b.until > Date.now() ? `<div class="bubble ${b.chat ? 'chat' : ''}" data-k="${b.k}">${esc(b.text)}</div>` : ''; };
  let bgmOn = localStorage.getItem(LS.bgm) !== '0';

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
  let revealed = new Set(), revealedHand = 0;
  let meCardsKey = '', peekActive = false, peekPending = false, goodKey = '';
  let rebuyDismissed = 0;

  /* ── 소리 (합성) ── */
  const Snd = (() => {
    let ctx = null;
    function noise(dur, peak, delay, freq) {
      if (muted) return;
      try {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        const n = Math.floor(ctx.sampleRate * dur), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
        const s = ctx.createBufferSource(); s.buffer = b; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 2500; f.Q.value = 0.8;
        const g = ctx.createGain(); g.gain.value = peak || 0.08; s.connect(f).connect(g).connect(ctx.destination); s.start(ctx.currentTime + (delay || 0));
      } catch (e) { }
    }
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
      shuffle: () => { for (let i = 0; i < 9; i++) noise(0.09, 0.12, i * 0.11, 1800 + (i % 3) * 600); },
      slide: () => noise(0.12, 0.07, 0, 3200),
      turn: () => { tone(660, 0.12, 'sine', 0.12); tone(880, 0.16, 'sine', 0.12, null, 0.12); },
      chip: () => { tone(1500, 0.05, 'square', 0.04); tone(1900, 0.04, 'square', 0.03, null, 0.05); },
      peek: () => tone(180, 0.06, 'triangle', 0.05, 240),
      reveal: () => tone(520, 0.1, 'triangle', 0.08, 780),
      win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.1, null, i * 0.09)),
      big: () => [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.3, 'square', 0.05, null, i * 0.08)),
      lose: () => tone(220, 0.35, 'sawtooth', 0.06, 110),
      die: () => tone(140, 0.2, 'sawtooth', 0.05, 80),
      good: () => { [659, 784, 988].forEach((f, i) => tone(f, 0.18, 'triangle', 0.1, null, i * 0.07)); tone(1318, 0.5, 'triangle', 0.1, null, 0.24); },
      great: () => { [523, 659, 784, 1046, 1318, 1568, 2093].forEach((f, i) => tone(f, 0.35, 'square', 0.05, null, i * 0.09)); [262, 330].forEach((f, i) => tone(f, 1.2, 'sawtooth', 0.04, null, 0.3 + i * 0.05)); },
      tick: () => tone(1800, 0.05, 'square', 0.05),
      riser: () => { tone(120, 1.1, 'sawtooth', 0.05, 900); tone(240, 1.1, 'triangle', 0.04, 1800); },
      chat: () => { tone(1200, 0.07, 'sine', 0.08); tone(1600, 0.09, 'sine', 0.08, null, 0.08); },
      snap: () => { noise(0.05, 0.14, 0, 3500); tone(900, 0.06, 'square', 0.05, 300); },
      drum: () => { let d = 0; for (let i = 0; i < 11; i++) { tone(85, 0.07, 'square', 0.07, 50, d); d += 0.12 - i * 0.006; } },
      whoosh: () => tone(900, 0.12, 'triangle', 0.04, 200),
      coin: (i) => tone(1500 + (i % 4) * 180, 0.12, 'sine', 0.05, 2600),
      pop: () => tone(500, 0.08, 'square', 0.05, 900),
      flop: () => { [420, 560, 700].forEach((f, i) => tone(f, 0.12, 'triangle', 0.07, null, i * 0.1)); },
    };
  })();

  const tweens = new Map();
  function tweenNum(el, to, ms) {
    const from = +String(el.dataset.v ?? el.textContent.replace(/[^\d-]/g, '')) || 0;
    if (from === to) { el.textContent = fmt(to); el.dataset.v = to; return; }
    if (tweens.has(el)) cancelAnimationFrame(tweens.get(el));
    const t0 = performance.now();
    const step = t => {
      const k = Math.min(1, (t - t0) / (ms || 600)); const e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(from + (to - from) * e)); el.dataset.v = to;
      if (k < 1) tweens.set(el, requestAnimationFrame(step)); else tweens.delete(el);
    };
    tweens.set(el, requestAnimationFrame(step));
  }
  let streak = 0, renderedTurn = null, armedTurnAt = 0, lastTickSec = -1;
  let sd = null, wakeLock = null;
  let lastSnap = null, migrating = false, takeoverTimer = null;
  const QUICK = ['ㅋㅋㅋ', '빨리 해', '블러핑이지?', '올인 가자', '아 망했다', 'ㄱㄱ', '한 판 더', '나이스 핸드'];

  /* ── BGM ── */
  const Bgm = (() => {
    let ctx = null, master = null, timer = null, step = 0, nextT = 0, playing = false, tense = false;
    const BPM = 92, STEP = 60 / BPM / 4;
    const BASS = [43, 0, 0, 43, 0, 0, 46, 0, 38, 0, 0, 38, 0, 0, 41, 0, 43, 0, 0, 43, 0, 0, 46, 0, 39, 0, 0, 39, 0, 0, 41, 41];
    const PAD = [[43, 50, 55], [39, 46, 51], [41, 48, 53], [38, 45, 50]];
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
    };
  })();

  /* ── 화면 ── */
  function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id)); }
  let toastT = null;
  function toast(msg, ms) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms || 1800); }
  const fmt = n => (n || 0).toLocaleString('ko-KR');
  const won = n => fmt(n) + '원';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function stackHtml(amount, label) {
    if (!amount) return '';
    let rest = amount; const cols = [];
    for (const [v, cls] of [[5000, 'c5000'], [1000, 'c1000'], [500, 'c500'], [100, 'c100'], [50, 'c50'], [10, 'c10']]) {
      let n = Math.floor(rest / v); rest -= n * v;
      while (n > 0) { const k = Math.min(n, 6); cols.push({ cls, k }); n -= k; if (cols.length >= 5) { n = 0; rest = 0; } }
      if (cols.length >= 5) break;
    }
    return cols.map(c => `<div class="col">${Array.from({ length: c.k }, (_, i) => `<div class="chip ${c.cls}" style="transform:translateY(${-i * 4}px)"></div>`).join('')}</div>`).join('') + (label === false ? '' : `<span class="amt">${fmt(amount)}</span>`);
  }
  function cardHtml(id, size, extra) {
    const c = R.cardById(id);
    return `<div class="card ${size || ''} ${extra || ''}" data-cid="${id}" title="${c.name}"><div class="face">${CARDS.face(c)}</div></div>`;
  }
  function backHtml(size, extra) { return `<div class="card back ${size || ''} ${extra || ''}">${CARDS.BACK}</div>`; }
  const sdGate = p => !!(sd && view && sd.handNo === view.handNo && !sd.done && p.id !== myId && !view.spectating);
  function cardsHtml(p, size, usedIds, delayIdx) {
    const gate = sdGate(p);
    const faces = p.cards ? (gate ? Math.min(p.cards.length, sd.open[p.id] || 0) : p.cards.length) : 0;
    const key = `${p.cardCount}:${faces}`;
    const prev = lastCardKey[p.id] || '0:0';
    lastCardKey[p.id] = key;
    const [pc, pf] = prev.split(':').map(Number);
    const newCount = p.cardCount > pc;
    const showHl = !gate || sd.hand[p.id];
    let s = '';
    for (let i = 0; i < p.cardCount; i++) {
      const isNew = newCount && i >= pc;
      if (p.cards && i < faces) {
        const justShown = i >= pf && !isNew;
        const used = showHl && usedIds && usedIds.includes(p.cards[i]);
        const dim = showHl && usedIds && usedIds.length && !used;
        const delay = justShown && !gate ? ` style="animation-delay:${(0.2 + (delayIdx || 0) * 0.3).toFixed(2)}s;opacity:0;animation-fill-mode:both"` : '';
        s += cardHtml(p.cards[i], size, (isNew ? 'deal' : justShown ? 'flip' : '') + (used ? ' used' : '') + (dim ? ' dim' : '')).replace('<div class="card', `<div${delay} class="card`);
      } else s += backHtml(size, isNew ? 'deal' : '');
    }
    return s;
  }

  /* ── 공통 명령 ── */
  function doAction(type, to) { if (role === 'host') game.act(myId, type, to); else client.send({ t: 'act', type, to }); }
  function doRebuy() { $('rebuy').classList.add('hidden'); if (role === 'host') game.rebuy(myId); else client.send({ t: 'rebuy' }); }
  function doChat(text) {
    text = text.trim().slice(0, 60); if (!text) return;
    if (role === 'host') hostChat(myName, text); else client.send({ t: 'chat', text });
  }
  /* 다음 판 시작: 진 사람이 시작한다(접속 중이면). 진 사람이 없거나 나갔으면 방장 */
  function doStart() {
    inSettings = false;
    if (role === 'host') { if (!game.startHand()) toast('돈이 있는 사람이 2명 이상 있어야 시작할 수 있어요'); }
    else client.send({ t: 'start' });
  }
  function doAway(v) { if (role === 'host') game.setAway(myId, v); else client.send({ t: 'away', away: !!v }); }
  function doExtend() { if (role === 'host') game.extendTurn(myId); else client.send({ t: 'extend' }); }
  function doSettings(patch) { if (role !== 'host') return; if (!game.updateSettings(patch)) toast('판이 끝난 뒤에 바꿀 수 있어요'); }

  /* ── 호스트 ── */
  function withTimer(v) {
    const s = v.settings;
    v.turnLeft = null;
    if (s.turnSec > 0 && v.phase === 'betting' && v.turn) v.turnLeft = Math.max(0, v.turnAt + s.turnSec * 1000 - Date.now());
    return v;
  }
  function hostBroadcast() {
    const snap = game.snapshot(myId);
    for (const p of game.players) if (p.id !== myId && p.connected && !p.bot) host.send(p.id, { t: 'state', view: withTimer(game.view(p.id)), snap });
    const prevV = view;
    receiveView(withTimer(game.view(myId)));
    botTaunts(prevV, view);
    scheduleHostTimer();
  }
  function hostHandlers(onFatal) {
    return {
      onOpen: () => { hostBroadcast(); },
      onJoin: (pid, nm, av) => !!game.addPlayer(pid, nm, CHARS[av] ? av : 'dog'),
      onLeave: pid => game.disconnectPlayer(pid),
      onMessage: (pid, msg) => {
        const p = game.player(pid); if (!p) return;
        if (msg.t === 'act') game.act(pid, String(msg.type), msg.to != null ? +msg.to : undefined);
        else if (msg.t === 'rebuy') game.rebuy(pid);
        else if (msg.t === 'away') game.setAway(pid, !!msg.away);
        else if (msg.t === 'extend') game.extendTurn(pid);
        else if (msg.t === 'start') game.startBy(pid);
        else if (msg.t === 'chat') hostChat(p.name, String(msg.text || '').slice(0, 60));
      },
      onError: (msg, err) => {
        if (err && err.type === 'unavailable-id') { onFatal(err); return; }
        if (!view) goHome(msg); else toast(msg, 3000);
      },
    };
  }
  /* ── 봇 ── */
  const BOT_TAUNT = { win: ['ㅋㅋ 접수', '다음 판도 내 거', '이 정도야 뭐', '고마워요~', '나이스 핸드… 나한테'], lose: ['아 몰라', '다음 판에 보자', '…운이 없네', '리버가 미쳤네'] };
  let botTimer = null;
  function addBot() {
    if (role !== 'host') return;
    const used = new Set(game.players.map(p => p.avatar));
    const keys = Object.keys(CHARS); const free = keys.filter(k => !used.has(k));
    const k = (free.length ? free : keys)[Math.floor(Math.random() * (free.length ? free.length : keys.length))];
    const base = CHARS[k].name.split(' ').pop().replace(/이$/, '') + '봇';
    let name = base, i = 2; while (game.players.some(p => p.name === name)) name = base + (i++);
    const p = game.addPlayer('bot_' + N.makeCode(6).toLowerCase(), name, k, true);
    if (!p) toast('자리가 꽉 찼어요'); else { p.brain = { aggr: 0.3 + Math.random() * 0.45, bluff: 0.06 + Math.random() * 0.14 }; }
  }
  function botStrength(id) {
    const h = game.hand; const hole = h.cards[id];
    if (h.board.length < 3) return R.holeStrength(hole);
    const hd = R.evalBest(hole.concat(h.board));
    const usesHole = hd.cards.some(c => hole.includes(c));
    const hi = Math.max(...hole.map(c => R.cardById(c).r)) / 14;
    let v;
    if (hd.cat === 0) v = 0.12 + hi * 0.18;
    else if (hd.cat === 1) v = 0.32 + hd.tb[0] / 14 * 0.16 + (usesHole ? 0.06 : -0.08);
    else if (hd.cat === 2) v = 0.56 + (usesHole ? 0.06 : -0.1);
    else if (hd.cat === 3) v = 0.7 + (usesHole ? 0.06 : -0.1);
    else if (hd.cat === 4) v = 0.8;
    else if (hd.cat === 5) v = 0.86;
    else v = 0.95;
    /* 보드가 열릴수록 확정 강도. 아직 카드가 남았으면 조금 보수적으로 */
    if (h.board.length < 5) v -= 0.04;
    return Math.max(0, Math.min(1, v));
  }
  function botDecide(id) {
    const opts = game.actionsFor(id); if (!opts.length) return null;
    const p = game.player(id); const br = p.brain || (p.brain = { aggr: 0.5, bluff: 0.1 });
    const has = t => opts.find(o => o.type === t);
    const call = has('call'); const callAmt = call ? call.amount : 0;
    const pot = game.hand.pot;
    let s = botStrength(id) + (Math.random() - 0.5) * 0.14 + (br.aggr - 0.5) * 0.1;
    const bluffing = Math.random() < br.bluff;
    const rz = has('raise') || has('bet');
    const sizeTo = f => rz ? Math.max(rz.min, Math.min(rz.max, game.hand.curBet + Math.round((pot + callAmt) * f / 10) * 10)) : 0;
    let raise = null;
    if (rz && (s > 0.66 || bluffing)) raise = { type: rz.type, to: sizeTo(s > 0.85 ? 1 : s > 0.75 ? 0.66 : 0.5) };
    if (has('allin') && s > 0.92 && br.aggr > 0.55 && Math.random() < 0.5) raise = { type: 'allin' };
    if (!rz && has('allin') && s > 0.8 && callAmt < p.chips * 0.5) raise = { type: 'allin' };
    if (callAmt === 0) return raise || { type: 'check' };
    const odds = callAmt / (pot + callAmt);
    if (callAmt >= p.chips * 0.6 && s < 0.72 && !bluffing) return { type: 'fold' };
    if (s < Math.max(0.28, odds * 1.6) && !bluffing) return { type: 'fold' };
    return raise || { type: 'call' };
  }
  function scheduleBots() {
    clearTimeout(botTimer);
    if (role !== 'host' || !game) return;
    const h = game.hand;
    const think = 900 + Math.random() * 1500;
    if (game.phase === 'betting' && h && h.turn) {
      const p = game.player(h.turn);
      if (p && p.bot) { const turn = h.turn, at = h.turnAt; botTimer = setTimeout(() => { if (game.phase === 'betting' && game.hand === h && h.turn === turn && h.turnAt === at) { const a = botDecide(turn); if (a) game.act(turn, a.type, a.to); } }, Math.max(think, dealEndsAt - Date.now() + 400)); }
      return;
    }
    if (!game.inProgress()) {
      const broke = game.players.find(p => p.bot && game.canRebuy(p.id));
      if (broke) { botTimer = setTimeout(() => { if (game.canRebuy(broke.id)) game.rebuy(broke.id); }, 1200); return; }
      const st = game.starter();
      if (st && game.player(st) && game.player(st).bot && game.canStart()) { botTimer = setTimeout(() => { if (game.starter() === st && game.canStart()) game.startBy(st); }, 6000); }
    }
  }
  function botTaunts(prev, v) {
    if (role !== 'host' || !v.result || (prev && prev.phase === 'result')) return;
    const r = v.result;
    for (const p of game.players) {
      if (!p.bot || !v.players.find(x => x.id === p.id && x.inHand)) continue;
      const won = r.winners.includes(p.id); const lines = won ? BOT_TAUNT.win : BOT_TAUNT.lose;
      if (Math.random() < (won ? 0.6 : 0.3)) setTimeout(() => { if (host) hostChat(p.name, lines[Math.floor(Math.random() * lines.length)]); }, 2500 + Math.random() * 2500);
    }
  }
  function scheduleHostTimer() {
    scheduleBots();
    clearTimeout(hostTimer);
    const h = game.hand; const s = game.settings;
    if (!h || !s.turnSec) return;
    if (game.phase === 'betting' && h.turn) {
      const turn = h.turn, at = h.turnAt;
      hostTimer = setTimeout(() => { if (game.phase === 'betting' && game.hand === h && h.turn === turn && h.turnAt === at) game.autoAct(turn); }, at + s.turnSec * 1000 - Date.now() + 300);
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
    host = new N.Host(code, hostHandlers(() => { host.close(); host = null; setTimeout(() => createRoom(name), 200); }));
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
      onHostDown: onHostDown,
      onMessage: msg => {
        if (msg.t === 'state') { if (msg.snap) lastSnap = msg.snap; migrating = false; clearTimeout(takeoverTimer); receiveView(msg.view); }
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

  /* ── 방장 이전 ── */
  function onHostDown() {
    if (role !== 'client' || migrating || !lastSnap) return;
    migrating = true;
    const cands = lastSnap.players.filter(p => p.connected && p.id !== lastSnap.hostId).sort((a, b) => a.seat - b.seat);
    const rank = cands.findIndex(p => p.id === myId);
    if (rank < 0) return;
    const wait = rank === 0 ? 2500 : 2500 + rank * 9000;
    toast(rank === 0 ? '방장 연결 끊김 — 내가 방을 이어받는 중…' : `방장 연결 끊김 — ${cands[0].name}이(가) 이어받는 중…`, 4000);
    clearTimeout(takeoverTimer);
    takeoverTimer = setTimeout(() => tryTakeover(), wait);
  }
  function tryTakeover() {
    if (role !== 'client' || !migrating || !lastSnap) return;
    if (client && client.conn && client.conn.open) { migrating = false; return; }
    const snap = lastSnap;
    try { client.close(); } catch (e) { } client = null;
    role = 'host';
    game = E.Game.restore(snap, myId);
    game.onChange = hostBroadcast;
    host = new N.Host(code, hostHandlers(() => {
      host.close(); host = null; role = 'client'; game = null; migrating = false;
      joinRoom(code, myName);
    }));
    host.takeover = true;
    host.start();
    toast('방장을 이어받았어요. 친구들이 다시 붙는 중…', 4000);
  }

  /* ── 뷰 수신 → 이펙트 → 렌더 ── */
  function receiveView(v) {
    const prev = view; view = v;
    if (v.turnLeft != null) { localDeadline = Date.now() + v.turnLeft; deadlineTotal = v.settings.turnSec * 1000; } else localDeadline = 0;
    if (v.handNo !== revealedHand) {
      revealed = new Set(); revealedHand = v.handNo; lastCardKey = {}; meCardsKey = ''; goodKey = ''; $('me-cards').innerHTML = ''; $('board').innerHTML = ''; $('board').dataset.n = 0;
      $('result').classList.add('hidden'); $('rebuy').classList.add('hidden'); $('winfx').classList.add('hidden'); $('reaction').classList.add('hidden'); closeRaise(); renderedTurn = null;
      if (sd) { sd.timers.forEach(clearTimeout); sd = null; $('sdstage').classList.add('hidden'); $('screen-table').querySelector('.felt').classList.remove('dim'); }
      if (prev) banner(`${v.handNo}판`, 'small', `블라인드 ${fmt(v.sb)}/${fmt(v.settings.bb)}`);
    }
    const me = v.players.find(p => p.id === myId);
    if (prev && prev.handNo === v.handNo) effects(prev, v, me);
    else if (prev && v.handNo !== prev.handNo) { Snd.deal(); }
    if (me && me.cards && v.phase === 'result') me.cards.forEach(c => revealed.add(c));
    render();
  }
  let unread = 0;
  function addChat(line) {
    chatLines.push(line); if (chatLines.length > 60) chatLines.shift(); renderLog();
    const p = view && view.players.find(x => x.name === line.from);
    if (p) { bubbles[p.id] = { text: line.text, until: Date.now() + 4500, k: Math.random(), chat: true }; if (view) renderTable(); }
    const feed = $('chatfeed');
    if (feed) {
      const el = document.createElement('div'); el.className = 'cf-item';
      el.innerHTML = `<img class="${avatarCls(p ? p.avatar : 'dog')}" src="${avatarSrc(p ? p.avatar : 'dog')}" alt=""><b>${esc(line.from)}</b><span>${esc(line.text)}</span>`;
      feed.appendChild(el);
      while (feed.children.length > 4) feed.firstChild.remove();
      setTimeout(() => { el.classList.add('gone'); setTimeout(() => el.remove(), 400); }, 9000);
    }
    if ($('drawer').classList.contains('hidden') && line.from !== myName) { unread++; const u = $('unread'); u.textContent = unread > 9 ? '9+' : unread; u.classList.remove('hidden'); }
    if (line.from !== myName) Snd.chat();
  }

  function render() {
    if (!view) return;
    const lobby = (view.phase === 'lobby' && view.handNo === 0) || inSettings;
    if (lobby) { show('screen-lobby'); renderLobby(); }
    else { show('screen-table'); renderTable(); if (bgmOn) Bgm.start(); keepAwake(); }
    renderLog();
  }

  /* ── 대기실 ── */
  let settingsBound = false;
  function renderLobby() {
    const isHost = role === 'host';
    $('lobby-code').textContent = code;
    $('lobby-players').innerHTML = view.players.map(p => `
      <div class="lp"><span class="dot ${p.connected ? '' : 'off'}"></span><img class="${avatarCls(p.avatar)}" src="${avatarSrc(p.avatar)}" alt=""><span>${esc(p.name)}</span>
        ${p.seat === 0 ? '<span class="tag">방장</span>' : ''}${p.id === myId ? '<span class="tag">나</span>' : ''}
        ${p.bot ? '<span class="bot-tag">🤖 봇</span>' : ''}${p.rebuys ? `<span class="rebuy-tag">충전 ${p.rebuys}회</span>` : ''}<span class="sp"></span><span class="muted">💰 ${won(p.chips)}</span>
        ${isHost && p.id !== myId ? `<button class="icon-btn kick" data-id="${p.id}" title="내보내기">✕</button>` : ''}</div>`).join('');
    if (isHost) $('lobby-players').querySelectorAll('.kick').forEach(b => b.onclick = () => { host.kick(b.dataset.id); game.removePlayer(b.dataset.id); });
    const s = view.settings;
    $('settings').classList.toggle('readonly', !isHost);
    $('settings-who').textContent = isHost ? '' : '(방장만 변경)';
    const fill = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
    fill('set-bb', s.bb); fill('set-turn', s.turnSec); fill('set-max', s.maxPlayers); fill('set-chips', s.startChips);
    $('sb-note').textContent = `스몰 블라인드 ${fmt(view.sb)}원 / 빅 블라인드 ${fmt(s.bb)}원 · 최소 레이즈 폭은 직전 레이즈만큼`;
    if (!settingsBound) {
      settingsBound = true;
      const push = () => doSettings({ bb: +$('set-bb').value, turnSec: +$('set-turn').value, maxPlayers: +$('set-max').value, startChips: +$('set-chips').value });
      ['set-bb', 'set-turn', 'set-max', 'set-chips'].forEach(id => { $(id).addEventListener('change', push); $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $(id).blur(); push(); } }); });
    }
    const n = view.players.filter(p => p.connected).length;
    $('btn-start').disabled = !(isHost && view.canStart);
    $('btn-start').textContent = view.handNo ? '다음 판 시작' : '게임 시작';
    $('lobby-hint').textContent = isHost ? (view.canStart ? `${n}명 준비됨` : '2명 이상 모이면 시작할 수 있어요 (봇을 넣어도 돼요)') : `방장이 시작하길 기다리는 중 (${n}명)`;
    $('btn-addbot').classList.toggle('hidden', !isHost);
  }

  /* ── 테이블 ── */
  function renderTable() {
    const me = view.players.find(p => p.id === myId);
    const isHost = role === 'host';
    const res = view.result;
    const hideMoney = !!(res && sd && sd.handNo === view.handNo && !sd.done);
    const shownChips = p => hideMoney ? p.chips - (p.payout || 0) : p.chips;
    const shownPot = hideMoney ? view.players.reduce((a, p) => a + (p.payout || 0), 0) : view.pot;
    $('top-code').textContent = code;
    $('top-hand').textContent = view.handNo ? `${view.handNo}판 · ${view.stageLabel}` : '';
    $('mode-tag').textContent = `블라인드 ${fmt(view.sb)}/${fmt(view.settings.bb)}`;
    { const pe = $('pot'); const prevPot = +pe.dataset.v || 0; tweenNum(pe, shownPot, 500); if (shownPot > prevPot && prevPot) { pe.classList.remove('tick'); void pe.offsetWidth; pe.classList.add('tick'); } }
    { const pile = $('pot-pile'); const h = stackHtml(view.phase === 'result' && !hideMoney ? 0 : shownPot, false); if (pile.dataset.k !== h) { pile.innerHTML = h; pile.dataset.k = h; pile.classList.remove('bump'); void pile.offsetWidth; pile.classList.add('bump'); } }
    { const ms = $('my-stack'); const h = me && me.bet && view.phase !== 'result' ? stackHtml(me.bet) : ''; if (ms.dataset.k !== h) { ms.innerHTML = h; ms.dataset.k = h; ms.classList.remove('bump'); void ms.offsetWidth; ms.classList.add('bump'); } }

    /* 상대 자리 */
    const others = view.players.filter(p => p.id !== myId);
    const seats = $('seats');
    seats.className = `seats n${Math.min(others.length, 7)}`;
    const turnChanged = view.turn !== renderedTurn; renderedTurn = view.turn;
    seats.innerHTML = others.map((p, seatIdx) => {
      const cls = ['seat'];
      if (p.isTurn) cls.push('turn');
      if (p.isTurn && turnChanged) cls.push('turn-in');
      if (p.folded) cls.push('folded');
      if (!p.connected) cls.push('off');
      if (res && !hideMoney && res.winners.includes(p.id)) cls.push('winner');
      if (view.handNo && !p.inHand) cls.push('out');
      if (p.away) cls.push('away');
      let status = '', scls = '';
      if (!p.connected) status = '오프라인';
      else if (p.away && !p.inHand) { status = '자리 비움'; scls = 'away'; }
      else if (view.handNo && !p.inHand) status = p.chips === 0 ? '돈 없음' : '대기';
      else if (p.folded) { status = '폴드'; scls = 'die'; }
      else if (res && p.handDesc) status = sdGate(p) && !sd.hand[p.id] ? '…' : p.handDesc;
      else if (p.allin) { status = '올인'; scls = 'hot'; }
      else if (p.isTurn) { status = '생각 중…'; scls = 'hot'; }
      if (view.spectating && p.inHand && p.handDesc && !res && !p.folded) status = `<b class="spec-hand">${esc(p.handDesc)}</b>${status ? ' · ' + status : ''}`;
      const net = res && p.inHand && !hideMoney ? p.payout - p.contrib : 0;
      const usedIds = res && res.used ? res.used[p.id] : null;
      return `<div class="${cls.join(' ')}" data-id="${p.id}">
        ${p.isDealer ? '<div class="dealer">D</div>' : ''}
        ${p.isSB && p.inHand ? '<div class="blind sb">SB</div>' : p.isBB && p.inHand ? '<div class="blind bb">BB</div>' : ''}
        ${res && p.inHand && net ? `<div class="seat-bet payout-badge ${net < 0 ? 'neg' : ''}">${net > 0 ? '+' : ''}${fmt(net)}</div>` : ''}
        ${p.bet && !res ? `<div class="stack">${stackHtml(p.bet)}</div>` : ''}
        ${bubbleHtml(p.id)}
        <img class="${avatarCls(p.avatar)}" src="${avatarSrc(p.avatar)}" alt="">
        <div class="seat-name">${esc(p.name)}${p.bot ? '<span class="bot-tag">🤖</span>' : ''}</div>
        <div class="seat-chips">💰 ${fmt(shownChips(p))}${p.rebuys ? `<span class="rebuy-tag">충전 ${p.rebuys}회</span>` : ''}</div>
        <div class="seat-cards">${p.inHand && !(p.folded && !p.cards) ? cardsHtml(p, '', usedIds, seatIdx) : ''}</div>
        <div class="seat-status ${scls}">${status}</div>
        ${p.folded && p.inHand && !res ? '<div class="stamp">FOLD</div>' : ''}
        ${p.isTurn && localDeadline ? '<div class="timer"></div>' : ''}
      </div>`;
    }).join('');

    /* 공유 카드 */
    renderBoard(me);

    /* 가운데 메시지 */
    const cm = $('center-msg');
    cm.classList.remove('me');
    if (view.phase === 'betting') {
      if (view.turn === myId) { cm.textContent = me && view.curBet > me.bet ? `내 차례 · 콜 ${won(view.curBet - me.bet)}` : '내 차례'; cm.classList.add('me'); }
      else { const t = view.players.find(p => p.id === view.turn); cm.textContent = t ? `${t.name}의 차례` : ''; }
    } else if (view.phase === 'result' && res) {
      cm.textContent = (sd && sd.handNo === view.handNo && !sd.done) ? (sd.cur ? `쇼다운 · ${sd.cur} 공개 중…` : '쇼다운…') : `${res.winners.map(id => view.players.find(p => p.id === id)?.name).join(', ')} 승리`;
    } else cm.textContent = '';
    $('timer-bar').classList.toggle('on', !!localDeadline && view.phase === 'betting');

    /* 나 */
    const meBox = $('me');
    meBox.classList.toggle('folded', !!(me && me.folded));
    meBox.classList.toggle('myturn', view.phase === 'betting' && view.turn === myId);
    if (view.phase === 'betting' && view.turn === myId && turnChanged) { meBox.classList.remove('turn-in'); void meBox.offsetWidth; meBox.classList.add('turn-in'); }
    const roleTag = me && me.inHand ? (me.isDealer ? ' <span class="muted">딜러</span>' : '') + (me.isSB ? ' <span class="muted">SB</span>' : me.isBB ? ' <span class="muted">BB</span>' : '') : '';
    $('me-name').innerHTML = `<img class="${avatarCls(me ? me.avatar : myChar)}" src="${avatarSrc(me ? me.avatar : myChar)}" alt=""> ${esc(me ? me.name : myName)}${roleTag}${view.spectating ? ' <span class="muted">(관전 중)</span>' : !me || !me.inHand ? ' <span class="muted">(대기)</span>' : ''}`;
    const oldB = meBox.querySelector('.bubble'); if (oldB) oldB.remove();
    if (me) meBox.insertAdjacentHTML('afterbegin', bubbleHtml(me.id));
    Bgm.setTense(view.phase === 'betting' && view.turn === myId);
    renderMyCards(me);
    tweenNum($('me-chips'), me ? shownChips(me) : 0, 700);
    $('me-bet').innerHTML = (me && me.bet ? `· 이번 라운드 ${won(me.bet)}` : (me && me.inHand && me.contrib ? `· 넣은 돈 ${won(me.contrib)}` : '')) + (me && me.rebuys ? ` <span class="rebuy-tag">충전 ${me.rebuys}회</span>` : '');

    /* 행동 버튼 */
    const ab = $('actions');
    if (view.phase === 'betting' && view.actions.length) {
      const A = {}; view.actions.forEach(a => A[a.type] = a);
      const rz = A.raise || A.bet;
      const callIsAllin = A.call && me && A.call.amount >= me.chips;
      let s = `<button class="btn fold" data-type="fold">폴드</button>`;
      if (A.check) s += `<button class="btn" data-type="check">체크</button>`;
      else if (A.call) s += `<button class="btn call" data-type="call">콜<small>${won(A.call.amount)}${callIsAllin ? ' 올인' : ''}</small></button>`;
      if (rz) s += `<button class="btn raise" data-type="${rz.type}">${rz.label}<small>${won(rz.min)}부터</small></button>`;
      if (A.allin) s += `<button class="btn allin" data-type="allin">올인<small>${won(A.allin.amount)}</small></button>`;
      ab.innerHTML = s;
      ab.querySelectorAll('button').forEach(b => b.onclick = () => {
        const t = b.dataset.type;
        if (t === 'raise' || t === 'bet') { openRaise(rz); return; }
        if (t === 'allin' && !confirm(`남은 ${won(me ? me.chips : 0)} 전부 올인할까요?`)) return;
        ab.querySelectorAll('button').forEach(x => x.disabled = true); closeRaise(); doAction(t);
      });
      if (armedTurnAt !== view.turnAt) {
        armedTurnAt = view.turnAt; const at = view.turnAt;
        ab.querySelectorAll('button').forEach((b, i) => { b.classList.add('arming'); b.style.transitionDelay = (i * 60) + 'ms'; });
        const arm = () => { if (!view || view.turnAt !== at) return; const left = dealEndsAt - Date.now(); if (left > 0) { setTimeout(arm, left); return; } ab.querySelectorAll('button').forEach(b => b.classList.remove('arming')); };
        setTimeout(arm, 520);
      }
      if (raiseOpen && raiseOpen.turnAt !== view.turnAt) closeRaise();
    } else if (view.phase === 'betting') {
      closeRaise();
      const t = view.players.find(p => p.id === view.turn);
      ab.innerHTML = `<div class="wait">${me && me.folded ? '폴드 — 이번 판은 구경' : view.spectating ? '👀 관전 중 — 모든 패가 보여요 · 다음 판부터 참가' : me && !me.inHand ? '다음 판부터 참가해요' : me && me.allin ? '올인 — 결과를 기다리는 중' : t ? `${esc(t.name)} 차례를 기다리는 중` : '…'}</div>`;
    } else if (sd && sd.handNo === view.handNo && !sd.done) {
      closeRaise();
      ab.innerHTML = `<div class="wait">쇼다운 중… ${sd.cur ? esc(sd.cur) + ' 공개' : ''}</div><button class="btn" id="btn-skip-sd">건너뛰기 ▶</button>`;
      $('btn-skip-sd').onclick = () => { if (sd && sd.skip) sd.skip(); };
    } else {
      closeRaise();
      let s = '';
      if (me && me.canRebuy) s += `<button class="btn raise" id="btn-rebuy">다시 참가<small>${won(view.settings.startChips)}</small></button>`;
      const iStart = view.starter ? view.starter === myId : isHost;
      if (iStart) s += `<button class="btn call" id="btn-next">다음 판 시작<small>${view.starter ? '진 사람이 시작 · ' : ''}블라인드 ${fmt(view.sb)}/${fmt(view.settings.bb)}</small></button>`;
      else s += `<div class="wait">${view.starter ? `${esc(view.starterName)}(진 사람)이` : '방장이'} 다음 판을 시작하면 이어져요</div>`;
      if (isHost) { s += `<button class="btn" id="btn-settings">설정</button>`; if (!iStart) s += `<button class="btn ghost small" id="btn-next-force">대신 시작</button>`; }
      ab.innerHTML = s;
      if ($('btn-next')) $('btn-next').onclick = doStart;
      if ($('btn-next-force')) $('btn-next-force').onclick = () => { if (confirm(`${view.starterName}(진 사람) 대신 시작할까요?`)) doStart(); };
      if ($('btn-settings')) $('btn-settings').onclick = () => { inSettings = true; render(); };
      if ($('btn-rebuy')) $('btn-rebuy').onclick = doRebuy;
    }

    renderQuick(me);
    animateDeals();
    if (view.phase === 'result' && res) renderResult(me);
    if (me && me.canRebuy && rebuyDismissed !== view.handNo && $('result').classList.contains('hidden')) { $('rb-yes').textContent = `${won(view.settings.startChips)}으로 다시 참가`; $('rb-desc').textContent = `${won(view.settings.startChips)}으로 다시 참가할 수 있어요. 지금 판이 끝나면 바로 들어갑니다.`; $('rebuy').classList.remove('hidden'); }
    else if (!(me && me.canRebuy)) $('rebuy').classList.add('hidden');
    tick();
  }

  /* 보드: 5칸, 새로 열리는 카드는 순서대로 뒤집힌다 (런아웃이면 스트리트 간격을 둔다) */
  function renderBoard(me) {
    const board = $('board');
    if (!view.handNo) { board.innerHTML = ''; board.dataset.n = 0; return; }
    const usedIds = (view.phase === 'result' && me && me.best) ? me.best : [];
    const prevN = +board.dataset.n || 0;
    const n = view.board.length;
    const streetsAtOnce = n > prevN ? (prevN < 3 ? 1 + Math.max(0, n - 3) : n - prevN) : 0;
    let s = view.board.map((c, i) => {
      const isNew = i >= prevN;
      let delay = 0;
      if (isNew) { const street = i < 3 ? 0 : i - 2; const firstNewStreet = prevN < 3 ? 0 : prevN - 2; delay = (street - firstNewStreet) * (streetsAtOnce > 1 ? 1100 : 0) + (i < 3 ? i * 160 : 0); }
      return cardHtml(c, 'mid', (isNew ? 'flip ' : '') + (usedIds.includes(c) ? 'used' : usedIds.length ? 'dim' : '')).replace('<div class="card', isNew ? `<div style="animation-delay:${delay}ms;opacity:0;animation-fill-mode:both" class="card` : '<div class="card');
    }).join('');
    for (let i = n; i < 5; i++) s += '<div class="slot"></div>';
    s += `<div class="board-label">${n === 0 ? '프리플롭' : n === 3 ? 'FLOP' : n === 4 ? 'TURN' : 'RIVER'}</div>`;
    if (board.dataset.k !== s) { board.innerHTML = s; board.dataset.k = s; }
    board.dataset.n = n;
  }

  /* ── 레이즈 패널 ── */
  let raiseOpen = null;
  function openRaise(a) {
    raiseOpen = { a, turnAt: view.turnAt, to: a.min };
    const panel = $('raise-panel'); panel.classList.remove('hidden');
    $('rp-title').textContent = a.type === 'bet' ? '벳' : '레이즈';
    const range = $('rp-range'); range.min = a.min; range.max = a.max; range.step = a.step || 10; range.value = a.min;
    const presets = a.presets.filter((p, i, arr) => arr.findIndex(x => x.to === p.to) === i);
    $('rp-presets').innerHTML = presets.map(p => `<button data-to="${p.to}">${p.label}<br><small>${fmt(p.to)}</small></button>`).join('') + `<button data-to="${a.max}">올인<br><small>${fmt(a.max)}</small></button>`;
    const paint = () => {
      const to = raiseOpen.to; $('rp-amt').textContent = fmt(to);
      range.value = to; range.style.setProperty('--p', ((to - a.min) / Math.max(1, a.max - a.min) * 100) + '%');
      $('rp-presets').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.to === to));
      $('rp-ok').innerHTML = to >= a.max ? `올인 ${won(a.max)}` : `${a.type === 'bet' ? '벳' : '레이즈'} ${won(to)}`;
    };
    range.oninput = () => { let v = Math.round(+range.value / 10) * 10; if (v >= a.max - 5) v = a.max; raiseOpen.to = Math.max(a.min, Math.min(a.max, v)); paint(); };
    $('rp-presets').querySelectorAll('button').forEach(b => b.onclick = () => { raiseOpen.to = +b.dataset.to; paint(); Snd.chip(); });
    $('rp-ok').onclick = () => { const to = raiseOpen.to; if (to >= a.max && !confirm(`남은 돈 전부 올인할까요?`)) return; closeRaise(); $('actions').querySelectorAll('button').forEach(x => x.disabled = true); doAction(to >= a.max ? 'allin' : a.type, to); };
    $('rp-cancel').onclick = closeRaise;
    paint();
  }
  function closeRaise() { raiseOpen = null; $('raise-panel').classList.add('hidden'); }

  /* ── 내 카드: 쪼기 + 사용 카드 강조 ── */
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
    const allRevealed = me.cards.every(c => revealed.has(c));
    const key = [me.cards.join(','), me.cards.map(c => revealed.has(c) ? 1 : 0).join(''), allRevealed ? usedIds.join(',') : '', me.folded ? 1 : 0, view.phase, view.board.length].join('|');
    /* 다 열었을 때 / 보드가 열릴 때 내 패 리액션 (판·스트리트마다 한 번) */
    if (allRevealed && !me.folded && goodKey !== `${view.handNo}:${view.board.length}`) {
      goodKey = `${view.handNo}:${view.board.length}`;
      reaction(me);
    }
    if (key !== meCardsKey && peekActive) peekPending = true;
    else if (key !== meCardsKey) {
      meCardsKey = key;
      const prevCount = box.querySelectorAll('.card').length;
      box.innerHTML = me.cards.map((c, i) => {
        const isRev = revealed.has(c);
        const used = allRevealed && usedIds.includes(c) && view.phase === 'result';
        const dim = allRevealed && view.phase === 'result' && usedIds.length && !usedIds.includes(c);
        const cls = ['big', isRev ? '' : 'peek', i >= prevCount ? 'deal' : '', used ? 'used' : '', dim ? 'dim' : ''].join(' ');
        const inner = isRev ? '' : `<div class="cover">${CARDS.BACK}</div><div class="hint">${PEEK_HINT[peekMode]}</div>`;
        return cardHtml(c, cls, '').replace('</div></div>', `</div>${inner}</div>`);
      }).join('');
      box.querySelectorAll('.card.peek').forEach(el => bindPeek(el));
    }
    mh.className = 'me-hand';
    if (me.folded) mh.textContent = '폴드';
    else if (!allRevealed) { mh.classList.add('hidden-hand'); mh.textContent = revealed.size ? '더 열어보세요…' : '카드를 쪼아보세요'; }
    else {
      const desc = me.handDesc || '';
      if (view.board.length >= 3 && me.best) { const h = R.evalBest(me.cards.concat(view.board)); if (h.cat >= 4) mh.classList.add('special'); mh.innerHTML = `${esc(desc)}<span class="sub">${view.board.length < 5 ? '지금까지' : '최종'}</span>`; }
      else mh.textContent = desc;
    }
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

  /* ── 이펙트 ── */
  function seatEl(id) { return id === myId ? $('me') : document.querySelector(`.seat[data-id="${id}"]`); }
  function stackEl(id) { if (id === myId) return $('my-stack'); const s = document.querySelector(`.seat[data-id="${id}"] .stack`); return s || seatEl(id); }
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
  let shuffledHand = 0, dealEndsAt = 0;
  function animateDeals() {
    const targets = [...document.querySelectorAll('#screen-table .card.deal:not([data-flown])')];
    if (!targets.length) return;
    const fx = $('fx'); const fr = fx.getBoundingClientRect(); const src = $('deck').getBoundingClientRect();
    const sx = src.left + src.width / 2 - fr.left, sy = src.top + src.height / 2 - fr.top;
    const inHand = view.players.filter(p => p.inHand).sort((a, b) => a.seat - b.seat);
    const dSeat = (view.players.find(p => p.isDealer) || {}).seat ?? -1;
    const order = inHand.filter(p => p.seat > dSeat).concat(inHand.filter(p => p.seat <= dSeat)).map(p => p.id);
    const items = targets.map(el => {
      const seat = el.closest('.seat'); const pid = seat ? seat.dataset.id : (el.closest('#me-cards') ? myId : null);
      const idx = [...el.parentElement.children].filter(c => c.classList.contains('card')).indexOf(el);
      return { el, pid, idx, rank: pid ? order.indexOf(pid) : 99 };
    }).sort((a, b) => a.idx - b.idx || a.rank - b.rank);
    let base = 0;
    if (shuffledHand !== view.handNo) {
      shuffledHand = view.handNo; base = 1000;
      const deck = $('deck'); deck.classList.remove('shuffling'); void deck.offsetWidth; deck.classList.add('shuffling'); Snd.shuffle();
      setTimeout(() => deck.classList.remove('shuffling'), 950);
    }
    const per = 170;
    dealEndsAt = Date.now() + base + items.length * per + 400;
    items.forEach((it, i) => {
      const el = it.el;
      el.dataset.flown = '1'; el.classList.remove('deal'); el.style.visibility = 'hidden';
      const r = el.getBoundingClientRect(); if (!r.width) { el.style.visibility = ''; return; }
      const fly = document.createElement('div'); fly.className = 'card-fly'; fly.innerHTML = CARDS.BACK;
      fly.style.left = sx + 'px'; fly.style.top = sy + 'px'; fly.style.width = r.width + 'px'; fly.style.height = r.height + 'px';
      fx.appendChild(fly);
      const dx = r.left + r.width / 2 - fr.left - sx, dy = r.top + r.height / 2 - fr.top - sy;
      const delay = base + i * per;
      const anim = fly.animate([
        { transform: 'translate(-50%,-50%) rotate(-6deg) scale(.92)', opacity: 0.95 },
        { transform: `translate(calc(-50% + ${dx * 0.55}px), calc(-50% + ${dy * 0.55 - 18}px)) rotate(6deg) scale(1.03)`, opacity: 1, offset: 0.55 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(0) scale(1)`, opacity: 1 },
      ], { duration: 380, delay, easing: 'cubic-bezier(.25,.8,.3,1)', fill: 'both' });
      setTimeout(() => Snd.slide(), delay);
      const land = () => { fly.remove(); if (el.style.visibility === 'hidden') { el.style.visibility = ''; el.classList.add('landed'); } };
      anim.onfinish = land;
      setTimeout(land, delay + 380 + 250);
    });
  }
  function actPop(pid, type, text) {
    const host = seatEl(pid); if (!host) return;
    host.querySelectorAll('.act-pop').forEach(e => e.remove());
    const el = document.createElement('div'); el.className = 'act-pop ' + (type === 'fold' ? 'die' : type === 'allin' ? 'allin' : type === 'hand' ? 'hand' : (type === 'check' || type === 'call') ? '' : 'raise'); el.textContent = text;
    host.appendChild(el); setTimeout(() => el.remove(), 1400);
  }
  function reactionText(text, cls) {
    const el = $('reaction'); el.className = 'reaction ' + (cls || ''); el.textContent = text; el.classList.remove('hidden'); void el.offsetWidth;
    clearTimeout(reactionText.t); reactionText.t = setTimeout(() => el.classList.add('hidden'), 2500);
  }
  /* 내 패 리액션: 프리플롭은 2장 강도, 보드가 열리면 족보 */
  function reaction(me) {
    if (view.board.length < 3) {
      const s = R.holeStrength(me.cards); const [a, b] = me.cards.map(c => R.cardById(c));
      if (a.r === b.r && a.r >= 10) { reactionText('어이구 좋다~ ' + me.handDesc, ''); Snd.good(); try { navigator.vibrate && navigator.vibrate(60); } catch (e) { } }
      else if (s >= 0.7) { reactionText('오~ 괜찮은데? ' + me.handDesc, 'ok'); Snd.pop(); }
      else if (s <= 0.28) reactionText('음… 애매하네', 'bad');
      return;
    }
    const h = R.evalBest(me.cards.concat(view.board));
    const usesHole = h.cards.some(c => me.cards.includes(c));
    if (h.cat >= 6) { reactionText('대박!!! ' + h.name, 'great'); Snd.great(); confetti(30); try { navigator.vibrate && navigator.vibrate([80, 40, 120]); } catch (e) { } }
    else if (h.cat >= 4) { reactionText('어이구 좋다~ ' + h.name, ''); Snd.good(); try { navigator.vibrate && navigator.vibrate(60); } catch (e) { } }
    else if (h.cat >= 2 && usesHole) { reactionText('오~ ' + h.desc, 'ok'); Snd.pop(); }
    else if (h.cat === 1 && usesHole && h.tb[0] >= 11) reactionText('먹을 만하네', 'ok');
    else if (view.board.length === 5 && h.cat === 0) reactionText('…망했다', 'bad');
  }
  function celebrate(net, big, handName) {
    const el = $('winfx'); el.className = 'winfx';
    el.innerHTML = `<div class="w-title">${big ? '대박 승리!' : '승리!'}</div><div class="w-amount">+0원</div><div class="w-sub">${esc(handName || '모두 폴드')}</div>${streak >= 2 ? `<div class="w-streak">🔥 ${streak}연승!</div>` : ''}`;
    void el.offsetWidth;
    const amt = el.querySelector('.w-amount'); const t0 = performance.now(); const dur = 1200;
    const step = t => { const k = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - k, 3); amt.textContent = '+' + fmt(Math.round(net * e)) + '원'; if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
    const n = Math.min(60, 16 + Math.floor(net / 400));
    for (let i = 0; i < n; i++) {
      const c = document.createElement('div'); c.className = 'coin';
      c.style.left = (5 + Math.random() * 90) + '%'; c.style.animationDuration = (1.4 + Math.random() * 1.2) + 's'; c.style.animationDelay = (Math.random() * 1.2) + 's';
      $('fx').appendChild(c); setTimeout(() => c.remove(), 3200);
      if (i % 3 === 0) setTimeout(() => Snd.coin(i), 200 + i * 60);
    }
    try { navigator.vibrate && navigator.vibrate(big ? [60, 40, 60, 40, 160] : [40, 30, 90]); } catch (e) { }
    setTimeout(() => el.classList.add('hidden'), 3300);
  }
  function banner(text, cls, sub) {
    const b = $('banner'); b.className = 'banner ' + (cls || ''); b.innerHTML = esc(text) + (sub ? `<span class="sub">${esc(sub)}</span>` : '');
    b.classList.remove('hidden'); void b.offsetWidth;
    clearTimeout(banner.t); banner.t = setTimeout(() => b.classList.add('hidden'), 1800);
  }
  function confetti(n) {
    const fx = $('fx'); const colors = ['#ffd54f', '#ff6b5e', '#4fc98a', '#7c6cf0', '#fff'];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('div'); c.className = 'confetti';
      c.style.left = Math.random() * 100 + '%'; c.style.background = colors[i % colors.length];
      c.style.animationDuration = (1.6 + Math.random() * 1.4) + 's'; c.style.animationDelay = (Math.random() * 0.6) + 's';
      fx.appendChild(c); setTimeout(() => c.remove(), 3500);
    }
  }
  const STREET_BANNER = { 1: '플롭!', 2: '턴!', 3: '리버!' };
  function effects(prev, v, me) {
    const pm = {}; prev.players.forEach(p => pm[p.id] = p);
    let anyBet = false;
    for (const p of v.players) {
      const q = pm[p.id]; if (!q) continue;
      if (p.inHand && p.contrib > q.contrib && v.phase !== 'result') {
        anyBet = true;
        setTimeout(() => flyChip(seatEl(p.id), stackEl(p.id), p.contrib - q.contrib), 0);
        if (p.chips === 0 && q.chips > 0 && !p.folded) { banner('올인!', 'red small', p.name); Snd.big(); say(p.id, 'allin'); $('screen-table').querySelector('.felt').classList.add('shake'); setTimeout(() => $('screen-table').querySelector('.felt').classList.remove('shake'), 600); }
        else if (Math.random() < 0.6) say(p.id, p.bet > q.bet && p.bet >= v.curBet && p.contrib - q.contrib > v.settings.bb ? 'bet' : 'call');
      }
      if (p.folded && !q.folded) { Snd.die(); say(p.id, 'die'); }
    }
    if (anyBet) { Snd.chip(); $('pot-box').classList.remove('bump'); void $('pot-box').offsetWidth; $('pot-box').classList.add('bump'); }
    if (v.lastAction && v.lastAction.n !== (prev.lastAction ? prev.lastAction.n : 0)) {
      const a = v.lastAction; const label = a.label || E.ACTION_LABEL[a.type] || a.type;
      setTimeout(() => actPop(a.id, a.type, label + (a.to && a.type !== 'fold' && a.type !== 'check' ? ` ${fmt(a.to)}` : (a.type === 'fold' ? '' : '!'))), 0);
      if (a.type !== 'fold' && a.type !== 'check') Snd.pop();
    }
    /* 스트리트 전환: 각자 앞의 칩이 팟으로, 보드 배너 (런아웃이면 순서대로) */
    if ((v.street !== prev.street || v.phase !== prev.phase) && prev.phase === 'betting') {
      for (const q of prev.players) if (q.bet > 0) setTimeout(() => flyChip(seatEl(q.id), $('pot-pile'), q.bet), 60);
    }
    if (v.street > prev.street) {
      const first = prev.street + 1;
      for (let s = first; s <= v.street; s++) setTimeout(() => { banner(STREET_BANNER[s], 'gold small', s === 1 ? '공유 카드 3장' : ''); s === 1 ? Snd.flop() : Snd.reveal(); }, (s - first) * 1100);
      if (v.street - prev.street > 1) setTimeout(() => banner('올인 — 보드를 끝까지!', 'red small'), 100);
    }
    if (v.phase === 'betting' && v.turn === myId && (prev.turn !== myId || prev.phase !== 'betting')) Snd.turn();
    if (v.phase === 'result' && prev.phase !== 'result' && v.result) {
      const r = v.result;
      for (const id of r.winners) say(id, 'win');
      const showdown = !r.byFold;
      if (showdown) { banner('쇼다운!', 'red small'); Snd.whoosh(); startShowdown(r, v, me); }
      else setTimeout(() => announce(r, v, me), 200);
    }
  }
  /* 쇼다운 순차 공개: 진 사람부터, 마지막 승자는 두구두구 뒤에 */
  function startShowdown(r, v, me) {
    sd = { handNo: v.handNo, open: {}, hand: {}, done: false, timers: [], startedAt: Date.now(), cur: '' };
    const players = v.players.filter(p => r.revealed.includes(p.id));
    const order = players.filter(p => !r.winners.includes(p.id)).concat(players.filter(p => r.winners.includes(p.id)));
    const at = (ms, fn) => sd.timers.push(setTimeout(() => { if (sd && !sd.done && view && view.handNo === sd.handNo) fn(); }, ms));
    const felt = $('screen-table').querySelector('.felt');
    const stage = $('sdstage');
    let leader = null;
    let t = 450;
    at(t, () => felt.classList.add('dim'));
    order.forEach((p, pi) => {
      const last = pi === order.length - 1, isWin = r.winners.includes(p.id);
      const hand = r.hands[p.id]; const hole = p.cards || [];
      const big = hand && hand.cat >= 4;
      t += 200;
      at(t, () => {
        sd.cur = p.name; renderTable();
        stage.className = 'sdstage' + (last ? ' winner' : '');
        $('ss-avatar').src = avatarSrc(p.avatar); $('ss-avatar').className = avatarCls(p.avatar);
        $('ss-name').textContent = p.name; $('ss-sub').textContent = last ? '마지막 패…' : `${pi + 1}번째 공개`;
        $('ss-cards').innerHTML = hole.map(c => `<div class="ss-card ${last ? 'slow' : ''}"><div class="face">${CARDS.face(R.cardById(c))}</div><div class="cover">${CARDS.BACK}</div></div>`).join('');
        const hh = $('ss-hand'); hh.className = 'ss-hand'; hh.textContent = '';
        const ld = $('ss-lead'); ld.className = 'ss-lead'; ld.innerHTML = leader ? `현재 1등: <b>${esc(leader.name)}</b> ${esc(leader.hand)}` : '';
        stage.classList.remove('hidden'); Snd.whoosh();
      });
      hole.forEach((c, i) => {
        const finalCard = last && i === hole.length - 1;
        if (finalCard) { t += 250; at(t, () => { stage.classList.add('thump'); $('ss-sub').textContent = '두구두구…'; Snd.riser(); Snd.drum(); }); t += 1100; }
        else t += 250;
        const peelMs = finalCard ? 1000 : 650;
        at(t, () => { const el = $('ss-cards').children[i]; if (!el) return; el.style.setProperty('--peel', peelMs + 'ms'); el.querySelector('.cover').classList.add('peel'); Snd.peek(); stage.classList.remove('thump'); });
        t += peelMs;
        at(t, () => { const el = $('ss-cards').children[i]; if (!el) return; const cv = el.querySelector('.cover'); if (cv) cv.remove(); el.classList.add('hit'); Snd.snap(); });
        t += 150;
      });
      t += 150;
      at(t, () => {
        const hh = $('ss-hand'); hh.textContent = hand ? hand.desc : ''; hh.className = 'ss-hand show' + (big ? ' great' : hand && hand.cat === 0 ? ' bad' : '');
        big ? Snd.good() : Snd.pop();
        if (big) felt.classList.add('shake');
        const ld = $('ss-lead');
        if (isWin) { ld.className = 'ss-lead flip'; ld.textContent = r.winners.length > 1 ? '공동 1등 — 팟 분배' : leader ? '역전!! 1등' : '1등'; Snd.win(); }
        else if (!leader || (hand && hand.score > leader.score)) { ld.className = 'ss-lead' + (leader ? ' flip' : ''); ld.textContent = leader ? '역전! 현재 1등' : '현재 1등'; if (leader) Snd.pop(); leader = { name: p.name, score: hand ? hand.score : 0, hand: hand ? hand.desc : '' }; }
        else { ld.className = 'ss-lead'; ld.innerHTML = `1등은 여전히 <b>${esc(leader.name)}</b> ${esc(leader.hand)}`; }
        setTimeout(() => felt.classList.remove('shake'), 600);
        sd.open[p.id] = 9; sd.hand[p.id] = true; renderTable(); actPop(p.id, 'hand', hand ? hand.name : '');
      });
      t += last ? 1100 : 750;
      at(t, () => { stage.classList.add('out'); });
      t += 250;
      at(t, () => { stage.classList.add('hidden'); stage.classList.remove('out'); });
    });
    t += 100;
    at(t, () => finishShowdown(r, v, me));
    sd.skip = () => finishShowdown(r, v, me);
  }
  function finishShowdown(r, v, me) {
    if (!sd || sd.done) return;
    sd.timers.forEach(clearTimeout); sd.done = true;
    for (const id of r.revealed) { sd.open[id] = 9; sd.hand[id] = true; }
    $('sdstage').classList.add('hidden'); $('sdstage').classList.remove('thump', 'out');
    $('screen-table').querySelector('.felt').classList.remove('dim', 'shake');
    renderTable();
    announce(r, v, me);
  }
  function showResultPanel(ms) {
    const hn = view.handNo;
    setTimeout(() => { if (view && view.phase === 'result' && view.handNo === hn) $('result').classList.remove('hidden'); }, ms);
  }
  function announce(r, v, me) {
    const names = r.winners.map(id => v.players.find(p => p.id === id)?.name).join(', ');
    const top = r.winners.length ? r.hands[r.winners[0]] : null;
    const bigHand = top && top.cat >= 4;
    if (r.byFold) banner(`${names} 승리`, 'small', '모두 폴드');
    else if (bigHand) { banner(`${top.name}!`, 'gold', `${names} 승리`); $('screen-table').querySelector('.felt').classList.add('shake'); if (top.cat >= 6) confetti(60); }
    else banner(`${top ? top.desc : ''}`, 'small', `${names} 승리${r.winners.length > 1 ? ' — 팟 분배' : ''}`);
    setTimeout(() => $('screen-table').querySelector('.felt').classList.remove('shake'), 600);
    const meWon = r.winners.includes(myId);
    const myNet = me && me.inHand ? (r.payouts[myId] || 0) - me.contrib : 0;
    if (meWon) { streak++; bigHand ? Snd.big() : Snd.win(); }
    else if (me && me.inHand) { streak = 0; Snd.lose(); if (myNet <= -1000) { $('vignette').classList.remove('red'); void $('vignette').offsetWidth; $('vignette').classList.add('red'); reactionText(myNet <= -5000 ? '아… 크게 잃었다' : '아깝다…', 'bad'); } }
    const pot = $('pot-box');
    for (const id of r.winners) setTimeout(() => flyChip(pot, seatEl(id), r.payouts[id] || 0, true), 300);
    if (meWon && myNet > 0) setTimeout(() => celebrate(myNet, bigHand, top ? top.desc : ''), 500);
    showResultPanel(r.byFold ? 1500 : (meWon ? 2800 : 1600));
  }

  function renderQuick(me) {
    const q = $('quick');
    const away = !!(me && me.away);
    let s = '';
    if (view.canExtend) s += `<button class="ext" data-q="extend">⏱ +15초</button>`;
    s += `<button class="util ${away ? 'away-on' : ''}" data-q="away">${away ? '↩ 돌아오기' : '🚻 자리 비움'}</button>`;
    s += `<button class="util" data-q="stats">📊 전적</button>`;
    if (role === 'host') { s += `<button class="util" data-q="addbot">🤖 봇 추가</button>`; if (view.players.some(p => p.bot)) s += `<button class="util" data-q="rmbot">🤖 봇 빼기</button>`; }
    s += QUICK.map(t => `<button data-q="chat" data-t="${esc(t)}">${esc(t)}</button>`).join('');
    if (q.dataset.k !== s) { q.innerHTML = s; q.dataset.k = s; q.querySelectorAll('button').forEach(b => b.onclick = () => {
      const k = b.dataset.q;
      if (k === 'extend') doExtend();
      else if (k === 'away') doAway(!(view && view.players.find(p => p.id === myId)?.away));
      else if (k === 'stats') openStats();
      else if (k === 'addbot') addBot();
      else if (k === 'rmbot') { const b = game.players.filter(p => p.bot).pop(); if (b) { if (game.inProgress() && game.hand.participants.includes(b.id)) game.setAway(b.id, true); else game.removePlayer(b.id); toast(`${b.name} ${game.player(b.id) ? '다음 판부터 빠져요' : '내보냈어요'}`); } }
      else if (k === 'chat') doChat(b.dataset.t);
    }); }
  }
  function openStats() {
    const rows = view.players.slice().sort((a, b) => (b.stats?.net || 0) - (a.stats?.net || 0));
    $('stats-body').innerHTML = `<div class="st-row head"><span></span><span>이름</span><span class="r">판</span><span class="r">승</span><span class="r">충전</span><span class="r">순손익</span><span class="r">최고</span></div>` +
      rows.map(p => { const s = p.stats || {}; const net = s.net || 0; return `<div class="st-row"><img class="${avatarCls(p.avatar)}" src="${avatarSrc(p.avatar)}" alt=""><span class="nm">${esc(p.name)}${p.id === myId ? ' <span class="muted">나</span>' : ''}${s.maxStreak >= 2 ? ` <span class="muted">🔥${s.maxStreak}</span>` : ''}</span><span class="r">${s.hands || 0}</span><span class="r">${s.wins || 0}</span><span class="rb">${p.rebuys ? p.rebuys + '회' : '-'}</span><span class="${net >= 0 ? 'pos' : 'neg'}">${net > 0 ? '+' : ''}${fmt(net)}</span><span class="best">${s.best ? esc(s.best.name) : '-'}</span></div>`; }).join('');
    const hist = (view.history || []).slice().reverse();
    $('stats-hist').innerHTML = hist.length ? hist.map(h => `<div class="hist-row"><span>${h.no}판</span><b>${esc(h.winners.join(', '))}</b><span class="hh">${esc(h.hand)}</span><span>팟 ${fmt(h.pot)}</span></div>`).join('') : '<div class="hist-row">아직 없음</div>';
    $('stats').classList.remove('hidden');
  }
  function renderResult(me) {
    const res = view.result; const box = $('result');
    const nameOf = id => view.players.find(p => p.id === id)?.name || '?';
    const title = $('result-title'); title.className = 'result-title win';
    if (res.byFold) title.textContent = `${nameOf(res.winners[0])} 승리 — 모두 폴드`;
    else title.textContent = `${res.winners.map(id => `${nameOf(id)} (${res.hands[id].desc})`).join(', ')} 승리${res.winners.length > 1 ? ' — 팟 분배' : ''}`;
    const rows = view.players.filter(p => p.inHand).map(p => {
      const net = p.payout - p.contrib;
      const shown = p.cards && res.revealed.includes(p.id);
      const used = res.used && res.used[p.id] ? res.used[p.id] : [];
      return `<div class="rrow ${res.winners.includes(p.id) ? 'win' : ''}">
        <div class="rcards">${shown ? p.cards.map(c => cardHtml(c, '', used.includes(c) ? 'used' : used.length ? 'dim' : '')).join('') : p.folded ? '' : backHtml() + backHtml()}</div>
        <span class="rn">${esc(p.name)}${p.id === myId ? ' <span class="muted">나</span>' : ''}</span>
        <span class="rh">${p.folded ? '<span class="muted">폴드</span>' : shown ? (res.hands[p.id]?.desc || '') : ''}</span>
        <span class="rp ${net < 0 ? 'neg' : ''}">${(net > 0 ? '+' : '') + fmt(net)}</span></div>`;
    }).join('');
    const boardRow = view.board.length ? `<div class="result-note">보드: ${view.board.map(c => R.cardById(c).name).join(' ')}</div>` : '';
    $('result-body').innerHTML = boardRow + rows;
    let acts = '';
    const iStart = view.starter ? view.starter === myId : role === 'host';
    if (iStart) acts += `<button class="btn primary" id="res-next">다음 판 시작${view.starter ? ' — 진 사람이 시작' : ''}</button>`;
    else acts += `<div class="result-note">${view.starter ? `${esc(view.starterName)}(진 사람)이` : '방장이'} 다음 판을 시작하면 이어져요</div>`;
    if (me && me.canRebuy) acts += `<button class="btn" id="res-rebuy">${won(view.settings.startChips)}으로 다시 참가</button>`;
    acts += `<button class="btn ghost" id="res-close">닫고 테이블 보기</button>`;
    $('result-actions').innerHTML = acts;
    if ($('res-next')) $('res-next').onclick = doStart;
    if ($('res-rebuy')) $('res-rebuy').onclick = doRebuy;
    $('res-close').onclick = () => { box.classList.add('hidden'); renderTable(); };
    resultHand = view.handNo;
  }

  function tick() {
    if (!view || !localDeadline || view.phase !== 'betting') return;
    const leftMs = Math.max(0, localDeadline - Date.now());
    const left = Math.ceil(leftMs / 1000);
    const el = document.querySelector('.seat.turn .timer');
    if (el) { el.textContent = `${left}s`; el.classList.toggle('low', left <= 5); }
    const fill = $('timer-fill');
    fill.style.width = (deadlineTotal ? leftMs / deadlineTotal * 100 : 0) + '%'; fill.classList.toggle('low', left <= 5);
    if (view.turn === myId) {
      const me = view.players.find(p => p.id === myId);
      $('center-msg').textContent = `내 차례 · ${left}초${me && view.curBet > me.bet ? ` · 콜 ${won(view.curBet - me.bet)}` : ''}`;
      $('me').classList.toggle('urgent', left <= 5 && left > 0);
      if (left <= 5 && left !== lastTickSec) { lastTickSec = left; Snd.tick(); }
    } else { $('me').classList.remove('urgent'); lastTickSec = -1; }
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
    clearTimeout(hostTimer); clearTimeout(botTimer); Bgm.stop();
    if (host) { const h = host; try { h.broadcast({ t: 'bye' }); } catch (e) { } setTimeout(() => h.close(), 200); }
    if (client) client.close();
    host = null; client = null; game = null; view = null; role = null; inSettings = false; chatLines = []; lastCardKey = {}; resultHand = 0; meCardsKey = ''; revealed = new Set(); revealedHand = 0;
    ['result', 'drawer', 'invite', 'rebuy', 'stats', 'raise-panel'].forEach(id => $(id).classList.add('hidden'));
    lastSnap = null; migrating = false; clearTimeout(takeoverTimer); $('quick').dataset.k = ''; $('quick').innerHTML = ''; $('chatfeed').innerHTML = ''; unread = 0; $('unread').classList.add('hidden');
    $('home-err').textContent = err || '';
    show('screen-home');
    const ps = new URLSearchParams(location.search); ps.delete('room');
    history.replaceState(null, '', location.pathname + (ps.toString() ? '?' + ps : ''));
  }
  function leave() {
    if (role === 'host' && view && view.players.length > 1 && !confirm('방장이 나가면 다음 사람이 방을 이어받아요. 나갈까요?')) return;
    if (role === 'client' && view && view.phase === 'betting' && !confirm('판 진행 중이에요. 나가면 폴드 처리돼요.')) return;
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

  const inApp = N.inAppBrowser();
  if (inApp) {
    $('inapp').classList.remove('hidden');
    $('inapp').innerHTML = `<b>${esc(inApp)} 안의 브라우저</b>로 열려 있어요. 여기서는 연결이 안 될 수 있어요.<br>${N.isIOS() ? '오른쪽 아래(또는 위) <b>⋯ / 공유</b> 버튼 → <b>Safari로 열기</b>' : '오른쪽 위 <b>⋮</b> → <b>다른 브라우저로 열기(Chrome)</b>'} 를 눌러 다시 열어 주세요.`;
  }
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
    else advice = '이 기기는 연결 조건이 정상이에요. 그래도 안 되면 방장 쪽 기기에서도 진단을 해보세요.';
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
  $('btn-addbot').onclick = addBot;
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
  $('stats-close').onclick = () => $('stats').classList.add('hidden');
  $('rb-no').onclick = () => { rebuyDismissed = view ? view.handNo : 0; $('rebuy').classList.add('hidden'); };
  $('btn-log').onclick = () => { $('drawer').classList.toggle('hidden'); renderLog(); $('log').scrollTop = $('log').scrollHeight; unread = 0; $('unread').classList.add('hidden'); if (!$('drawer').classList.contains('hidden')) $('chat-in').focus(); };
  $('btn-drawer-close').onclick = () => $('drawer').classList.add('hidden');
  $('chat-form').onsubmit = e => { e.preventDefault(); doChat($('chat-in').value); $('chat-in').value = ''; };
  const bgmBtn = $('btn-bgm');
  const paintBgm = () => { bgmBtn.style.opacity = bgmOn ? '1' : '0.35'; };
  paintBgm();
  bgmBtn.onclick = () => { bgmOn = !bgmOn; localStorage.setItem(LS.bgm, bgmOn ? '1' : '0'); paintBgm(); if (bgmOn) Bgm.start(); else Bgm.stop(); toast(bgmOn ? '배경음악 켜짐' : '배경음악 꺼짐', 1000); };
  const muteBtn = $('btn-mute');
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.onclick = () => { muted = !muted; localStorage.setItem(LS.mute, muted ? '1' : '0'); muteBtn.textContent = muted ? '🔇' : '🔊'; };

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && sd && !sd.done && sd.skip && Date.now() - sd.startedAt > 20000) sd.skip(); });
  async function keepAwake() { try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { } }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && view) keepAwake(); });
  { const st = $('screen-table'); st.addEventListener('scroll', () => { if (st.scrollLeft || st.scrollTop) { st.scrollLeft = 0; st.scrollTop = 0; } }); }

  if (params.get('room')) nameIn.focus();
})();
