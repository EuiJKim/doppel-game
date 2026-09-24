/* 섯다 로직 테스트 — `node game/seotda/test.js` */
const R = require('./rules.js');
const { Game } = require('./engine.js');
const assert = require('assert');

const C = (m, k) => R.DECK.find(c => c.m === m && c.k === k).id;
let n = 0;
function t(name, fn) { fn(); n++; console.log('  ✓', name); }

console.log('족보');
t('38광땡', () => assert.equal(R.evalHand([C(3, '광'), C(8, '광')]).name, '38광땡'));
t('18광땡 > 13광땡', () => assert(R.evalHand([C(1, '광'), C(8, '광')]).score > R.evalHand([C(1, '광'), C(3, '광')]).score));
t('장땡', () => assert.equal(R.evalHand([C(10, '열'), C(10, '띠')]).name, '장땡'));
t('1땡 < 2땡', () => assert(R.evalHand([C(1, '광'), C(1, '띠')]).score < R.evalHand([C(2, '열'), C(2, '띠')]).score));
t('알리·독사·구삥·장삥·장사·세륙 순서', () => {
  const s = [[1, 2], [1, 4], [1, 9], [1, 10], [4, 10], [4, 6]].map(([a, b]) => R.evalHand([C(a, '띠'), C(b, '띠')]).score);
  for (let i = 1; i < s.length; i++) assert(s[i - 1] > s[i]);
});
t('끗 계산: 5+7 = 2끗, 4+5 = 갑오, 3+7 = 망통', () => {
  assert.equal(R.evalHand([C(5, '띠'), C(7, '띠')]).name, '2끗');
  assert.equal(R.evalHand([C(4, '띠'), C(5, '띠')]).name, '갑오');
  assert.equal(R.evalHand([C(3, '광'), C(7, '띠')]).name, '망통');
});
t('땡잡이 = 3띠+7열', () => {
  assert.equal(R.evalHand([C(3, '띠'), C(7, '열')]).special, '땡잡이');
  assert.equal(R.evalHand([C(3, '광'), C(7, '열')]).special, null);
});
t('암행어사 = 4열+7열, 구사 = 4+9, 멍텅구리구사 = 4열+9열', () => {
  assert.equal(R.evalHand([C(4, '열'), C(7, '열')]).special, '암행어사');
  assert.equal(R.evalHand([C(4, '띠'), C(9, '열')]).special, '구사');
  assert.equal(R.evalHand([C(4, '열'), C(9, '열')]).special, '멍텅구리구사');
});

console.log('승자 결정');
t('땡잡이가 7땡을 잡는다', () => {
  const r = R.resolve([{ id: 'a', cards: [C(7, '띠'), C(7, '열')] }, { id: 'b', cards: [C(3, '띠'), C(7, '열')] }]);
  assert.deepEqual(r.winners, ['b']); assert.equal(r.catcher, '땡잡이');
});
t('땡잡이는 장땡을 못 잡는다', () => {
  const r = R.resolve([{ id: 'a', cards: [C(10, '띠'), C(10, '열')] }, { id: 'b', cards: [C(3, '띠'), C(7, '열')] }]);
  assert.deepEqual(r.winners, ['a']);
});
t('땡잡이 vs 끗 → 땡잡이는 망통으로 진다', () => {
  const r = R.resolve([{ id: 'a', cards: [C(1, '띠'), C(5, '띠')] }, { id: 'b', cards: [C(3, '띠'), C(7, '열')] }]);
  assert.deepEqual(r.winners, ['a']);
});
t('암행어사가 18광땡을 잡고 38광땡은 못 잡는다', () => {
  assert.deepEqual(R.resolve([{ id: 'a', cards: [C(1, '광'), C(8, '광')] }, { id: 'b', cards: [C(4, '열'), C(7, '열')] }]).winners, ['b']);
  assert.deepEqual(R.resolve([{ id: 'a', cards: [C(3, '광'), C(8, '광')] }, { id: 'b', cards: [C(4, '열'), C(7, '열')] }]).winners, ['a']);
});
t('구사: 상대가 알리 이하면 재경기, 땡이면 아님', () => {
  assert.equal(R.resolve([{ id: 'a', cards: [C(1, '광'), C(2, '띠')] }, { id: 'b', cards: [C(4, '띠'), C(9, '열')] }]).redeal, true);
  assert.equal(R.resolve([{ id: 'a', cards: [C(2, '열'), C(2, '띠')] }, { id: 'b', cards: [C(4, '띠'), C(9, '열')] }]).redeal, false);
});
t('멍텅구리구사: 장땡이면 재경기, 광땡이면 아님', () => {
  assert.equal(R.resolve([{ id: 'a', cards: [C(10, '열'), C(10, '띠')] }, { id: 'b', cards: [C(4, '열'), C(9, '열')] }]).redeal, true);
  assert.equal(R.resolve([{ id: 'a', cards: [C(1, '광'), C(3, '광')] }, { id: 'b', cards: [C(4, '열'), C(9, '열')] }]).redeal, false);
});
t('특수족보 OFF면 땡잡이 무시', () => {
  const r = R.resolve([{ id: 'a', cards: [C(7, '띠'), C(7, '열')] }, { id: 'b', cards: [C(3, '띠'), C(7, '열')] }], { special: false });
  assert.deepEqual(r.winners, ['a']);
});
t('동점 → 공동 승자', () => {
  const r = R.resolve([{ id: 'a', cards: [C(1, '띠'), C(5, '띠')] }, { id: 'b', cards: [C(2, '열'), C(4, '띠')] }]);
  assert.deepEqual(r.winners.sort(), ['a', 'b']);
});

