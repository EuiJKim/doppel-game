/* 도플 — 《한 장 더》 규칙 엔진 (푸시 유어 럭, 순수 상태 기계, UI 무관)
 * 라운드마다 공유 덱: 보석 16장(1×6, 2×6, 3×4) + 폭탄 4장 = 20장.
 * 내 턴에 [한 장 더](뽑기) 또는 [멈춤](더미 점수 확정). 폭탄이면 이번 라운드 더미 소멸.
 * 5라운드 총점 승부. 남은 폭탄 수는 공개 정보.
 */
const Engine = (() => {

  const MAX_ROUNDS = 5;
  const GEMS = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3];
  const BOMBS = 4;

  /* 스킬 3종 — 세션당 각 1회. 규칙은 한 줄로 읽히되, 쓰는 타이밍이 실력이 되게 한다.
   * 이것들이 분신의 새로운 학습 대상이 된다: "당신은 지고 있을 때만 배증을 지릅니다" */
  const SKILLS = {
    shield: { icon: '🛡', name: '방패', desc: '다음 폭탄 1회 무효' },
    peek: { icon: '👁', name: '투시', desc: '맨 위 카드를 미리 본다' },
    double: { icon: '✕2', name: '배증', desc: '이번 라운드 확정 점수 2배 (터지면 무효)' },
  };

  function newSession() {
    return {
      round: 0, maxRounds: MAX_ROUNDS,
      total: { me: 0, opp: 0 },   // 확정(뱅킹)된 점수
      wins: { me: 0, opp: 0 },    // 라운드 승수 (연출용)
      skills: {                   // 세션당 잔여 사용 횟수
        me: { shield: 1, peek: 1, double: 1 },
        opp: { shield: 1, peek: 1, double: 1 },
      },
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
      shieldOn: { me: false, opp: false },   // 방패 대기 상태
      doubleOn: { me: false, opp: false },   // 배증 선언 상태
      peeked: { me: null, opp: null },       // 투시로 본 카드 (뽑으면 소멸)
      saved: { me: false, opp: false },      // 이번 라운드 방패로 살아남았는지 (연출용)
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

  /* 사용 가능한 스킬 목록 (남았고, 이번 라운드에 아직 안 켠 것) */
  function availableSkills(session, round, who) {
    if (round.over || round.done[who]) return [];
    return Object.keys(SKILLS).filter(k => {
      if (session.skills[who][k] <= 0) return false;
      if (k === 'shield' && round.shieldOn[who]) return false;
      if (k === 'double' && round.doubleOn[who]) return false;
      if (k === 'peek' && round.peeked[who]) return false;
      if (k === 'peek' && round.deck.length === 0) return false;
      return true;
    });
  }

  /* 스킬 사용 — 턴을 소모하지 않는다 (선언 후 계속 내 선택) */
  function useSkill(session, round, who, name) {
    if (!availableSkills(session, round, who).includes(name)) return null;
    session.skills[who][name] -= 1;
    if (name === 'shield') { round.shieldOn[who] = true; return { name }; }
    if (name === 'double') { round.doubleOn[who] = true; return { name }; }
    if (name === 'peek') {
      const top = round.deck[round.deck.length - 1];
      round.peeked[who] = top;
      return { name, card: top };
    }
    return null;
  }

  /* 행동 적용. 반환 { card, busted, banked, saved } */
  function apply(session, round, who, act) {
    if (act === 'stop') {
      round.done[who] = true;
      const raw = pileScore(round, who);
      round.banked[who] = round.doubleOn[who] ? raw * 2 : raw;
      session.total[who] += round.banked[who];
      passTurn(round, who);
      return { card: null, banked: round.banked[who], doubled: round.doubleOn[who] };
    }
    // go
    const card = round.deck.pop();
    round.peeked[who] = null; // 미리 본 카드를 뽑았으면 정보 소멸
    if (card.type === 'bomb') {
      if (round.shieldOn[who]) {          // 방패가 폭탄을 한 번 삼킨다
        round.shieldOn[who] = false;
        round.saved[who] = true;
        passTurn(round, who);
        return { card, saved: true };
      }
      round.busted[who] = true;
      round.done[who] = true;
      round.pile[who] = [];
      round.doubleOn[who] = false;        // 배증 선언은 터지면 무효
      passTurn(round, who);
      return { card, busted: true };
    }
    round.pile[who].push(card);
    if (round.deck.length === 0) {
      // 덱 소진 — 남은 전원 강제 확정
      ['me', 'opp'].forEach(w => {
        if (!round.done[w]) {
          round.done[w] = true;
          const raw = pileScore(round, w);
          round.banked[w] = round.doubleOn[w] ? raw * 2 : raw;
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
      // 스킬 상태 — AI/분신의 판단 재료 (버킷 키에는 넣지 않는다. 표본이 흩어지므로)
      guarded: round.shieldOn[who],
      doubled: round.doubleOn[who],
      peeked: round.peeked[who],
      skillsLeft: { ...session.skills[who] },
      roundNo: session.round, maxRounds: session.maxRounds,
    };
  }

  return { newSession, newRound, legalActions, apply, endRound, context, bombsLeft, pileScore, dangerRatio, other, availableSkills, useSkill, SKILLS };
})();
