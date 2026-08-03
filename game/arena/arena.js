/* 도플: 아레나 — 오토배틀러 코어 프로토
 * 재미 게이트: "고르고(3택1), 지켜보는(자동 전투) 게 재밌는가"
 * 유저는 조작하지 않는다. 선택하고, 관전하고, 결과에서 자기 선택의 값을 확인한다.
 */
(() => {
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const GROUND = 400;

  /* ── 스킬 풀 (8종) — 전부 분신의 것. 관전 다양성의 원천 ── */
  const SKILLS = {
    flame: { icon: '🔥', name: '화염베기', cls: 'atk', desc: '공격 시 30% 확률로 불을 붙인다 (3초간 초당 2 피해)' },
    combo: { icon: '⚡', name: '연속베기', cls: 'atk', desc: '공격 시 35% 확률로 즉시 2타째 (피해 50%)' },
    execute: { icon: '☠', name: '처형', cls: 'atk', desc: '적 체력 30% 이하면 공격 피해 2배' },
    steel: { icon: '🛡', name: '강철 자세', cls: 'def', desc: '받는 피해 30% 확률로 절반' },
    riposte: { icon: '↩', name: '반격 태세', cls: 'def', desc: '25% 확률로 막고 즉시 반격 (피해 60%)' },
    regen: { icon: '✚', name: '재생', cls: 'def', desc: '2초마다 체력 1.5 회복' },
    shadowstep: { icon: '👣', name: '그림자 밟기', cls: 'tec', desc: '전투 시작 시 선공 + 공격 속도 12% 증가' },
    shake: { icon: '〰', name: '흔들기', cls: 'tec', desc: '적의 공격이 12% 확률로 빗나간다' },
  };

  /* ── 리그 상대 3인 (아키타입 부활) ── */
  const FOES = [
    {
      id: 'bulldozer', name: '불도저', color: '#c2542e', eye: '#ffb15e',
      hp: 34, atk: 4.6, interval: 1000,
      intro: '공격적이고 빠르다. 막을 줄 모른다.',
      advise: { pick: ['riposte', 'shake'], why: '빠른 공격엔 반격 태세나 흔들기가 값을 합니다.' },
    },
    {
      id: 'accountant', name: '회계사', color: '#5d7a94', eye: '#bfe3ff',
      hp: 48, atk: 3.8, interval: 1200, halve: 0.25,
      intro: '단단하다. 피해를 자주 반감한다. 오래 버틴다.',
      advise: { pick: ['flame', 'execute'], why: '반감 상대엔 화염 도트나 처형으로 뚫는 게 계산상 이득입니다.' },
    },
    {
      id: 'fox', name: '여우', color: '#b8862e', eye: '#ffe08a',
      hp: 42, atk: 4.2, interval: 1100, counter: 0.18, dodge: 0.1,
      intro: '반격하고, 흘린다. 정직한 교환으로는 손해 본다.',
      advise: { pick: ['regen', 'shadowstep'], why: '반격 손해를 재생으로 메우거나, 선공권으로 템포를 뺏으시죠.' },
    },
  ];

  /* ── 상태 ── */
  let R = null;      // 런: { battleIdx, skills[], followedAdvice, log }
  let B = null;      // 전투: fighters, timers, procs
  let fx = { particles: [], trails: [], floats: [], shake: 0, hitStop: 0, slowmo: 0 };
  let running = false, lastT = 0;

  function newRun() {
    R = { battleIdx: 0, skills: [], advicePick: null, adviceFollowed: 0, adviceTotal: 0, wins: 0, notes: [] };
  }

  /* ── 드래프트 ── */
  function showDraft() {
    running = false;
    const foe = FOES[R.battleIdx];
    document.getElementById('foe-preview').innerHTML =
      `다음 상대 <b>${foe.name}</b> — ${foe.intro}`;
    // 미보유 스킬 중 3장
    const pool = Object.keys(SKILLS).filter(k => !R.skills.includes(k));
    const offer = shuffle(pool).slice(0, 3);
    // 분신의 추천: 상대 상성표에서 제시된 것 중 오퍼에 있는 첫 번째
    R.advicePick = foe.advise.pick.find(k => offer.includes(k)) || null;
    R.adviceTotal += 1;

    const row = document.getElementById('draft-row');
    row.innerHTML = '';
    offer.forEach(k => {
      const s = SKILLS[k];
      const b = document.createElement('button');
      b.className = `skill-card ${s.cls}` + (k === R.advicePick ? ' advised' : '');
      b.innerHTML = `<div class="sk-icon">${s.icon}</div><div class="sk-name">${s.name}</div>
        <div class="sk-desc">${s.desc}</div><span class="sk-tag">${{ atk: '공격', def: '방어', tec: '기술' }[s.cls]}</span>`;
      b.onclick = () => pickSkill(k, b);
      row.appendChild(b);
    });
    document.getElementById('advice').textContent =
      R.advicePick ? `◑ "${foe.advise.why}"` : `◑ "이 셋 중엔 추천이 없네요. 감으로 가시죠."`;
    document.getElementById('ov-draft').classList.remove('hidden');
    sfx.draft();
  }

  function pickSkill(k, cardEl) {
    if (R.skills.includes(k)) return;
    R.skills.push(k);
    if (k === R.advicePick) R.adviceFollowed += 1;
    cardEl.classList.add('picked');
    sfx.pick();
    setTimeout(() => {
      document.getElementById('ov-draft').classList.add('hidden');
      startBattle();
    }, 550);
  }

  /* ── 전투 엔진 (자동) ── */
  function fighter(base) {
    return { hp: base.hp, maxHp: base.hp, atk: base.atk, interval: base.interval,
      timer: base.interval * (0.4 + Math.random() * 0.3), burn: 0, burnTick: 0,
      pose: 'idle', poseT: 0, ...base };
  }

  function startBattle() {
    const foeBase = FOES[R.battleIdx];
    // 분신 기본기: 상대 1을 스킬 1개로 우세하게 이길 수 있는 선 (전투마다 +2 최대체력 성장)
    const me = fighter({ side: 'me', name: '분신', hp: 42 + R.battleIdx * 2, atk: 4.4, interval: 1080, color: '#e9e9f0', glow: '#7c6cf0', x: 290, dir: 1 });
    const foe = fighter({ side: 'foe', name: foeBase.name, hp: foeBase.hp, atk: foeBase.atk, interval: foeBase.interval,
      halve: foeBase.halve, counter: foeBase.counter, dodge: foeBase.dodge,
      color: '#23232c', glow: foeBase.color, eye: foeBase.eye, x: 610, dir: -1 });

    if (has('shadowstep')) { me.interval *= 0.88; me.timer = 200; }   // 선공 + 속도
    B = { me, foe, over: false, t: 0, regenTick: 0, procs: {}, dmgDealt: 0, dmgTaken: 0, healed: 0 };

    document.getElementById('foe-name').textContent = foeBase.name;
    document.getElementById('battle-no').textContent = `${R.battleIdx + 1} / ${FOES.length}`;
    renderSkillChips();
    renderHP();
    running = true;
    announce(`${foeBase.name} 등장`, 'red');
    sfx.battleStart();
  }

  function has(k) { return R.skills.includes(k); }
  function proc(k) { B.procs[k] = (B.procs[k] || 0) + 1; flashChip(k); }

  function update(dt) {
    if (fx.hitStop > 0) { fx.hitStop -= dt; return; }
    let scale = 1;
    if (fx.slowmo > 0) { fx.slowmo -= dt; scale = 0.3; }
    const d = dt * scale;
    B.t += d;

    [B.me, B.foe].forEach(f => {
      f.poseT += d;
      if (f.pose !== 'idle' && f.poseT > 320) { f.pose = 'idle'; f.poseT = 0; }
    });

    fx.shake = Math.max(0, fx.shake - d * 0.08);
    fx.particles = fx.particles.filter(p => (p.life -= d) > 0);
    fx.particles.forEach(p => { p.x += p.vx * d * 0.06; p.y += p.vy * d * 0.06; p.vy += d * 0.012; });
    fx.trails = fx.trails.filter(t => (t.life -= d) > 0);
    fx.floats = fx.floats.filter(f => (f.life -= d) > 0);
    fx.floats.forEach(f => f.y -= d * 0.04);

    if (B.over) return;

    // 화염 도트
    [B.me, B.foe].forEach(f => {
      if (f.burn > 0) {
        f.burnTick += d;
        if (f.burnTick >= 1000) {
          f.burnTick -= 1000; f.burn -= 1;
          damage(f, 2, { silent: true, kind: 'burn' });
          burst(f.x, GROUND - 90, '#ff8a3d', 5);
        }
      }
    });

    // 재생
    if (has('regen')) {
      B.regenTick += d;
      if (B.regenTick >= 2000) {
        B.regenTick -= 2000;
        if (B.me.hp < B.me.maxHp) {
          B.me.hp = Math.min(B.me.maxHp, B.me.hp + 1.5);
          B.healed += 1.5;
          proc('regen');
          addFloat(B.me.x, GROUND - 150, '+1.5', '#4fc98a');
          renderHP();
        }
      }
    }

    // 공격 타이머
    [B.me, B.foe].forEach(f => {
      if (B.over) return;
      f.timer -= d;
      if (f.timer <= 0) { f.timer += f.interval * (0.9 + Math.random() * 0.2); attack(f); }
    });
  }

  function attack(a) {
    const dfd = a === B.me ? B.foe : B.me;
    a.pose = 'strike'; a.poseT = 0;
    fx.trails.push({ x1: a.x + 40 * a.dir, y1: GROUND - 130, x2: a.x + 110 * a.dir, y2: GROUND - 80, life: 160, color: a.glow });
    sfx.swing();

    // 회피 (여우 자체 / 분신의 흔들기)
    const dodgeP = (dfd === B.me ? 0 : (has('shake') ? 0.12 : 0)) + (dfd.dodge || 0);
    if (Math.random() < dodgeP) {
      dfd.pose = 'dodge'; dfd.poseT = 0;
      addFloat(dfd.x, GROUND - 160, 'MISS', '#8b8b98');
      if (dfd === B.foe && has('shake')) proc('shake');
      sfx.miss();
      return;
    }

    // 반격 (분신의 반격 태세 / 여우 자체)
    const counterP = dfd === B.me ? (has('riposte') ? 0.25 : 0) : (dfd.counter || 0);
    if (Math.random() < counterP) {
      dfd.pose = 'block'; dfd.poseT = 0;
      fx.slowmo = 130; fx.hitStop = 50;
      burst((a.x + dfd.x) / 2, GROUND - 110, '#f2f2f5', 12);
      sfx.clash();
      if (dfd === B.me) { proc('riposte'); announce('반격!', 'purple'); }
      damage(a, dfd.atk * 0.6, { kind: 'counter' });
      return;
    }

    // 피해 계산
    let dmg = a.atk * (0.9 + Math.random() * 0.2);
    let crit = false;
    if (a === B.me && has('execute') && dfd.hp <= dfd.maxHp * 0.3) { dmg *= 2; crit = true; proc('execute'); }
    // 반감 (회계사 자체 / 분신의 강철 자세)
    const halveP = dfd === B.me ? (has('steel') ? 0.3 : 0) : (dfd.halve || 0);
    if (Math.random() < halveP) {
      dmg *= 0.5;
      if (dfd === B.me) proc('steel');
      addFloat(dfd.x, GROUND - 175, '반감', '#4fc98a');
      sfx.guard();
    }
    damage(dfd, dmg, { crit });

    // 화염 부여
    if (a === B.me && has('flame') && Math.random() < 0.3 && !B.over) {
      dfd.burn = 3; dfd.burnTick = 0; proc('flame');
      addFloat(dfd.x, GROUND - 190, '🔥', '#ff8a3d');
    }
    // 연속베기
    if (a === B.me && has('combo') && Math.random() < 0.35 && !B.over) {
      setTimeout(() => {
        if (B.over) return;
        proc('combo');
        a.pose = 'strike'; a.poseT = 0;
        fx.trails.push({ x1: a.x + 30 * a.dir, y1: GROUND - 100, x2: a.x + 120 * a.dir, y2: GROUND - 120, life: 160, color: '#e8c256' });
        damage(dfd, a.atk * 0.5, { kind: 'combo' });
        sfx.swing();
      }, 170);
    }
  }

  function damage(f, amt, opt = {}) {
    if (B.over) return;
    amt = Math.round(amt * 10) / 10;
    f.hp -= amt;
    if (f === B.me) B.dmgTaken += amt; else B.dmgDealt += amt;
    if (!opt.silent) {
      f.pose = 'hurt'; f.poseT = 0;
      fx.hitStop = opt.crit ? 90 : 45;
      if (opt.crit) { fx.shake = 20; announce('처형!', 'red'); }
      burst(f.x, GROUND - 110, opt.crit ? '#e2574f' : f === B.me ? '#e2574f' : '#e8c256', opt.crit ? 18 : 8);
      sfx.hit(opt.crit);
    }
    addFloat(f.x, GROUND - 150, (opt.kind === 'burn' ? '🔥' : '') + '-' + amt, opt.crit ? '#ff5a4f' : f === B.me ? '#e2574f' : '#f2f2f5', opt.crit);
    renderHP();
    if (f.hp <= 0) endBattle(f !== B.me);
  }

  /* ── 전투 종료·노트 ── */
  function endBattle(won) {
    B.over = true;
    running = false;
    (won ? B.foe : B.me).pose = 'dead';
    sfx[won ? 'win' : 'lose']();
    if (won) R.wins += 1;
    setTimeout(() => {
      document.getElementById('result-title').textContent = won ? '승리' : '패배';
      document.getElementById('result-title').className = won ? '' : 'dead-title';
      document.getElementById('battle-notes').innerHTML =
        battleNotes(won).map(l => `<div class="learn-line">"${l}"</div>`).join('');
      document.getElementById('btn-next').textContent = won
        ? (R.battleIdx + 1 < FOES.length ? '다음 상대' : '결과 보기') : '결과 보기';
      document.getElementById('ov-result').classList.remove('hidden');
      B.won = won;
    }, 900);
  }

  /* 선택의 값을 낭독한다 — "당신의 픽이 이겼다"가 이 게임의 도파민 */
  function battleNotes(won) {
    const out = [];
    const P = B.procs;
    const top = Object.entries(P).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 2) {
      const s = SKILLS[top[0]];
      out.push(won
        ? `${s.icon} ${s.name}${josa(s.name, '이')} ${top[1]}번 터졌습니다. 이 픽이 승부였어요.`
        : `${s.icon} ${s.name}${josa(s.name, '은')} ${top[1]}번 일했는데… 부족했네요.`);
    }
    if (won) out.push(`가한 피해 ${Math.round(B.dmgDealt)} · 받은 피해 ${Math.round(B.dmgTaken)}${B.healed ? ` · 회복 ${Math.round(B.healed)}` : ''}.`);
    else {
      const foe = FOES[R.battleIdx];
      out.push(`${foe.name}에게 ${Math.round(B.dmgTaken)} 피해를 받았습니다. ${foe.advise.why}`);
    }
    if (R.advicePick) {
      const followed = R.skills.includes(R.advicePick);
      if (followed && won) out.push('제 추천이 맞았죠? …다음에도 들으세요.');
      if (!followed && won) out.push('추천을 배신하고 이기다니. …인정합니다.');
      if (!followed && !won) out.push('제 추천 안 들으셨죠. 적어둡니다.');
    }
    return out;
  }

  function nextStep() {
    document.getElementById('ov-result').classList.add('hidden');
    if (!B.won || R.battleIdx + 1 >= FOES.length) return endRun();
    R.battleIdx += 1;
    showDraft();
  }

  function endRun() {
    const cleared = B.won && R.wins === FOES.length;
    document.getElementById('runend-title').textContent = cleared ? '런 클리어' : '런 종료';
    document.getElementById('runend-title').className = cleared ? '' : 'dead-title';
    document.getElementById('runend-stats').innerHTML =
      `${R.wins}승 ${R.battleIdx + 1 - R.wins}패 · 빌드: ${R.skills.map(k => SKILLS[k].icon + SKILLS[k].name).join(' · ') || '없음'}<br>` +
      `분신 조언 채택 ${R.adviceFollowed}/${R.adviceTotal}`;
    document.getElementById('ov-runend').classList.remove('hidden');
  }

  /* ── HUD·연출 유틸 ── */
  function renderHP() {
    document.getElementById('hp-me').style.width = Math.max(0, 100 * B.me.hp / B.me.maxHp) + '%';
    document.getElementById('hp-foe').style.width = Math.max(0, 100 * B.foe.hp / B.foe.maxHp) + '%';
  }
  function renderSkillChips() {
    document.getElementById('my-skills').innerHTML =
      R.skills.map(k => `<span class="mini-skill" data-k="${k}">${SKILLS[k].icon} ${SKILLS[k].name}</span>`).join('');
  }
  function flashChip(k) {
    const el = document.querySelector(`.mini-skill[data-k="${k}"]`);
    if (!el) return;
    el.classList.remove('proc'); void el.offsetWidth; el.classList.add('proc');
  }
  function announce(text, cls) {
    const el = document.getElementById('announce');
    el.textContent = text; el.className = 'announce ' + cls;
    void el.offsetWidth; el.classList.add('pop');
  }
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5;
      fx.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, life: 300 + Math.random() * 250, color });
    }
  }
  function addFloat(x, y, text, color, big) {
    fx.floats.push({ x: x + (Math.random() - 0.5) * 30, y, text, color, big, life: 900 });
  }
  function shuffle(arr) { return arr.slice().sort(() => Math.random() - 0.5); }
  /* 받침 유무 조사: josa('재생','은')→'은', josa('처형','이')→'이' */
  function josa(word, kind) {
    const code = word.charCodeAt(word.length - 1) - 0xac00;
    const jong = code >= 0 && code <= 11171 && code % 28 !== 0;
    return { '이': jong ? '이' : '가', '은': jong ? '은' : '는', '을': jong ? '을' : '를' }[kind];
  }

  /* ── 렌더링 (결투 절차 실루엣 계승) ── */
  function draw() {
    ctx.clearRect(0, 0, W, H);
    const shx = fx.shake ? (Math.random() - 0.5) * fx.shake : 0;
    ctx.save();
    ctx.translate(shx, fx.shake ? (Math.random() - 0.5) * fx.shake * 0.5 : 0);

    const g = ctx.createRadialGradient(W / 2, H * 0.4, 60, W / 2, H * 0.4, 520);
    g.addColorStop(0, '#17171d'); g.addColorStop(1, '#0c0c10');
    ctx.fillStyle = g; ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.strokeStyle = '#26262f'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(40, GROUND + 24); ctx.lineTo(W - 40, GROUND + 24); ctx.stroke();

    if (B) { drawFighter(B.me); drawFighter(B.foe); }

    fx.trails.forEach(tr => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, tr.life / 160) * 0.5;
      ctx.strokeStyle = tr.color; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.shadowColor = tr.color; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.moveTo(tr.x1, tr.y1); ctx.lineTo(tr.x2, tr.y2); ctx.stroke();
      ctx.restore();
    });
    fx.particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / 500);
      ctx.strokeStyle = p.color; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2.4, p.y - p.vy * 2.4); ctx.stroke();
      ctx.restore();
    });
    fx.floats.forEach(f => {
      ctx.save();
      ctx.globalAlpha = Math.min(1, f.life / 500);
      ctx.fillStyle = f.color; ctx.textAlign = 'center';
      ctx.font = `900 ${f.big ? 26 : 17}px sans-serif`;
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    });
    ctx.restore();
  }

  function drawFighter(f) {
    const t = performance.now() * 0.003;
    let lean = 0.05, crouch = Math.sin(t + (f.dir > 0 ? 0 : 2)) * 3, swordA = 0.5, shiftX = 0, alpha = 1;
    const pt = f.poseT;
    if (f.pose === 'strike') { const p = Math.min(1, pt / 180); lean = 0.4; swordA = 1.0 - p * 1.3; shiftX = 55 * p * 1; crouch = 6; }
    if (f.pose === 'hurt') { lean = -0.35; swordA = -0.2; shiftX = -20; }
    if (f.pose === 'block') { lean = -0.1; swordA = 1.5; }
    if (f.pose === 'dodge') { lean = -0.25; shiftX = -40; alpha = 0.6; }
    if (f.pose === 'dead') { lean = -1.1; crouch = 46; swordA = -1.3; alpha = 0.5; }

    const bx = f.x + shiftX * f.dir;
    const hipY = GROUND - 56 + crouch;
    const shY = hipY - 64 + crouch * 0.35;
    const shX = bx + Math.sin(lean) * 44 * f.dir;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(bx, GROUND + 22, 42, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = f.color;
    ctx.lineWidth = 12;
    ctx.beginPath(); ctx.moveTo(bx - 13 * f.dir, GROUND + 16); ctx.lineTo(bx, hipY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx + 19 * f.dir, GROUND + 16); ctx.lineTo(bx, hipY); ctx.stroke();
    ctx.lineWidth = 14;
    ctx.beginPath(); ctx.moveTo(bx, hipY); ctx.lineTo(shX, shY); ctx.stroke();
    ctx.beginPath(); ctx.arc(shX + 4 * f.dir, shY - 17, 12, 0, Math.PI * 2);
    ctx.fillStyle = f.color; ctx.fill();
    if (f.eye) { ctx.fillStyle = f.eye; ctx.beginPath(); ctx.arc(shX + 9 * f.dir, shY - 19, 3, 0, Math.PI * 2); ctx.fill(); }
    const hx = shX + Math.cos(swordA) * 28 * f.dir, hy = shY + 6 - Math.sin(swordA) * 28;
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(shX, shY + 4); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.save();
    ctx.strokeStyle = f.glow; ctx.lineWidth = 4;
    ctx.shadowColor = f.glow; ctx.shadowBlur = 13;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(swordA) * 58 * f.dir, hy - Math.sin(swordA) * 58); ctx.stroke();
    ctx.restore();
    // 화염 상태
    if (f.burn > 0) { ctx.fillStyle = '#ff8a3d'; ctx.font = '900 15px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('🔥'.repeat(Math.min(3, f.burn)), bx, shY - 44); }
    ctx.restore();
  }

  /* ── 사운드 (WebAudio 합성) ── */
  const sfx = (() => {
    let ac = null;
    const ready = () => {
      if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (A) ac = new A(); }
      if (ac && ac.state === 'suspended') ac.resume();
      return ac;
    };
    const tone = (f, { type = 'sine', dur = 0.15, peak = 0.15, slide, delay = 0 } = {}) => {
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
    const noise = ({ dur = 0.15, peak = 0.2, hp = 0, lp = 8000 } = {}) => {
      const c = ready(); if (!c) return;
      const t = c.currentTime;
      const n = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, n, c.sampleRate);
      const dta = buf.getChannelData(0);
      for (let i = 0; i < n; i++) dta[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = c.createBufferSource(); src.buffer = buf;
      let node = src;
      if (hp) { const fl = c.createBiquadFilter(); fl.type = 'highpass'; fl.frequency.value = hp; node.connect(fl); node = fl; }
      if (lp < 8000) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; node.connect(fl); node = fl; }
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      node.connect(g).connect(c.destination); src.start(t);
    };
    return {
      ready,
      draft: () => tone(420, { dur: 0.2, peak: 0.06, slide: 560 }),
      pick: () => { tone(660, { dur: 0.12, peak: 0.13 }); tone(990, { dur: 0.2, peak: 0.1, delay: 0.07 }); },
      battleStart: () => { tone(180, { type: 'sawtooth', dur: 0.4, peak: 0.1, slide: 120 }); noise({ dur: 0.3, peak: 0.1, lp: 1200 }); },
      swing: () => noise({ dur: 0.1, peak: 0.1, hp: 1100 }),
      hit: (crit) => { noise({ dur: 0.18, peak: crit ? 0.32 : 0.2, lp: 1100 }); tone(crit ? 90 : 140, { type: 'sawtooth', dur: 0.25, peak: crit ? 0.26 : 0.16, slide: 50 }); },
      clash: () => { noise({ dur: 0.1, peak: 0.24, hp: 2300 }); tone(1200, { type: 'square', dur: 0.08, peak: 0.09 }); },
      guard: () => tone(480, { type: 'square', dur: 0.07, peak: 0.08 }),
      miss: () => tone(300, { dur: 0.1, peak: 0.07, slide: 220 }),
      win: () => [0, 0.09, 0.18].forEach((d, i) => tone([523, 659, 880][i], { dur: 0.26, peak: 0.13, delay: d })),
      lose: () => [0, 0.14].forEach((d, i) => tone([310, 210][i], { type: 'triangle', dur: 0.5, peak: 0.14, delay: d })),
    };
  })();

  /* ── 루프·바인딩 ── */
  function loop(t) {
    const dt = Math.min(50, t - lastT);
    lastT = t;
    if (running && B) update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  function startRun() {
    newRun();
    ['ov-title', 'ov-runend', 'ov-result', 'ov-draft'].forEach(id => document.getElementById(id).classList.add('hidden'));
    sfx.ready();
    showDraft();
  }

  document.getElementById('btn-start').onclick = startRun;
  document.getElementById('btn-again').onclick = startRun;
  document.getElementById('btn-next').onclick = nextStep;

  // 디버그 훅 (백그라운드 탭 검증용 — 제출 전 제거)
  window.__arena = {
    state: () => ({ battleIdx: R ? R.battleIdx : null, skills: R ? R.skills : [], running,
      over: B ? B.over : null, meHP: B ? Math.round(B.me.hp * 10) / 10 : null, foeHP: B ? Math.round(B.foe.hp * 10) / 10 : null,
      procs: B ? { ...B.procs } : null, won: B ? B.won : null, wins: R ? R.wins : 0 }),
    startRun, tick: (ms) => { if (running && B) update(ms); }, draw,
    pickByIndex: (i) => { const c = document.querySelectorAll('#draft-row .skill-card')[i]; if (c) c.click(); },
    next: () => document.getElementById('btn-next').click(),
    draftOffer: () => [...document.querySelectorAll('#draft-row .skill-card .sk-name')].map(e => e.textContent),
    advice: () => document.getElementById('advice').textContent,
  };

  requestAnimationFrame(t => { lastT = t; loop(t); });
})();
