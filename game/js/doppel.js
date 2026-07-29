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
    return { buckets: {}, choices: 0, rounds: 0, recent: [], notes: [], skillUse: {} };
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

  /* ── 스킬 사용 타이밍 학습 ──
   * GO/STOP과 별개로 "언제 방패를 아끼고 언제 배증을 지르는가"가 그 사람의 성격이다.
   * 사용한 순간의 상황만 기록한다(안 쓴 순간은 매 턴 쌓여 노이즈가 되므로).
   */
  function learnSkill(name, ctx) {
    const s = state.skillUse[name] || (state.skillUse[name] = { n: 0, keys: {}, diff: {}, pile: {} });
    s.n += 1;
    s.keys[bucketKey(ctx)] = (s.keys[bucketKey(ctx)] || 0) + 1;
    s.diff[ctx.diffBand] = (s.diff[ctx.diffBand] || 0) + 1;
    s.pile[ctx.pileBand] = (s.pile[ctx.pileBand] || 0) + 1;
    save();
  }

  /* 지금 이 상황이 "그 사람이 그 스킬을 쓰던 상황"인가 → 0~1 */
  function skillUrge(name, ctx) {
    const s = state.skillUse[name];
    if (!s || !s.n) return 0;
    const exact = (s.keys[bucketKey(ctx)] || 0) / s.n;      // 똑같은 상황에서 썼던 비율
    const byDiff = (s.diff[ctx.diffBand] || 0) / s.n;        // 점수차 성향
    const byPile = (s.pile[ctx.pileBand] || 0) / s.n;        // 더미 성향
    return Math.min(1, exact * 0.5 + byDiff * 0.3 + byPile * 0.2);
  }

  /* 스킬 성향 한 줄 (노트·프로필용) — 2회 이상 관찰됐을 때만 */
  function skillNote(name) {
    const s = state.skillUse[name];
    if (!s || s.n < 2) return null;
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0];
    const [d, dn] = top(s.diff), [p] = top(s.pile);
    if (dn / s.n < 0.6) return null;                          // 뚜렷한 편향이 없으면 단정하지 않는다
    const diffKo = { behind: '지고 있고', even: '비등하고', ahead: '이기고 있고' }[d];
    const pileKo = { low: '더미가 얇을 때', mid: '더미가 어중간할 때', high: '더미가 두툼할 때' }[p];
    const nameKo = { shield: '방패', peek: '투시', double: '배증' }[name];
    return `${diffKo} ${pileKo} ${nameKo}${josa(nameKo)} 꺼내는 타입. ${s.n}번 봤어요.`;
  }

  /* ── 백오프(back-off) 추론 ──
   * 정확한 18버킷 표본은 한 라운드에 3~5개씩만 쌓인다. 그것만 기다리면
   * 분신은 몇 세션이 지나도 입을 못 연다. 그래서 n-gram 백오프와 같은 방식으로
   * 좁은 상황 → 넓은 상황 순으로 물러나며 근거를 찾는다.
   *   L0 더미×점수차×위험 (이 상황 그대로)  L1 더미×점수차  L2 더미만  L3 전체 성향
   * 원칙 유지: 어느 층에서 답했는지를 항상 밝힌다. 노트(영구 주장)는 여전히 L0 3회 이상만.
   */
  const LEVELS = [
    { id: 0, label: '이 상황', match: (k, c) => k === `${c.pileBand}|${c.diffBand}|${c.danger}` },
    { id: 1, label: '비슷한 상황', match: (k, c) => k.startsWith(`${c.pileBand}|${c.diffBand}|`) },
    { id: 2, label: '더미가 이만할 때', match: (k, c) => k.startsWith(`${c.pileBand}|`) },
    { id: 3, label: '평소 성향', match: () => true },
  ];

  function infer(ctx, minN) {
    for (const lv of LEVELS) {
      let go = 0, stop = 0;
      for (const [k, b] of Object.entries(state.buckets)) {
        if (!lv.match(k, ctx)) continue;
        go += b.go || 0; stop += b.stop || 0;
      }
      const n = go + stop;
      if (n < minN) continue;
      const act = go >= stop ? 'go' : 'stop';
      return { act, n, lean: Math.max(go, stop) / n, level: lv.id, levelLabel: lv.label };
    }
    return null;
  }

  /* 상황 → 한국어 구절 (노트·프로필 공용) */
  function phrase(pileBand, diffBand, danger, act) {
    const diffKo = { behind: '지고 있을 때', even: '비등할 때', ahead: '이기고 있을 때' }[diffBand];
    const pileKo = { low: '더미 3점 이하면', mid: '더미 4~7점이면', high: '더미 8점 넘으면' }[pileBand];
    const dangKo = danger === 'hot' ? '폭탄이 짙어도' : '안전할 때는';
    const actKo = act === 'go' ? '더 달리는' : '바로 멈추는';
    return `${diffKo} ${pileKo}, ${dangKo} ${actKo}`;
  }

  /* 예측(일치율 측정용): 백오프로 근거를 찾는다. 전체 표본이 3 미만이면 null = 아직 모름 */
  function predict(ctx) {
    const r = infer(ctx, 3);
    return r ? r.act : null;
  }

  /* 조기 예측 선언 — 내가 선택하기 "직전"에 거는 콜.
   * 관찰 2회부터 입을 연다 (일치율 통계용 predict보다 이른 시점).
   * 목적: 첫 세션 2~3분 안에 "읽혔다"는 소름을 만드는 것.
   */
  const CALL_LINES = {
    go: {
      guess: ['이건 감인데… 가시죠?', '아직 잘 모르지만, 뽑으실 것 같아요.'],
      hunch: ['갈 것 같은데요.', '또 뽑으시죠? 느낌이 와요.', '멈출 리가 없죠, 사장님은.'],
      sure: ['여기선 무조건 가십니다. 봤어요, 여러 번.', '한 장 더. 안 봐도 알아요.'],
    },
    stop: {
      guess: ['이건 감인데… 멈추시죠?', '아직 잘 모르지만, 잠그실 것 같아요.'],
      hunch: ['여기서 멈추실 것 같은데.', '슬슬 잠그시겠네요.', '이쯤에서 접으시죠?'],
      sure: ['여기선 반드시 멈추십니다. 사장님 버릇이에요.', '멈춤. 이미 알고 있었어요.'],
    },
  };

  /* 조기 예측 콜: 백오프로 근거를 찾되, 어느 층에서 말하는지 티가 나게 한다.
   * L0 = "이 상황 그대로 봤다"(확신) / L1~2 = 감 / L3 = 순 성향 추측 */
  function callOut(ctx) {
    const r = infer(ctx, 2);
    if (!r) return null;
    if (r.lean < 0.6) return null;                       // 갈팡질팡하면 입 다문다
    if (r.level >= 3 && r.lean < 0.75) return null;      // 근거 얇으면 함부로 말 안 함
    const tone = (r.level === 0 && r.n >= 4 && r.lean >= 0.75) ? 'sure'
      : r.level <= 1 ? 'hunch' : 'guess';
    const prefix = r.level === 0 ? '' : `(${r.levelLabel} 기준) `;
    return { act: r.act, n: r.n, level: r.level, sure: tone === 'sure', line: prefix + pick(CALL_LINES[r.act][tone]) };
  }

  /* 분신 플레이 (거울전): 버킷 분포에서 샘플링 + 내 결정 템포 흉내
   * 못 배운 버킷은 보수적 기본기(기대값 기준)로 두고 learned:false로 정직하게 알림 */
  function play(ctx) {
    const exact = state.buckets[bucketKey(ctx)];
    const thinkMs = exact && exact.n ? Math.max(500, Math.min(2500, exact.timeSum / exact.n)) : 900;

    // 정확한 상황을 3번 이상 봤으면 그 분포 그대로 — "배운 대로"
    if (exact && exact.n >= 3) {
      const goP = (exact.go || 0) / exact.n;
      return { act: Math.random() < goP ? 'go' : 'stop', learned: true, level: 0, thinkMs };
    }
    // 아니면 넓은 층의 기억으로 흉내 — 배운 척은 하지 않고 층을 밝힌다
    const r = infer(ctx, 3);
    if (r) {
      const goP = r.act === 'go' ? r.lean : 1 - r.lean;
      return { act: Math.random() < goP ? 'go' : 'stop', learned: false, level: r.level, levelLabel: r.levelLabel, thinkMs };
    }
    // 아무 기억도 없으면 기본기(기대값)
    const ev = (1 - ctx.ratio) * 1.8 - ctx.ratio * ctx.pileScore;
    return { act: ev > 0.4 ? 'go' : 'stop', learned: false, level: 4, thinkMs: 900 };
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
  /* 예측 콜의 결과 — 적중/빗나감 직후 대사 (거울전 서사의 씨앗) */
  const CALL_RESULT = {
    hit: [
      '봤죠? 사장님은 사장님을 못 숨겨요.',
      '적중. 이런 게 몇 개 더 쌓이면 제가 사장님이 되는 거죠.',
      '역시. 이제 좀 알 것 같아요.',
    ],
    hitSure: [
      '두 번 생각할 필요도 없었어요.',
      '이건 이제 안 틀립니다. 사장님이니까요.',
    ],
    miss: [
      '어? …틀렸네요. 이런 것도 사장님이구나.',
      '빗나갔어요. 방금 그건 안 하시던 건데.',
      '제 예상 밖. …좋아요, 그것도 배웠어요.',
    ],
  };

  function reactToCall(call, act) {
    if (!call) return null;
    if (call.act === act) return pick(call.sure ? CALL_RESULT.hitSure : CALL_RESULT.hit);
    return pick(CALL_RESULT.miss);
  }

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

  /* 목적격 조사 — 받침 유무로 을/를 */
  function josa(word) {
    const code = word.charCodeAt(word.length - 1) - 0xac00;
    if (code < 0 || code > 11171) return '를';
    return code % 28 === 0 ? '를' : '을';
  }

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

  /* 거울전에서 분신이 스킬을 쓸지 결정 — 내가 쓰던 상황에 왔을 때 나처럼 꺼낸다 */
  function playSkill(available, ctx) {
    let best = null, bestUrge = 0;
    available.forEach(name => {
      const u = skillUrge(name, ctx);
      if (u > bestUrge) { bestUrge = u; best = name; }
    });
    if (!best || bestUrge < 0.3) return null;
    return Math.random() < Math.min(0.85, bestUrge + 0.2) ? best : null;
  }

  function skillLines() {
    return Object.keys({ shield: 1, peek: 1, double: 1 })
      .map(skillNote).filter(Boolean);
  }

  function isDemo() { return DEMO; }
  function reset() { localStorage.removeItem(KEY); location.reload(); }

  return { learn, learnSkill, roundDone, react, predict, callOut, reactToCall, play, playSkill, skillUrge, skillLines, profile, matchRate, summary, isDemo, reset };
})();
