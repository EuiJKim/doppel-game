/* 도플 — UI·게임 플로우 (《한 장 더》) */
(() => {
  const $ = id => document.getElementById(id);
  const screens = ['home', 'pick', 'game', 'result', 'notes'];

  let session = null, round = null, aiId = null, decideStart = 0;
  let mode = 'spar'; // 'spar' | 'mirror'
  let pendingCall = null;                 // 이번 선택에 걸린 분신의 예측
  let sessionCall = { n: 0, hit: 0 };     // 이번 세션 적중 집계
  let faces = {};                         // home / seat / opp 얼굴 SVG

  /* ── 분신의 얼굴 ── */
  function initFaces() {
    faces.home = Face.mount($('doppel-face'), 78);
    faces.seat = Face.mount($('seat-face'), 30);
    faces.opp = Face.mount($('opp-face'), 62);
    refreshFaces();
  }

  function refreshFaces() {
    const c = Face.clarityOf(Doppel.summary());
    Object.values(faces).forEach(f => Face.apply(f, c));
  }

  /* 미니 거울전: 스파링이라도 마지막 라운드는 분신이 상대석에 앉는다.
   * "나와 마주함"을 정식 거울전(80선택+65%)까지 기다리지 않게 하는 장치. */
  function isMirrorSeat() {
    return mode === 'mirror' || session.round >= session.maxRounds;
  }

  /* ── 화면 전환 ── */
  function show(name) {
    screens.forEach(s => $('screen-' + s).classList.toggle('active', s === name));
    if (name === 'home') renderHome();
    if (name === 'notes') renderNotes();
  }

  /* ── 홈 ── */
  function renderHome() {
    const s = Doppel.summary();
    $('learn-count').textContent = (Doppel.isDemo() ? '[데모 분신] ' : '') + `배운 선택: ${s.choices} · 파악한 상황: ${s.bucketsLearned}/${s.totalBuckets}`;
    $('match-pct').textContent = s.matchRate === null ? '측정 전' : s.matchRate + '%';
    $('match-fill').style.width = (s.matchRate || 0) + '%';
    $('btn-mirror').disabled = !s.mirrorUnlocked;
    document.querySelector('#btn-mirror .lock').style.display = s.mirrorUnlocked ? 'none' : '';
    refreshFaces();
    $('home-quote').textContent = homeQuote(s);
  }

  function homeQuote(s) {
    if (Doppel.isDemo()) return '"저는 시연용 분신이에요. 거울전 바로 열어뒀습니다 — 주소에서 ?demo를 떼면 진짜 당신을 배우기 시작하죠."';
    if (s.choices === 0) return '"…누구세요? 아, 제가 배울 사람이구나. 일단 뽑아보시죠."';
    if (s.choices < 15) return `"${s.choices}번 봤는데요, 아직 사장님이 겁쟁이인지 도박꾼인지 모르겠어요."`;
    if (s.matchRate === null || s.matchRate < 40) return '"슬슬 감이 오는데… 사장님, 생각보다 복잡한 사람이네요?"';
    if (s.matchRate < 65) return `"일치율 ${s.matchRate}%. 사장님이 언제 멈추는지, 반은 꿰었어요."`;
    return '"이제 사장님 없어도 사장님처럼 뽑을 수 있어요. 증명해 볼까요?"';
  }

  /* ── 노트 화면 ── */
  function renderNotes() {
    const s = Doppel.summary();
    const list = $('notes-list');
    list.innerHTML = '';
    const skillLines = Doppel.skillLines();
    if (s.notes.length === 0 && skillLines.length === 0) {
      list.innerHTML = '<div class="note-card locked">아직 백지예요. 뽑아 주셔야 배우죠.</div>';
    } else {
      s.notes.concat(skillLines.map(t => ({ text: '🎴 ' + t }))).forEach(n => {
        const d = document.createElement('div');
        d.className = 'note-card';
        d.textContent = n.text;
        list.appendChild(d);
      });
    }
    const remain = s.totalBuckets - s.bucketsLearned;
    if (remain > 0) {
      const d = document.createElement('div');
      d.className = 'note-card locked';
      d.textContent = `아직 못 배운 상황 ${remain}가지 — 지어내진 않을 거예요.`;
      list.appendChild(d);
    }
  }

  /* ── 대전 플로우 ── */
  function newSessionState() {
    session = Engine.newSession();
    sessionCall = { n: 0, hit: 0 };
    pendingCall = null;
    $('seat-log').innerHTML = '';
    $('call-badge').className = 'call-badge';
    $('opp-face').classList.remove('on');
    $('seat-title').textContent = '분신 관전 중';
    $('skills').innerHTML = '';
    const fx = document.querySelector('.fx-row');
    if (fx) fx.innerHTML = '';
    renderCallGauge();
    refreshFaces();
  }

  function startSession(id) {
    mode = 'spar';
    aiId = id;
    newSessionState();
    show('game');
    $('opp-name').textContent = SparringAI.get(aiId).name;
    $('opp-name').classList.remove('is-doppel');
    nextRound();
  }

  function startMirror() {
    mode = 'mirror';
    newSessionState();
    show('game');
    $('opp-name').textContent = '분신';
    $('opp-name').classList.add('is-doppel');
    $('opp-face').classList.add('on');
    Sfx.play('mirror');
    seatNote('거울전. 상대는 당신에게 배운 대로 두는, 당신입니다.');
    nextRound();
  }

  function oppTitle() { return isMirrorSeat() ? '분신' : SparringAI.get(aiId).name; }

  function nextRound() {
    const first = session.round % 2 === 0 ? 'me' : 'opp';
    round = Engine.newRound(session, first);
    const c = $('deck-card');
    c.className = 'card back';
    c.textContent = '?';
    $('opp-speech').textContent = '';
    $('center-msg').textContent = '';
    $('call-badge').className = 'call-badge';
    const fxRow = document.querySelector('.fx-row');
    if (fxRow) fxRow.innerHTML = '';

    // 마지막 라운드 = 미니 거울전. 상대석이 바뀐다
    if (mode === 'spar' && isMirrorSeat()) {
      $('opp-name').textContent = '분신';
      $('opp-name').classList.add('is-doppel');
      $('opp-face').classList.add('on');
      $('seat-title').textContent = '분신이 상대석에';
      refreshFaces();
      Sfx.play('mirror');
      Face.speak(faces.opp);
      centerFlash('마지막 라운드 — 분신이 상대석에 앉았다');
      seatNote(sessionCall.n
        ? `제 차례네요. 오늘 배운 것만 갖고 해볼게요. (${sessionCall.hit}/${sessionCall.n} 맞혔죠?)`
        : '제 차례네요. 오늘 배운 것만 갖고 해볼게요.');
      render();
      setTimeout(step, 1600);
      return;
    }
    render();
    step();
  }

  function step() {
    if (round.over) return endRound();
    if (round.turn === 'opp') setTimeout(oppMove, 700 + Math.random() * 500);
    else armMyTurn();
  }

  function render() {
    $('my-total').textContent = session.total.me;
    $('opp-total').textContent = session.total.opp;
    $('my-pilescore').textContent = Engine.pileScore(round, 'me');
    $('deck-count').textContent = round.deck.length;
    $('bomb-count').textContent = Engine.bombsLeft(round);
    $('round-info').textContent = `라운드 ${session.round} / ${session.maxRounds}`;
    renderPile('my-pile', round.pile.me, round.busted.me, round.banked.me, round.done.me);
    renderPile('opp-pile', round.pile.opp, round.busted.opp, round.banked.opp, round.done.opp);
    $('opp-skills').textContent = Object.entries(Engine.SKILLS)
      .map(([k, s]) => session.skills.opp[k] > 0 ? s.icon : '·').join(' ');
  }

  function renderPile(id, pile, busted, banked, done) {
    const el = $(id);
    el.innerHTML = '';
    if (busted) { el.innerHTML = '<span class="boom">💥</span>'; return; }
    pile.forEach(card => {
      const s = document.createElement('span');
      s.className = 'gem g' + card.v;
      s.textContent = card.v;
      el.appendChild(s);
    });
    if (done && banked > 0) {
      const s = document.createElement('span');
      s.className = 'banked-tag';
      s.textContent = `+${banked} 확정`;
      el.appendChild(s);
    }
    if (!el.children.length) el.innerHTML = '<span class="pile-empty">—</span>';
  }

  /* 덱 카드 공개 연출 */
  function revealCard(card, cb, saved) {
    const c = $('deck-card');
    c.classList.remove('reveal');
    void c.offsetWidth; // 애니메이션 재시작
    const kind = card.type === 'bomb' ? (saved ? 'savedcard' : 'bombcard') : 'gemcard g' + card.v;
    c.className = 'card reveal ' + kind;
    c.textContent = card.type === 'bomb' ? (saved ? '🛡' : '💥') : card.v;
    Sfx.play('draw');
    if (card.type === 'bomb') {
      if (saved) {                                   // 방패가 폭탄을 삼켰다 — 안도의 순간
        setTimeout(() => { Sfx.play('bank'); centerFlash('🛡 방패가 폭탄을 막았다'); }, 320);
        setTimeout(cb, 900);
      } else {
        setTimeout(() => { Sfx.play('bomb'); quake(); }, 380);
        setTimeout(cb, 1100);
      }
    } else {
      setTimeout(() => Sfx.play('gem', card.v), 300);
      setTimeout(cb, 650);
    }
  }

  /* 폭탄 순간 — 화면이 흔들리고 붉게 번쩍인다 */
  function quake() {
    const t = document.querySelector('.table'), f = $('flash');
    t.classList.remove('quake'); f.classList.remove('on');
    void t.offsetWidth;
    t.classList.add('quake'); f.classList.add('on');
    setTimeout(() => { t.classList.remove('quake'); f.classList.remove('on'); }, 600);
  }

  function centerFlash(text) {
    const el = $('center-msg');
    el.textContent = text;
    el.classList.remove('pulse');
    void el.offsetWidth;
    if (text) el.classList.add('pulse');
  }

  /* 분신의 조기 예측 — 버튼이 뜨기 전에 먼저 말한다 */
  function showCall() {
    const el = $('call-badge');
    pendingCall = null;
    el.className = 'call-badge';
    el.textContent = '';
    if (!Engine.legalActions(round, 'me').includes('stop')) return; // 강제 뽑기엔 콜 없음
    const call = Doppel.callOut(Engine.context(session, round, 'me'));
    if (!call) return;
    pendingCall = call;
    el.className = 'call-badge show' + (call.sure ? ' sure' : '');
    el.textContent = `◑ "${call.line}"`;
    Sfx.play('call');
    Face.speak(faces.seat);
  }

  function resolveCall(act) {
    if (!pendingCall) return;
    const hit = pendingCall.act === act;
    sessionCall.n += 1;
    if (hit) sessionCall.hit += 1;
    const el = $('call-badge');
    el.className = 'call-badge show ' + (hit ? 'hit' : 'miss');
    el.textContent = hit ? '◑ 적중 ✓' : '◑ 빗나감 ✗';
    Sfx.play(hit ? 'hit' : 'miss');
    Face.flash(faces.seat, hit ? 'hit' : 'miss');
    seatNote((hit ? '✓ ' : '✗ ') + Doppel.reactToCall(pendingCall, act));
    renderCallGauge();
    pendingCall = null;
  }

  function renderCallGauge() {
    const pct = sessionCall.n ? Math.round(100 * sessionCall.hit / sessionCall.n) : 0;
    $('call-fill').style.width = pct + '%';
    $('call-stat').textContent = sessionCall.n
      ? `이번 판 예측 적중 ${sessionCall.hit}/${sessionCall.n} (${pct}%)`
      : '아직 예측할 만큼 못 봤어요';
  }

  /* ── 스킬 ── */
  function renderSkills() {
    const zone = $('skills');
    zone.innerHTML = '';
    const avail = Engine.availableSkills(session, round, 'me');
    const myTurn = round.turn === 'me' && !round.done.me && !round.over;
    Object.entries(Engine.SKILLS).forEach(([key, s]) => {
      const b = document.createElement('button');
      const left = session.skills.me[key];
      const on = (key === 'shield' && round.shieldOn.me) || (key === 'double' && round.doubleOn.me);
      b.className = 'skill-btn' + (on ? ' armed' : '');
      b.disabled = !myTurn || !avail.includes(key);
      b.title = s.desc;
      b.innerHTML = `<span class="sk-ico">${s.icon}</span>${s.name}<span class="skill-hint">${on ? '켜짐' : left > 0 ? '×' + left : '소진'}</span>`;
      b.onclick = () => useMySkill(key);
      zone.appendChild(b);
    });
    // 켜져 있는 효과 + 상대 잔여 스킬
    const fx = [];
    if (round.shieldOn.me) fx.push('<span class="fx shield">🛡 방패 대기</span>');
    if (round.doubleOn.me) fx.push('<span class="fx">✕2 배증 선언</span>');
    if (round.peeked.me) fx.push(`<span class="fx peek">👁 다음 장: ${round.peeked.me.type === 'bomb' ? '폭탄!' : round.peeked.me.v + '점'}</span>`);
    let row = document.querySelector('.fx-row');
    if (!row) {
      row = document.createElement('div');
      row.className = 'fx-row';
      zone.parentNode.insertBefore(row, zone);
    }
    row.innerHTML = fx.join('');
    $('opp-skills').textContent = Object.entries(Engine.SKILLS)
      .map(([k, s]) => session.skills.opp[k] > 0 ? s.icon : '·').join(' ');
  }

  function useMySkill(key) {
    const ctx = Engine.context(session, round, 'me');
    const res = Engine.useSkill(session, round, 'me', key);
    if (!res) return;
    Doppel.learnSkill(key, ctx);              // 분신은 "언제 썼는지"를 배운다
    Sfx.play(key === 'shield' ? 'bank' : key === 'peek' ? 'call' : 'hit');
    const s = Engine.SKILLS[key];
    if (key === 'peek') {
      const c = res.card;
      centerFlash(c.type === 'bomb' ? '👁 다음 장은 폭탄이다' : `👁 다음 장은 ${c.v}점`);
    } else {
      centerFlash(`${s.icon} ${s.name} 발동`);
    }
    seatNote(skillSeatLine(key, ctx));
    renderSkills();
    armMyTurn();                              // 스킬은 턴을 소모하지 않는다
  }

  function skillSeatLine(key, ctx) {
    const n = Engine.SKILLS[key].name;
    const j = josa(n);
    if (ctx.diffBand === 'behind') return `지고 있으니 ${n}${j} 꺼내시네요. 적어둘게요.`;
    if (ctx.diffBand === 'ahead') return `이기고 있는데도 ${n}${j}? 성격이 나오네요.`;
    return `${n}, 지금이 그 타이밍이라고 보신 거군요.`;
  }

  /* 목적격 조사 — 받침 유무로 을/를 */
  function josa(word) {
    const code = word.charCodeAt(word.length - 1) - 0xac00;
    if (code < 0 || code > 11171) return '를';
    return code % 28 === 0 ? '를' : '을';
  }

  function armMyTurn() {
    decideStart = performance.now();
    showCall();
    renderSkills();
    const legal = Engine.legalActions(round, 'me');
    const zone = $('actions');
    zone.innerHTML = '';
    legal.forEach(act => {
      const b = document.createElement('button');
      if (act === 'go') {
        b.className = 'btn aggr';
        b.textContent = round.pile.me.length === 0 ? '첫 장 뽑기' : '한 장 더';
      } else {
        b.className = 'btn';
        b.textContent = `멈춤 (+${Engine.pileScore(round, 'me')} 확정)`;
      }
      b.onclick = () => myMove(act);
      zone.appendChild(b);
    });
  }

  function myMove(act) {
    $('actions').innerHTML = '';
    $('skills').innerHTML = '';
    const ms = performance.now() - decideStart;
    const ctx = Engine.context(session, round, 'me');
    const hadChoice = Engine.legalActions(round, 'me').includes('stop');

    const res = Engine.apply(session, round, 'me', act);

    // 분신 학습 — 진짜 선택이 있었던 순간만 (첫 장 강제 뽑기는 제외)
    if (hadChoice) { Doppel.learn(ctx, act, ms); refreshFaces(); } // 배울 때마다 얼굴이 또렷해진다
    const called = !!pendingCall;
    resolveCall(act);
    // 예측을 이미 말한 순간엔 일반 리액션까지 겹치지 않게 (터진 경우는 예외 — 폭탄은 항상 반응)
    if (mode === 'spar' && (!called || res.busted)) {
      Doppel.react(ctx, act, res).forEach(seatNote);
    }

    if (act === 'go') revealCard(res.card, () => { render(); step(); }, res.saved);
    else {
      Sfx.play('bank');
      centerFlash(res.doubled ? `✕2 발동 — +${res.banked} 확정!` : `+${res.banked} 확정`);
      render();
      setTimeout(step, 600);
    }
  }

  const MIRROR_SPEECH = {
    go: ['여기선 가시던데요.', '사장님이라면 뽑았어요.', '배운 대로, 한 장 더.'],
    stop: ['여기선 멈추시더라고요.', '사장님 같으면 확정이죠.', '배운 대로, 잠급니다.'],
    unlearned: '이 상황은 아직 안 배웠어요. 기본기로 갈게요.',
    bust: '💥 …이것도 당신에게 배운 결과인데요.',
  };
  const rand = arr => arr[Math.floor(Math.random() * arr.length)];

  function oppMove() {
    const legal = Engine.legalActions(round, 'opp');
    if (!legal.length) return step();
    let ctx = Engine.context(session, round, 'opp');

    // 스킬 먼저 — 턴을 소모하지 않으므로 쓰고 나서 행동을 정한다
    const avail = Engine.availableSkills(session, round, 'opp');
    const wantSkill = isMirrorSeat()
      ? Doppel.playSkill(avail, ctx)                       // 분신은 내가 쓰던 타이밍을 따라 쓴다
      : SparringAI.decideSkill(aiId, ctx, avail);
    if (wantSkill && Engine.useSkill(session, round, 'opp', wantSkill)) {
      const s = Engine.SKILLS[wantSkill];
      const line = isMirrorSeat()
        ? `${s.icon} ${s.name}. 사장님이 쓰시던 타이밍이잖아요.`
        : (SparringAI.get(aiId).speech[wantSkill] || `${s.icon} ${s.name}`);
      $('opp-speech').textContent = line;
      if (isMirrorSeat()) Face.speak(faces.opp);
      Sfx.play(wantSkill === 'shield' ? 'bank' : 'call');
      ctx = Engine.context(session, round, 'opp');
      render();
      return setTimeout(oppAct, 800);
    }
    oppAct();
  }

  function oppAct() {
    const legal = Engine.legalActions(round, 'opp');
    if (!legal.length) return step();
    const ctx = Engine.context(session, round, 'opp');

    let act, speech, extraDelay = 0;
    if (isMirrorSeat()) {
      if (legal.length === 1) { act = 'go'; speech = ''; }
      else {
        const p = Doppel.play(ctx);
        act = p.act;
        speech = p.learned ? rand(MIRROR_SPEECH[act])
          : p.level === 4 ? MIRROR_SPEECH.unlearned
          : `이 상황은 처음인데… ${p.levelLabel} 기억으로 갈게요.`;
        extraDelay = Math.max(0, p.thinkMs - 700); // 내 결정 템포 흉내
      }
    } else {
      act = SparringAI.decide(aiId, ctx, legal);
      speech = SparringAI.get(aiId).speech[act];
    }

    setTimeout(() => {
      const res = Engine.apply(session, round, 'opp', act);
      if (res.busted) speech = isMirrorSeat() ? MIRROR_SPEECH.bust : SparringAI.get(aiId).speech.bust;
      if (res.saved) speech = '🛡 …막았다.';
      $('opp-speech').textContent = speech || '';
      if (isMirrorSeat() && speech) Face.speak(faces.opp);
      if (act === 'go') revealCard(res.card, () => { render(); step(); }, res.saved);
      else {
        Sfx.play('bank');
        if (res.doubled) centerFlash(`${oppTitle()} ✕2 — +${res.banked}`);
        render();
        setTimeout(step, 700);
      }
    }, extraDelay);
  }

  function endRound() {
    const wasMirrorRound = isMirrorSeat();
    Engine.endRound(session, round);
    Doppel.roundDone();
    if (wasMirrorRound) session.mirrorRound = { me: round.banked.me, opp: round.banked.opp };
    render();
    centerFlash(`라운드 종료 — 나 +${round.banked.me} / ${oppTitle()} +${round.banked.opp}`);
    setTimeout(() => {
      if (session.over) endSession();
      else nextRound();
    }, 1700);
  }

  function endSession() {
    show('result');
    const meWin = session.total.me > session.total.opp;
    const tie = session.total.me === session.total.opp;
    Sfx.play(meWin ? 'win' : 'lose');

    if (mode === 'mirror') {
      $('result-title').textContent = meWin ? '거울전 승리 — 분신을 넘었다' : tie ? '거울전 무승부' : '거울전 패배 — 나에게 졌다';
      const p = Doppel.profile();
      $('result-box').innerHTML =
        `내 점수 <b>${session.total.me}</b> vs 분신 <b>${session.total.opp}</b><br>` +
        `분신이 아는 나: <b>「${p.title}」</b><br>` +
        p.top.map(t => `· ${t} 타입`).join('<br>');
      $('result-quote').textContent = meWin
        ? '"…오늘의 저는 어제의 사장님이니까요. 내일 다시 하죠."'
        : '"당신처럼 뒀을 뿐이에요. 지금 진 건, 어제의 당신입니다."';
      return;
    }

    $('result-title').textContent = meWin ? '승리' : tie ? '무승부' : '패배';
    const mr = session.mirrorRound;
    const pct = sessionCall.n ? Math.round(100 * sessionCall.hit / sessionCall.n) : null;
    $('result-box').innerHTML =
      `내 점수 <b>${session.total.me}</b> vs ${SparringAI.get(aiId).name} <b>${session.total.opp}</b><br>` +
      (pct !== null ? `분신의 예측 적중 <b>${sessionCall.hit}/${sessionCall.n}</b> (${pct}%)<br>` : '') +
      (mr ? `마지막 라운드(분신전) 나 <b>${mr.me}</b> · 분신 <b>${mr.opp}</b>` : '');
    $('result-quote').textContent = mr && mr.opp > mr.me
      ? '"마지막 판, 제가 이겼죠? 사장님한테 배운 대로 했을 뿐인데요."'
      : pct !== null && pct >= 60
        ? `"${sessionCall.n}번 중 ${sessionCall.hit}번 맞혔어요. 슬슬 무섭지 않아요?"`
        : '"아직 사장님을 다 모르겠네요. 한 판 더 보여주시죠."';
  }

  /* 관전석 노트 */
  function seatNote(text) {
    const log = $('seat-log');
    const d = document.createElement('div');
    d.className = 'note';
    d.textContent = text;
    log.prepend(d);
    while (log.children.length > 6) log.removeChild(log.lastChild);
    Sfx.play('note');
    Face.speak(faces.seat);
  }

  /* ── 바인딩 ── */
  $('btn-spar').onclick = () => show('pick');
  $('btn-notes').onclick = () => show('notes');
  $('btn-back-home').onclick = () => show('home');
  $('btn-notes-home').onclick = () => show('home');
  $('btn-result-home').onclick = () => show('home');
  $('btn-again').onclick = () => mode === 'mirror' ? startMirror() : startSession(aiId);
  $('btn-mirror').onclick = startMirror;
  document.querySelectorAll('.pick').forEach(p => p.onclick = () => startSession(p.dataset.ai));

  const muteBtn = $('btn-mute');
  function renderMute() { muteBtn.textContent = Sfx.isMuted() ? '🔇' : '🔊'; }
  muteBtn.onclick = () => { Sfx.toggleMute(); renderMute(); Sfx.play('gem', 2); };
  renderMute();
  // 오디오는 첫 사용자 제스처에서만 열린다
  document.addEventListener('pointerdown', () => Sfx.ready(), { once: true });

  initFaces();
  renderHome();
})();