console.log('엔진');
function seeded(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }
function mk(names, settings, seed) {
  const g = new Game({ ante: 100, startChips: 1000, turnSec: 0, ...settings }, seeded(seed || 7));
  names.forEach((nm, i) => g.addPlayer('p' + i, nm));
  return g;
}
const total = g => g.players.reduce((a, p) => a + p.chips, 0) + (g.hand ? g.hand.pot : 0);

t('입장·최대 인원', () => {
  const g = mk(['a', 'b', 'c'], { maxPlayers: 3 });
  assert.equal(g.addPlayer('p9', 'z'), null);
  assert.equal(g.players.length, 3);
});
t('시작 → 앤티 → 첫 장 → 딜러 다음 사람 턴', () => {
  const g = mk(['a', 'b', 'c']);
  assert(g.startHand());
  assert.equal(g.phase, 'betting');
  assert.equal(g.hand.pot, 300);
  assert.equal(g.hand.round, 1);
  assert.equal(g.hand.dealer, 'p0');
  assert.equal(g.hand.turn, 'p1');
  g.players.forEach(p => assert.equal(p.chips, 900));
  assert(g.hand.order.every(id => g.hand.cards[id].length === 1));
});
t('모두 체크 → 2장째 → 모두 체크 → 쇼다운, 칩 보존', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand();
  const before = total(g);
  for (let i = 0; i < 3; i++) assert(g.act(g.hand.turn, 'check').ok);
  assert.equal(g.hand.round, 2);
  for (let i = 0; i < 3; i++) assert(g.act(g.hand.turn, 'check').ok);
  assert.equal(g.phase, 'result');
  assert.equal(g.hand.result.revealed.length, 3);
  assert.equal(total(g), before);
  assert.equal(g.hand.pot, 0);
});
t('삥 → 콜 → 다이 → 두 명 남아 진행', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand();
  const acts = g.actionsFor('p1').map(a => a.type);
  assert.deepEqual(acts, ['check', 'ping', 'quarter', 'half', 'die']);
  g.act('p1', 'ping');
  assert.equal(g.hand.curBet, 100);
  assert.deepEqual(g.actionsFor('p2').map(a => a.type), ['call', 'ddadang', 'quarter', 'half', 'die']);
  g.act('p2', 'call');
  g.act('p0', 'die');
  assert.equal(g.hand.round, 2);
  assert.equal(g.hand.turn, 'p1');
});
t('전원 다이 → 남은 한 명이 팟 획득, 카드 비공개', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand();
  g.act('p1', 'half');
  g.act('p2', 'die');
  g.act('p0', 'die');
  assert.equal(g.phase, 'result');
  assert(g.hand.result.byFold);
  assert.equal(g.hand.result.revealed.length, 0);
  assert.equal(g.player('p1').chips, 900 + 300);
});
t('따당은 현재 베팅의 2배, 레이즈 횟수 제한', () => {
  const g = mk(['a', 'b'], { maxRaises: 2 });
  g.startHand();
  g.act('p1', 'ping');                    // curBet 100, raises 1
  g.act('p0', 'ddadang');                 // to 200, raises 2
  assert.equal(g.hand.curBet, 200);
  assert.deepEqual(g.actionsFor('p1').map(a => a.type), ['call', 'die']);
});
t('올인 콜 → 베팅 스킵 후 쇼다운', () => {
  const g = mk(['a', 'b'], { startChips: 500 });
  g.startHand();
  g.act('p1', 'half');                    // 팟 200 → 100 콜 + ... p1 puts 100
  g.act('p0', 'half');
  const chips = g.player('p1').chips;
  // 남은 칩보다 큰 레이즈는 올인으로 잘린다
  const half = g.actionsFor('p1').find(a => a.type === 'half');
  if (half) assert(half.amount <= chips);
  let guard = 0;
  while (g.phase === 'betting' && guard++ < 20) {
    const opts = g.actionsFor(g.hand.turn);
    const raise = opts.find(a => a.type === 'half' || a.type === 'ddadang');
    g.act(g.hand.turn, raise ? raise.type : (opts.find(a => a.type === 'call') ? 'call' : 'check'));
  }
  assert.equal(g.phase, 'result');
  assert.equal(total(g), 1000);
});
t('사이드팟: 칩 적은 올인은 자기 몫까지만', () => {
  const g = mk(['a', 'b', 'c'], { startChips: 1000, maxRaises: 5 });
  g.player('p2').chips = 300; // c는 가난하다
  g.startHand();               // 앤티 100씩 → p2 200 남음
  const before = total(g);
  // 1라운드: p1 half(150), p2 call, p0 call
  g.act('p1', 'half'); g.act('p2', 'call'); g.act('p0', 'call');
  // 2라운드: p1 half → p2 올인 콜(50) → p0 콜
  g.act('p1', 'half'); g.act('p2', 'call'); g.act('p0', 'call');
  assert.equal(g.phase, 'result');
  assert.equal(total(g), before);
  const r = g.hand.result;
  // p2가 이겼다면 최대 300*3 = 900까지만
  if (r.winners.includes('p2') && r.winners.length === 1) assert(r.payouts.p2 <= 900);
  // 총 지급 = 총 팟
  const paid = Object.values(r.payouts).reduce((x, y) => x + y, 0);
  const contributed = Object.values(g.hand.contrib).reduce((x, y) => x + y, 0);
  assert.equal(paid, contributed);
});
t('사이드팟 강제 시나리오: 가난한 승자', () => {
  const g = mk(['a', 'b', 'c'], { startChips: 1000, maxRaises: 5 });
  g.player('p2').chips = 200;
  g.startHand();
  // 카드 조작: p2에게 38광땡, 나머지는 끗
  const h = g.hand;
  h.cards.p2 = [C(3, '광')]; h.cards.p0 = [C(2, '띠')]; h.cards.p1 = [C(5, '띠')];
  h.deck = [C(8, '광'), C(6, '띠'), C(7, '띠')].reverse().concat([]); // pop 순서: order = p1,p2,p0
  h.deck = [C(7, '띠') /*p0*/, C(8, '광') /*p2*/, C(6, '띠') /*p1*/];
  g.act('p1', 'half'); g.act('p2', 'call'); g.act('p0', 'call');   // p2 100 올인 (총 기여 200)
  // 2라운드: p1, p0만 베팅
  g.act('p1', 'half'); g.act('p0', 'call');
  assert.equal(g.phase, 'result');
  const r = g.hand.result;
  assert.equal(r.hands.p2.name, '38광땡');
  assert.equal(r.payouts.p2, 600);          // 200 × 3명
  const rest = r.payouts.p0 + r.payouts.p1;
  assert(rest > 0);                         // 나머지는 p0/p1 중 높은 쪽
  assert.equal(total(g), 2200);
});
t('재경기: 구사 → 팟 이월 → 같은 사람들로 다시', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand();
  const h = g.hand;
  h.cards.p0 = [C(4, '띠')]; h.cards.p1 = [C(1, '띠')]; h.cards.p2 = [C(5, '띠')];
  h.deck = [C(9, '열') /*p0*/, C(6, '띠') /*p2*/, C(2, '띠') /*p1*/];
  g.act('p1', 'check'); g.act('p2', 'die'); g.act('p0', 'check');
  g.act('p1', 'check'); g.act('p0', 'check');
  assert.equal(g.phase, 'result');
  assert(g.hand.result.redeal);
  assert.equal(g.hand.pot, 300);
  assert(g.startHand());
  assert.deepEqual(g.hand.participants.sort(), ['p0', 'p1']);
  assert.equal(g.hand.pot, 300);
  assert.equal(total(g), 3000);
});
t('접속 끊김 = 다이, 로비에서는 제거', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand();
  g.disconnectPlayer('p1');
  assert(g.hand.folded.has('p1'));
  assert.equal(g.hand.turn, 'p2');
  const g2 = mk(['a', 'b']);
  g2.disconnectPlayer('p1');
  assert.equal(g2.players.length, 1);
});
t('턴인 사람이 나가면 다음 사람에게 턴', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand();
  assert.equal(g.hand.turn, 'p1');
  g.removePlayer('p1');
  assert.equal(g.hand.turn, 'p2');
  assert.equal(g.players.length, 2);
  g.act('p2', 'check'); g.act('p0', 'check');
  g.act('p2', 'check'); g.act('p0', 'check');
  assert.equal(g.phase, 'result');
});
t('타이머 자동행동: 체크 가능하면 체크, 아니면 다이', () => {
  const g = mk(['a', 'b']);
  g.startHand();
  g.autoAct('p1'); assert.equal(g.hand.acted.has('p1'), true); assert(!g.hand.folded.has('p1'));
  g.act('p0', 'ping');
  g.autoAct('p1'); assert(g.hand.folded.has('p1'));
  assert.equal(g.phase, 'result');
});
t('리바이: 칩 0일 때만', () => {
  const g = mk(['a', 'b']);
  assert.equal(g.rebuy('p0'), false);
  g.player('p0').chips = 0;
  assert.equal(g.rebuy('p0'), true);
  assert.equal(g.player('p0').chips, 1000);
});
t('뷰: 남의 카드는 안 보이고 내 카드는 보인다', () => {
  const g = mk(['a', 'b']);
  g.startHand();
  const v = g.view('p0');
  assert.deepEqual(v.players.find(p => p.id === 'p0').cards.length, 1);
  assert.equal(v.players.find(p => p.id === 'p1').cards, null);
  assert.equal(v.players.find(p => p.id === 'p1').cardCount, 1);
  assert.equal(v.actions.length, 0);
  assert(g.view('p1').actions.length > 0);
});
t('딜러 순환', () => {
  const g = mk(['a', 'b', 'c']);
  const dealers = [];
  for (let i = 0; i < 4; i++) {
    g.startHand(); dealers.push(g.hand.dealer);
    while (g.phase === 'betting') g.act(g.hand.turn, g.actionsFor(g.hand.turn)[0].type);
  }
  assert.deepEqual(dealers, ['p0', 'p1', 'p2', 'p0']);
});
t('랜덤 플레이 500판: 칩 총량 보존, 예외 없음', () => {
  const g = mk(['a', 'b', 'c', 'd', 'e', 'f'], { startChips: 2000, maxRaises: 4 }, 42);
  const rng = seeded(99);
  let hands = 0;
  for (let i = 0; i < 500; i++) {
    for (const p of g.players) if (p.chips === 0) g.rebuy(p.id);
    if (!g.startHand()) break;
    hands++;
    const before = total(g);
    let guard = 0;
    while (g.phase === 'betting' && guard++ < 200) {
      const opts = g.actionsFor(g.hand.turn);
      assert(opts.length > 0);
      const pick = opts[Math.floor(rng() * opts.length)];
      assert(g.act(g.hand.turn, pick.type).ok);
    }
    assert.equal(g.phase, 'result');
    assert.equal(total(g), before, 'chips conserved');
    for (const p of g.players) assert(p.chips >= 0);
  }
  assert(hands >= 400);
});

console.log(`\n${n} tests passed`);
