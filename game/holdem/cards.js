/* 홀덤 — 트럼프 카드 렌더 (전부 SVG, 이미지 파일 0). viewBox 0 0 100 140 */
const HoldemCards = (() => {
  const RED = '#c62828', BLK = '#1a1a1a';
  const cache = {};
  const PIPS = {
    2: [[50, 30], [50, 110]],
    3: [[50, 30], [50, 70], [50, 110]],
    4: [[30, 30], [70, 30], [30, 110], [70, 110]],
    5: [[30, 30], [70, 30], [50, 70], [30, 110], [70, 110]],
    6: [[30, 30], [70, 30], [30, 70], [70, 70], [30, 110], [70, 110]],
    7: [[30, 30], [70, 30], [50, 50], [30, 70], [70, 70], [30, 110], [70, 110]],
    8: [[30, 30], [70, 30], [50, 50], [30, 70], [70, 70], [50, 90], [30, 110], [70, 110]],
    9: [[30, 30], [70, 30], [30, 57], [70, 57], [50, 70], [30, 83], [70, 83], [30, 110], [70, 110]],
    10: [[30, 30], [70, 30], [50, 45], [30, 57], [70, 57], [30, 83], [70, 83], [50, 95], [30, 110], [70, 110]],
  };
  const FACE_KO = { 11: 'J', 12: 'Q', 13: 'K' };
  function pip(sym, x, y, size, color, flip) {
    return `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" dominant-baseline="central" fill="${color}" ${flip ? `transform="rotate(180 ${x} ${y})"` : ''}>${sym}</text>`;
  }
  function face(c) {
    if (cache[c.id]) return cache[c.id];
    const color = c.red ? RED : BLK;
    let mid = '';
    if (c.r === 14) mid = pip(c.sym, 50, 72, 56, color);
    else if (c.r >= 11) {
      mid = `<rect x="22" y="30" width="56" height="80" rx="4" fill="${c.red ? '#fbe9e7' : '#eceff1'}" stroke="${color}" stroke-width="1.5"/>
        <text x="50" y="66" font-size="40" font-weight="800" text-anchor="middle" dominant-baseline="central" fill="${color}" font-family="Georgia, serif">${FACE_KO[c.r]}</text>
        ${pip(c.sym, 33, 40, 12, color)}${pip(c.sym, 67, 100, 12, color, true)}
        <text x="50" y="94" font-size="10" text-anchor="middle" fill="${color}" font-family="serif" letter-spacing="1">${c.r === 11 ? 'JACK' : c.r === 12 ? 'QUEEN' : 'KING'}</text>`;
    } else mid = PIPS[c.r].map(([x, y]) => pip(c.sym, x, y, c.r >= 9 ? 15 : 18, color, y > 70)).join('');
    const idx = (x, y, flip) => `<g ${flip ? `transform="rotate(180 ${x} ${y})"` : ''}>
      <text x="${x}" y="${y - 4}" font-size="${c.r === 10 ? 13 : 15}" font-weight="800" text-anchor="middle" fill="${color}" font-family="Arial, Helvetica, sans-serif">${c.rank}</text>
      <text x="${x}" y="${y + 11}" font-size="13" text-anchor="middle" fill="${color}">${c.sym}</text></g>`;
    const svg = `<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="98" height="138" rx="8" fill="#fff" stroke="#c9c9c9" stroke-width="1"/>
      ${idx(11, 16)}${idx(89, 124, true)}${mid}</svg>`;
    cache[c.id] = svg;
    return svg;
  }
  const BACK = `<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg">
    <defs><pattern id="hb" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#1c3f8f"/><rect width="5" height="5" fill="#2a56b8"/><rect x="5" y="5" width="5" height="5" fill="#2a56b8"/></pattern></defs>
    <rect x="1" y="1" width="98" height="138" rx="8" fill="#fff"/>
    <rect x="6" y="6" width="88" height="128" rx="5" fill="url(#hb)" stroke="#0f2a66" stroke-width="2"/>
    <rect x="12" y="12" width="76" height="116" rx="3" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>
    <circle cx="50" cy="70" r="16" fill="#0f2a66" stroke="#fff" stroke-width="1.5"/>
    <text x="50" y="70" font-size="14" font-weight="900" text-anchor="middle" dominant-baseline="central" fill="#ffd54f" font-family="Georgia, serif">♠</text>
  </svg>`;
  return { face, BACK };
})();
