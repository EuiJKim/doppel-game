/* 도플 — 스파링 AI 3종 (규칙 기반 + 확률 노이즈)
 * 각 AI는 공개 정보 컨텍스트(ctx: 더미·점수차·폭탄 비율) → go/stop을 반환.
 * 성향이 "읽히도록" 명확한 편향을 가진다 — 분신의 노트·리그 리포트가 서사가 되는 재료.
 */
const SparringAI = (() => {

  const ARCHETYPES = {
    bulldozer: {
      name: '불도저',
      desc: '멈춤이란 없다. 터질 때까지 간다.',
      speech: {
        go: '한 장 더. 당연하지.',
        stop: '…오늘은 여기까지 해 주지.',
        bust: '펑? 다시 쌓으면 돼.',
      },
      // 더미 크기만 본다. 폭탄 비율은 무시 — 그게 불도저다.
      act(ctx) {
        const p = ctx.pileScore < 8 ? 0.95 : ctx.pileScore < 11 ? 0.55 : 0.25;
        return Math.random() < p ? 'go' : 'stop';
      },
    },

    accountant: {
      name: '회계사',
      desc: '기대값이 음수면 그만. 계산이 곧 용기다.',
      speech: {
        go: '확률상 아직 이득입니다.',
        stop: '기대값이 음수로 돌아섰네요.',
        bust: '…계산 밖의 일입니다.',
      },
      // 다음 장의 기대값: (1-p)×평균보석 - p×더미. 양수일 때만 간다.
      act(ctx) {
        const ev = (1 - ctx.ratio) * 1.8 - ctx.ratio * ctx.pileScore;
        const want = ev > 0.4 ? 'go' : 'stop';
        return Math.random() < 0.08 ? flip(want) : want;
      },
    },

    fox: {
      name: '여우',
      desc: '점수판을 본다. 지면 달리고, 이기면 잠근다.',
      speech: {
        go: '점수판이 가라고 하네?',
        stop: '이럴 때 멈추는 게 여우지.',
        bust: '…이건 못 본 걸로.',
      },
      act(ctx) {
        let want;
        if (ctx.diffBand === 'behind') want = (ctx.ratio > 0.45 || ctx.pileScore >= 10) ? 'stop' : 'go';
        else if (ctx.diffBand === 'ahead') want = ctx.pileScore >= 4 ? 'stop' : 'go';
        else want = (ctx.pileScore < 6 && ctx.ratio < 0.3) ? 'go' : 'stop';
        return Math.random() < 0.1 ? flip(want) : want;
      },
    },
  };

  function flip(a) { return a === 'go' ? 'stop' : 'go'; }

  function get(id) { return ARCHETYPES[id]; }

  /* 결정 (합법 행동으로 보정 — 첫 장은 무조건 go) */
  function decide(id, ctx, legal) {
    if (legal.length === 1) return legal[0];
    const want = ARCHETYPES[id].act(ctx);
    return legal.includes(want) ? want : legal[0];
  }

  return { get, decide, ARCHETYPES };
})();
