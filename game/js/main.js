/* 도플 — UI·게임 플로우 (《한 장 더》) */
(() => {
  const $ = id => document.getElementById(id);
  const screens = ['home', 'pick', 'game', 'result', 'notes'];

  let session = null, round = null, aiId = null, decideStart = 0;

  /* ── 화면 전환 ── */
  function show(name) {
    screens.forEach(s => $('screen-' + s).classList.toggle('active', s === name));
    if (name === 'home') renderHome();
    if (name === 'notes') renderNotes();
  }

  /* ── 홈 ── */
  function renderHome() {
    const s = Doppel.summary();
    $('learn-count').textContent = `배운 선택: ${s.choices} · 파악한 상황: ${s.bucketsLearned}/${s.totalBuckets}`;
    $('match-pct').textContent = s.matchRate === null ? '측정 전' : s.matchRate + '%';
    $('match-fill').style.width = (s.matchRate || 0) + '%';
    $('btn-mirror').disabled = !s.mirrorUnlocked;
    $('home-quote').textContent = homeQuote(s);
  }

  function homeQuote(s) {
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
    if (s.notes.length === 0) {
      list.innerHTML = '<div class="note-card locked">아직 백지예요. 뽑아 주셔야 배우죠.</div>';
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
    nextRound();
  }

  function nextRound() {
    const first = session.round % 2 === 0 ? 'me' : 'opp';
    round = Engine.newRound(session, first);
    const c = $('deck-card');
    c.className = 'card back';
    c.textContent = '?';
    $('opp-speech').textContent = '';
    $('center-msg').textContent = '';
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
  function revealCard(card, cb) {
    const c = $('deck-card');
    c.classList.remove('reveal');
    void c.offsetWidth; // 애니메이션 재시작
    c.className = 'card reveal ' + (card.type === 'bomb' ? 'bombcard' : 'gemcard g' + card.v);
    c.textContent = card.type === 'bomb' ? '💥' : card.v;
    setTimeout(cb, card.type === 'bomb' ? 1000 : 650);
  }

  function centerFlash(text) { $('center-msg').textContent = text; }

  function armMyTurn() {
    decideStart = performance.now();
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
    const ms = performance.now() - decideStart;
    const ctx = Engine.context(session, round, 'me');
    const hadChoice = Engine.legalActions(round, 'me').includes('stop');

    const res = Engine.apply(session, round, 'me', act);

    // 분신 학습 — 진짜 선택이 있었던 순간만 (첫 장 강제 뽑기는 제외)
    if (hadChoice) Doppel.learn(ctx, act, ms);
    Doppel.react(ctx, act, res).forEach(seatNote);

    if (act === 'go') revealCard(res.card, () => { render(); step(); });
    else {
      centerFlash(`+${res.banked} 확정`);
      render();
      setTimeout(step, 600);
    }
  }

  function oppMove() {
    const legal = Engine.legalActions(round, 'opp');
    if (!legal.length) return step();
    const ctx = Engine.context(session, round, 'opp');
    const act = SparringAI.decide(aiId, ctx, legal);
    const res = Engine.apply(session, round, 'opp', act);
    const sp = SparringAI.get(aiId).speech;
    $('opp-speech').textContent = res.busted ? sp.bust : sp[act];

    if (act === 'go') revealCard(res.card, () => { render(); step(); });
    else { render(); setTimeout(step, 700); }
  }

  function endRound() {
    Engine.endRound(session, round);
    Doppel.roundDone();
    render();
    const opp = SparringAI.get(aiId).name;
    centerFlash(`라운드 종료 — 나 +${round.banked.me} / ${opp} +${round.banked.opp}`);
    setTimeout(() => {
      if (session.over) endSession();
      else nextRound();
    }, 1700);
  }

  function endSession() {
    show('result');
    const meWin = session.total.me > session.total.opp;
    const tie = session.total.me === session.total.opp;
    $('result-title').textContent = meWin ? '승리' : tie ? '무승부' : '패배';
    $('result-box').innerHTML =
      `내 점수 <b>${session.total.me}</b> vs ${SparringAI.get(aiId).name} <b>${session.total.opp}</b><br>` +
      `라운드 ${session.wins.me}승 ${session.wins.opp}패 · 분신이 이번 세션을 지켜봤다`;
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
