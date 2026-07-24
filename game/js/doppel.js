/* 도플 — 분신: 행동 로깅(18버킷) + 실시간 노트(건방진 제자) + 일치율
 * 버킷 = 패 강도(weak/mid/strong) × 포지션(first/second) × 직면 상황(none/checked/bet)
 * 원칙: 표본이 부족한 버킷은 "아직 못 배운 상황" — 채워넣지 않는다.
 */
const Doppel = (() => {

  const KEY = 'doppel_v1';
  const RECENT_MAX = 30; // 일치율 창

  let state = load() || {
    buckets: {},          // key → {check,bet,call,fold,raise, n, timeSum}
    handsLearned: 0,
    recent: [],           // 최근 예측 적중 여부 (1/0)
    notes: [],            // {text, ts}
  };

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
  }
  function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

  function bucketKey(card, isFirst, facing) {
    return `${Engine.strengthBand(card)}|${isFirst ? 'first' : 'second'}|${facing}`;
  }

  function facingOf(hand, who) {
    // 내가 행동하는 시점의 직면 상황
    if (hand.toCall > 0) return 'bet';
    const last = hand.actions[hand.actions.length - 1];
    return last && last.act === 'check' ? 'checked' : 'none';
  }

  /* 예측: 현재 버킷의 최빈 행동 (표본 3 미만이면 null = 아직 모름) */
  function predict(card, isFirst, facing) {
    const b = state.buckets[bucketKey(card, isFirst, facing)];
    if (!b || b.n < 3) return null;
    let best = null, bestN = -1;
    for (const a of ['check', 'bet', 'call', 'fold', 'raise']) {
      if ((b[a] || 0) > bestN) { bestN = b[a] || 0; best = a; }
    }
    return best;
  }

  /* 학습: 내 행동 1건 기록 (+예측 대조로 일치율 갱신) */
  function learn(card, isFirst, facing, act, ms) {
    const guess = predict(card, isFirst, facing);
    if (guess !== null) {
      state.recent.push(guess === act ? 1 : 0);
      if (state.recent.length > RECENT_MAX) state.recent.shift();
    }
    const k = bucketKey(card, isFirst, facing);
    const b = state.buckets[k] || (state.buckets[k] = { n: 0, timeSum: 0 });
    b[act] = (b[act] || 0) + 1;
    b.n += 1; b.timeSum += ms;
    save();
    return guess; // UI가 "맞췄다/틀렸다" 연출에 사용 가능
  }

  function handDone() { state.handsLearned += 1; save(); }

  function matchRate() {
    if (state.recent.length < 5) return null; // 표본 부족 — 정직하게 미표시
    return Math.round(100 * state.recent.reduce((a, b) => a + b, 0) / state.recent.length);
  }

  /* ── 노트 (건방진 제자 말투) ── */

  function addNote(text) {
    if (state.notes.some(n => n.text === text)) return null; // 같은 통찰은 한 번만
    const note = { text, ts: Date.now() };
    state.notes.push(note); save();
    return note;
  }

  /* 행동 직후 호출 — 상황에 맞는 실시간 코멘트(1회성 대사)와 영구 노트를 분리 */
  function react(card, isFirst, facing, act, hand) {
    const s = Engine.strengthBand(card);
    const lines = [];

    // 1회성 리액션 (저장 안 함)
    if (s === 'weak' && (act === 'bet' || act === 'raise')) lines.push(pick([
      '어? 그 패로 지르시게요? …일단 메모.',
      '허세 부리는 거 다 보이는데. 적어놨어요.',
    ]));
    if (s === 'strong' && act === 'check') lines.push(pick([
      '함정 파시는 거 보소. 이런 것도 배워야 하나…',
      '강한데 조용하시네. 음흉한 것까지 닮으라고요?',
    ]));
    if (act === 'fold') lines.push(pick([
      '접으시는군요. 겁쟁이… 아니, 신중하시네요.',
      '그건 저라도 접었어요. 아마도.',
    ]));
    if (act === 'call' && s === 'weak') lines.push('그 패로 콜을? 사장님 돈이니까 뭐.');

    // 영구 노트 (패턴이 3회 쌓이면 봉인 해제)
    const b = state.buckets[bucketKey(card, isFirst, facing)];
    if (b && b.n === 3) {
      const main = predict(card, isFirst, facing);
      const situ = { weak: '약한 패', mid: '어중간한 패', strong: '강한 패' }[s]
        + (facing === 'bet' ? '로 베팅을 받으면' : facing === 'checked' ? '로 체크를 받으면' : '를 들면');
      const actKo = { check: '일단 체크', bet: '지르는', call: '따라가는', fold: '접는', raise: '올려버리는' }[main];
      const permanent = addNote(`${situ} ${actKo} 타입. 세 번 봤으면 확실하죠.`);
      if (permanent) lines.push('📝 ' + permanent.text);
    }
    return lines;
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* 홈 화면용 요약 */
  function summary() {
    const totalBuckets = 18;
    const learned = Object.values(state.buckets).filter(b => b.n >= 3).length;
    return {
      handsLearned: state.handsLearned,
      matchRate: matchRate(),
      notes: state.notes,
      bucketsLearned: learned, totalBuckets,
      mirrorUnlocked: state.handsLearned >= 60 && (matchRate() || 0) >= 65,
    };
  }

  function reset() { localStorage.removeItem(KEY); location.reload(); }

  return { learn, handDone, react, predict, matchRate, summary, facingOf, reset };
})();
