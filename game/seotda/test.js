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
t('땡잡이 = 3·7 어떤 조합이든', () => {
  assert.equal(R.evalHand([C(3, '띠'), C(7, '열')]).special, '땡잡이');
  assert.equal(R.evalHand([C(3, '광'), C(7, '열')]).special, '땡잡이');
  assert.equal(R.evalHand([C(3, '광'), C(7, '띠')]).special, '땡잡이');
});
t('암행어사 = 4·7 어떤 조합이든, 구사(49파토) = 4·9 어떤 조합이든', () => {
  assert.equal(R.evalHand([C(4, '열'), C(7, '열')]).special, '암행어사');
  assert.equal(R.evalHand([C(4, '띠'), C(7, '띠')]).special, '암행어사');
  assert.equal(R.evalHand([C(4, '띠'), C(7, '열')]).special, '암행어사');
  assert.deepEqual(R.resolve([{ id: 'a', cards: [C(1, '광'), C(8, '광')] }, { id: 'b', cards: [C(4, '띠'), C(7, '띠')] }]).winners, ['b']);   // 4띠+7띠도 18광땡을 잡는다
  assert.equal(R.evalHand([C(4, '띠'), C(9, '열')]).special, '구사');
  assert.equal(R.evalHand([C(4, '열'), C(9, '열')]).special, '구사');
  assert.equal(R.evalHand([C(4, '띠'), C(9, '띠')]).special, '구사');
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
t('49파토: 4·9가 있으면 상대가 뭐든 재경기', () => {
  assert.equal(R.resolve([{ id: 'a', cards: [C(1, '광'), C(2, '띠')] }, { id: 'b', cards: [C(4, '띠'), C(9, '열')] }]).redeal, true);
  assert.equal(R.resolve([{ id: 'a', cards: [C(2, '열'), C(2, '띠')] }, { id: 'b', cards: [C(4, '띠'), C(9, '열')] }]).redeal, true);
  const r = R.resolve([{ id: 'a', cards: [C(3, '광'), C(8, '광')] }, { id: 'b', cards: [C(4, '열'), C(9, '띠')] }]);
  assert.equal(r.redeal, true); assert.equal(r.reason, '49파토'); assert.equal(r.by, 'b');
  assert.equal(R.resolve([{ id: 'a', cards: [C(1, '광'), C(3, '광')] }, { id: 'b', cards: [C(4, '열'), C(9, '열')] }], { special: false }).redeal, false);
});
t('땡잡이(3광+7띠)도 땡을 잡는다', () => {
  const r = R.resolve([{ id: 'a', cards: [C(5, '열'), C(5, '띠')] }, { id: 'b', cards: [C(3, '광'), C(7, '띠')] }]);
  assert.deepEqual(r.winners, ['b']); assert.equal(r.catcher, '땡잡이');
});
t('특수족보 OFF면 땡잡이 무시', () => {
  const r = R.resolve([{ id: 'a', cards: [C(7, '띠'), C(7, '열')] }, { id: 'b', cards: [C(3, '띠'), C(7, '열')] }], { special: false });
  assert.deepEqual(r.winners, ['a']);
});
t('동점 → 무승부 재경기(묻고 다시), noRedeal 이면 나눠 가짐', () => {
  const r = R.resolve([{ id: 'a', cards: [C(1, '띠'), C(5, '띠')] }, { id: 'b', cards: [C(2, '열'), C(4, '띠')] }, { id: 'c', cards: [C(3, '광'), C(7, '띠')] }]);
  assert.equal(r.redeal, true); assert.equal(r.reason, '무승부'); assert.deepEqual(r.tied.sort(), ['a', 'b']);
  const r2 = R.resolve([{ id: 'a', cards: [C(1, '띠'), C(5, '띠')] }, { id: 'b', cards: [C(2, '열'), C(4, '띠')] }], { noRedeal: true });
  assert.deepEqual(r2.winners.sort(), ['a', 'b']);
});

console.log('엔진');
function seeded(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }
function mk(names, settings, seed) {
  const g = new Game({ turnSec: 0, ...settings }, seeded(seed || 7));
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
  assert.equal(g.hand.street, 1);
  assert.equal(g.hand.dealer, 'p0');
  assert.equal(g.hand.turn, 'p1');
  g.players.forEach(p => assert.equal(p.chips, 9900));
  assert(g.hand.order.every(id => g.hand.cards[id].length === 1));
});
t('모두 체크 → 2장째 → 모두 체크 → 쇼다운, 칩 보존', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand();
  const before = total(g);
  for (let i = 0; i < 3; i++) assert(g.act(g.hand.turn, 'check').ok);
  assert.equal(g.hand.street, 2);
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
  assert.deepEqual(acts, ['check', 'ping', 'quarter', 'half', 'allin', 'die']);
  g.act('p1', 'ping');
  assert.equal(g.hand.curBet, 100);
  assert.deepEqual(g.actionsFor('p2').map(a => a.type), ['call', 'ddadang', 'quarter', 'half', 'allin', 'die']);
  g.act('p2', 'call');
  g.act('p0', 'die');
  assert.equal(g.hand.street, 2);
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
  assert.equal(g.player('p1').chips, 9900 + 300);
});
t('올인: 남은 돈 전부, 같은 금액의 레이즈는 올인으로 대체', () => {
  const g = mk(['a', 'b']);
  g.startHand();
  const opts = g.actionsFor('p1');
  const ai = opts.find(o => o.type === 'allin');
  assert(ai); assert.equal(ai.amount, 9900);
  assert(g.act('p1', 'allin').ok);
  assert(g.hand.allin.has('p1')); assert.equal(g.player('p1').chips, 0); assert.equal(g.hand.curBet, 9900);
  const o0 = g.actionsFor('p0').map(o => o.type);
  assert.deepEqual(o0, ['call', 'die']);                 // 콜하면 나도 올인 → 레이즈 불가
  g.act('p0', 'call');
  assert.equal(g.phase, 'result');                       // 둘 다 올인 → 베팅 스킵, 바로 쇼다운
  assert.equal(total(g), 20000);
  // 칩이 적어 하프가 올인과 같은 금액이면 하프 대신 올인만
  const g2 = mk(['a', 'b']); g2.player('p1').chips = 150; g2.startHand();
  const t2 = g2.actionsFor('p1').map(o => o.type);
  assert(t2.includes('allin') && !t2.includes('half'));
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
  const g = mk(['a', 'b']);
  g.players.forEach(p => p.chips = 500);
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
  const g = mk(['a', 'b', 'c'], { maxRaises: 5 });
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
  const g = mk(['a', 'b', 'c'], { maxRaises: 5 });
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
  assert.equal(total(g), 20200);
});
t('재경기: 49파토 → 팟 이월 → 같은 사람들로 다시', () => {
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
  assert.equal(total(g), 30000);
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
  assert.equal(g.player('p0').chips, 10000);
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
  const g = mk(['a', 'b', 'c', 'd', 'e', 'f'], { maxRaises: 4 }, 42);
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


console.log('모드');
t('판돈 100 고정, 시작금은 설정 가능(1,000~10,000,000, 100 단위)', () => {
  const g = mk(['a', 'b'], { ante: 500, startChips: 50 });
  assert.equal(g.settings.ante, 100); assert.equal(g.settings.startChips, 1000);
  g.updateSettings({ ante: 1, startChips: 50000 });
  assert.equal(g.settings.ante, 100); assert.equal(g.settings.startChips, 50000);
  g.players.forEach(p => assert.equal(p.chips, 50000));            // 시작 전이라 모두 반영
  g.startHand(); while (g.phase === 'betting') g.act(g.hand.turn, 'check');
  const before = g.player('p0').chips;
  g.updateSettings({ startChips: 20000 });
  assert.equal(g.player('p0').chips, before);                       // 게임 중엔 기존 돈 유지
  g.player('p1').chips = 0; assert(g.rebuy('p1')); assert.equal(g.player('p1').chips, 20000);   // 재참가는 새 시작금
  const q = g.addPlayer('p9', 'c'); assert.equal(q.chips, 20000);
});
t('3장 섯다: 2장 → 베팅 → 3장째 → 선택 → 베팅 → 쇼다운', () => {
  const g = mk(['a', 'b', 'c'], { mode: '3' });
  g.startHand();
  assert.equal(g.hand.cards.p0.length, 2);
  for (let i = 0; i < 3; i++) g.act(g.hand.turn, 'check');
  assert.equal(g.phase, 'choosing');
  assert.equal(g.hand.cards.p0.length, 3);
  assert.equal(g.view('p0').needChoose, true);
  assert.equal(g.actionsFor('p0').length, 0);
  assert.equal(g.choose('p0', [5]).ok, false);
  assert.equal(g.choose('p0', [1]).ok, true);              // 1번을 공개, 족보는 3장 중 최선 2장
  assert.deepEqual(g.hand.chosen.p0, R.bestPair(g.hand.cards.p0).cards);
  assert.equal(g.hand.opened.p0, g.hand.cards.p0[1]);
  assert.equal(g.view('p1').players.find(p => p.id === 'p0').open, g.hand.cards.p0[1]);   // 남에게 공개됨
  assert.equal(g.view('p1').players.find(p => p.id === 'p0').cards, null);                 // 나머지는 비공개
  assert.equal(g.choose('p0', [0]).ok, false);             // 이미 골랐음
  assert.equal(g.view('p0').needChoose, false);
  g.choose('p1', [1, 2]);                                   // 2장 지정 방식도 허용 → 나머지(0번) 공개
  assert.equal(g.hand.opened.p1, g.hand.cards.p1[0]);
  assert.deepEqual(g.hand.chosen.p1, R.bestPair(g.hand.cards.p1).cards);
  assert.equal(g.phase, 'choosing');
  g.autoChoose();                                          // p2 시간 초과 → 자동
  assert.equal(g.phase, 'betting');
  for (let i = 0; i < 3; i++) g.act(g.hand.turn, 'check');
  assert.equal(g.phase, 'result');
  const r = g.hand.result;
  assert.deepEqual(r.used.p0, R.bestPair(g.hand.cards.p0).cards);   // 공개 카드도 조합에 포함
  assert.equal(R.evalHand(r.used.p0).name, r.hands.p0.name);
  assert.equal(total(g), 30000);
});
t('3장 섯다: 선택 중 다이(접속 끊김) → 나머지만 고르면 진행', () => {
  const g = mk(['a', 'b', 'c'], { mode: '3' });
  g.startHand();
  for (let i = 0; i < 3; i++) g.act(g.hand.turn, 'check');
  g.choose('p0', [0, 1]); g.choose('p1', [0, 1]);
  g.disconnectPlayer('p2');
  assert.equal(g.phase, 'betting');
  assert(g.hand.folded.has('p2'));
});
t('홀덤 섯다: 개인 2장 + 가운데 1장(뒤집힘) → 베팅 → 공개 → 3장 중 2장 선택 → 베팅', () => {
  const g = mk(['a', 'b'], { mode: 'holdem' });
  g.startHand();
  assert.equal(g.hand.cards.p0.length, 2); assert.equal(g.hand.board.length, 1); assert.equal(g.hand.boardHidden, 1);
  assert.deepEqual(g.view('p0').board, [null]);                 // 아직 뒤집혀 있음
  assert.equal(g.view('p0').pool.length, 2);
  g.act('p1', 'check'); g.act('p0', 'check');
  assert.equal(g.phase, 'choosing');
  assert.equal(g.hand.boardHidden, 0);
  assert.equal(g.view('p0').board[0], g.hand.board[0]);         // 공개됨
  assert.equal(g.view('p0').pool.length, 3);
  assert.equal(g.choose('p0', [0, 2]).ok, true);                // 내 1장 + 공유 카드
  assert.deepEqual(g.hand.chosen.p0, [g.hand.cards.p0[0], g.hand.board[0]]);
  g.autoChoose();
  assert.equal(g.phase, 'betting');
  g.act('p1', 'check'); g.act('p0', 'check');
  assert.equal(g.phase, 'result');
  const r = g.hand.result;
  assert.deepEqual(r.used.p0, [g.hand.cards.p0[0], g.hand.board[0]]);
  assert.equal(r.hands.p0.name, R.evalHand(r.used.p0).name);
  assert.equal(total(g), 20000);
});
t('홀덤 섯다 8명도 카드가 모자라지 않는다 (16 + 1 = 17장)', () => {
  const g = mk(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], { mode: 'holdem', maxPlayers: 8 });
  g.startHand();
  let guard = 0;
  while (g.inProgress() && guard++ < 60) { if (g.phase === 'choosing') g.autoChoose(); else g.act(g.hand.turn, 'check'); }
  assert.equal(g.phase, 'result');
  assert.equal(g.hand.deck.length, 3);
});
t('게임 중 모드 변경 → 다음 판부터 적용 (진행 중인 판은 그대로), 다른 설정은 진행 중 거부', () => {
  const g = mk(['a', 'b']);
  g.startHand();
  assert.equal(g.updateSettings({ turnSec: 5 }), false);
  assert.equal(g.updateSettings({ mode: '3' }), true);
  assert.equal(g.hand.mode, '2');
  while (g.phase === 'betting') g.act(g.hand.turn, 'check');
  assert.equal(g.view('p0').nextModeLabel, '3장 섯다');
  g.startHand();
  assert.equal(g.hand.mode, '3');
  assert.equal(g.hand.cards.p0.length, 2);
});
t('돈 0이면 판 밖에서 언제든 시작금으로 재참가, 판 안(올인)에서는 불가', () => {
  const g = mk(['a', 'b', 'c']);
  g.player('p2').chips = 0;                                 // 판에 못 들어감
  g.startHand();
  assert(!g.hand.participants.includes('p2'));
  assert.equal(g.canRebuy('p2'), true);
  assert.equal(g.rebuy('p2'), true);
  assert.equal(g.player('p2').chips, 10000);
  g.player('p1').chips = 0; g.hand.allin.add('p1');        // 판 안에서 올인 상태
  assert.equal(g.canRebuy('p1'), false);
});
t('게임 중 입장 → 다음 판부터 참가, 아바타 저장', () => {
  const g = mk(['a', 'b']);
  g.startHand();
  const p = g.addPlayer('p9', '늦게온친구', 'dog');
  assert(p); assert.equal(g.view('p9').players.find(x => x.id === 'p9').avatar, 'dog');
  assert(!g.hand.participants.includes('p9'));
  assert.equal(g.view('p9').players.find(x => x.id === 'p9').inHand, false);
  while (g.phase === 'betting') g.act(g.hand.turn, 'check');
  g.startHand();
  assert(g.hand.participants.includes('p9'));
});
t('탭을 닫고 새 토큰으로 돌아오면 같은 닉네임의 끊긴 자리를 이어받는다', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand();
  g.act('p1', 'die');                 // b 다이
  g.disconnectPlayer('p1');           // 그리고 접속 끊김
  const p = g.addPlayer('newtoken', 'b');
  assert.equal(p.id, 'newtoken'); assert.equal(g.players.length, 3);
  assert(g.hand.participants.includes('newtoken') && !g.hand.participants.includes('p1'));
  assert(g.hand.folded.has('newtoken'));
  while (g.phase === 'betting') g.act(g.hand.turn, 'check');
  assert.equal(g.phase, 'result');
  assert.equal(total(g), 30000);
  // 살아있는 사람의 자리는 못 뺏는다 → 새 자리
  const g2 = mk(['a', 'b']);
  g2.startHand();
  g2.player('p1').connected = false;
  const q = g2.addPlayer('other', 'b');
  assert.equal(q.seat, 2);
});
t('랜덤 플레이 (3장·홀덤) 300판: 칩 보존, 예외 없음', () => {
  for (const mode of ['3', 'holdem']) {
    const g = mk(['a', 'b', 'c', 'd', 'e'], { mode, maxRaises: 4 }, 11);
    const rng = seeded(5);
    for (let i = 0; i < 300; i++) {
      for (const p of g.players) if (p.chips === 0) g.rebuy(p.id);
      assert(g.startHand());
      const before = total(g);
      let guard = 0;
      while (g.inProgress() && guard++ < 300) {
        if (g.phase === 'choosing') {
          const live = g.hand.order.filter(id => !g.hand.folded.has(id) && !g.hand.chosen[id]);
          if (rng() < 0.3) g.autoChoose(); else { const id = live[0]; const a = Math.floor(rng() * 3); assert(g.choose(id, [a, (a + 1 + Math.floor(rng() * 2)) % 3]).ok); }
          continue;
        }
        const opts = g.actionsFor(g.hand.turn);
        assert(g.act(g.hand.turn, opts[Math.floor(rng() * opts.length)].type).ok);
      }
      assert.equal(g.phase, 'result');
      assert.equal(total(g), before);
    }
  }
});

