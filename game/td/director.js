/* 마왕 디렉터 — 이 게임의 심장.
 * 읽고(타워 분포) → 편성하고(예산 내 카운터) → 선언하고(도발) → 실행한다.
 * 회귀: localStorage로 런을 넘어 기억한다. 죽어도, 이겨도, 놈은 돌아온다.
 *
 * 사용자(TD 고인물) 인사이트 반영:
 *  ① "투자를 무효화하는 카운터의 당황" = 클리어 욕구 → 주력 투자 타워를 정확히 찢는 편성
 *  ② "모든 상황이 반복되면 식는다" → 연속 동일 주력 금지 + 통한 유닛만 예외(선언으로 티냄)
 *  ③ "다시 불러들이는 힘" → 회귀 기억·다음 생 예고
 */
const Director = (() => {
  const KEY = 'td_memory_v1';

  let M = load() || fresh();
  function fresh() { return { runs: 0, wins: 0, losses: 0, domHistory: [], openerHistory: [], bestLeak: null }; }
  function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
  function save() { localStorage.setItem(KEY, JSON.stringify(M)); }

  /* 런 내 세션 상태 */
  let lastPrimary = null, lastLeakKind = null, lastBuildSig = '', lastAlt = null;
  const lineHist = {};   // 대사 풀 비반복 선택용

  function newRun() { lastPrimary = null; lastLeakKind = null; lastBuildSig = ''; lastAlt = null; }

  /* 같은 상황 대사 풀에서 직전과 다른 걸 뽑는다 — "대사도 반복되면 식는다" */
  function pickFrom(key, pool) {
    let idx = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && idx === lineHist[key]) idx = (idx + 1) % pool.length;
    lineHist[key] = idx;
    return pool[idx];
  }
  const LINES = {
    switch: ['같은 수는 두 번 안 쓴다.', '이번엔 각도를 바꾸지.', '다음 장은 넘겨야지.'],
    double: null,   // 동적 문장 — 그대로 사용
    mixed: ['읽을 수 없게 섞어주지.', '전부 조금씩. 골라 막아보든가.', '이번 편성은 나도 즉흥이다.'],
  };
  function pickLine(key, dynamic) { return dynamic || pickFrom(key, LINES[key]); }

  /* ── 읽기: 타워 분포 (비용 가중) ── */
  function analyze(spots) {
    const invest = { arrow: 0, cannon: 0, mage: 0, sniper: 0 };
    let total = 0;
    spots.forEach(s => {
      if (!s.tower) return;
      // 업그레이드 투자까지 읽는다 — 화살탑을 강화할수록 철갑충이 더 온다 (일관된 읽기)
      const c = s.tower.invested || DATA.TOWERS[s.tower.kind].cost;
      invest[s.tower.kind] += c; total += c;
    });
    const share = {};
    Object.keys(invest).forEach(k => share[k] = total ? invest[k] / total : 0);
    const counts = {};
    Object.keys(invest).forEach(k => counts[k] = spots.filter(s => s.tower && s.tower.kind === k).length);
    const top = Object.keys(share).sort((a, b) => share[b] - share[a])[0];
    return { share, counts, total, top, sig: Object.entries(counts).map(([k, v]) => k + v).join('|') };
  }

  /* ── 편성 + 선언 ── */
  function compose(n, spots, lastWave) {
    const a = analyze(spots);
    // 군비경쟁은 "마왕이 격퇴당한 횟수(M.losses)"만큼 — 이기는 유저에게만 걸린다.
    // (버그 수정: 기존엔 지는 유저에게 걸려서 고전할수록 더 어려워졌음)
    let budget = Math.round(DATA.budget(n) * (1 + 0.08 * M.losses));
    const maxUnitCost = 8 + 4 * n;                                    // 초반부터 오우거 금지
    const taunts = [];

    // 빈손 정찰
    if (a.total === 0) {
      return { units: fill(['goblin', 'rat'], Math.min(budget, 40), maxUnitCost),
        gapMs: 520, taunt: '타워가 없군. …정찰만 보내지. 다음엔 봐주지 않는다.', read: null };
    }

    // 주력 카운터 선택 — 핑퐁 방지: 카운터 2종 + 혼합 웨이브까지 3로테이션
    let primary = DATA.COUNTER[a.top][0];
    let mixedWave = false;
    const reason = a.top;

    // 인사이트 ②: 반복 방지. 단, 지난 웨이브에 그 유닛이 뚫었다면 배가(선언으로 티냄)
    const leakedWithPrimary = lastWave && lastWave.leaks && lastWave.leaks[lastPrimary] > 0;
    if (primary === lastPrimary) {
      if (leakedWithPrimary) {
        taunts.push(pickLine('double', `${DATA.UNITS[primary].name}${nJosa(DATA.UNITS[primary].name)} 통했지. 그래서 더 간다.`));
      } else {
        const alt = DATA.COUNTER[a.top][1] || altCounter(a, primary);
        if (alt === lastAlt) { mixedWave = true; lastAlt = null; }   // 카운터 2종도 소진 → 혼합 대량
        else { primary = alt; lastAlt = alt; taunts.push(pickLine('switch')); }
      }
    } else lastAlt = null;
    // 비용 게이트는 선언 "이전"에 — 선언한 유닛이 반드시 실제로 온다 (선언→실행 무결성)
    let downgraded = false;
    if (DATA.UNITS[primary].cost > maxUnitCost) { primary = DATA.COUNTER[a.top][0]; }
    if (DATA.UNITS[primary].cost > maxUnitCost) { primary = DATA.UNITS.ironrat.cost <= maxUnitCost ? 'ironrat' : 'goblin'; downgraded = true; }

    // 선언 1: 읽기 근거 (인사이트 ① — 당황의 순간을 예고로 만든다). 상황별 대사 풀에서 비반복 선택
    const READ = {
      arrow: (c) => [`화살탑이 ${c}개라… 잔딜은 철갑이 먹는다.`, `연사에 기대는군. 무뎌지는 걸 보여주지.`, `${c}개의 화살로 강철을 뚫을 셈인가.`],
      cannon: (c) => [`스플래시가 ${c}문이군. 뭉쳐줄 이유가 없지.`, `포격 범위는 봤다. 그 사이로 지나가주지.`, `넓게 때리는 자에겐 하나씩 보내는 법이다.`],
      mage: (c) => [`감속 마법 ${c}기. 걸리지 않는 것들을 보내주지.`, `얼음은 봤다. 얼지 않는 것들이 있지.`, `느려지는 건 살아있는 것들뿐이다.`],
      sniper: (c) => [`한방 타워가 ${c}개… 한 발에 한 마리씩만 죽여보든가.`, `큰 한 발이라. 작은 것 스물이면 어쩔 텐가.`, `정밀 사격? 낭비하게 만들어주지.`],
    };
    if (mixedWave) taunts.push(pickLine('mixed'));
    else if (downgraded) taunts.push(pickFrom('scout', [
      `네 배치는 다 봤다. 오늘은 정찰이다 — 본대는 다음이다.`,
      `${DATA.TOWERS[a.top].name}이라… 기억해두지. 지금은 몸풀기다.`,
      `첫 수부터 패를 깔 수는 없지. 일단 간다.`,
    ]));
    else if (!taunts.length) taunts.push(pickFrom(reason, READ[reason](a.counts[reason])));

    // 간격: 스플래시 비중 → 산개 / 단일딜 비중 → 밀집. 단 1웨이브는 정찰 성격 — 전술 자비 (온보딩 절벽 방지)
    let gapMs = 480, spacingNote = null;
    if (n >= 2 && a.share.cannon >= 0.34) { gapMs = 900; spacingNote = '흩어져서 간다.'; }
    else if (n >= 2 && a.share.arrow + a.share.sniper >= 0.55) { gapMs = 150; spacingNote = '한꺼번에 간다.'; }
    if (n === 1) budget = Math.round(budget * 0.75);
    if (spacingNote) taunts.push(spacingNote);

    // 예산 소비: 혼합 웨이브면 전부 섞고, 아니면 주력 60% + 혼합 40%
    let units;
    if (mixedWave) {
      units = fill(Object.keys(DATA.UNITS), budget, maxUnitCost);
    } else {
      units = fill([primary], Math.round(budget * 0.6), maxUnitCost);
      const mixPool = Object.keys(DATA.UNITS).filter(k => k !== primary && DATA.UNITS[k].cost <= maxUnitCost);
      units.push(...fill(mixPool, budget - cost(units), maxUnitCost));
    }
    // 밀집 러시면 주력을 앞에 몰고, 산개면 섞는다
    const ordered = gapMs <= 300 ? units.sort((x, y) => (x === primary ? -1 : 0) - (y === primary ? -1 : 0)) : shuffle(units);

    lastPrimary = primary;
    lastBuildSig = a.sig;
    // read: 마왕이 위협으로 판정한 타워 종류 — 엔진이 "마왕의 시선" 연출(스캔→락온)에 그대로 사용
    return { units: ordered, gapMs, taunt: taunts.join(' '), read: a.top };
  }

  function altCounter(a, exclude) {
    const second = Object.keys(a.share).sort((x, y) => a.share[y] - a.share[x])[1];
    const cand = DATA.COUNTER[second] ? DATA.COUNTER[second][0] : 'goblin';
    return cand === exclude ? 'goblin' : cand;
  }
  function fill(pool, budget, maxCost) {
    const out = []; let b = budget, guard = 0;
    const ok = pool.filter(k => DATA.UNITS[k].cost <= maxCost);
    if (!ok.length) return out;
    while (b >= Math.min(...ok.map(k => DATA.UNITS[k].cost)) && guard++ < 120) {
      const k = ok[Math.floor(Math.random() * ok.length)];
      if (DATA.UNITS[k].cost <= b) { out.push(k); b -= DATA.UNITS[k].cost; }
    }
    return out;
  }
  function cost(units) { return units.reduce((s, k) => s + DATA.UNITS[k].cost, 0); }
  function shuffle(arr) { return arr.slice().sort(() => Math.random() - 0.5); }
  function nJosa(w) { const c = w.charCodeAt(w.length - 1) - 0xac00; return c >= 0 && c % 28 !== 0 ? '이' : '가'; }
  function roJosa(w) { const c = w.charCodeAt(w.length - 1) - 0xac00; const j = c >= 0 ? c % 28 : 0; return j !== 0 && j !== 8 ? '으로' : '로'; }

  /* ── 웨이브 결과 학습 (런 내) ── */
  function onWaveEnd(leaks) { lastLeakKind = Object.keys(leaks || {}).sort((a, b) => leaks[b] - leaks[a])[0] || null; }

  /* ── 회귀 (런 간 기억) ── */
  function onRunEnd(won, spots, stats) {
    const a = analyze(spots);
    M.runs += 1;
    if (won) M.losses += 1; else M.wins += 1;   // won = 플레이어 승 = 마왕 패
    if (a.top) M.domHistory.push(a.top);
    if (M.domHistory.length > 8) M.domHistory.shift();
    const bigLeak = Object.entries(stats.leaks || {}).sort((x, y) => y[1] - x[1])[0];
    if (bigLeak) M.bestLeak = bigLeak[0];
    save();
  }
  function onRunStart(spots) {
    newRun();
    // 초반 3웨이브 빌드 성향 기록용 — 웨이브3 시점에 호출됨
  }
  function recordOpener(spots) {
    const a = analyze(spots);
    if (a.top) { M.openerHistory.push(a.top); if (M.openerHistory.length > 8) M.openerHistory.shift(); save(); }
  }

  function dominantMemory(hist) {
    if (!hist.length) return null;
    const cnt = {};
    hist.forEach(t => cnt[t] = (cnt[t] || 0) + 1);
    const [top, n] = Object.entries(cnt).sort((x, y) => y[1] - x[1])[0];
    return n >= 2 ? { top, n, total: hist.length } : null;
  }

  /* 회귀 인사 — "다시 불러들이는 힘" */
  function openingTaunt() {
    if (M.runs === 0) return null;
    const dom = dominantMemory(M.openerHistory.length ? M.openerHistory : M.domHistory);
    let line = `회귀 ${M.runs + 1}번째다.`;
    if (dom) line += ` 넌 ${dom.total}판 중 ${dom.n}판을 ${DATA.TOWERS[dom.top].name}${roJosa(DATA.TOWERS[dom.top].name)} 시작했지. 이번에도 그럴 건가?`;
    else line += ' 이번 생의 너는 어떤 배치인지 보자.';
    if (M.bestLeak) line += ` …${DATA.UNITS[M.bestLeak].name}${nJosa(DATA.UNITS[M.bestLeak].name)} 잘 먹혔던 건 기억하고 있다.`;
    return line;
  }

  /* 회귀록 — 정직 원칙: 숫자와 함께, 아는 만큼만 */
  function memoryLines() {
    if (M.runs === 0) return ['…아직 너를 모른다. 첫 회차를 보여라.'];
    const out = [`너와 ${M.runs}번 싸웠다. 내가 ${M.wins}번 이겼고, ${M.losses}번 회귀했다.`];
    const dom = dominantMemory(M.domHistory);
    if (dom) out.push(`너는 ${dom.total}판 중 ${dom.n}판을 ${DATA.TOWERS[dom.top].name} 중심으로 짰다. 버릇이다.`);
    if (M.bestLeak) out.push(`${DATA.UNITS[M.bestLeak].name}${nJosa(M.bestLeak && DATA.UNITS[M.bestLeak].name)} 네 방어를 뚫었던 걸 기억한다.`);
    out.push(`다음 생의 예산 계수: ×${(1 + 0.08 * M.losses).toFixed(2)} (나를 격퇴할수록 오른다)`);
    return out;
  }

  function resetMemory() { M = fresh(); save(); }
  function raw() { return M; }

  return { compose, onWaveEnd, onRunEnd, onRunStart, recordOpener, openingTaunt, memoryLines, resetMemory, raw, analyze };
})();
