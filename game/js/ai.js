/* 도플 — 스파링 AI 3종 (규칙 기반 + 확률 노이즈)
 * 각 AI는 (내 카드, 콜 필요 여부, 레이즈 가능 여부) → 행동을 반환.
 * 성향이 "읽히도록" 명확한 편향을 가진다 — 분신의 리그 리포트가 서사가 되는 재료.
 */
const SparringAI = (() => {

  const ARCHETYPES = {
    bulldozer: {
      name: '불도저',
      desc: '일단 지르고 본다',
      speech: { bet: '받아보시든가.', raise: '더 얹지.', call: '그 정도로는 안 접어.', fold: '…이번 판은 넘긴다.', check: '어디 한번.' },
      act(card, legal) {
        const s = Engine.strengthBand(card);
        if (legal.includes('bet')) {
          // 공격형: 중간 패 이상이면 거의 베팅, 약패도 40% 블러핑
          if (s !== 'weak') return roll([['bet', 0.85], ['check', 0.15]]);
          return roll([['bet', 0.4], ['check', 0.6]]);
        }
        if (legal.includes('raise')) {
          if (s === 'strong') return roll([['raise', 0.6], ['call', 0.4]]);
          if (s === 'mid') return roll([['call', 0.75], ['raise', 0.15], ['fold', 0.1]]);
          return roll([['call', 0.35], ['fold', 0.5], ['raise', 0.15]]); // 약패 콜/역블러핑도 함
        }
        // 레이즈 받은 상태: call/fold
        if (s === 'strong') return 'call';
        if (s === 'mid') return roll([['call', 0.6], ['fold', 0.4]]);
        return roll([['call', 0.25], ['fold', 0.75]]);
      },
    },

    accountant: {
      name: '회계사',
      desc: '베팅이 곧 패다',
      speech: { bet: '계산상 이득입니다.', raise: '숫자는 거짓말을 안 하죠.', call: '확인해 보겠습니다.', fold: '기대값이 음수네요.', check: '지켜보죠.' },
      act(card, legal) {
        const s = Engine.strengthBand(card);
        if (legal.includes('bet')) {
          if (s === 'strong') return roll([['bet', 0.9], ['check', 0.1]]);
          if (s === 'mid') return roll([['bet', 0.25], ['check', 0.75]]);
          return roll([['check', 0.97], ['bet', 0.03]]); // 블러핑 거의 없음
        }
        if (legal.includes('raise')) {
          if (s === 'strong') return roll([['raise', 0.7], ['call', 0.3]]);
          if (s === 'mid') return roll([['call', 0.5], ['fold', 0.5]]);
          return roll([['fold', 0.9], ['call', 0.1]]);
        }
        if (s === 'strong') return 'call';
        if (s === 'mid') return roll([['fold', 0.65], ['call', 0.35]]);
        return 'fold';
      },
    },

    fox: {
      name: '여우',
      desc: '체크를 믿지 마라',
      speech: { bet: '이건 진짜일까, 가짜일까?', raise: '걸렸네.', call: '흐음… 재밌는데?', fold: '오늘은 물러나 주지.', check: '(빙긋)' },
      act(card, legal) {
        const s = Engine.strengthBand(card);
        if (legal.includes('bet')) {
          if (s === 'strong') return roll([['check', 0.45], ['bet', 0.55]]); // 강패 슬로우플레이
          if (s === 'mid') return roll([['bet', 0.4], ['check', 0.6]]);
          return roll([['bet', 0.3], ['check', 0.7]]);
        }
        if (legal.includes('raise')) {
          if (s === 'strong') return roll([['raise', 0.5], ['call', 0.5]]); // 함정 완성
          if (s === 'mid') return roll([['call', 0.6], ['fold', 0.25], ['raise', 0.15]]);
          return roll([['fold', 0.55], ['call', 0.2], ['raise', 0.25]]); // 역블러핑
        }
        if (s === 'strong') return 'call';
        if (s === 'mid') return roll([['call', 0.5], ['fold', 0.5]]);
        return roll([['fold', 0.8], ['call', 0.2]]);
      },
    },
  };

  function roll(pairs) {
    let r = Math.random();
    for (const [act, p] of pairs) { if ((r -= p) <= 0) return act; }
    return pairs[pairs.length - 1][0];
  }

  function get(id) { return ARCHETYPES[id]; }

  /* 결정 (합법 행동으로 보정) */
  function decide(id, card, legal) {
    const want = ARCHETYPES[id].act(card, legal);
    return legal.includes(want) ? want : legal[0];
  }

  return { get, decide, ARCHETYPES };
})();