console.log('자리 비움 · 타이머 연장 · 전적 · 스냅샷');
t('자리 비움: 다음 판부터 빠지고, 진행 중인 판은 그대로', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand();
  g.setAway('p2', true);
  assert(g.hand.participants.includes('p2'));
  while (g.phase === 'betting') g.act(g.hand.turn, 'check');
  g.startHand();
  assert(!g.hand.participants.includes('p2'));
  assert.equal(g.view('p2').players.find(p => p.id === 'p2').away, true);
  g.setAway('p2', false);
  while (g.phase === 'betting') g.act(g.hand.turn, 'check');
  g.startHand();
  assert(g.hand.participants.includes('p2'));
});
t('타이머 연장: 내 차례에 1회 +15초', () => {
  const g = mk(['a', 'b'], { turnSec: 30 });
  g.startHand();
  const at = g.hand.turnAt;
  assert.equal(g.canExtend('p0'), false);       // 내 차례 아님
  assert.equal(g.extendTurn('p1'), true);
  assert.equal(g.hand.turnAt, at + 15000);
  assert.equal(g.extendTurn('p1'), false);      // 1회 제한
  assert.equal(g.view('p1').canExtend, false);
});
t('전적: 판수·승·순손익·최고 족보·연승, 기록', () => {
  const g = mk(['a', 'b']);
  for (let i = 0; i < 3; i++) { g.startHand(); while (g.phase === 'betting') g.act(g.hand.turn, 'check'); }
  const s0 = g.player('p0').stats, s1 = g.player('p1').stats;
  assert.equal(s0.hands + s1.hands, 6);
  assert.equal(s0.net + s1.net, 0);
  assert(s0.wins + s1.wins >= 3);
  assert(s0.best && s0.best.name);
  assert.equal(g.history.length, 3);
  assert.equal(g.view('p0').history.length, 3);
});
t('스냅샷 → 복원: 카드 없음, 진행 중 판은 환급, 새 방장만 접속 상태, 딜러 순환 유지', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand(); while (g.phase === 'betting') g.act(g.hand.turn, 'check');
  g.startHand(); g.act(g.hand.turn, 'half');           // 판 진행 중 (p1 이 하프)
  const before = { p0: g.player('p0').chips + g.hand.contrib.p0, p1: g.player('p1').chips + g.hand.contrib.p1, p2: g.player('p2').chips + g.hand.contrib.p2 };
  const snap = JSON.parse(JSON.stringify(g.snapshot('p0')));
  assert(!JSON.stringify(snap).includes('"cards"'));
  const g2 = Game.restore(snap, 'p1');
  assert.equal(g2.phase, 'lobby'); assert.equal(g2.handNo, 2);
  for (const id of ['p0', 'p1', 'p2']) assert.equal(g2.player(id).chips, before[id]);
  assert.equal(g2.player('p1').connected, true); assert.equal(g2.player('p0').connected, false); assert.equal(g2.player('p2').connected, false);
  assert.equal(g2.canStart(), false);                  // 아직 아무도 재접속 안 함
  g2.addPlayer('p2', 'c');                              // 재접속
  assert.equal(g2.canStart(), true);
  g2.startHand();
  assert.equal(g2.handNo, 3);
  assert.equal(g2.hand.dealer, 'p2');                   // 2판 딜러 p1 → 다음 p2
  assert.equal(g2.hand.participants.length, 2);
});

