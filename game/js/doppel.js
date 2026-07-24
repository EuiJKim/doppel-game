/* 도플 — 분신: 선택 로깅(18버킷) + 실시간 노트(건방진 제자) + 일치율 + 분신 플레이(거울전)
 * 버킷 = 더미 점수(low/mid/high) × 점수차(behind/even/ahead) × 폭탄 위험(cool/hot)
 * 선택은 go/stop 2가지 — 2지선다라 모방이 빠르고 선명하다.
 * 원칙: 표본이 부족한 버킷은 "아직 못 배운 상황" — 채워넣지 않는다. 분신도 그 상황에선 기본기로 두고 그 사실을 말한다.
 * 심사자 모드: URL에 ?demo → 사전 학습된 데모 분신(메모리 전용, 저장 안 함)으로 거울전 즉시 체험.
 */
const Doppel = (() => {

  const KEY = 'doppel_v2';   // v1(쇼다운)과 버킷 의미가 달라 키 분리
  const RECENT_MAX = 30;     // 일치율 창
  const DEMO = new URLSearchParams(location.search).has('demo');

  let state = DEMO ? demoState() : (load() || fresh());

  let silent = 0;            // 리액션 없이 지나간 선택 수 (세션 한정, 저장 안 함)

  function fresh() {
    return { buckets: {}, choices: 0, rounds: 0, recent: [], notes: [] };
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
  }
  function save() { if (DEMO) return; localStorage.setItem(KEY, JSON.stringify(state)); }

  /* 데모 분신 페르소나: 평소엔 신중, 지고 있으면 달리는 타입. 4개 버킷은 일부러 미학습(정직 표시 데모) */
  function demoState() {
    const buckets = {};
    const P = { low: 0.85, mid: 0.5, high: 0.15 };
    const D = { behind: 0.25, even: 0, ahead: -0.15 };
    const skip = ['high|ahead|hot', 'high|behind|hot', 'low|ahead|hot', 'high|even|hot'];
    ['low', 'mid', 'high'].forEach(pb => ['behind', 'even', 'ahead'].forEach(db => ['cool', 'hot'].forEach(dg => {
      const k = `${pb}|${db}|${dg}`;
      if (skip.includes(k)) return;
      let p = P[pb] + D[db] + (dg === 'hot' ? -0.2 : 0);
      p = Math.max(0.05, Math.min(0.95, p));
      const n = 8, go = Math.round(n * p);
      buckets[k] = { n, timeSum: n * 1100, go, stop: n - go };
    })));
    return {
      buckets, choices: 112, rounds: 38,
      recent: Array.from({ length: 30 }, (_, i) => (i % 4 === 3 ? 0 : 1)), // ≈77%
      notes: [
        { text: '지고 있을 때 더미 4~7점이면, 폭탄이 짙어도 더 달리는 타입. 세 번 봤으면 확실하죠.', ts: 0 },
        { text: '이기고 있을 때 더미 4~7점이면, 안전할 때는 바로 멈추는 타입. 세 번 봤으면 확실하죠.', ts: 0 },
        { text: '비등할 때 더미 8점 넘으면, 안전할 때는 바로 멈추는 타입. 세 번 봤으면 확실하죠.', ts: 0 },
        { text: '지고 있을 때 더미 3점 이하면, 안전할 때는 더 달리는 타입. 세 번 봤으면 확실하죠.', ts: 0 },
      ],
    };
  }

  function bucketKey(ctx) { return `${ctx.pileBand}|${ctx.diffBand}|${ctx.danger}`; }

  /* 상황 → 한국어 구절 (노트·프로필 공용) */
  function phrase(pileBand, diffBand, danger, act) {
    const diffKo = { behind: '지고 있을 때', even: '비등할 때', ahead: '이기고 있을 때' }[diffBand];
    const pileKo = { low: '더미 3점 이하면', mid: '더미 4~7점이면', high: '더미 8점 넘으면' }[pileBand];
    const dangKo = danger === 'hot' ? '폭탄이 짙어도' : '안전할 때는';
    const actKo = act === 'go' ? '더 달리는' : '바로 멈추는';
    return `${diffKo} ${pileKo}, ${dangKo} ${actKo}`;
  }

  /* 예측: 현재 버킷의 최빈 행동 (표본 3 미만이면 null = 아직 모름) */
  function predict(ctx) {
    const b = state.buckets[bucketKey(ctx)];
    if (!b || b.n < 3) return null;
    return (b.go || 0) >= (b.stop || 0) ? 'go' : 'stop';
  }

  /* 분신 플레이 (거울전): 버킷 분포에서 샘플링 + 내 결정 템포 흉내
   * 못 배운 버킷은 보수적 기본기(기대값 기준)로 두고 learned:false로 정직하게 알림 */
  function play(ctx) {
    const b = state.buckets[bucketKey(ctx)];
    if (!b || b.n < 3) {
      const ev = (1 - ctx.ratio) * 1.8 - ctx.ratio * ctx.pileScore;
      return { act: ev > 0.4 ? 'go' : 'stop', learned: false, thinkMs: 900 };
    }
    const goP = (b.go || 0) / ((b.go || 0) + (b.stop || 0));
    return {
      act: Math.random() < goP ? 'go' : 'stop',
      learned: true,
      thinkMs: Math.max(500, Math.min(2500, b.timeSum / b.n)),
    };
  }

  /* 학습: 내 선택 1건 기록 (+예측 대조로 일치율 갱신) */
  function learn(ctx, act, ms) {
    const guess = predict(ctx);
    if (guess !== null) {
      state.recent.push(guess === act ? 1 : 0);
      if (state.recent.length > RECENT_MAX) state.recent.shift();
    }
    const k = bucketKey(ctx);
    const b = state.buckets[k] || (state.buckets[k] = { n: 0, timeSum: 0 });
    b[act] = (b[act] || 0) + 1;
    b.n += 1; b.timeSum += ms;
    state.choices += 1;
    save();
    return guess;
  }

  function roundDone() { state.rounds += 1; save(); }

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

  const LINES = {
    bust: [
      '펑. …이것도 기록해요? 해야죠.',
      '거봐요, 폭탄 냄새 났잖아요. 아, 말 안 했나.',
      '💥 …사장님의 이런 점은 안 닮고 싶은데.',
    ],
    bigBank: [
      '오, 크게 확정. 오늘 좀 하시는데요?',
      '이만큼 쌓고 딱 멈추기. 이게 되네…?',
    ],
    hotGo: [
      '폭탄 냄새 진동하는데 또 가요? 심장이 강철이시네.',
      '이 확률에 간다고요? …적어는 놓을게요.',
      '남은 폭탄 보고도 가는 거, 용기예요 습관이에요?',
    ],
    earlyStop: [
      '그거 갖고 멈춰요? 소심한 것도 스타일이라면야.',
      '벌써 확정? 겁쟁… 신중하시다고요, 네.',
    ],
    go: [
      '한 장 더? 네네, 적는 중.',
      '달리시네요. 저도 이렇게 되는 건가.',
      '그 손 떨림까지 배워야 하나요.',
      '과감하시네. 인정하긴 싫지만.',
    ],
    stop: [
      '여기서 멈춤. …저라면 갔어요.',
      '확정하시네요. 안전 제일주의, 메모.',
      '멈추는 타이밍은 좀 배울 만하네요.',
    ],
  };

  /* 선택 직후 호출 — 1회성 리액션(저장 안 함)과 영구 노트(3회 관찰 시 봉인 해제)를 분리
   * 빈도 설계: 특이 상황은 확정~70%, 평범한 선택도 40%, 3연속 침묵이면 강제 발화
   */
  function react(ctx, act, result) {
    const lines = [];

    if (result && result.busted) lines.push(pick(LINES.bust));
    else if (act === 'stop' && result && result.banked >= 8) lines.push(pick(LINES.bigBank));
    else if (act === 'go' && ctx.danger === 'hot' && chance(0.7)) lines.push(pick(LINES.hotGo));
    else if (act === 'stop' && ctx.pileScore <= 3 && chance(0.7)) lines.push(pick(LINES.earlyStop));
    else if (chance(0.4) || silent >= 3) lines.push(pick(LINES[act] || LINES.go));

    silent = lines.length ? 0 : silent + 1;

    // 영구 노트 — 같은 상황을 3번 봤을 때 봉인 해제
    const b = state.buckets[bucketKey(ctx)];
    if (b && b.n === 3) {
      const main = (b.go || 0) >= (b.stop || 0) ? 'go' : 'stop';
      const permanent = addNote(`${phrase(ctx.pileBand, ctx.diffBand, ctx.danger, main)} 타입. 세 번 봤으면 확실하죠.`);
      if (permanent) lines.push('📝 ' + permanent.text);
    }
    return lines;
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function chance(p) { return Math.random() < p; }

  /* 프로필: 분신이 아는 나 — 최다 관찰 패턴 3줄 + 칭호 (거울전 결과 화면용) */
  function profile() {
    const learned = Object.entries(state.buckets).filter(([, b]) => b.n >= 3);
    // 최다 관찰 순 + 점수차 상황(지는 중/비등/이기는 중)이 겹치지 않게 골라 3줄
    const sorted = learned.slice().sort((a, b) => b[1].n - a[1].n);
    const picked = [];
    const seenDiff = new Set();
    for (const e of sorted) {
      if (picked.length >= 3) break;
      if (!seenDiff.has(e[0].split('|')[1])) { picked.push(e); seenDiff.add(e[0].split('|')[1]); }
    }
    for (const e of sorted) {
      if (picked.length >= 3) break;
      if (!picked.includes(e)) picked.push(e);
    }
    const top = picked.map(([k, b]) => {
      const [pb, db, dg] = k.split('|');
      const main = (b.go || 0) >= (b.stop || 0) ? 'go' : 'stop';
      return phrase(pb, db, dg, main);
    });

    let go = 0, n = 0, bGo = 0, bN = 0, aGo = 0, aN = 0;
    learned.forEach(([k, b]) => {
      const db = k.split('|')[1];
      go += b.go || 0; n += b.n;
      if (db === 'behind') { bGo += b.go || 0; bN += b.n; }
      if (db === 'ahead') { aGo += b.go || 0; aN += b.n; }
    });
    const goRate = n ? go / n : 0;
    const behindRate = bN ? bGo / bN : goRate;
    const aheadRate = aN ? aGo / aN : goRate;
    const title = behindRate - aheadRate >= 0.25 ? '역전의 도박꾼'
      : goRate >= 0.72 ? '강철 심장'
      : goRate <= 0.45 ? '회계사보다 회계사'
      : '균형 잡힌 승부사';
    return { top, title };
  }

  /* 홈 화면용 요약 */
  function summary() {
    const totalBuckets = 18;
    const learned = Object.values(state.buckets).filter(b => b.n >= 3).length;
    return {
      choices: state.choices,
      rounds: state.rounds,
      matchRate: matchRate(),
      notes: state.notes,
      bucketsLearned: learned, totalBuckets,
      mirrorUnlocked: state.choices >= 80 && (matchRate() || 0) >= 65,
    };
  }

  function isDemo() { return DEMO; }
  function reset() { localStorage.removeItem(KEY); location.reload(); }

  return { learn, roundDone, react, predict, play, profile, matchRate, summary, isDemo, reset };
})();
