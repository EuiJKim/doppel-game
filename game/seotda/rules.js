/* 섯다 — 족보 규칙 (순수 로직, 브라우저/Node 공용)
 * 20장 화투(1~10월 × 2장), 2장 섯다.
 * 이 파일은 DOM/네트워크를 모른다. 카드 정의 + 족보 판정 + 승자 결정만 한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SeotdaRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  /* ── 카드 ──
   * m: 월(1~10), k: 종류 — '광' | '열'(열끗) | '띠'
   * 8월은 광+열끗, 나머지는 (광|열끗)+띠
   */
  const MONTH_NAME = ['', '송학', '매조', '벚꽃', '흑싸리', '난초', '모란', '홍싸리', '공산', '국화', '단풍'];
  const DECK = [
    { m: 1, k: '광' }, { m: 1, k: '띠' },
    { m: 2, k: '열' }, { m: 2, k: '띠' },
    { m: 3, k: '광' }, { m: 3, k: '띠' },
    { m: 4, k: '열' }, { m: 4, k: '띠' },
    { m: 5, k: '열' }, { m: 5, k: '띠' },
    { m: 6, k: '열' }, { m: 6, k: '띠' },
    { m: 7, k: '열' }, { m: 7, k: '띠' },
    { m: 8, k: '광' }, { m: 8, k: '열' },
    { m: 9, k: '열' }, { m: 9, k: '띠' },
    { m: 10, k: '열' }, { m: 10, k: '띠' },
  ].map((c, i) => ({ ...c, id: i, name: MONTH_NAME[c.m] }));

  function cardById(id) { return DECK[id]; }

  function shuffle(rng) {
    const r = rng || Math.random;
    const ids = DECK.map(c => c.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids;
  }

  /* ── 족보 ──
   * score: 클수록 강함. 카테고리 간 간격을 크게 둬서 비교가 단순하다.
   *   광땡  1000+  (38 > 18 > 13)
   *   땡    900+n  (장땡=910 … 1땡=901)
   *   특수  8xx    (알리 860 > 독사 850 > 구삥 840 > 장삥 830 > 장사 820 > 세륙 810)
   *   끗    700+n  (갑오=709 … 망통=700)
   * 특수족보(땡잡이·암행어사·구사)는 기본 score는 끗으로 두고, flag로 표시해 승자 결정 시 처리한다.
   */
  function evalHand(cardIds) {
    if (!cardIds || cardIds.length < 2) return null;
    const a = cardById(cardIds[0]), b = cardById(cardIds[1]);
    const lo = Math.min(a.m, b.m), hi = Math.max(a.m, b.m);
    const has = (m, k) => (a.m === m && a.k === k) || (b.m === m && b.k === k);
    const h = { score: 0, name: '', tier: '', special: null };

    if (a.k === '광' && b.k === '광') {
      const key = `${lo}${hi}`;
      h.tier = '광땡';
      if (key === '38') { h.score = 1000; h.name = '38광땡'; }
      else if (key === '18') { h.score = 990; h.name = '18광땡'; }
      else { h.score = 980; h.name = '13광땡'; }
      return h;
    }
    if (lo === hi) {
      h.tier = '땡'; h.score = 900 + lo;
      h.name = lo === 10 ? '장땡' : `${lo}땡`;
      return h;
    }
    const pairs = { '12': ['알리', 860], '14': ['독사', 850], '19': ['구삥', 840], '110': ['장삥', 830], '410': ['장사', 820], '46': ['세륙', 810] };
    const p = pairs[`${lo}${hi}`];
    if (p) { h.tier = '특수'; h.name = p[0]; h.score = p[1]; }
    else {
      const n = (lo + hi) % 10;
      h.tier = '끗'; h.score = 700 + n;
      h.name = n === 0 ? '망통' : n === 9 ? '갑오' : `${n}끗`;
    }

    /* 특수족보 표시 (끗 값은 그대로 두고 flag만) */
    if (has(3, '띠') && has(7, '열')) h.special = '땡잡이';
    else if (has(4, '열') && has(7, '열')) h.special = '암행어사';
    else if (has(4, '열') && has(9, '열')) h.special = '멍텅구리구사';
    else if (lo === 4 && hi === 9) h.special = '구사';
    return h;
  }

  /* 한 장만 있을 때 화면 표시용 */
  function describeOne(cardId) {
    const c = cardById(cardId);
    return `${c.m}월 ${c.k === '열' ? '열끗' : c.k}`;
  }

  /* ── 승자 결정 ──
   * entries: [{ id, cards:[id,id] }]
   * opts.special: 땡잡이·암행어사·구사 적용 여부
   * 반환: { redeal: bool, reason, winners: [id], hands: {id: hand} }
   */
  function resolve(entries, opts) {
    const special = !opts || opts.special !== false;
    const hands = {};
    for (const e of entries) hands[e.id] = evalHand(e.cards);
    const ids = entries.map(e => e.id);
    if (ids.length === 1) return { redeal: false, winners: ids, hands };

    let best = -1;
    for (const id of ids) best = Math.max(best, hands[id].score);
    const bestIds = ids.filter(id => hands[id].score === best);

    if (special) {
      /* 구사 → 재경기 (구사 본인 이외에 알리 이하만 있을 때) */
      for (const id of (opts && opts.noRedeal ? [] : ids)) {
        const sp = hands[id].special;
        if (sp !== '구사' && sp !== '멍텅구리구사') continue;
        const othersBest = Math.max(...ids.filter(x => x !== id).map(x => hands[x].score));
        const limit = sp === '구사' ? 860 /* 알리 */ : 910 /* 장땡 */;
        if (othersBest <= limit) return { redeal: true, reason: sp, by: id, winners: [], hands };
      }
      /* 암행어사: 13·18광땡을 잡는다 (38광땡은 못 잡음) */
      const amhaeng = ids.find(id => hands[id].special === '암행어사');
      if (amhaeng && (best === 980 || best === 990)) return { redeal: false, winners: [amhaeng], hands, caught: bestIds, catcher: '암행어사' };
      /* 땡잡이: 1~9땡을 잡는다 (장땡·광땡은 못 잡음) */
      const jabi = ids.find(id => hands[id].special === '땡잡이');
      if (jabi && best >= 901 && best <= 909) return { redeal: false, winners: [jabi], hands, caught: bestIds, catcher: '땡잡이' };
    }
    return { redeal: false, winners: bestIds, hands };
  }

  /* N장 중 가장 좋은 2장 (3장 섯다 자동 선택 · 홀덤 섯다) */
  function bestPair(cardIds) {
    let best = null;
    for (let i = 0; i < cardIds.length; i++) for (let j = i + 1; j < cardIds.length; j++) {
      const h = evalHand([cardIds[i], cardIds[j]]);
      if (!best || h.score > best.hand.score || (h.score === best.hand.score && h.special && !best.hand.special)) best = { cards: [cardIds[i], cardIds[j]], hand: h };
    }
    return best;
  }

  return { DECK, MONTH_NAME, cardById, shuffle, evalHand, describeOne, resolve, bestPair };
});