t('진 사람이 다음 게임을 고른다 (가장 많이 잃은 사람), 본인만·판 사이에만', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand();
  g.act('p1', 'half'); g.act('p2', 'die'); g.act('p0', 'call');
  g.act('p1', 'check'); g.act('p0', 'check');
  assert.equal(g.phase, 'result');
  const r = g.hand.result; const loser = g.hand.order.find(id => !r.winners.includes(id) && (r.payouts[id] || 0) - g.hand.contrib[id] < -100);
  assert.equal(g.picker, loser);
  const v = g.view(loser);
  assert.equal(v.picker, loser); assert(v.pickerName);
  const other = ['p0', 'p1', 'p2'].find(id => id !== loser);
  assert.equal(g.pickMode(other, '3'), false);          // 남은 못 고른다
  assert.equal(g.pickMode(loser, 'holdem'), true);
  assert.equal(g.settings.mode, 'holdem'); assert.equal(g.picker, null);
  g.startHand(); assert.equal(g.hand.mode, 'holdem');
  assert.equal(g.pickMode(loser, '2'), false);          // 판 중엔 불가
  const g2 = mk(['a', 'b'], { loserPicks: false });
  g2.startHand(); while (g2.phase === 'betting') g2.act(g2.hand.turn, 'check');
  assert.equal(g2.view('p0').picker, null);
});

