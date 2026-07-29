/* 도플 — 사운드 (WebAudio 합성, 오디오 파일 0개)
 * 외부 에셋을 쓰지 않는 이유: 출처·라이선스 리스크 0 + 로딩 0 + 저장소 경량.
 * 전부 오실레이터/노이즈로 즉석 합성한다.
 */
const Sfx = (() => {

  const KEY = 'doppel_mute';
  let ctx = null;
  let muted = localStorage.getItem(KEY) === '1';

  /* 브라우저 정책상 첫 사용자 제스처에서만 오디오를 열 수 있다 */
  function ready() {
    if (muted) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function env(gain, t, a, d, peak) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  function tone({ freq, type = 'sine', dur = 0.18, peak = 0.18, slideTo = null, delay = 0 }) {
    const c = ready(); if (!c) return;
    const t = c.currentTime + delay;
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    env(g, t, 0.012, dur, peak);
    osc.connect(g).connect(c.destination);
    osc.start(t); osc.stop(t + dur + 0.06);
  }

  function noise({ dur = 0.35, peak = 0.35, lowpass = 1200, delay = 0 }) {
    const c = ready(); if (!c) return;
    const t = c.currentTime + delay;
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(lowpass, t);
    const g = c.createGain(); env(g, t, 0.008, dur, peak);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t);
  }

  const S = {
    /* 카드를 뽑는 순간 — 짧게 차오르는 긴장 */
    draw: () => tone({ freq: 220, slideTo: 420, type: 'triangle', dur: 0.16, peak: 0.10 }),
    /* 보석 획득 — 점수가 클수록 높은 음 */
    gem: (v) => {
      const base = { 1: 523, 2: 659, 3: 784 }[v] || 523;
      tone({ freq: base, type: 'sine', dur: 0.22, peak: 0.16 });
      tone({ freq: base * 2, type: 'sine', dur: 0.16, peak: 0.06, delay: 0.03 });
    },
    /* 폭탄 — 저음 충격 + 노이즈 */
    bomb: () => {
      noise({ dur: 0.5, peak: 0.38, lowpass: 900 });
      tone({ freq: 150, slideTo: 40, type: 'sawtooth', dur: 0.45, peak: 0.3 });
    },
    /* 점수 확정 — 안심되는 하강 2음 */
    bank: () => {
      tone({ freq: 660, type: 'sine', dur: 0.14, peak: 0.14 });
      tone({ freq: 440, type: 'sine', dur: 0.22, peak: 0.14, delay: 0.1 });
    },
    /* 분신이 예측을 걸 때 — 낮게 웅웅거리는 "생각" */
    call: () => tone({ freq: 300, slideTo: 250, type: 'sine', dur: 0.3, peak: 0.07 }),
    /* 예측 적중 — 서늘한 상승 2음 (이 게임의 시그니처) */
    hit: () => {
      tone({ freq: 880, type: 'sine', dur: 0.12, peak: 0.16 });
      tone({ freq: 1320, type: 'sine', dur: 0.3, peak: 0.13, delay: 0.08 });
    },
    miss: () => tone({ freq: 300, slideTo: 200, type: 'sine', dur: 0.2, peak: 0.09 }),
    /* 노트가 적힐 때 — 사각거리는 필기 */
    note: () => noise({ dur: 0.09, peak: 0.06, lowpass: 4200 }),
    /* 미니 거울전 진입 — 낮고 긴 예고음 */
    mirror: () => {
      tone({ freq: 180, type: 'sine', dur: 0.9, peak: 0.14 });
      tone({ freq: 269, type: 'sine', dur: 0.9, peak: 0.09, delay: 0.06 });
    },
    win: () => [0, 0.1, 0.2].forEach((d, i) => tone({ freq: [523, 659, 880][i], dur: 0.3, peak: 0.15, delay: d })),
    lose: () => [0, 0.12].forEach((d, i) => tone({ freq: [330, 247][i], type: 'triangle', dur: 0.4, peak: 0.14, delay: d })),
  };

  function play(name, arg) { if (muted) return; try { S[name] && S[name](arg); } catch (e) { /* 오디오 실패가 게임을 막지 않는다 */ } }
  function toggleMute() {
    muted = !muted;
    localStorage.setItem(KEY, muted ? '1' : '0');
    if (!muted) ready();
    return muted;
  }
  function isMuted() { return muted; }

  return { play, toggleMute, isMuted, ready };
})();
