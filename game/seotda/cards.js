/* 섯다 — 화투 카드 SVG 렌더 (이미지 파일 0, 전부 코드로 그린다)
 * viewBox 0 0 100 160. 전통 화투 도안을 단순화한 벡터: 송학·매조·벚꽃·흑싸리·난초·모란·홍싸리·공산·국화·단풍
 */
const SeotdaCards = (() => {
  const INK = '#151515', RED = '#c8281e', CREAM = '#f4ecd8', GOLD = '#e6b422';

  /* ── 공통 부품 ── */
  const frame = (inner, bg) => `<svg viewBox="0 0 100 160" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <clipPath id="cf"><rect x="3" y="3" width="94" height="154" rx="7"/></clipPath>
      <radialGradient id="moon" cx="50%" cy="50%" r="50%"><stop offset="70%" stop-color="#fff8e1"/><stop offset="100%" stop-color="#f1e2a8"/></radialGradient>
      <linearGradient id="curtain" x1="0" x2="1"><stop offset="0" stop-color="#7b2a8c"/><stop offset=".5" stop-color="#b4409a"/><stop offset="1" stop-color="#7b2a8c"/></linearGradient>
    </defs>
    <rect x="1" y="1" width="98" height="158" rx="9" fill="${INK}"/>
    <rect x="3" y="3" width="94" height="154" rx="7" fill="${bg || CREAM}"/>
    <g clip-path="url(#cf)">${inner}</g>
    <rect x="3" y="3" width="94" height="154" rx="7" fill="none" stroke="${INK}" stroke-width="1.5"/>
  </svg>`;

  /* 띠(리본): kind = 'hong'(홍단) | 'cheong'(청단) | 'cho'(초단, 글씨 없음) */
  function ribbon(kind, x = 22, y = 30) {
    const fill = kind === 'cheong' ? '#2a4fa3' : RED;
    const text = kind === 'hong' ? '홍단' : kind === 'cheong' ? '청단' : '';
    return `<g transform="translate(${x} ${y})">
      <path d="M0 0 h56 q3 0 3 3 v18 q0 3 -3 3 h-56 q-3 0 -3 -3 v-18 q0 -3 3 -3z" fill="${fill}" stroke="${INK}" stroke-width="1.2" transform="rotate(-8)"/>
      <path d="M-3 18 q10 10 22 6 q14 -6 28 4 q6 5 12 3" fill="none" stroke="${INK}" stroke-width="0.9" opacity=".7" transform="rotate(-8)"/>
      ${text ? `<text x="28" y="16" font-size="11" font-weight="700" text-anchor="middle" fill="${kind === 'cheong' ? '#fff' : INK}" font-family="serif" transform="rotate(-8)">${text}</text>` : ''}
    </g>`;
  }

  /* 식물 ── 각 월의 배경 그림 */
  const pine = () => `
    <path d="M10 160 L18 60 L30 160z M30 160 L34 90 L46 160z" fill="#7a4a1e"/>
    ${[[20, 55, 22], [40, 70, 18], [12, 85, 16], [48, 100, 20], [26, 112, 18], [10, 128, 16], [50, 130, 14]].map(([x, y, r]) =>
      `<circle cx="${x}" cy="${y}" r="${r}" fill="#2e6b3a"/><circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${INK}" stroke-width="1" stroke-dasharray="1 2"/>`).join('')}`;
  const plum = () => `
    <path d="M8 155 Q30 110 70 100 Q85 95 92 70" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
    <path d="M40 118 Q50 95 45 80 M70 100 Q80 110 90 108" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>
    ${[[30, 128], [46, 100], [58, 108], [80, 92], [90, 70], [42, 82], [66, 118]].map(([x, y]) =>
      `<g transform="translate(${x} ${y})">${[0, 72, 144, 216, 288].map(a => `<circle cx="${(6 * Math.cos(a * Math.PI / 180)).toFixed(1)}" cy="${(6 * Math.sin(a * Math.PI / 180)).toFixed(1)}" r="4.2" fill="${RED}"/>`).join('')}<circle r="2.2" fill="${GOLD}"/></g>`).join('')}`;
  const cherry = () => `
    <path d="M5 40 Q40 60 60 30 M30 85 Q60 70 95 95 M10 120 Q50 100 90 140" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
    ${[[22, 45], [45, 42], [62, 55], [38, 70], [78, 78], [58, 92], [25, 100], [88, 120], [50, 118], [70, 135], [30, 140]].map(([x, y]) =>
      `<g transform="translate(${x} ${y})">${[0, 72, 144, 216, 288].map(a => `<ellipse cx="${(6 * Math.cos(a * Math.PI / 180)).toFixed(1)}" cy="${(6 * Math.sin(a * Math.PI / 180)).toFixed(1)}" rx="4.4" ry="3.4" transform="rotate(${a} ${(6 * Math.cos(a * Math.PI / 180)).toFixed(1)} ${(6 * Math.sin(a * Math.PI / 180)).toFixed(1)})" fill="#f1a0b8" stroke="${RED}" stroke-width=".6"/>`).join('')}<circle r="2" fill="${RED}"/></g>`).join('')}`;
  const wisteria = () => `
    <path d="M20 5 Q15 60 25 120 M50 5 Q45 70 55 130 M80 5 Q75 60 85 110" fill="none" stroke="${INK}" stroke-width="2"/>
    ${[[20, 30], [20, 55], [22, 80], [24, 105], [50, 40], [48, 70], [52, 100], [55, 125], [80, 25], [78, 55], [82, 85]].map(([x, y]) =>
      `<ellipse cx="${x}" cy="${y}" rx="9" ry="11" fill="#3b2a52"/><ellipse cx="${x - 2}" cy="${y - 2}" rx="4" ry="5" fill="#5a4278"/>`).join('')}`;
  const iris = () => `
    ${[[15, 150, 60], [30, 150, 40], [55, 150, 55], [75, 150, 70], [90, 150, 45]].map(([x, y, h]) => `<path d="M${x} ${y} Q${x + 6} ${y - h / 2} ${x + 2} ${y - h}" fill="none" stroke="#2f7a3a" stroke-width="4" stroke-linecap="round"/>`).join('')}
    ${[[22, 70], [58, 60], [86, 85]].map(([x, y]) => `<g transform="translate(${x} ${y})"><path d="M0 0 q-10 -12 -6 -22 q6 6 6 22z M0 0 q10 -12 6 -22 q-6 6 -6 22z M0 0 q-12 4 -14 12 q10 2 14 -12z M0 0 q12 4 14 12 q-10 2 -14 -12z" fill="#5b3fa0" stroke="#3a2670" stroke-width=".8"/><circle r="2.5" fill="${GOLD}"/></g>`).join('')}`;
  const peony = () => `
    <path d="M10 150 Q30 120 50 125 Q70 120 92 150" fill="#2f7a3a"/>
    <path d="M25 140 q-15 -10 -20 -25 q15 2 20 25z M75 140 q15 -10 20 -25 q-15 2 -20 25z" fill="#2f7a3a" stroke="${INK}" stroke-width=".8"/>
    <g transform="translate(50 85)">
      ${[0, 45, 90, 135, 180, 225, 270, 315].map(a => `<ellipse rx="13" ry="24" fill="#d22b2b" stroke="#8c1717" stroke-width=".8" transform="rotate(${a}) translate(0 -18)"/>`).join('')}
      ${[22, 67, 112, 157, 202, 247, 292, 337].map(a => `<ellipse rx="9" ry="16" fill="#ef4444" stroke="#8c1717" stroke-width=".6" transform="rotate(${a}) translate(0 -10)"/>`).join('')}
      <circle r="7" fill="${GOLD}"/>
    </g>`;
  const clover = () => `
    <path d="M10 150 Q20 90 45 60 M40 150 Q50 100 80 70 M70 150 Q80 110 95 95" fill="none" stroke="#7a3b1e" stroke-width="2.5"/>
    ${[[25, 100], [38, 78], [55, 65], [60, 110], [75, 88], [88, 76], [20, 128], [50, 132], [85, 120]].map(([x, y]) =>
      `<g transform="translate(${x} ${y})"><ellipse cx="-6" cy="-3" rx="5" ry="3.5" fill="#c0392b" transform="rotate(-30)"/><ellipse cx="6" cy="-3" rx="5" ry="3.5" fill="#c0392b" transform="rotate(30)"/><ellipse cy="4" rx="3.5" ry="5" fill="#c0392b"/></g>`).join('')}`;
  const susuki = (dark) => `
    <rect x="0" y="0" width="100" height="160" fill="${dark ? '#1f1f22' : CREAM}"/>
    <path d="M-5 95 Q50 70 105 95 L105 165 L-5 165z" fill="${RED}"/>
    <path d="M-5 100 Q50 78 105 100" fill="none" stroke="${INK}" stroke-width="1.2"/>`;
  const mum = () => `
    <path d="M30 155 Q40 120 50 110 M65 155 Q60 130 70 118" fill="none" stroke="#2f7a3a" stroke-width="3"/>
    ${[[35, 82, 18], [72, 95, 14], [50, 118, 12]].map(([x, y, r]) => `<g transform="translate(${x} ${y})">${Array.from({ length: 16 }, (_, i) => `<ellipse rx="3" ry="${r}" fill="${GOLD}" stroke="#b8860b" stroke-width=".5" transform="rotate(${i * 22.5}) translate(0 -${r * 0.55})"/>`).join('')}<circle r="${r * 0.35}" fill="#d29a00"/></g>`).join('')}`;
  const maple = () => `
    <path d="M8 150 Q30 110 60 100 M50 150 Q70 120 95 118" fill="none" stroke="#5a2e12" stroke-width="2.5"/>
    ${[[22, 60, '#d9372b'], [48, 45, '#e8642a'], [72, 62, '#d9372b'], [30, 95, '#e8642a'], [62, 88, '#c0281e'], [86, 100, '#e8642a'], [20, 130, '#d9372b'], [52, 128, '#e8642a'], [82, 138, '#c0281e']].map(([x, y, c]) =>
      `<path transform="translate(${x} ${y}) scale(1.1)" d="M0 -12 L3 -4 L11 -6 L6 1 L10 9 L2 6 L0 13 L-2 6 L-10 9 L-6 1 L-11 -6 L-3 -4z" fill="${c}" stroke="#6b1a12" stroke-width=".6"/>`).join('')}`;

  /* 포인트 ── 광·열끗의 상징물 */
  const sun = () => `<circle cx="72" cy="38" r="20" fill="${RED}"/>`;
  const crane = () => `
    <ellipse cx="62" cy="120" rx="22" ry="12" fill="#fff" stroke="${INK}" stroke-width="1.2"/>
    <path d="M78 116 Q92 100 84 84 Q80 78 76 84" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M76 84 L70 80 L80 78z" fill="${RED}"/><circle cx="78" cy="83" r="1.3" fill="${INK}"/>
    <path d="M44 122 Q30 128 22 138" fill="none" stroke="${INK}" stroke-width="3"/>
    <path d="M58 130 L56 150 M66 130 L70 150" stroke="${INK}" stroke-width="1.5"/>`;
  const warbler = () => `
    <ellipse cx="32" cy="62" rx="12" ry="8" fill="#8ab84a" stroke="${INK}" stroke-width="1"/>
    <circle cx="43" cy="58" r="5" fill="#8ab84a" stroke="${INK}" stroke-width="1"/><circle cx="45" cy="57" r="1" fill="${INK}"/>
    <path d="M48 58 l5 1 l-5 1z" fill="${GOLD}"/><path d="M22 60 l-8 -4 l3 6 l-4 3z" fill="#5f8a2e"/>`;
  const curtain = () => `
    <rect x="18" y="70" width="66" height="60" rx="3" fill="url(#curtain)" stroke="${INK}" stroke-width="1.2"/>
    ${[26, 38, 50, 62, 74].map(x => `<line x1="${x}" y1="70" x2="${x}" y2="130" stroke="${INK}" stroke-width=".8" opacity=".5"/>`).join('')}
    <path d="M18 70 q33 -14 66 0" fill="${RED}" stroke="${INK}" stroke-width="1"/>`;
  const cuckoo = () => `
    <g transform="translate(55 45)"><path d="M-18 0 q18 -10 36 0 q-18 4 -36 0z" fill="${INK}"/><ellipse cx="4" cy="2" rx="9" ry="4" fill="${INK}"/><path d="M13 1 l6 -1 l-5 3z" fill="${GOLD}"/></g>
    <circle cx="78" cy="22" r="9" fill="url(#moon)" stroke="${INK}" stroke-width=".8"/>`;
  const bridge = () => `
    ${[[8, 100], [30, 110], [52, 100], [74, 110]].map(([x, y]) => `<rect x="${x}" y="${y}" width="28" height="9" fill="#8d5a2b" stroke="${INK}" stroke-width="1"/>`).join('')}
    <path d="M0 132 Q50 122 100 134 L100 160 L0 160z" fill="#5b8fd6" opacity=".55"/>`;
  const butterfly = () => `
    <g transform="translate(74 40)">
      <path d="M0 0 q-14 -16 -18 -2 q0 12 18 6z M0 0 q14 -16 18 -2 q0 12 -18 6z M0 4 q-12 2 -12 10 q8 4 12 -6z M0 4 q12 2 12 10 q-8 4 -12 -6z" fill="${GOLD}" stroke="${INK}" stroke-width="1"/>
      <ellipse rx="2" ry="8" cy="4" fill="${INK}"/><path d="M-1 -3 l-4 -6 M1 -3 l4 -6" stroke="${INK}" stroke-width="1"/>
    </g>`;
  const boar = () => `
    <g transform="translate(50 118)">
      <ellipse rx="30" ry="15" fill="#2b2b2b"/><ellipse cx="-30" cy="-2" rx="11" ry="9" fill="#2b2b2b"/>
      <path d="M-36 -12 l-4 -8 l8 4z M-22 -12 l0 -9 l6 6z" fill="#2b2b2b"/>
      <path d="M-40 2 l-5 -1 l5 3z" fill="#fff"/><circle cx="-30" cy="-4" r="1.4" fill="#fff"/>
      ${[-18, -6, 8, 20].map(x => `<rect x="${x}" y="12" width="5" height="10" fill="#2b2b2b"/>`).join('')}
      <path d="M-28 -10 q28 -14 56 0" fill="none" stroke="#6b4a2a" stroke-width="3"/>
    </g>`;
  const fullMoon = () => `<circle cx="50" cy="50" r="30" fill="url(#moon)"/>`;
  const geese = () => `
    ${[[30, 40], [52, 28], [74, 44]].map(([x, y]) => `<path d="M${x - 14} ${y} q14 -12 28 0 q-14 -4 -28 0z" fill="${INK}"/>`).join('')}`;
  const sakeCup = () => `
    <g transform="translate(58 118)">
      <path d="M-24 -8 h48 l-5 24 h-38z" fill="${RED}" stroke="${INK}" stroke-width="1.2"/>
      <ellipse rx="24" ry="5" cy="-8" fill="#f6d1c8" stroke="${INK}" stroke-width="1.2"/>
      <text y="14" font-size="13" text-anchor="middle" fill="#fff" font-family="serif" font-weight="700">壽</text>
    </g>`;
  const deer = () => `
    <g transform="translate(58 112)">
      <ellipse rx="22" ry="12" cy="6" fill="#a0672e" stroke="${INK}" stroke-width="1"/>
      <path d="M-18 0 q-10 -18 -4 -32 q6 2 8 8" fill="#a0672e" stroke="${INK}" stroke-width="1"/>
      <path d="M-22 -30 l-8 -12 M-22 -30 l0 -14 M-22 -30 l7 -12 M-14 -30 l6 -12" stroke="#5a2e12" stroke-width="2" stroke-linecap="round"/>
      <circle cx="-20" cy="-26" r="1.3" fill="${INK}"/>
      ${[-14, -4, 8, 16].map(x => `<rect x="${x}" y="14" width="4" height="14" fill="#7a4a1e"/>`).join('')}
      ${[[-4, 2], [6, -2], [12, 6]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="#fff"/>`).join('')}
    </g>`;

  /* ── 20장 조립 ── (m, k) → SVG */
  const ART = {
    '1광': () => frame(sun() + pine() + crane()),
    '1띠': () => frame(pine() + ribbon('hong', 30, 20)),
    '2열': () => frame(plum() + warbler()),
    '2띠': () => frame(plum() + ribbon('hong', 30, 18)),
    '3광': () => frame(cherry() + curtain()),
    '3띠': () => frame(cherry() + ribbon('hong', 28, 60)),
    '4열': () => frame(wisteria() + cuckoo()),
    '4띠': () => frame(wisteria() + ribbon('cho', 26, 120)),
    '5열': () => frame(iris() + bridge()),
    '5띠': () => frame(iris() + ribbon('cho', 26, 20)),
    '6열': () => frame(peony() + butterfly()),
    '6띠': () => frame(peony() + ribbon('cheong', 26, 22)),
    '7열': () => frame(clover() + boar()),
    '7띠': () => frame(clover() + ribbon('cho', 26, 28)),
    '8광': () => frame(susuki(true) + fullMoon()),
    '8열': () => frame(susuki(false) + geese()),
    '9열': () => frame(mum() + sakeCup()),
    '9띠': () => frame(mum() + ribbon('cheong', 26, 22)),
    '10열': () => frame(maple() + deer()),
    '10띠': () => frame(maple() + ribbon('cheong', 26, 22)),
  };

  const cache = {};
  function svg(card) {
    const key = `${card.m}${card.k}`;
    if (!cache[key]) cache[key] = ART[key] ? ART[key]() : frame('');
    return cache[key];
  }
  /* 뒷면: 전통 홍색 + 격자 무늬 */
  const BACK = `<svg viewBox="0 0 100 160" xmlns="http://www.w3.org/2000/svg">
    <defs><pattern id="bk" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#a51d1d"/><rect width="4" height="8" fill="#8f1616"/></pattern></defs>
    <rect x="1" y="1" width="98" height="158" rx="9" fill="#151515"/>
    <rect x="4" y="4" width="92" height="152" rx="7" fill="url(#bk)"/>
    <rect x="9" y="9" width="82" height="142" rx="5" fill="none" stroke="#e6b422" stroke-width="1.2" opacity=".8"/>
    <circle cx="50" cy="80" r="16" fill="none" stroke="#e6b422" stroke-width="1.2" opacity=".8"/>
    <text x="50" y="86" font-size="16" text-anchor="middle" fill="#e6b422" font-family="serif" font-weight="700" opacity=".9">花</text>
  </svg>`;

  return { svg, BACK };
})();
if (typeof module === 'object' && module.exports) module.exports = SeotdaCards;