t('봇: 플레이어로 참가, 스냅샷 복원 후에도 접속 상태', () => {
  const g = mk(['a']);
  const b = g.addPlayer('bot1', '우영봇', 'woo', true);
  assert(b.bot); assert.equal(g.view('p0').players.find(p => p.id === 'bot1').bot, true);
  assert(g.canStart());
  g.startHand(); while (g.phase === 'betting') g.act(g.hand.turn, 'check');
  const g2 = Game.restore(JSON.parse(JSON.stringify(g.snapshot('p0'))), 'p0');
  assert.equal(g2.player('bot1').connected, true); assert(g2.player('bot1').bot);
});

t('무승부 → 판돈 묻고 비긴 사람끼리만 다음 판', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand();
  const h = g.hand;
  h.cards.p0 = [C(1, '띠')]; h.cards.p1 = [C(2, '열')]; h.cards.p2 = [C(3, '광')];
  h.deck = [C(7, '띠') /*p0*/, C(6, '띠') /*p2*/, C(4, '띠') /*p1*/];   // p0 1+7=8끗, p1 2+4=6끗, p2 3+6=9(갑오)? → 조정
  h.deck = [C(9, '띠') /*p0: 1+9 구삥*/, C(6, '띠') /*p2: 3+6 갑오*/, C(4, '띠') /*p1: 2+4 6끗*/];
  h.deck = [C(5, '띠') /*p0: 1+5=6끗*/, C(7, '띠') /*p2: 3+7 땡잡이(망통)*/, C(4, '띠') /*p1: 2+4=6끗*/];
  g.act('p1', 'check'); g.act('p2', 'check'); g.act('p0', 'check');
  g.act('p1', 'check'); g.act('p2', 'check'); g.act('p0', 'check');
  assert.equal(g.phase, 'result');
  assert(g.hand.result.redeal); assert.deepEqual(g.hand.result.tied.sort(), ['p0', 'p1']);
  assert.equal(g.hand.pot, 300);
  g.startHand();
  assert.deepEqual(g.hand.participants.sort(), ['p0', 'p1']);   // 진 p2는 빠진다
  assert.equal(g.hand.pot, 300);
  assert.equal(total(g), 30000);
});

