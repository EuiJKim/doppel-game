/* 도플 — 분신의 얼굴
 * 이 게임에서 성장은 숫자가 아니라 "선명해짐"으로 보여야 한다.
 * 배운 게 없을 땐 흐릿한 실루엣, 나를 알수록 초점이 잡히고 눈이 열린다.
 * 외부 이미지 0 — 전부 인라인 SVG + CSS 변수.
 */
const Face = (() => {

  let seq = 0;

  /* 선명도 0~1
   * 버킷(정확한 상황 3회 이상)은 느리게 차므로 그것만 쓰면 초반에 얼굴이 멈춰 보인다.
   * 그래서 세 축을 섞는다: 지켜본 양(빠름) + 파악한 상황 수(느림) + 일치율(실력).
   */
  function clarityOf(summary) {
    // 제곱근 완화: 초반 몇 판에서 변화가 눈에 보여야 "자라고 있다"가 전달된다.
    // 완전히 또렷해지는 건 여전히 오래 걸린다 (성장의 끝은 멀게).
    const seen = Math.sqrt(Math.min(1, summary.choices / 25));
    const cov = Math.sqrt(Math.min(1, summary.bucketsLearned / summary.totalBuckets));
    const acc = (summary.matchRate || 0) / 100;
    return Math.max(0, Math.min(1, seen * 0.35 + cov * 0.35 + acc * 0.30));
  }

  /* 컨테이너에 얼굴을 심는다. size = px */
  function mount(el, size) {
    const id = 'f' + (++seq);
    el.innerHTML = `
<svg class="doppel-face-svg" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">
  <defs>
    <filter id="blur-${id}" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur class="face-blur" stdDeviation="5"/>
    </filter>
    <linearGradient id="grad-${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#9d90ff"/>
      <stop offset="100%" stop-color="#5a49d6"/>
    </linearGradient>
  </defs>

  <circle class="face-halo" cx="50" cy="50" r="46" fill="none" stroke="url(#grad-${id})" stroke-width="1.5" opacity="0.25"/>

  <g filter="url(#blur-${id})">
    <!-- 머리: 반달(◑) 모티프 — 왼쪽은 채워지고 오른쪽은 비어 있다 -->
    <circle class="face-head" cx="50" cy="50" r="34" fill="none" stroke="url(#grad-${id})" stroke-width="2.5"/>
    <path class="face-fill" d="M50 16 A34 34 0 0 0 50 84 Z" fill="url(#grad-${id})" opacity="0.9"/>
    <!-- 눈: 선명해질수록 열린다 -->
    <g class="face-eyes">
      <circle class="eye eye-l" cx="39" cy="45" r="3.4" fill="#0d0d12"/>
      <circle class="eye eye-r" cx="62" cy="45" r="3.4" fill="url(#grad-${id})"/>
    </g>
    <!-- 입: 마지막에 나타나는 미세한 선 (건방진 반쪽 미소) -->
    <path class="face-mouth" d="M40 63 Q50 69 61 61" fill="none" stroke="url(#grad-${id})" stroke-width="2" stroke-linecap="round"/>
  </g>
</svg>`;
    return el.querySelector('svg');
  }

  /* 선명도 적용 — 흐림·눈·입·후광이 함께 움직인다 */
  function apply(svg, clarity) {
    if (!svg) return;
    const c = Math.max(0, Math.min(1, clarity));
    svg.querySelector('.face-blur').setAttribute('stdDeviation', (5.5 * (1 - c)).toFixed(2));
    svg.style.setProperty('--face-op', (0.45 + 0.55 * c).toFixed(2));
    svg.querySelector('.face-eyes').style.opacity = clamp((c - 0.12) / 0.4);
    svg.querySelector('.face-mouth').style.opacity = clamp((c - 0.55) / 0.35);
    svg.querySelector('.face-halo').style.opacity = (0.15 + 0.45 * c).toFixed(2);
    svg.dataset.clarity = c.toFixed(2);
  }

  function clamp(v) { return Math.max(0, Math.min(1, v)).toFixed(2); }

  /* 말할 때 한 번 두근 — 관전석 얼굴이 살아 있다는 신호 */
  function speak(svg) {
    if (!svg) return;
    svg.classList.remove('face-speak');
    void svg.getBoundingClientRect();
    svg.classList.add('face-speak');
  }

  /* 예측 적중 — 눈이 번뜩인다 */
  function flash(svg, kind) {
    if (!svg) return;
    const cls = kind === 'hit' ? 'face-hit' : 'face-miss';
    svg.classList.remove('face-hit', 'face-miss');
    void svg.getBoundingClientRect();
    svg.classList.add(cls);
    setTimeout(() => svg.classList.remove(cls), 700);
  }

  return { mount, apply, speak, flash, clarityOf };
})();
