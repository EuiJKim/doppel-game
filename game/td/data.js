/* 회귀한 마왕은 나의 타워를 기억한다 — 카탈로그 (06-td-design.md §1~2)
 * 밸런스는 전부 여기서만 조정한다.
 */
const DATA = {
  START_GOLD: 110,
  LIVES: 10,
  WAVES: 10,
  budget: (n) => 40 + 22 * n,          // 마왕의 웨이브 예산 — 하드캡

  TOWERS: {
    arrow: { name: '화살탑', icon: '🏹', cost: 30, range: 120, cooldown: 550, dmg: 6, color: '#e8c256',
      desc: '빠른 연사. 철갑에 약하다' },
    cannon: { name: '대포탑', icon: '💣', cost: 45, range: 105, cooldown: 1600, dmg: 9, splash: 55, color: '#e2574f',
      desc: '스플래시. 물량을 갈아버린다' },
    mage: { name: '마법탑', icon: '❄', cost: 40, range: 100, cooldown: 900, dmg: 3, slow: 0.45, slowMs: 1400, magic: true, color: '#6cc4f0',
      desc: '감속 + 방어 무시. 망령에겐 무력' },
    sniper: { name: '저격탑', icon: '🎯', cost: 55, range: 210, cooldown: 2600, dmg: 34, color: '#b98cff',
      desc: '한방. 쥐떼에겐 낭비다' },
  },

  UNITS: {
    goblin: { name: '고블린', cost: 8, hp: 26, speed: 46, armor: 0, bounty: 6, r: 9, color: '#7da45a' },
    rat:    { name: '쥐떼',   cost: 5, hp: 9,  speed: 62, armor: 0, bounty: 2, r: 6, color: '#9a8f7a' },
    beetle: { name: '철갑충', cost: 14, hp: 34, speed: 30, armor: 3, bounty: 9, r: 10, color: '#5d7a94' },
    wolf:   { name: '질풍 늑대', cost: 12, hp: 30, speed: 88, armor: 0, bounty: 8, r: 9, color: '#c9c9d4' },
    ogre:   { name: '오우거', cost: 25, hp: 130, speed: 26, armor: 1, bounty: 18, r: 14, color: '#a4653a' },
    wraith: { name: '망령',   cost: 18, hp: 40, speed: 50, armor: 0, slowImmune: true, bounty: 12, r: 10, color: '#8f7ad6' },
  },

  /* 상성표 — 마왕 디렉터의 뇌 (타워 타입 → 주력 카운터 유닛) */
  COUNTER: {
    arrow: 'beetle',    // 연사 → 철갑
    cannon: 'wolf',     // 스플래시 → 빠른 단일 (산개)
    mage: 'wraith',     // 감속 → 면역
    sniper: 'rat',      // 한방 → 물량
  },
};
