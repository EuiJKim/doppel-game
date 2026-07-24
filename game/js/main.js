/* 도플 — UI·게임 플로우 */
(() => {
  const $ = id => document.getElementById(id);
  const screens = ['home', 'pick', 'game', 'result', 'notes'];

  let session = null, hand = null, aiId = null, decideStart = 0;

  /* ── 화면 전환 ── */
  function show(name) {
    screens.forEach(s => $('screen-' + s).classList.toggle('active', s === name));
    if (name === 'home') renderHome();
    if (name === 'notes') renderNotes();
  }

  /* ── 홈 ── */
  function renderHome() {
    const s = Doppel.summary();
    $('learn-count').textContent = `배운 판: ${s.handsLearned} · 파악한 상황: ${s.bucketsLearned}/${s.totalBuckets}`;
    $('match-pct').textContent = s.matchRate === null ? '측정 전' : s.matchRate + '%';
    $('match-fill').style.width = (s.matchRate || 0) + '%';
    $('btn-mirror').disabled = !s.mirrorUnlocked;
    $('home-quote').textContent = homeQuote(s);
  }

  function homeQuote(s) {
    if (s.handsLearned === 0) return '"…누구세요? 아, 제가 배울 사람이구나. 일단 쳐보시죠."';
    if (s.handsLearned < 20) return `"${s.handsLearned}판 봤는데요, 아직 사장님이 뭐 하는 사람인지 모르겠어요."`;
    if (s.matchRate === null || s.matchRate < 40) return '"슬슬 감이 오는데… 사장님, 생각보다 복잡한 사람이네요?"';
    if (s.matchRate < 65) return `"일치율 ${s.matchRate}%. 사장님 버릇, 반은 꿰었어요."`;
    return '"이제 사장님 없어도 사장님처럼 칠 수 있어요. 증명해 볼까요?"';
  }

  /* ── 노트 화면 ── */
  function renderNotes() {
    const s = Doppel.summary();
    const list = $('notes-list');
    list.innerHTML = '';
    if (s.notes.length === 0) {
      list.innerHTML = '<div class="note-card locked">아직 백지예요. 쳐 주셔야 배우죠.</div>';
    } else {
      s.notes.forEach(n => {
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
  function startSession(id) {
    aiId = id;
    session = Engine.newSession();
    show('game');
    $('opp-name').textContent = SparringAI.get(aiId).name;
    nextHand();
  }

  function nextHand() {
    const first = session.hand % 2 === 0 ? 'me' : 'opp';
    hand = Engine.newHand(session, first);
    $('opp-card').className = 'card back';
    $('opp-card').textContent = '?';
    $('opp-speech').textContent = '';
    render();
    if (hand.turn === 'opp') setTimeout(oppMove, 700);
    else armMyTurn();
  }

  function render() {
    $('my-card').textContent = hand.myCard;
    $('my-chips').textContent = session.chips.me;
    $('opp-chips').textContent = session.chips.opp;
    $('pot').textContent = hand.pot;
    $('round-info').textContent = `${session.hand} / ${session.maxHands}`;
  }

  function armMyTurn() {
    decideStart = performance.now();
    const legal = Engine.legalActions(hand);
    const zone = $('actions');
    zone.innerHTML = '';
    const label = { check: '체크', bet: '베팅 ' + Engine.betSize(hand.pot), call: '콜 ' + hand.toCall, fold: '폴드', raise: '레이즈' };
    legal.forEach(act => {
      const b = document.createElement('button');
      b.className = 'btn' + (act === 'fold' ? ' fold' : (act === 'bet' || act === 'raise') ? ' aggr' : '');
      b.textContent = label[act];
      b.onclick = () => myMove(act);
      zone.appendChild(b);
    });
  }

  function myMove(act) {
    $('actions').innerHTML = '';
    const ms = performance.now() - decideStart;
    const facing = Doppel.facingOf(hand, 'me');
    const isFirst = hand.first === 'me';

    // 분신 학습 + 리액션
    Doppel.learn(hand.myCard, isFirst, facing, act, ms);
    Doppel.react(hand.myCard, isFirst, facing, act, hand).forEach(seatNote);

    const cont = Engine.apply(session, hand, 'me', act);
    render();
    if (!cont) return endHand();
    setTimeout(oppMove, 600 + Math.random() * 700);
  }

  function oppMove() {
    const legal = Engine.legalActions(hand);
    const act = SparringAI.decide(aiId, hand.oppCard, legal);
    $('opp-speech').textContent = SparringAI.get(aiId).speech[act] || '';
    const cont = Engine.apply(session, hand, 'opp', act);
    render();
    if (!cont) return endHand();
    armMyTurn();
  }

  function endHand() {
    Doppel.handDone();
    // 쇼다운이면 상대 카드 공개 연출
    if (hand.reason !== 'fold') {
      const c = $('opp-card');
      setTimeout(() => {
        c.className = 'card reveal';
        c.textContent = hand.oppCard;
      }, 400);
    }
    render();
    const delay = hand.reason === 'fold' ? 900 : 1600;
    setTimeout(() => {
      if (session.over) return endSession();
      nextHand();
    }, delay);
  }

  function endSession() {
    show('result');
    const meWin = session.chips.me > session.chips.opp;
    $('result-title').textContent = meWin ? '승리' : session.chips.me === session.chips.opp ? '무승부' : '패배';
    $('result-box').innerHTML =
      `내 칩 <b>${session.chips.me}</b> vs ${SparringAI.get(aiId).name} <b>${session.chips.opp}</b><br>` +
      `${session.wins.me}승 ${session.wins.opp}패 · 분신이 이번 세션을 지켜봤다`;
    const s = Doppel.summary();
    $('result-quote').textContent = meWin
      ? `"이기는 법도 배웠어요. 일치율 ${s.matchRate ?? '측정 전'}${s.matchRate ? '%' : ''} — 저 좀 크지 않았어요?"`
      : `"지는 법까지 배워버렸네요. …이것도 사장님 스타일이라면 할 말 없고요."`;
  }

  /* 관전석 노트 */
  function seatNote(text) {
    const log = $('seat-log');
    const d = document.createElement('div');
    d.className = 'note';
    d.textContent = text;
    log.prepend(d);
    while (log.children.length > 6) log.removeChild(log.lastChild);
  }

  /* ── 바인딩 ── */
  $('btn-spar').onclick = () => show('pick');
  $('btn-notes').onclick = () => show('notes');
  $('btn-back-home').onclick = () => show('home');
  $('btn-notes-home').onclick = () => show('home');
  $('btn-result-home').onclick = () => show('home');
  $('btn-again').onclick = () => startSession(aiId);
  document.querySelectorAll('.pick').forEach(p => p.onclick = () => startSession(p.dataset.ai));

  renderHome();
})();
