/* 홀덤 로직 테스트 — `node game/holdem/test.js` */
const R = require('./rules.js');
const { Game } = require('./engine.js');
const assert = require('assert');

/* 카드 표기: 'As' 'Td' '9h' … */
const C = s => { const r = { T: 10, J: 11, Q: 12, K: 13, A: 14 }[s[0]] || +s[0]; return (r - 2) * 4 + R.SUITS.indexOf(s[1]); };
const H = str => str.split(' ').map(C);
let n = 0;
function t(name, fn) { fn(); n++; console.log('  ✓', name); }
function seeded(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

console.log('족보');
t('카드 id 왕복', () => { assert.equal(R.cardById(C('As')).name, 'A♠'); assert.equal(R.cardById(C('2c')).name, '2♣'); assert.equal(R.DECK.length, 52); });
t('로열 / 스트레이트 플러시 / 휠 플러시', () => {
  assert.equal(R.evalBest(H('As Ks Qs Js Ts')).name, '로열 스트레이트 플러시');
  assert.equal(R.evalBest(H('9h 8h 7h 6h 5h')).cat, 8);
  const wheel = R.evalBest(H('Ah 2h 3h 4h 5h')); assert.equal(wheel.cat, 8); assert.equal(wheel.tb[0], 5);
  assert(R.evalBest(H('9h 8h 7h 6h 5h')).score > wheel.score);
});
t('포카드 > 풀하우스 > 플러시 > 스트레이트 > 트리플 > 투페어 > 원페어 > 하이', () => {
  const s = ['9s 9h 9d 9c 2s', 'Ks Kh Kd 3c 3s', 'As 9s 7s 4s 2s', 'Ts 9h 8d 7c 6s', 'Qs Qh Qd 7c 2s', 'Js Jh 5d 5c As', 'As Ah 9d 7c 2s', 'As Kh 9d 7c 2s'].map(x => R.evalBest(H(x)).score);
  for (let i = 1; i < s.length; i++) assert(s[i - 1] > s[i], 'order ' + i);
});
t('키커·타이브레이크', () => {
  assert(R.evalBest(H('As Ah Kd 7c 2s')).score > R.evalBest(H('As Ah Qd 7c 2s')).score);           // 원페어 키커
  assert(R.evalBest(H('Js Jh 5d 5c As')).score > R.evalBest(H('Js Jh 5d 5c Ks')).score);           // 투페어 키커
  assert(R.evalBest(H('Ks Kh Kd 3c 3s')).score > R.evalBest(H('Qs Qh Qd Ac As')).score);           // 풀하우스는 트리플 랭크
  assert(R.evalBest(H('As 9s 7s 4s 2s')).score > R.evalBest(H('Ks Qs Js 9s 2s')).score);           // 플러시 하이카드
  assert.equal(R.evalBest(H('As 2h 3d 4c 5s')).tb[0], 5);                                             // 휠은 5 하이
  assert(R.evalBest(H('6s 2h 3d 4c 5s')).score > R.evalBest(H('As 2h 3d 4c 5s')).score);
  assert.equal(R.evalBest(H('As Ah 9d 7c 2s')).score, R.evalBest(H('Ad Ac 9h 7s 2d')).score);      // 무늬만 다르면 동점
});
t('7장 중 최선 5장', () => {
  const h = R.evalBest(H('As Ks 2h 7d Qs Js Ts'));
  assert.equal(h.name, '로열 스트레이트 플러시');
  assert.deepEqual(h.cards.slice().sort((a, b) => a - b), H('As Ks Qs Js Ts').sort((a, b) => a - b));
  const two = R.evalBest(H('9s 9h 5d 5c Kd Kh 2s'));
  assert.equal(two.cat, 2); assert.deepEqual(two.tb.slice(0, 2), [13, 9]);                            // 세 페어 중 높은 둘
  const fl = R.evalBest(H('2s 5s 9s Ks 7s 7h 7d'));
  assert.equal(fl.cat, 5);                                                                            // 플러시 > 트리플
  assert.equal(R.evalBest(H('As Kd 8h 8c 3s 2d Qs')).desc, '8 원페어');
});
t('resolve: 동점 → 여러 승자', () => {
  const r = R.resolve([{ id: 'a', cards: H('As Kd 9h 9c 5s 2d 3c') }, { id: 'b', cards: H('Ah Kc 9h 9c 5s 2d 3c') }, { id: 'c', cards: H('Qh Jc 9h 9c 5s 2d 3c') }]);
  assert.deepEqual(r.winners.sort(), ['a', 'b']);
});
t('프리플롭 설명·강도', () => {
  assert.equal(R.holeDesc(H('As Ah')), '포켓 A');
  assert.equal(R.holeDesc(H('Ks Qs')), 'K·Q 수티드');
  assert(R.holeStrength(H('As Ah')) > R.holeStrength(H('As Ks')));
  assert(R.holeStrength(H('As Ks')) > R.holeStrength(H('7s 2d')));
});

console.log('엔진');
function mk(names, settings, seed) {
  const g = new Game({ turnSec: 0, ...settings }, seeded(seed || 7));
  names.forEach((nm, i) => g.addPlayer('p' + i, nm));
  return g;
}
const total = g => g.players.reduce((a, p) => a + p.chips, 0) + (g.hand ? g.hand.pot : 0);
const turnOf = g => g.hand.turn;
const opts = (g, id) => g.actionsFor(id).map(a => a.type);

t('블라인드 · 프리플롭 순서 (3인: 딜러 p0, SB p1, BB p2, 첫 행동 p0)', () => {
  const g = mk(['a', 'b', 'c']);
  assert(g.startHand());
  const h = g.hand;
  assert.equal(h.dealer, 'p0'); assert.equal(h.sbId, 'p1'); assert.equal(h.bbId, 'p2');
  assert.equal(g.player('p1').chips, 9950); assert.equal(g.player('p2').chips, 9900);
  assert.equal(h.pot, 150); assert.equal(h.curBet, 100);
  assert.equal(turnOf(g), 'p0');
  assert.deepEqual(opts(g, 'p0'), ['call', 'raise', 'allin', 'fold']);
  assert.equal(g.hand.cards.p0.length, 2);
  assert.equal(total(g), 30000);
});
t('헤즈업: 딜러가 SB, 프리플롭은 딜러 먼저, 포스트플롭은 BB 먼저', () => {
  const g = mk(['a', 'b']);
  g.startHand();
  const h = g.hand;
  assert.equal(h.dealer, 'p0'); assert.equal(h.sbId, 'p0'); assert.equal(h.bbId, 'p1');
  assert.equal(turnOf(g), 'p0');
  g.act('p0', 'call'); assert.equal(turnOf(g), 'p1');                     // BB 옵션
  assert.deepEqual(opts(g, 'p1'), ['check', 'raise', 'allin', 'fold']);
  g.act('p1', 'check');
  assert.equal(h.street, 1); assert.equal(h.board.length, 3);
  assert.equal(turnOf(g), 'p1');                                            // 포스트플롭은 BB(비딜러) 먼저
});
t('BB 옵션: 모두 콜하면 BB가 체크/레이즈 할 수 있다', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand();
  g.act('p0', 'call'); g.act('p1', 'call');
  assert.equal(turnOf(g), 'p2'); assert(opts(g, 'p2').includes('check'));
  g.act('p2', 'check');
  assert.equal(g.hand.street, 1); assert.equal(turnOf(g), 'p1');          // 플롭은 SB부터
});
t('벳 → 콜 → 턴 → 리버 → 쇼다운, 돈 보존', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand();
  g.act('p0', 'call'); g.act('p1', 'call'); g.act('p2', 'check');
  const r = g.actionsFor('p1').find(a => a.type === 'bet');
  assert.equal(r.min, 100); assert(r.presets.length >= 3);
  g.act('p1', 'bet', 300);
  assert.equal(g.hand.curBet, 300); assert.equal(g.hand.minRaise, 300);
  assert.equal(turnOf(g), 'p2');
  const rr = g.actionsFor('p2').find(a => a.type === 'raise'); assert.equal(rr.min, 600);
  g.act('p2', 'call'); g.act('p0', 'call');
  assert.equal(g.hand.street, 2); assert.equal(g.hand.board.length, 4);
  g.act('p1', 'check'); g.act('p2', 'check'); g.act('p0', 'check');
  assert.equal(g.hand.street, 3); assert.equal(g.hand.board.length, 5);
  g.act('p1', 'check'); g.act('p2', 'check'); g.act('p0', 'check');
  assert.equal(g.phase, 'result');
  const res = g.hand.result;
  assert(res.winners.length >= 1); assert.deepEqual(res.revealed.sort(), ['p0', 'p1', 'p2']);
  assert.equal(Object.values(res.payouts).reduce((a, b) => a + b, 0), 1200);
  assert.equal(total(g), 30000);
  assert.equal(g.history.length, 1);
});
t('레이즈 최소 폭 = 직전 레이즈 폭, 금액은 10원 단위로', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand();
  g.act('p0', 'raise', 300);                                              // 100 → 300 (폭 200)
  assert.equal(g.hand.curBet, 300); assert.equal(g.hand.minRaise, 200);
  const r = g.actionsFor('p1').find(a => a.type === 'raise'); assert.equal(r.min, 500);
  assert(g.act('p1', 'raise', 555).ok);                                   // 560으로 반올림
  assert.equal(g.hand.bets.p1, 560);
  assert(g.act('p2', 'raise', 10).ok); assert.equal(g.hand.bets.p2, 820);  // 최소 미만이면 최소(560+260)로
});
t('모두 폴드 → 남은 사람 승리, 패 비공개', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand();
  g.act('p0', 'fold'); g.act('p1', 'fold');
  assert.equal(g.phase, 'result');
  assert.deepEqual(g.hand.result.winners, ['p2']); assert(g.hand.result.byFold);
  assert.equal(g.player('p2').chips, 10050);
  assert.equal(g.view('p0').players.find(p => p.id === 'p2').cards, null);
});
t('올인 · 사이드팟 · 런아웃(보드 자동 공개)', () => {
  const g = mk(['a', 'b', 'c']);
  g.player('p0').chips = 500;                                             // 숏스택
  g.startHand();
  g.act('p0', 'allin');                                                   // 500 올인
  assert.equal(g.hand.curBet, 500); assert.equal(g.hand.minRaise, 400);
  g.act('p1', 'raise', 2000); g.act('p2', 'call');
  assert.equal(g.hand.street, 1);
  g.act('p1', 'allin'); g.act('p2', 'call');                              // 둘 다 올인 → 보드 끝까지
  assert.equal(g.phase, 'result'); assert.equal(g.hand.board.length, 5); assert(g.hand.runout);
  const r = g.hand.result;
  assert.equal(Object.values(r.payouts).reduce((a, b) => a + b, 0), 500 + 10000 + 10000);
  /* p0는 최대 500×3 = 1500까지만 */
  assert(r.payouts.p0 <= 1500);
  assert.equal(total(g), 20500);
});
t('올인한 숏스택 BB에게 SB가 콜/폴드 선택권 (베팅 성립)', () => {
  const g = mk(['a', 'b']);
  g.player('p1').chips = 60;                                              // BB 60 올인(숏)
  g.startHand();
  assert.equal(g.hand.curBet, 60);
  assert.equal(turnOf(g), 'p0');                                          // 딜러=SB가 콜 여부 결정
  assert.deepEqual(opts(g, 'p0'), ['call', 'fold']);                      // 상대가 올인이라 레이즈 불가
  g.act('p0', 'call');
  assert.equal(g.phase, 'result'); assert.equal(g.hand.board.length, 5);
});
t('동점 → 팟 분배', () => {
  const g = mk(['a', 'b']);
  g.startHand();
  const h = g.hand;
  h.cards.p0 = H('2s 3d'); h.cards.p1 = H('2h 3c');
  h.deck = H('Kc Qc 5d 5h Kh'); h.deck.reverse();                          // pop 순서
  g.act('p0', 'call'); g.act('p1', 'check');
  g.act('p1', 'check'); g.act('p0', 'check'); g.act('p1', 'check'); g.act('p0', 'check'); g.act('p1', 'check'); g.act('p0', 'check');
  assert.equal(g.phase, 'result');
  assert.deepEqual(g.hand.result.winners.sort(), ['p0', 'p1']);
  assert.equal(g.player('p0').chips, 10000); assert.equal(g.player('p1').chips, 10000);
});
t('딜러 버튼 이동 · 돈 없는 사람은 빠짐 · 재참가', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand(); g.act('p0', 'fold'); g.act('p1', 'fold');
  g.player('p1').chips = 0;
  g.startHand();
  assert.equal(g.hand.dealer, 'p1' === g.hand.dealer ? 'p1' : g.hand.dealer);
  assert(!g.hand.participants.includes('p1'));
  assert.equal(g.hand.dealer, 'p2');                                      // p1 자리를 건너뛰고 다음 자리
  assert(g.canRebuy('p1'));
  g.act(turnOf(g), 'fold');
  assert(g.rebuy('p1')); assert.equal(g.player('p1').chips, 10000); assert.equal(g.player('p1').rebuys, 1);
});
t('시간 초과: 체크 가능하면 체크, 아니면 폴드', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand();
  g.autoAct('p0'); assert(g.hand.folded.has('p0'));
  g.act('p1', 'call'); g.autoAct('p2'); assert(!g.hand.folded.has('p2')); assert.equal(g.hand.street, 1);
});
t('접속 끊김 = 폴드, 대기실에서는 제거', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand();
  g.disconnectPlayer('p0'); assert(g.hand.folded.has('p0')); assert.equal(turnOf(g), 'p1');
  const g2 = mk(['a', 'b']); g2.disconnectPlayer('p1'); assert.equal(g2.players.length, 1);
});
t('뷰: 남의 패는 안 보이고, 결과에서 공개된 패만 보인다 · 관전자는 다 보인다', () => {
  const g = mk(['a', 'b', 'c']);
  g.setAway('p2', true);
  g.startHand();
  const v0 = g.view('p0');
  assert(Array.isArray(v0.players.find(p => p.id === 'p0').cards));
  assert.equal(v0.players.find(p => p.id === 'p1').cards, null);
  assert.equal(v0.players.find(p => p.id === 'p1').cardCount, 2);
  const v2 = g.view('p2'); assert(v2.spectating); assert.equal(v2.players.find(p => p.id === 'p1').cards.length, 2); assert(v2.players.find(p => p.id === 'p1').hand);
  g.act('p0', 'call'); g.act('p1', 'check');
  const v0f = g.view('p0'); assert.equal(v0f.board.length, 3); assert(v0f.players.find(p => p.id === 'p0').best.length === 5);
});
t('설정: 블라인드·시작 돈, 시작 전 시작 돈 변경은 모두에게', () => {
  const g = mk(['a', 'b']);
  assert(g.updateSettings({ bb: 200, startChips: 20000 }));
  assert.equal(g.settings.bb, 200); assert.equal(g.sb(), 100);
  assert.equal(g.player('p0').chips, 20000);
  g.startHand(); assert(!g.updateSettings({ bb: 300 }));
  assert.equal(g.hand.pot, 300);
});
t('스냅샷 → 복원: 진행 중 판은 환급, 새 방장만 접속 상태', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand(); g.act('p0', 'raise', 500);
  const snap = g.snapshot('p0');
  const g2 = Game.restore(snap, 'p1');
  assert.equal(g2.phase, 'lobby'); assert.equal(g2.handNo, 1);
  assert.equal(g2.player('p0').chips, 10000); assert.equal(g2.player('p1').chips, 10000); assert.equal(g2.player('p2').chips, 10000);
  assert(!g2.player('p0').connected); assert(g2.player('p1').connected);
  assert(g2.canStart() === false);                                        // 접속자 1명
});
t('봇 플래그 · 자리 이어받기', () => {
  const g = mk(['a', 'b']);
  const b = g.addPlayer('bot_1', '봇', 'dog', true); assert(b.bot);
  g.disconnectPlayer('p1');                                               // 대기실이라 제거
  g.startHand(); g.act(turnOf(g), 'fold');
  g.player('p0').connected = false;
  const back = g.addPlayer('newid', 'a'); assert.equal(back.id, 'newid'); assert.equal(g.players.filter(p => p.name === 'a').length, 1);
});
t('여러 판 랜덤 진행해도 돈이 보존된다', () => {
  const g = mk(['a', 'b', 'c', 'd', 'e'], {}, 11);
  const rng = seeded(99);
  for (let hand = 0; hand < 40; hand++) {
    for (const p of g.players) if (g.canRebuy(p.id)) g.rebuy(p.id);
    if (!g.startHand()) break;
    let guard = 0;
    while (g.phase === 'betting' && guard++ < 200) {
      const id = turnOf(g); const o = g.actionsFor(id);
      const a = o[Math.floor(rng() * o.length)];
      g.act(id, a.type, a.type === 'raise' || a.type === 'bet' ? a.min + Math.floor(rng() * (a.max - a.min)) : undefined);
    }
    assert.equal(g.phase, 'result', 'hand ended');
    const sum = g.players.reduce((s, p) => s + p.chips, 0);
    const expect = g.players.reduce((s, p) => s + 10000 * (1 + p.rebuys), 0);
    assert.equal(sum, expect, 'money conserved at hand ' + hand);
  }
});

t('진 사람이 다음 판을 시작한다 · 진 사람이 나가면 방장(null)', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand(); g.act('p0', 'fold'); g.act('p1', 'fold');   // p2 승리, 가장 많이 잃은 사람 = p1(SB 50) … p0은 0
  assert.equal(g.loser, 'p1'); assert.equal(g.starter(), 'p1');
  assert.equal(g.startBy('p0'), false); assert.equal(g.phase, 'result');
  g.player('p1').connected = false; assert.equal(g.starter(), null);
  g.player('p1').connected = true;
  assert(g.startBy('p1')); assert.equal(g.phase, 'betting'); assert.equal(g.loser, null);
});

console.log(`\n${n} tests passed`);
