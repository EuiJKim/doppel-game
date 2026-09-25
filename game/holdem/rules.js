/* 텍사스 홀덤 — 카드·족보 (순수 로직, Node 테스트 가능)
 * 52장: id = (rank-2)*4 + suit. rank 2~14(A=14), suit 0~3 = ♠♥♦♣
 * 족보 9단계: 하이카드 < 원페어 < 투페어 < 트리플 < 스트레이트 < 플러시 < 풀하우스 < 포카드 < 스트레이트 플러시(로열)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HoldemRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SUITS = ['s', 'h', 'd', 'c'];
  const SUIT_SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const SUIT_KO = { s: '스페이드', h: '하트', d: '다이아', c: '클럽' };
  const RANK_STR = r => (r <= 10 ? String(r) : { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[r]);
  const DECK = [];
  for (let r = 2; r <= 14; r++) for (let s = 0; s < 4; s++) DECK.push({ id: (r - 2) * 4 + s, r, s: SUITS[s], sym: SUIT_SYM[SUITS[s]], red: s === 1 || s === 2, rank: RANK_STR(r), name: RANK_STR(r) + SUIT_SYM[SUITS[s]] });
  const cardById = id => DECK[id];
  const CAT = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];

  function shuffle(rng) {
    rng = rng || Math.random;
    const a = DECK.map(c => c.id);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /* 5장 평가 → { cat, tb(타이브레이크 랭크 배열, 높은 순), score } */
  function eval5(ids) {
    const cs = ids.map(cardById);
    const ranks = cs.map(c => c.r).sort((a, b) => b - a);
    const flush = cs.every(c => c.s === cs[0].s);
    /* 스트레이트: 유니크 랭크 5개가 연속 (A-2-3-4-5 휠 포함) */
    let straightHigh = 0;
    const uniq = [...new Set(ranks)];
    if (uniq.length === 5) {
      if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
      else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5;
    }
    const cnt = {}; for (const r of ranks) cnt[r] = (cnt[r] || 0) + 1;
    /* 그룹: 개수 내림차순, 같은 개수면 랭크 내림차순 */
    const groups = Object.keys(cnt).map(r => ({ r: +r, n: cnt[r] })).sort((a, b) => b.n - a.n || b.r - a.r);
    let cat, tb;
    if (straightHigh && flush) { cat = 8; tb = [straightHigh]; }
    else if (groups[0].n === 4) { cat = 7; tb = [groups[0].r, groups[1].r]; }
    else if (groups[0].n === 3 && groups[1].n === 2) { cat = 6; tb = [groups[0].r, groups[1].r]; }
    else if (flush) { cat = 5; tb = ranks; }
    else if (straightHigh) { cat = 4; tb = [straightHigh]; }
    else if (groups[0].n === 3) { cat = 3; tb = [groups[0].r, groups[1].r, groups[2].r]; }
    else if (groups[0].n === 2 && groups[1].n === 2) { cat = 2; tb = [groups[0].r, groups[1].r, groups[2].r]; }
    else if (groups[0].n === 2) { cat = 1; tb = [groups[0].r, groups[1].r, groups[2].r, groups[3].r]; }
    else { cat = 0; tb = ranks; }
    let score = cat;
    for (let i = 0; i < 5; i++) score = score * 16 + (tb[i] || 0);
    return { cat, tb, score };
  }

  function combos(arr, k) {
    const out = [];
    const rec = (start, pick) => { if (pick.length === k) { out.push(pick.slice()); return; } for (let i = start; i < arr.length; i++) { pick.push(arr[i]); rec(i + 1, pick); pick.pop(); } };
    rec(0, []);
    return out;
  }

  /* 5~7장 중 최선의 5장 → { cat, name, desc, score, cards } */
  function evalBest(ids) {
    if (ids.length < 5) return null;
    let best = null;
    for (const c of (ids.length === 5 ? [ids] : combos(ids, 5))) {
      const e = eval5(c);
      if (!best || e.score > best.score) best = { ...e, cards: c };
    }
    best.name = best.cat === 8 && best.tb[0] === 14 ? '로열 스트레이트 플러시' : CAT[best.cat];
    best.desc = describe(best);
    return best;
  }
  function describe(h) {
    const R = RANK_STR; const t = h.tb;
    switch (h.cat) {
      case 8: return t[0] === 14 ? '로열 스트레이트 플러시' : `${R(t[0])} 하이 스트레이트 플러시`;
      case 7: return `${R(t[0])} 포카드`;
      case 6: return `${R(t[0])} 풀하우스 (${R(t[1])})`;
      case 5: return `${R(t[0])} 하이 플러시`;
      case 4: return `${R(t[0])} 하이 스트레이트`;
      case 3: return `${R(t[0])} 트리플`;
      case 2: return `${R(t[0])}·${R(t[1])} 투페어`;
      case 1: return `${R(t[0])} 원페어`;
      default: return `${R(t[0])} 하이카드`;
    }
  }

  /* 쇼다운: entries = [{id, cards(5~7장)}] → { winners, hands } (동점은 팟 분배) */
  function resolve(entries) {
    const hands = {};
    let top = -1;
    for (const e of entries) { hands[e.id] = evalBest(e.cards); top = Math.max(top, hands[e.id].score); }
    const winners = entries.filter(e => hands[e.id].score === top).map(e => e.id);
    return { winners, hands };
  }

  /* 프리플롭 2장 설명·강도(0~1, 첸 공식 근사) */
  function holeDesc(ids) {
    const [a, b] = ids.map(cardById).sort((x, y) => y.r - x.r);
    if (a.r === b.r) return `포켓 ${a.rank}`;
    return `${a.rank}·${b.rank}${a.s === b.s ? ' 수티드' : ''}`;
  }
  function holeStrength(ids) {
    const [a, b] = ids.map(cardById).sort((x, y) => y.r - x.r);
    const hv = r => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2);
    let pts = hv(a.r);
    if (a.r === b.r) pts = Math.max(5, pts * 2);
    else {
      if (a.s === b.s) pts += 2;
      const gap = a.r - b.r - 1;
      pts -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
      if (gap <= 1 && a.r < 12) pts += 1;
    }
    return Math.max(0, Math.min(1, (pts + 2) / 22));
  }

  return { DECK, SUITS, SUIT_SYM, SUIT_KO, CAT, cardById, shuffle, eval5, evalBest, describe, resolve, holeDesc, holeStrength, RANK_STR };
});
