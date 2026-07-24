/* 도플 — 쇼다운 규칙 엔진 (순수 상태 기계, UI 무관)
 * 규칙: 1~10 카드 1장씩, 앤티 1, 베팅 1라운드, 레이즈 판당 1회. 높은 숫자가 팟 획득. 동수 이월.
 */
const Engine = (() => {

  const START_CHIPS = 30;
  const MAX_HANDS = 20;

  function newSession() {
    return {
      hand: 0, maxHands: MAX_HANDS,
      chips: { me: START_CHIPS, opp: START_CHIPS },
      carryPot: 0,           // 동수 이월분
      wins: { me: 0, opp: 0 },
      over: false,
    };
  }

  function deal() {
    // 서로 다른 카드 2장 (동수 재미를 위해 같은 수 허용: 두 벌 덱 컨셉 → 10% 확률로 동수 허용)
    const a = 1 + Math.floor(Math.random() * 10);
    let b = 1 + Math.floor(Math.random() * 10);
    if (a === b && Math.random() < 0.9) {
      while (b === a) b = 1 + Math.floor(Math.random() * 10);
    }
    return [a, b];
  }

  /* 한 판의 상태 기계
   * first: 'me'|'opp' 선공. actions 로그: {who, act} 순서대로.
   * 가능한 act: check / bet / call / fold / raise
   */
  function newHand(session, first) {
    session.hand += 1;
    const [myCard, oppCard] = deal();
    const hand = {
      first, turn: first,
      myCard, oppCard,
      pot: 2 + session.carryPot,          // 앤티 1+1 + 이월
      toCall: 0,                           // 현재 콜에 필요한 칩
      raised: false,                       // 레이즈 1회 제한
      actions: [],
      done: false, winner: null, reason: null, // reason: 'fold'|'showdown'|'tie'
    };
    session.carryPot = 0;
    session.chips.me -= 1; session.chips.opp -= 1;
    return hand;
  }

  function betSize(pot) { return Math.max(1, Math.ceil(pot / 2)); }

  /* 현재 턴 플레이어가 가능한 행동 목록 */
  function legalActions(hand) {
    if (hand.done) return [];
    if (hand.toCall === 0) return ['check', 'bet'];
    return hand.raised ? ['call', 'fold'] : ['call', 'fold', 'raise'];
  }

  function other(who) { return who === 'me' ? 'opp' : 'me'; }

  /* 행동 적용. 반환: 판 계속 여부 */
  function apply(session, hand, who, act) {
    const chips = session.chips;
    hand.actions.push({ who, act });

    if (act === 'check') {
      // 양쪽 체크면 쇼다운
      const prev = hand.actions[hand.actions.length - 2];
      if (prev && prev.act === 'check') return showdown(session, hand);
      hand.turn = other(who);
      return true;
    }
    if (act === 'bet') {
      const amt = Math.min(betSize(hand.pot), chips[who]);
      chips[who] -= amt; hand.pot += amt; hand.toCall = amt;
      hand.turn = other(who);
      return true;
    }
    if (act === 'raise') {
      const amt = Math.min(hand.toCall * 3, chips[who]); // 콜분 + 레이즈(콜의 2배) 근사
      chips[who] -= amt; hand.pot += amt;
      hand.toCall = Math.max(1, amt - hand.toCall);
      hand.raised = true;
      hand.turn = other(who);
      return true;
    }
    if (act === 'call') {
      const amt = Math.min(hand.toCall, chips[who]);
      chips[who] -= amt; hand.pot += amt; hand.toCall = 0;
      return showdown(session, hand);
    }
    if (act === 'fold') {
      hand.done = true; hand.winner = other(who); hand.reason = 'fold';
      settle(session, hand);
      return false;
    }
    throw new Error('unknown act: ' + act);
  }

  function showdown(session, hand) {
    hand.done = true;
    if (hand.myCard === hand.oppCard) {
      hand.winner = null; hand.reason = 'tie';
      session.carryPot = hand.pot; // 이월
    } else {
      hand.winner = hand.myCard > hand.oppCard ? 'me' : 'opp';
      hand.reason = 'showdown';
      settle(session, hand);
    }
    return false;
  }

  function settle(session, hand) {
    if (hand.winner) {
      session.chips[hand.winner] += hand.pot;
      session.wins[hand.winner] += 1;
    }
    if (session.chips.me <= 0 || session.chips.opp <= 0 || session.hand >= session.maxHands) {
      session.over = true;
    }
  }

  /* 패 강도 구간: 약(1-4) 중(5-7) 강(8-10) — 분신 버킷과 공유 */
  function strengthBand(card) { return card <= 4 ? 'weak' : card <= 7 ? 'mid' : 'strong'; }

  return { newSession, newHand, legalActions, apply, betSize, strengthBand, other };
})();
