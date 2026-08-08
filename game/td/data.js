/* 회귀한 마왕은 나의 타워를 기억한다 — 카탈로그 (06-td-design.md §1~2)
 * 밸런스는 전부 여기서만 조정한다.
 */
const DATA = {
  START_GOLD: 110,
  LIVES: 10,
  WAVES: 10,
  /* 마왕의 웨이브 예산 — 하드캡. 6웨이브 이후 증가율 완화 (실플레이 피드백: 7부터 벽).
   * 강화 Lv3 도입 후 후반 화력이 올라 22로 재조정 (18은 도배 빌드도 무손실 통과) */
  budget: (n) => n <= 6 ? 46 + 28 * n : 214 + 22 * (n - 6),

  TOWERS: {
    arrow: { name: '화살탑', icon: '🏹', cost: 30, range: 120, cooldown: 550, dmg: 6, color: '#e8c256',
      desc: '빠른 연사. 철갑에 약하다' },
    cannon: { name: '대포탑', icon: '💣', cost: 45, range: 105, cooldown: 1600, dmg: 9, splash: 55, color: '#e2574f',
      desc: '스플래시. 물량을 갈아버린다' },
    mage: { name: '마법탑', icon: '❄', cost: 40, range: 100, cooldown: 900, dmg: 3, slow: 0.45, slowMs: 1400, magic: true, color: '#6cc4f0',
      desc: '감속 + 방어 무시. 망령에겐 무력' },
    sniper: { name: '저격탑', icon: '🎯', cost: 60, range: 210, cooldown: 2600, dmg: 34, color: '#b98cff',
      desc: '한방. 쥐떼에겐 낭비다' },
  },

  UNITS: {
    goblin: { name: '고블린', cost: 8, hp: 26, speed: 46, armor: 0, bounty: 6, r: 9, color: '#7da45a' },
    rat:    { name: '쥐떼',   cost: 5, hp: 9,  speed: 62, armor: 0, bounty: 2, r: 6, color: '#9a8f7a' },
    /* 사용자 인사이트: "한방 타워 앞의 방어 높고 체력 낮은 몹" — 한방은 오버킬 낭비, 연사는 방어에 막힘 */
    ironrat:{ name: '철갑 쥐떼', cost: 8, hp: 11, speed: 56, armor: 2, bounty: 3, r: 7, color: '#7a8ba0' },
    /* 체력 상향(34→40): 강화 Lv3 화살 시대에도 도배 압박 유지. 방어 5는 초반 과잔혹이라 4 유지 */
    beetle: { name: '철갑충', cost: 14, hp: 40, speed: 38, armor: 4, bounty: 9, r: 10, color: '#5d7a94' },
    wolf:   { name: '질풍 늑대', cost: 12, hp: 30, speed: 88, armor: 0, bounty: 8, r: 9, color: '#c9c9d4' },
    ogre:   { name: '오우거', cost: 25, hp: 130, speed: 26, armor: 1, bounty: 18, r: 14, color: '#a4653a', leak: 2 },
    wraith: { name: '망령',   cost: 18, hp: 58, speed: 50, armor: 0, slowImmune: true, bounty: 12, r: 10, color: '#8f7ad6' },
    /* 웨이브 10 전용 — 마왕 본체. boss는 일반 편성 풀에서 제외되고, 비용은 웨이브 10 예산에서 차감(공정한 권한 유지) */
    demonking: { name: '마왕', cost: 120, hp: 420, speed: 28, armor: 3, bounty: 50, r: 17, color: '#c04a6e', boss: true, leak: 5 },
  },

  /* 상성표 — 마왕 디렉터의 뇌 (타워 타입 → 주력/차선 카운터 유닛) */
  COUNTER: {
    arrow: ['beetle', 'ironrat'],   // 연사 → 철갑 (방어가 잔딜을 먹는다)
    cannon: ['wolf', 'ogre'],       // 스플래시 → 산개 고속 단일 / 뭉칠 이유가 없는 한 덩어리
    mage: ['wraith', 'ogre'],       // 감속 → 면역 / 맷집
    sniper: ['ironrat', 'rat'],     // 한방 → 오버킬 낭비 물량
  },
};
