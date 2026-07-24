/* 도플 — 《한 장 더》 규칙 엔진 (푸시 유어 럭, 순수 상태 기계, UI 무관)
 * 라운드마다 공유 덱: 보석 16장(1×6, 2×6, 3×4) + 폭탄 4장 = 20장.
 * 내 턴에 [한 장 더](뽑기) 또는 [멈춤](더미 점수 확정). 폭탄이면 이번 라운드 더미 소멸.
 * 5라운드 총점 승부. 남은 폭탄 수는 공개 정보.
 */
const Engine = (() => {

  const MAX_ROUNDS = 5;
  const GEMS = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3];
  const BOMBS = 4;

  function newSession() {
    return {
      round: 0, maxRounds: MAX_ROUNDS,
      total: { me: 0, opp: 0 },   // 확정(뱅킹)된 점수
      wins: { me: 0, opp: 0 },    // 라운드 승수 (연출용)
      over: false,
    };
  }

  function buildDeck() {
    const deck = GEMS.map(v => ({ type: 'gem', v }))
      .concat(Array.from({ length: BOMBS }, () => ({ type: 'bomb' })));
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  function newRound(session, first) {
    session.round += 1;
    return {
      deck: buildDeck(),
      pile: { me: [], opp: [] },        // 이번 라운드 쌓은 보석 (확정 전 = 위험 자산)
      done: { me: false, opp: false },
      busted: { me: false, opp: false },
      banked: { me: 0, opp: 0 },
      turn: first,
      over: false,
    };
  }

  function bombsLeft(round) { return round.deck.filter(c => c.type === 'bomb').length; }
  function pileScore(round, who) { return round.pile[who].reduce((a, c) => a + c.v, 0); }
  function dangerRatio(round) { return round.deck.length ? bombsLeft(round) / round.deck.length : 1; }
  function other(who) { return who === 'me' ? 'opp' : 'me'; }

  /* 첫 장은 무조건 뽑아야 라운드 참가 — 멈춤은 더미가 생긴 뒤부터 */
  function legalActions(round, who) {
    if (round.over || round.done[who]) return [];
    return round.pile[who].length === 0 ? ['go'] : ['go', 'stop'];
  }

  /* 행동 적용. 반환 { card, busted, banked } */
  function apply(session, round, who, act) {
    if (act === 'stop') {
      round.done[who] = true;
      round.banked[who] = pileScore(round, who);
      session.total[who] += round.banked[who];
      passTurn(round, who);
      return { card: null, banked: round.banked[who] };
    }
    // go
    const card = round.deck.pop();
    if (card.type === 'bomb') {
      round.busted[who] = true;
      round.done[who] = true;
      round.pile[who] = [];
      passTurn(round, who);
      return { card, busted: true };
    }
    round.pile[who].push(card);
    if (round.deck.length === 0) {
      // 덱 소진 — 남은 전원 강제 확정
      ['me', 'opp'].forEach(w => {
        if (!round.done[w]) {
          round.done[w] = true;
          round.banked[w] = pileScore(round, w);
          session.total[w] += round.banked[w];
        }
      });
    }
    passTurn(round, who);
    return { card };
  }

  function passTurn(round, who) {
    if (round.done.me && round.done.opp) { round.over = true; return; }
    const o = other(who);
    round.turn = round.done[o] ? who : o;
  }

  function endRound(session, round) {
    if (round.banked.me > round.banked.opp) session.wins.me += 1;
    else if (round.banked.opp > round.banked.me) session.wins.opp += 1;
    if (session.round >= session.maxRounds) session.over = true;
  }

  /* 분신 버킷용 상황 컨텍스트 — 전부 공개 정보로만 구성
   * pileBand: 더미 0~3 low / 4~7 mid / 8+ high
   * diffBand: (내 확정+더미) - (상대 확정+더미) 기준 ±3
   * danger:   남은 폭탄/남은 카드 ≥ 0.25 → hot (시작값 4/20=0.2 → cool)
   */
  function context(session, round, who) {
    const o = other(who);
    const pile = pileScore(round, who);
    const diff = (session.total[who] + pile) - (session.total[o] + pileScore(round, o));
    const ratio = dangerRatio(round);
    return {
      pileScore: pile,
      pileBand: pile <= 3 ? 'low' : pile <= 7 ? 'mid' : 'high',
      diffBand: diff <= -3 ? 'behind' : diff >= 3 ? 'ahead' : 'even',
      danger: ratio >= 0.25 ? 'hot' : 'cool',
      ratio, diff,
      deckLen: round.deck.length,
      bombs: bombsLeft(round),
    };
  }

  return { newSession, newRound, legalActions, apply, endRound, context, bombsLeft, pileScore, dangerRatio, other };
})();