console.log('관전');
t('관전자(중간 입장·자리 비움)는 모든 패·족보가 보이고, 참가자는 자기 패만 보인다', () => {
  const g = mk(['a', 'b', 'c']);
  g.setAway('p2', true);
  g.startHand();
  assert.deepEqual(g.hand.participants.sort(), ['p0', 'p1']);
  g.addPlayer('p3', 'late');                          // 판 도중 입장
  for (const spec of ['p2', 'p3']) {
    const v = g.view(spec);
    assert.equal(v.spectating, true);
    for (const id of ['p0', 'p1']) {
      const p = v.players.find(x => x.id === id);
      assert(Array.isArray(p.cards) && p.cards.length === 1, spec + ' sees ' + id);
      assert(p.hand, 'hand name shown');
    }
  }
  const v0 = g.view('p0');
  assert.equal(v0.spectating, false);
  assert(Array.isArray(v0.players.find(x => x.id === 'p0').cards));
  assert.equal(v0.players.find(x => x.id === 'p1').cards, null);
  const v1 = g.view('p1');
  assert.equal(v1.players.find(x => x.id === 'p0').cards, null);
});
t('관전자는 홀덤 가운데 숨김 카드도 보인다', () => {
  const g = mk(['a', 'b', 'c'], { mode: 'holdem' });
  g.setAway('p2', true);
  g.startHand();
  assert.equal(g.view('p0').board[0], null);
  assert.notEqual(g.view('p2').board[0], null);
});

console.log('다음 판 시작 권한');
t('진 사람이 다음 판을 시작한다 · 진 사람이 나가면 방장(null)', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand();
  g.act('p1', 'die'); g.act('p2', 'die');                   // p0 승리, 진 사람은 앤티만 낸 p1(딜러 다음 순서)
  assert.equal(g.phase, 'result');
  assert.equal(g.starter(), g.loser); assert(g.loser === 'p1' || g.loser === 'p2');
  const st = g.starter();
  assert.equal(g.startBy('p0' === st ? 'p2' : 'p0'), false);
  assert.equal(g.phase, 'result');
  g.player(st).connected = false;
  assert.equal(g.starter(), null);                            // 방장이 시작
  g.player(st).connected = true;
  assert(g.startBy(st)); assert.equal(g.phase, 'betting'); assert.equal(g.loser, null);
});

console.log(`\n${n} tests passed`);
