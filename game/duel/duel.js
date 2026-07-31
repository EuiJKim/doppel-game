/* 도플: 결투 — D1 손맛 프로토타입
 * 목표: 학습 AI 없이도 결투 자체가 재밌는가를 판정한다.
 * 구조 원칙: 적의 공격 선택은 chooseAttack() 한 곳 — D2에서 학습·페인트 AI로 교체된다.
 */
(() => {
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const GROUND = 430;

  /* ── 튜닝 (손맛의 심장 — 판정 후 여기부터 조정) ── */
  const CFG = {
    telegraphMs: 850,     // 결투 1 기준 예고 시간
    telegraphDecay: 0.92, // 결투마다 곱해짐
    telegraphMin: 460,
    attackMs: 190,        // 예고 후 칼이 나가는 시간
    graceMs: 90,          // 칼이 나간 직후에도 응수 허용
    perfectMs: 170,       // 예고 종료 직전 이 구간 응수 = 완벽
    staggerMs: 980,       // 응수 성공 후 반격 창
    chainGapMs: 420,      // 연속 공격 사이 간격
    breatherMs: [850, 1350],
    hitStopMs: 90,
    slowmo: { scale: 0.25, ms: 150 },
    enemyHP: 6,
    playerHP: 3,
    counterDmg: 1,
    perfectDmg: 2,
  };

  /* ── 상태 ── */
  const ATK = ['high', 'low', 'thrust'];            // 응수 인덱스와 1:1 (0 쳐내기 / 1 점프 / 2 흘리기)
  const ATK_KO = { high: '상단베기', low: '하단베기', thrust: '찌르기' };
  const ATK_COLOR = { high: '#e8c256', low: '#e2574f', thrust: '#7c6cf0' };

  let S = null;          // 세션
  let P = null;          // 현재 페이즈
  let fx = { particles: [], trails: [], shake: 0, flash: 0, hitStop: 0, slowmo: 0, playerFlash: 0, enemyFlash: 0 };
  let running = false;
  let lastT = 0;

  /* ── 학습 (D2) — 놈은 죽지 않고, 새로고침해도 기억한다 ──
   * 배우는 것: ①공격별로 당신이 얼마나 맞는가(약점) ②응수 타이밍 버릇(성급/완벽충)
   * 무기: 약점 공격 편중 / 성급한 자에게 페인트 / 완벽충에게 속공
   * 역이용(패턴 낚시): 일부러 성급한 척 → 페인트 유도 → 기다렸다 간파(2딜)
   */
  const Learn = (() => {
    const KEY = 'duel_v1';
    let L = load() || fresh();
    function fresh() {
      return {
        perType: { high: { n: 0, hits: 0 }, low: { n: 0, hits: 0 }, thrust: { n: 0, hits: 0 } },
        fracs: [],                      // 최근 응수 시점 (t/dur)
        feints: { tried: 0, landed: 0 },
        quicks: { tried: 0, landed: 0 },
      };
    }
    function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
    function save() { localStorage.setItem(KEY, JSON.stringify(L)); }

    function onDefend(type, gotHit) { L.perType[type].n += 1; if (gotHit) L.perType[type].hits += 1; save(); }
    function onRespond(frac) { L.fracs.push(Math.min(1, frac)); if (L.fracs.length > 12) L.fracs.shift(); save(); }
    function onFeint(landed) { L.feints.tried += 1; if (landed) L.feints.landed += 1; save(); }
    function onQuick(landed) { L.quicks.tried += 1; if (landed) L.quicks.landed += 1; save(); }

    function avgFrac() { return L.fracs.length >= 4 ? L.fracs.reduce((a, b) => a + b, 0) / L.fracs.length : null; }
    function stdevFrac() {
      if (L.fracs.length < 4) return null;
      const m = avgFrac();
      return Math.sqrt(L.fracs.reduce((a, b) => a + (b - m) ** 2, 0) / L.fracs.length);
    }
    function failRate(type) { const p = L.perType[type]; return p.n >= 2 ? p.hits / p.n : 0; }
    function weakest() {
      let best = null, bestR = 0.34;
      ATK.forEach(t => { const r = failRate(t); if (L.perType[t].n >= 3 && r > bestR) { bestR = r; best = t; } });
      return best;
    }
    /* 그림자가 아는 양 0~1 — 눈빛·윤곽 연출용 */
    function knowledge() {
      const defends = ATK.reduce((a, t) => a + L.perType[t].n, 0);
      return Math.min(1, (defends / 12) * 0.6 + (L.fracs.length / 12) * 0.4);
    }

    /* 인터미션·사망 화면용 — 숫자와 함께, 아는 만큼만 (정직 원칙) */
    function lines() {
      const out = [];
      const w = weakest();
      if (w) out.push(`${ATK_KO[w]}에 ${L.perType[w].n}번 중 ${L.perType[w].hits}번 적중 — 계속 노린다.`);
      const f = avgFrac(), sd = stdevFrac();
      if (f !== null && f < 0.5) out.push(`응수가 성급하다 (평균 ${Math.round(f * 100)}% 시점) — 페인트를 그 앞에 건다.`);
      else if (f !== null && f >= 0.72) out.push(`완벽만 노린다 (평균 ${Math.round(f * 100)}% 시점) — 속공 준비.`);
      else if (f !== null && sd !== null && sd < 0.12) out.push(`응수 시점이 일정하다 (평균 ${Math.round(f * 100)}%, 편차 ±${Math.round(sd * 100)}%p) — 그 리듬 직후에 칼을 바꾼다.`);
      if (L.feints.tried > 0) out.push(`페인트 ${L.feints.tried}회 중 ${L.feints.landed}회 적중.`);
      if (!out.length) {
        if (f !== null && sd !== null && sd >= 0.2 && !w) out.push('버릇이 안 잡힌다. …제법인데.');
        else out.push('…아직 배우는 중이다. 더 싸워라.');
      }
      return out;
    }
    function reset() { L = fresh(); save(); }
    function raw() { return L; }
    return { onDefend, onRespond, onFeint, onQuick, avgFrac, stdevFrac, failRate, weakest, knowledge, lines, reset, raw };
  })();

  function newSession() {
    S = {
      duel: 1, score: { counters: 0, perfects: 0, hitsTaken: 0 },
      playerHP: CFG.playerHP, enemyHP: CFG.enemyHP,
      telegraphMs: CFG.telegraphMs,
      dead: false,
      lastAtk: null,
      playerPose: 'idle', playerPoseT: 0,   // idle/parry/jump/side/strike/hurt
    };
    P = { name: 'breather', t: 0, dur: rand(...CFG.breatherMs), chainLeft: 0 };
    fx = { particles: [], trails: [], shake: 0, flash: 0, hitStop: 0, slowmo: 0, playerFlash: 0, enemyFlash: 0 };
    renderHUD();
  }

  /* ── 적의 공격 선택 — D2: 학습 기반 ──
   * 반환: { type, feintFrom, switchFrac, quick } — 페인트면 예고가 feintFrom으로 시작해 도중에 type으로 바뀐다
   */
  function chooseAttack() {
    // 약점 편중: 실패율만큼 가중치
    const weights = ATK.map(t => 1 + 2.4 * Learn.failRate(t) + (t === S.lastAtk ? -0.35 : 0));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    let pick = ATK[0];
    for (let i = 0; i < ATK.length; i++) { if ((r -= weights[i]) <= 0) { pick = ATK[i]; break; } }
    S.lastAtk = pick;

    const plan = { type: pick, pickedWeak: pick === Learn.weakest() };
    const f = Learn.avgFrac(), sd = Learn.stdevFrac();
    /* 페인트 — 핵심: 전환 시점을 "당신의 습관 시점 + 여유" 뒤에 건다.
     * 성급하든 중간이든, 습관대로 응수하면 가짜에 커밋된다. 늦게 치는 자(>0.72)만 속공 대상.
     * 습관이 일정할수록(편차 작음) 확신을 갖고 더 자주 건다 — 흔들리는 자에겐 함부로 안 건다. */
    if (S.duel >= 2 && f !== null && f < 0.72) {
      let chance = 0.16 + Math.max(0, 0.5 - f) * 0.5;          // 성급할수록 +
      if (sd !== null && sd < 0.12) chance += 0.14;             // 일정할수록 +
      if (Math.random() < Math.min(0.45, chance)) {
        const others = ATK.filter(t => t !== pick);
        plan.feintFrom = others[Math.floor(Math.random() * others.length)];
        plan.switchFrac = Math.min(0.85, Math.max(0.4, f + 0.15));
      }
    }
    // 완벽충 → 속공
    if (!plan.feintFrom && S.duel >= 2 && f !== null && f >= 0.72 && Math.random() < 0.25) plan.quick = true;
    return plan;
  }
  function chainLen() { return 1 + Math.floor(Math.random() * Math.min(1 + S.duel, 4)); }

  function startTelegraph(chainLeft) {
    const plan = chooseAttack();
    let dur = Math.max(CFG.telegraphMin, S.telegraphMs * (P && P.chainLeft > 0 ? 0.94 : 1));
    if (plan.feintFrom) dur *= 1.22;           // 페인트는 총 길이를 늘려 간파 여지를 준다
    if (plan.quick) dur *= 0.62;
    setPhase('telegraph', dur, {
      type: plan.feintFrom || plan.type,       // 페인트면 가짜로 시작
      realType: plan.type,
      feint: !!plan.feintFrom,
      switchFrac: plan.switchFrac,
      quick: !!plan.quick,
      pickedWeak: plan.pickedWeak,
      switched: false, committed: null,
      chainLeft,
    });
    sfx.tension();
  }

  /* 그림자의 조롱 — 약점을 알고 노렸음을 티낸다 (착취의 가시화) */
  const TAUNTS = {
    weakHit: (t) => [`거봐, ${ATK_KO[t]}.`, `${ATK_KO[t]}엔 늘 이러더라.`, `알고 넣었다, ${ATK_KO[t]}.`],
    feintHit: ['네 리듬은 이미 외웠다.', '그 시점에 움직일 줄 알았다.'],
  };
  function taunt(text) {
    const el = document.getElementById('taunt');
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  /* ── 페이즈 진행 ── */
  function setPhase(name, dur, extra = {}) { P = { name, t: 0, dur, ...extra, chainLeft: extra.chainLeft ?? P.chainLeft }; }

  function update(dt) {
    // 히트스톱·슬로모
    if (fx.hitStop > 0) { fx.hitStop -= dt; return; }
    let scale = 1;
    if (fx.slowmo > 0) { fx.slowmo -= dt; scale = CFG.slowmo.scale; }
    const d = dt * scale;
    P.t += d;
    S.playerPoseT += d;
    if (S.playerPose !== 'idle' && S.playerPoseT > 380 && !['jump', 'side'].includes(S.playerPose)) resetPose();
    if (['jump', 'side'].includes(S.playerPose) && S.playerPoseT > 460) resetPose();

    fx.shake = Math.max(0, fx.shake - d * 0.08);
    fx.flash = Math.max(0, fx.flash - d * 0.004);
    fx.playerFlash = Math.max(0, fx.playerFlash - d * 0.005);
    fx.enemyFlash = Math.max(0, fx.enemyFlash - d * 0.005);
    fx.particles = fx.particles.filter(p => (p.life -= d) > 0);
    fx.particles.forEach(p => { p.x += p.vx * d * 0.06; p.y += p.vy * d * 0.06; p.vy += d * 0.012; });
    fx.trails = fx.trails.filter(t => (t.life -= d) > 0);

    switch (P.name) {
      case 'breather':
        if (P.t >= P.dur) startTelegraph(P.chainLeft > 0 ? P.chainLeft : chainLen());
        break;
      case 'telegraph':
        // 페인트 전환 — 가짜 예고가 진짜로 바뀌는 순간
        if (P.feint && !P.switched && P.t >= P.dur * P.switchFrac) {
          P.switched = true;
          P.type = P.realType;
          fx.enemyFlash = 0.5;
          burst(600, 280, ATK_COLOR[P.type], 8);
          sfx.feint();
        }
        if (P.t >= P.dur) {
          // 커밋 평가: 페인트 앞구간에 이미 응수한 경우
          if (P.committed !== null && !P.responded && !P.wrong) {
            if (P.committed === ATK.indexOf(P.type)) {   // 운 좋게 진짜와 일치 — 표준 응수 처리
              parrySuccess(false, false);
              return;
            }
            P.wrong = true;                              // 가짜에 속음
            P.feintHit = true;
          }
          setPhase('attack', CFG.attackMs, { type: P.type, responded: P.responded, wrong: P.wrong, feint: P.feint, feintHit: P.feintHit, quick: P.quick, pickedWeak: P.pickedWeak, chainLeft: P.chainLeft });
          sfx.whoosh();
        }
        break;
      case 'attack':
        if (P.t >= P.dur) resolveAttack();
        break;
      case 'stagger':
        if (P.t >= P.dur) { announce('놓쳤다', 'purple'); endChain(); }
        break;
      case 'duelwon':
        if (P.t >= P.dur) showIntermission();
        break;
    }
  }

  function resolveAttack() {
    if (P.responded) { endChain(); return; }         // 이미 응수 성공 → stagger에서 처리됨 (안전망)
    // 피격 — 학습 기록
    Learn.onDefend(P.type, true);
    if (P.feint) Learn.onFeint(true);
    if (P.quick) Learn.onQuick(true);
    S.playerHP -= 1;
    S.score.hitsTaken += 1;
    S.playerPose = 'hurt'; S.playerPoseT = 0;
    fx.shake = 26; fx.flash = 1; fx.playerFlash = 1; fx.hitStop = CFG.hitStopMs;
    burst(300, 340, '#e2574f', 14);
    sfx.hit();
    announce(P.feintHit ? '낚였다' : P.wrong ? '헛응수!' : '피격', 'red');
    // 착취의 가시화 — 알고 때렸음을 말한다
    if (P.feintHit) {
      taunt(pickArr(TAUNTS.feintHit));
      if (!S.feintHintShown) { S.feintHintShown = true; hint('그림자의 페인트 — 전환을 기다렸다 응수하면 간파 (2딜)'); }
    } else if (P.pickedWeak) {
      taunt(pickArr(TAUNTS.weakHit(P.type)));
    }
    renderHUD();
    if (S.playerHP <= 0) return die();
    P.chainLeft -= 1;
    if (P.chainLeft > 0) startTelegraph(P.chainLeft);
    else setPhase('breather', rand(...CFG.breatherMs), { chainLeft: 0 });
  }

  function endChain() {
    P.chainLeft -= 1;
    if (P.chainLeft > 0) startTelegraph(P.chainLeft);
    else setPhase('breather', rand(...CFG.breatherMs), { chainLeft: 0 });
  }

  /* ── 입력 ── */
  function input(i) {
    if (!running || S.dead) return;
    if (P.name === 'stagger') return strike();
    const inTelegraph = P.name === 'telegraph';
    const inGrace = P.name === 'attack' && P.t <= CFG.graceMs && !P.wrong && !P.responded && P.committed === null;
    if (inTelegraph || inGrace) {
      if (P.responded || P.wrong || P.committed !== null) return;   // 이미 커밋함

      // 페인트 앞구간: 응수는 "커밋"만 된다 — 클래시 없음. 그 정적이 낚임의 공포다
      if (inTelegraph && P.feint && !P.switched) {
        P.committed = i;
        Learn.onRespond(P.t / P.dur);
        S.playerPose = ['parry', 'jump', 'side'][i]; S.playerPoseT = 0;
        sfx.commit();
        return;
      }

      const correct = ATK.indexOf(P.type) === i;
      if (inTelegraph) Learn.onRespond(P.t / P.dur);
      if (correct) {
        const remain = inTelegraph ? P.dur - P.t : 0;
        const readFeint = P.feint && P.switched;                    // 페인트를 기다렸다 간파
        const perfect = readFeint || remain <= CFG.perfectMs;
        S.playerPose = ['parry', 'jump', 'side'][i]; S.playerPoseT = 0;
        flashCtl(i, true);
        parrySuccess(perfect, readFeint);
      } else {
        P.wrong = true;
        S.playerPose = ['parry', 'jump', 'side'][i]; S.playerPoseT = 0;
        flashCtl(i, false);
        sfx.miss();
      }
      return;
    }
    // 빈틈 없는 공격 → 막힘
    if (P.name === 'breather') {
      S.playerPose = 'strike'; S.playerPoseT = 0;
      burst(470, 330, '#8b8b98', 6);
      sfx.blocked();
      announce('막혔다', 'purple');
    }
  }

  /* 응수 성공 공통 처리 — 학습 기록 포함 */
  function parrySuccess(perfect, readFeint) {
    P.responded = true;
    Learn.onDefend(P.type, false);
    if (P.feint) Learn.onFeint(false);
    if (P.quick) Learn.onQuick(false);
    fx.slowmo = CFG.slowmo.ms; fx.hitStop = 40; fx.enemyFlash = 0.6;
    burst(430, P.type === 'low' ? 420 : 300, readFeint ? '#e8c256' : '#f2f2f5', perfect ? 22 : 12);
    sfx.clash(perfect);
    announce(readFeint ? '간파!' : perfect ? '완벽!' : '받아쳤다', readFeint || perfect ? 'gold' : 'green');
    setPhase('stagger', CFG.staggerMs, { perfect, chainLeft: P.chainLeft });
  }

  function strike() {
    const dmg = P.perfect ? CFG.perfectDmg : CFG.counterDmg;
    S.enemyHP -= dmg;
    S.score.counters += 1;
    if (P.perfect) S.score.perfects += 1;
    S.playerPose = 'strike'; S.playerPoseT = 0;
    fx.shake = 18; fx.hitStop = CFG.hitStopMs; fx.enemyFlash = 1;
    burst(560, 320, P.perfect ? '#e8c256' : '#7c6cf0', P.perfect ? 24 : 14);
    sfx.counter(P.perfect);
    announce(P.perfect ? `반격 ${dmg}딜!` : '반격!', P.perfect ? 'gold' : 'purple');
    renderHUD();
    if (S.enemyHP <= 0) {
      setPhase('duelwon', 1400, { chainLeft: 0 });
      announce(`결투 ${S.duel} 승리`, 'gold');
      sfx.win();
      return;
    }
    setPhase('breather', rand(...CFG.breatherMs), { chainLeft: 0 });
  }

  /* 인터미션 — 놈이 배운 것을 낭독한다 (이 게임의 정체성 화면) */
  function showIntermission() {
    running = false;
    document.getElementById('inter-title').textContent = `결투 ${S.duel} 승리`;
    document.getElementById('inter-lines').innerHTML =
      Learn.lines().map(l => `<div class="learn-line">"${l}"</div>`).join('');
    document.getElementById('ov-inter').classList.remove('hidden');
  }

  function nextDuel() {
    document.getElementById('ov-inter').classList.add('hidden');
    S.duel += 1;
    S.enemyHP = CFG.enemyHP + Math.floor(S.duel / 2);
    S.telegraphMs = Math.max(CFG.telegraphMin, S.telegraphMs * CFG.telegraphDecay);
    setPhase('breather', 1000, { chainLeft: 0 });
    running = true;
    renderHUD();
    hint(`결투 ${S.duel} — 그림자는 더 빠르고, 당신을 더 안다`);
  }

  function die() {
    S.dead = true;
    running = false;
    sfx.lose();
    document.getElementById('dead-stats').textContent =
      `결투 ${S.duel}까지 · 반격 ${S.score.counters}회 (완벽 ${S.score.perfects}) · 피격 ${S.score.hitsTaken}회`;
    document.getElementById('dead-lines').innerHTML =
      Learn.lines().map(l => `<div class="learn-line">"${l}"</div>`).join('');
    document.getElementById('ov-dead').classList.remove('hidden');
  }

  function resetPose() { S.playerPose = 'idle'; S.playerPoseT = 0; }

  /* ── 연출 유틸 ── */
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5;
      fx.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, life: 300 + Math.random() * 250, color });
    }
  }
  function announce(text, cls) {
    const el = document.getElementById('announce');
    el.textContent = text;
    el.className = 'announce ' + cls;
    void el.offsetWidth;
    el.classList.add('pop');
  }
  function hint(text) { document.getElementById('hint').textContent = text; }
  function flashCtl(i, ok) {
    const b = document.querySelector(`.ctl[data-i="${i}"]`);
    if (!b) return;
    b.classList.remove('flash-ok', 'flash-bad');
    void b.offsetWidth;
    b.classList.add(ok ? 'flash-ok' : 'flash-bad');
    setTimeout(() => b.classList.remove('flash-ok', 'flash-bad'), 350);
  }
  function renderHUD() {
    document.getElementById('duel-no').textContent = `결투 ${S.duel} — 그림자`;
    document.getElementById('enemy-hp').style.width = Math.max(0, 100 * S.enemyHP / (CFG.enemyHP + Math.floor(S.duel / 2))) + '%';
    const hearts = document.getElementById('hearts');
    hearts.innerHTML = Array.from({ length: CFG.playerHP }, (_, i) =>
      `<span class="${i < S.playerHP ? '' : 'lost'}">♥</span>`).join('');
  }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pickArr(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* ── 렌더링 (절차적 실루엣) ── */
  function draw() {
    ctx.clearRect(0, 0, W, H);
    const shx = fx.shake ? (Math.random() - 0.5) * fx.shake : 0;
    const shy = fx.shake ? (Math.random() - 0.5) * fx.shake * 0.6 : 0;
    ctx.save();
    ctx.translate(shx, shy);

    // 바닥·배경
    const g = ctx.createRadialGradient(W / 2, H * 0.42, 60, W / 2, H * 0.42, 520);
    g.addColorStop(0, '#17171d'); g.addColorStop(1, '#0c0c10');
    ctx.fillStyle = g; ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.strokeStyle = '#26262f'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(40, GROUND + 24); ctx.lineTo(W - 40, GROUND + 24); ctx.stroke();

    // 예고 신호 (색 + 위치로 읽히게)
    if (P.name === 'telegraph') {
      const prog = P.t / P.dur;
      const c = ATK_COLOR[P.type];
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.55 * prog;
      ctx.strokeStyle = c; ctx.lineWidth = 3 + 5 * prog;
      if (P.type === 'high') { arc(600, 250, 70, -2.4, -0.7); }
      if (P.type === 'low') { arc(600, 440, 70, 2.6, 0.6, true); }
      if (P.type === 'thrust') { ctx.beginPath(); ctx.moveTo(560, 330); ctx.lineTo(430 + 40 * prog, 330); ctx.stroke(); }
      ctx.restore();
      // 예고 라벨 (프로토 가독용)
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = c; ctx.font = '800 20px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(ATK_KO[P.type], 600, 180);
      // 타이밍 게이지
      ctx.fillStyle = '#2a2a33'; ctx.fillRect(540, 196, 120, 5);
      ctx.fillStyle = prog > 1 - CFG.perfectMs / P.dur ? '#e8c256' : c;
      ctx.fillRect(540, 196, 120 * (1 - prog), 5);
      ctx.restore();
    }

    drawTrails();
    drawPlayer();
    drawEnemy();
    drawParticles();

    ctx.restore();

    // 전체 플래시 (피격)
    if (fx.flash > 0) { ctx.fillStyle = `rgba(226,87,79,${fx.flash * 0.22})`; ctx.fillRect(0, 0, W, H); }
  }

  function arc(x, y, r, a0, a1, ccw) { ctx.beginPath(); ctx.arc(x, y, r, a0, a1, !!ccw); ctx.stroke(); }

  function drawFighter(x, dir, opt) {
    // opt: lean(rad), crouch(px), shiftX, swordA(rad, 0=수평 전방), color, glow, flash, eye
    const { lean = 0, crouch = 0, shiftX = 0, swordA = 0.5, color, glow, flash = 0, eye } = opt;
    const bx = x + shiftX;
    const hipY = GROUND - 60 + crouch;
    const shY = hipY - 68 + crouch * 0.35;
    const shX = bx + Math.sin(lean) * 46 * dir;
    ctx.save();
    ctx.lineCap = 'round';
    // 그림자
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(bx, GROUND + 22, 44, 9, 0, 0, Math.PI * 2); ctx.fill();
    // 몸
    ctx.strokeStyle = flash > 0 ? `rgba(255,255,255,${0.4 + flash * 0.6})` : color;
    ctx.lineWidth = 13;
    ctx.beginPath(); ctx.moveTo(bx - 14 * dir, GROUND + 16); ctx.lineTo(bx, hipY); ctx.stroke();          // 뒷다리
    ctx.beginPath(); ctx.moveTo(bx + 20 * dir, GROUND + 16); ctx.lineTo(bx, hipY); ctx.stroke();          // 앞다리
    ctx.lineWidth = 15;
    ctx.beginPath(); ctx.moveTo(bx, hipY); ctx.lineTo(shX, shY); ctx.stroke();                            // 몸통
    ctx.beginPath(); ctx.arc(shX + 4 * dir, shY - 18, 13, 0, Math.PI * 2);                                 // 머리
    ctx.fillStyle = ctx.strokeStyle; ctx.fill();
    if (eye) { ctx.fillStyle = eye; ctx.beginPath(); ctx.arc(shX + 10 * dir, shY - 20, 3, 0, Math.PI * 2); ctx.fill(); }
    // 팔 + 검
    const hx = shX + Math.cos(swordA) * 30 * dir, hy = shY + 6 - Math.sin(swordA) * 30;
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(shX, shY + 4); ctx.lineTo(hx, hy); ctx.stroke();
    const sx = hx + Math.cos(swordA) * 62 * dir, sy = hy - Math.sin(swordA) * 62;
    ctx.save();
    ctx.strokeStyle = glow; ctx.lineWidth = 4.5;
    ctx.shadowColor = glow; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(sx, sy); ctx.stroke();
    ctx.restore();
    ctx.restore();
    return { hx, hy, sx, sy };
  }

  function drawPlayer() {
    const t = performance.now() * 0.003;
    let o = { lean: 0.06, crouch: Math.sin(t) * 3, swordA: 0.45, shiftX: 0 };
    const pt = S.playerPoseT;
    if (S.playerPose === 'parry') o = { lean: -0.1, swordA: 1.5, crouch: 0 };
    if (S.playerPose === 'jump') o = { lean: 0.15, swordA: 0.7, crouch: -74 + Math.min(1, pt / 220) * 30 };
    if (S.playerPose === 'side') o = { lean: -0.28, swordA: 0.3, shiftX: -46 };
    if (S.playerPose === 'strike') {
      const p = Math.min(1, pt / 200);
      o = { lean: 0.42, swordA: 0.9 - p * 1.2, shiftX: 70 * p, crouch: 6 };
      if (pt < 180) fx.trails.push({ x1: 380, y1: 300, x2: 480 + 60 * p, y2: 320 + 40 * p, life: 160, color: '#7c6cf0' });
    }
    if (S.playerPose === 'hurt') o = { lean: -0.4, swordA: -0.2, shiftX: -26, crouch: 10 };
    drawFighter(300, 1, { ...o, color: '#e9e9f0', glow: '#7c6cf0', flash: fx.playerFlash });
  }

  function drawEnemy() {
    const t = performance.now() * 0.0026;
    let o = { lean: 0.05, crouch: Math.sin(t + 2) * 3, swordA: 0.5, shiftX: 0 };
    if (P.name === 'telegraph') {
      const p = Math.min(1, P.t / P.dur);
      if (P.type === 'high') o = { lean: -0.2 - p * 0.15, swordA: 2.2, crouch: -4 };
      if (P.type === 'low') o = { lean: 0.1, swordA: -0.7, crouch: 26 };
      if (P.type === 'thrust') o = { lean: -0.12, swordA: 0.06, shiftX: 18 * p, crouch: 4 };
      o.shake = p > 0.75;
      if (o.shake) o.shiftX = (o.shiftX || 0) + (Math.random() - 0.5) * 3;
    }
    if (P.name === 'attack') {
      const p = Math.min(1, P.t / P.dur);
      if (P.type === 'high') { o = { lean: 0.4, swordA: 2.2 - p * 2.6, shiftX: -60 * p, crouch: 8 * p }; }
      if (P.type === 'low') { o = { lean: 0.3, swordA: -0.7 + p * 0.5, shiftX: -70 * p, crouch: 30 - 10 * p }; }
      if (P.type === 'thrust') { o = { lean: 0.5, swordA: 0.04, shiftX: -130 * p, crouch: 6 }; }
      fx.trails.push({ x1: 600 + (o.shiftX || 0), y1: 290, x2: 520 + (o.shiftX || 0), y2: 330, life: 140, color: ATK_COLOR[P.type] });
    }
    if (P.name === 'stagger') {
      const p = Math.min(1, P.t / 300);
      o = { lean: -0.5 * p, swordA: -0.4, shiftX: 34 * p, crouch: 12 };
    }
    if (P.name === 'duelwon') o = { lean: -0.9, swordA: -1.2, crouch: 40, shiftX: 20 };
    // 그림자는 알수록 밝아진다 — 눈빛과 보라 윤곽이 지식량에 비례
    const k = Learn.knowledge();
    const fig = drawFighter(600, -1, { ...o, color: '#23232c', glow: '#e2574f', flash: fx.enemyFlash, eye: '#e2574f' });
    if (k > 0.05) {
      ctx.save();
      ctx.globalAlpha = 0.12 + 0.3 * k;
      ctx.strokeStyle = '#7c6cf0';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#7c6cf0'; ctx.shadowBlur = 8 + 14 * k;
      ctx.beginPath(); ctx.arc(600 + (o.shiftX || 0), GROUND - 130 + (o.crouch || 0) * 0.5, 58, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // 반격 창 표시
    if (P.name === 'stagger') {
      const remain = 1 - P.t / P.dur;
      ctx.save();
      ctx.fillStyle = '#7c6cf0'; ctx.font = '800 17px sans-serif'; ctx.textAlign = 'center';
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(performance.now() * 0.02);
      ctx.fillText('빈틈 — 반격!', 600, 170);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#2a2a33'; ctx.fillRect(540, 182, 120, 5);
      ctx.fillStyle = '#7c6cf0'; ctx.fillRect(540, 182, 120 * remain, 5);
      ctx.restore();
    }
  }

  function drawTrails() {
    fx.trails.forEach(tr => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, tr.life / 160) * 0.5;
      ctx.strokeStyle = tr.color; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.shadowColor = tr.color; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.moveTo(tr.x1, tr.y1); ctx.lineTo(tr.x2, tr.y2); ctx.stroke();
      ctx.restore();
    });
  }
  function drawParticles() {
    fx.particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / 500);
      ctx.strokeStyle = p.color; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2.4, p.y - p.vy * 2.4); ctx.stroke();
      ctx.restore();
    });
  }

  /* ── 사운드 (WebAudio 합성 — 파일 0개) ── */
  const sfx = (() => {
    let ac = null;
    const ready = () => {
      if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (A) ac = new A(); }
      if (ac && ac.state === 'suspended') ac.resume();
      return ac;
    };
    const tone = (f, { type = 'sine', dur = 0.15, peak = 0.16, slide, delay = 0 } = {}) => {
      const c = ready(); if (!c) return;
      const t = c.currentTime + delay;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
    };
    const noise = ({ dur = 0.2, peak = 0.2, hp = 0, lp = 8000, delay = 0 } = {}) => {
      const c = ready(); if (!c) return;
      const t = c.currentTime + delay;
      const n = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, n, c.sampleRate);
      const dta = buf.getChannelData(0);
      for (let i = 0; i < n; i++) dta[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = c.createBufferSource(); src.buffer = buf;
      let node = src;
      if (hp) { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; node.connect(f); node = f; }
      if (lp < 8000) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      node.connect(g).connect(c.destination); src.start(t);
    };
    return {
      ready,
      tension: () => tone(160, { type: 'sine', dur: 0.28, peak: 0.05, slide: 200 }),
      whoosh: () => noise({ dur: 0.14, peak: 0.14, hp: 900 }),
      commit: () => tone(340, { type: 'sine', dur: 0.07, peak: 0.06 }),
      feint: () => { tone(900, { type: 'square', dur: 0.06, peak: 0.09 }); tone(600, { type: 'square', dur: 0.08, peak: 0.09, delay: 0.05 }); },
      clash: (perfect) => {
        noise({ dur: 0.1, peak: 0.28, hp: 2400 });
        tone(perfect ? 1650 : 1180, { type: 'square', dur: 0.09, peak: 0.1 });
        if (perfect) tone(2200, { dur: 0.22, peak: 0.1, delay: 0.05 });
      },
      miss: () => tone(240, { type: 'triangle', dur: 0.1, peak: 0.1, slide: 170 }),
      hit: () => { noise({ dur: 0.25, peak: 0.3, lp: 900 }); tone(120, { type: 'sawtooth', dur: 0.3, peak: 0.24, slide: 45 }); },
      blocked: () => { noise({ dur: 0.06, peak: 0.12, hp: 1500 }); tone(420, { type: 'square', dur: 0.06, peak: 0.07 }); },
      counter: (perfect) => {
        noise({ dur: 0.2, peak: 0.26, lp: 1400 });
        tone(perfect ? 700 : 520, { type: 'triangle', dur: 0.18, peak: 0.2, slide: perfect ? 1050 : 700 });
      },
      win: () => [0, 0.09, 0.18].forEach((d, i) => tone([523, 659, 880][i], { dur: 0.25, peak: 0.13, delay: d })),
      lose: () => [0, 0.14].forEach((d, i) => tone([310, 210][i], { type: 'triangle', dur: 0.5, peak: 0.15, delay: d })),
    };
  })();

  /* ── 루프·바인딩 ── */
  function loop(t) {
    const dt = Math.min(50, t - lastT);
    lastT = t;
    if (running) update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  function start() {
    newSession();
    document.getElementById('ov-title').classList.add('hidden');
    document.getElementById('ov-dead').classList.add('hidden');
    running = true;
    sfx.ready();
    hint('적의 자세와 색을 읽어라');
  }

  document.getElementById('btn-start').onclick = start;
  document.getElementById('btn-retry').onclick = start;
  document.getElementById('btn-next-duel').onclick = nextDuel;
  document.querySelectorAll('.btn-forget').forEach(b => b.onclick = () => {
    Learn.reset();
    b.textContent = '기억을 지웠다';
    setTimeout(() => { b.textContent = '그림자의 기억 지우기'; }, 1200);
  });
  document.querySelectorAll('.ctl').forEach(b => {
    b.addEventListener('pointerdown', e => { e.preventDefault(); input(+b.dataset.i); });
  });
  addEventListener('keydown', e => {
    const map = { a: 0, s: 1, d: 2, ArrowLeft: 0, ArrowDown: 1, ArrowRight: 2, '1': 0, '2': 1, '3': 2 };
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k in map) { e.preventDefault(); input(map[k]); }
    else if (e.key === ' ' || e.key === 'Enter') {
      if (!running) start();
      else input(-1); // 스페이스 = 반격 전용
    }
  });

  // 디버그 훅 (자동 검증용 — 제출 전 제거)
  window.__duel = {
    state: () => ({ phase: P.name, type: P.type, realType: P.realType, feint: !!P.feint, switched: !!P.switched, quick: !!P.quick,
      committed: P.committed, t: Math.round(P.t), dur: P.dur, duel: S.duel, pHP: S.playerHP, eHP: S.enemyHP, dead: S.dead, running,
      score: { ...S.score } }),
    input, start, nextDuel,
    correctIndex: () => ATK.indexOf(P.type),
    tick: (ms) => { if (running) update(ms); },   // rAF 없이 로직만 전진 (백그라운드 탭 검증용)
    draw,
    learn: () => Learn.raw(), learnLines: () => Learn.lines(), learnReset: () => Learn.reset(),
  };

  newSession();
  requestAnimationFrame(t => { lastT = t; loop(t); });
})();
