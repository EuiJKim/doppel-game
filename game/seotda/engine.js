/* 섯다 — 게임 엔진 (호스트 브라우저에서 돈다. 순수 로직, Node 테스트 가능)
 * 모드 3종: 2장 섯다 · 3장 섯다(3장 중 2장 선택) · 홀덤 섯다(개인 2장 + 공유 3장, 최선 2장)
 * 판돈(앤티) 100원 고정 · 시작금은 설정(기본 10,000원, 1,000~10,000,000) · 돈이 0이면 언제든 시작금으로 재참가.
 * 베팅 용어: 삥(앤티만큼) · 따당(현재 베팅의 2배) · 쿼터(팟 1/4) · 하프(팟 1/2) · 콜 · 체크 · 다이
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'));
  else root.SeotdaEngine = factory(root.SeotdaRules);
})(typeof self !== 'undefined' ? self : this, function (R) {

  const ANTE = 100, START_CHIPS = 10000;
  const clampStart = v => { v = Math.floor(+v || 0); if (!v) return START_CHIPS; return Math.min(10000000, Math.max(1000, Math.round(v / 100) * 100)); };
  const newStats = () => ({ hands: 0, wins: 0, net: 0, won: 0, best: null, streak: 0, maxStreak: 0 });
  const DEFAULTS = { mode: '2', ante: ANTE, startChips: START_CHIPS, special: true, maxRaises: 3, turnSec: 30, maxPlayers: 6, loserPicks: true };
  const ACTION_LABEL = { check: '체크', call: '콜', ping: '삥', ddadang: '따당', quarter: '쿼터', half: '하프', allin: '올인', die: '다이' };
  /* 스테이지: deal:n(개인 카드 n장) · board:n(공유 카드 n장) · bet · choose(3장 중 2장) · show */
  const MODES = {
    '2': { label: '2장 섯다', stages: ['deal:1', 'bet', 'deal:1', 'bet', 'show'], perPlayer: 2, board: 0 },
    '3': { label: '3장 섯다', stages: ['deal:2', 'bet', 'deal:1', 'choose', 'bet', 'show'], perPlayer: 3, board: 0 },
    'holdem': { label: '홀덤 섯다', stages: ['deal:2', 'hide:1', 'bet', 'reveal', 'choose', 'bet', 'show'], perPlayer: 2, board: 1 },
  };

  class Game {
    constructor(settings, rng) {
      this.settings = { ...DEFAULTS, ...(settings || {}), ante: ANTE };
      this.settings.startChips = clampStart(this.settings.startChips);
      if (!MODES[this.settings.mode]) this.settings.mode = '2';
      this.rng = rng || Math.random;
      this.players = [];          // {id,name,chips,seat,connected,rebuys}
      this.phase = 'lobby';       // lobby | betting | choosing | result
      this.hand = null;
      this.handNo = 0;
      this.log = [];
      this.picker = null; this.picked = null;
      this.history = [];
      this.lastDealerSeat = null;
      this.version = 0;
      this.onChange = null;
    }

    /* ── 스냅샷(카드 제외) / 복원 — 방장 이전용 ──
     * 진행 중인 판이 있으면 그 판은 무효: 각자 넣은 돈을 돌려주고 다음 판부터 이어간다. */
    snapshot(hostId) {
      const h = this.hand;
      return {
        v: 1, hostId, settings: this.settings, handNo: this.handNo, lastDealerSeat: this.lastDealerSeat, picker: this.picker,
        players: this.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, chips: p.chips, seat: p.seat, connected: p.connected, rebuys: p.rebuys, away: p.away, stats: p.stats, bot: !!p.bot })),
        refund: h && this.inProgress() ? { ...h.contrib, __carry: h.carry } : null,
        carry: h && this.phase === 'result' && h.result && h.result.redeal ? h.pot : 0,
        history: this.history.slice(-30), log: this.log.slice(-40),
      };
    }
    static restore(snap, newHostId, rng) {
      const g = new Game(snap.settings, rng);
      g.players = (snap.players || []).map(p => ({ ...p, away: !!p.away, stats: p.stats || newStats(), connected: p.id === newHostId || !!p.bot }));   // 봇은 새 방장이 계속 돌린다
      g.handNo = snap.handNo || 0; g.lastDealerSeat = snap.lastDealerSeat ?? null; g.picker = snap.picker || null;
      g.history = snap.history || []; g.log = snap.log || [];
      g.phase = 'lobby';
      const oldHost = g.players.find(p => p.id === snap.hostId);
      const me = g.player(newHostId);
      g._log(`방장 연결 끊김 → ${me ? me.name : '?'}이(가) 방장을 이어받음`);
      if (snap.refund) {
        for (const id in snap.refund) { if (id === '__carry') continue; const p = g.player(id); if (p) p.chips += snap.refund[id]; }
        g.pendingCarry = snap.refund.__carry || 0;
        g._log('진행 중이던 판은 무효 — 넣은 돈을 돌려드렸어요');
      } else g.pendingCarry = snap.carry || 0;
      if (oldHost) oldHost.connected = false;
      return g;
    }

    /* ── 유틸 ── */
    _touch() { this.version++; if (this.onChange) this.onChange(); }
    _log(text) { this.log.push({ t: Date.now(), text }); if (this.log.length > 80) this.log.shift(); }
    player(id) { return this.players.find(p => p.id === id); }
    seated() { return this.players.slice().sort((a, b) => a.seat - b.seat); }
    inProgress() { return this.phase === 'betting' || this.phase === 'choosing'; }
    mode() { return MODES[this.settings.mode]; }
    updateSettings(patch) {
      /* 모드는 다음 판부터 적용되므로 판 중에도 바꿀 수 있다. 나머지는 판이 끝난 뒤에만 */
      const onlyMode = Object.keys(patch).every(k => k === 'mode');
      if (this.inProgress() && !onlyMode) return false;
      const s = { ...this.settings, ...patch };
      s.ante = ANTE;                                                   // 판돈은 고정
      s.startChips = clampStart(s.startChips);
      /* 시작금 변경: 아직 한 판도 안 했으면 모두의 돈을 새 시작금으로 맞춘다. 게임 중이면 새로 오는 사람·재참가부터 적용 */
      if (s.startChips !== this.settings.startChips && this.handNo === 0) for (const p of this.players) p.chips = s.startChips;
      if (!MODES[s.mode]) s.mode = this.settings.mode;
      s.maxRaises = Math.min(10, Math.max(0, Math.floor(s.maxRaises) || 0));
      s.turnSec = Math.min(180, Math.max(0, Math.floor(s.turnSec) || 0));
      s.maxPlayers = Math.min(8, Math.max(2, Math.floor(s.maxPlayers) || 6));
      s.loserPicks = s.loserPicks !== false;
      const modeChanged = s.mode !== this.settings.mode;
      this.settings = s;
      this._log(modeChanged ? `다음 판부터 ${MODES[s.mode].label}` : `설정 변경: 특수족보 ${s.special ? 'ON' : 'OFF'} · 레이즈 ${s.maxRaises}회 · 타이머 ${s.turnSec || '없음'}`);
      this._touch();
      return true;
    }

    /* ── 플레이어 ── */
    addPlayer(id, name, avatar, bot) {
      const existing = this.player(id);
      if (existing) { existing.connected = true; existing.name = name || existing.name; if (avatar) existing.avatar = avatar; this._log(`${existing.name} 재접속`); this._touch(); return existing; }
      /* 탭을 닫았다 다시 온 사람: 같은 닉네임의 끊긴 자리를 이어받는다 (현재 판에 살아있지 않을 때만) */
      const ghost = this.players.find(p => !p.connected && p.name === (name || '').slice(0, 10) && !this._inLiveHand(p.id));
      if (ghost) { this._renameId(ghost.id, id); ghost.connected = true; if (avatar) ghost.avatar = avatar; this._log(`${ghost.name} 재접속 (자리 이어받기)`); this._touch(); return ghost; }
      const connected = this.players.filter(p => p.connected).length;
      if (connected >= this.settings.maxPlayers) return null;
      const used = new Set(this.players.map(p => p.seat));
      let seat = 0; while (used.has(seat)) seat++;
      const p = { id, name: (name || '익명').slice(0, 10), avatar: String(avatar || '').slice(0, 12), chips: this.settings.startChips, seat, connected: true, rebuys: 0, away: false, stats: newStats(), bot: !!bot };
      this.players.push(p);
      this._log(`${p.name} ${bot ? '(봇) ' : ''}입장${this.handNo ? ' (다음 판부터 참가)' : ''}`);
      this._touch();
      return p;
    }
    _renameId(oldId, newId) {
      const p = this.player(oldId); if (!p) return; p.id = newId;
      const h = this.hand; if (!h) return;
      const ren = arr => { const i = arr.indexOf(oldId); if (i >= 0) arr[i] = newId; };
      const renObj = o => { if (o && Object.prototype.hasOwnProperty.call(o, oldId)) { o[newId] = o[oldId]; delete o[oldId]; } };
      const renSet = st => { if (st.has(oldId)) { st.delete(oldId); st.add(newId); } };
      ren(h.participants); ren(h.order);
      [h.cards, h.contrib, h.bets, h.chosen].forEach(renObj);
      [h.folded, h.allin, h.acted].forEach(renSet);
      if (h.dealer === oldId) h.dealer = newId;
      if (h.turn === oldId) h.turn = newId;
      const r = h.result;
      if (r) { ren(r.winners); ren(r.revealed); if (r.by === oldId) r.by = newId; if (r.caught) ren(r.caught); [r.hands, r.used, r.payouts].forEach(renObj); }
    }
    _inLiveHand(id) { const h = this.hand; return !!(h && this.inProgress() && h.participants.includes(id) && !h.folded.has(id)); }
    disconnectPlayer(id) {
      const p = this.player(id); if (!p) return;
      p.connected = false;
      this._log(`${p.name} 접속 끊김`);
      if (this._inLiveHand(id)) { this._fold(id, true); this._afterFold(id); }
      else if (this.phase === 'lobby') this.players = this.players.filter(x => x.id !== id);
      this._touch();
    }
    removePlayer(id) {
      const p = this.player(id); if (!p) return;
      const live = this._inLiveHand(id);
      if (live) this._fold(id, true);
      this.players = this.players.filter(x => x.id !== id);
      if (live) this._afterFold(id);
      this._log(`${p.name} 퇴장`);
      this._touch();
    }
    canRebuy(id) {
      const p = this.player(id);
      return !!(p && p.chips === 0 && !(this.hand && this.inProgress() && this.hand.participants.includes(id)));
    }
    rebuy(id) {
      if (!this.canRebuy(id)) return false;
      const p = this.player(id);
      p.chips = this.settings.startChips; p.rebuys++;
      this._log(`${p.name} ${this.settings.startChips.toLocaleString()}원으로 재참가 (${p.rebuys}회)`);
      this._touch();
      return true;
    }
    eligible() { return this.seated().filter(p => p.connected && p.chips > 0 && !p.away); }
    /* 자리 비움: 다음 판부터 빠진다(진행 중인 판은 그대로). 돌아오면 다음 판부터 참가 */
    setAway(id, away) {
      const p = this.player(id); if (!p) return false;
      away = !!away; if (p.away === away) return true;
      p.away = away; this._log(`${p.name} ${away ? '자리 비움' : '돌아옴'}`); this._touch(); return true;
    }
    /* 타이머 연장: 판마다 1인 1회, 내 차례(또는 선택 단계)에서 +15초 */
    extendTurn(id) {
      const h = this.hand; if (!h || !this.settings.turnSec) return false;
      if (h.extended.has(id)) return false;
      if (this.phase === 'betting' && h.turn === id) h.turnAt += 15000;
      else if (this.phase === 'choosing' && this._inLiveHand(id) && !h.chosen[id]) h.chooseAt += 15000;
      else return false;
      h.extended.add(id); this._log(`${this.player(id).name}: +15초`); this._touch(); return true;
    }
    /* 진 사람의 다음 게임 선택 */
    pickMode(id, mode) {
      if (!this.settings.loserPicks || this.picker !== id || this.inProgress() || !MODES[mode]) return false;
      if (this.settings.mode !== mode) { this.settings.mode = mode; this._log(`${this.player(id).name}(진 사람)이 다음 판을 ${MODES[mode].label}로 골랐어요`); }
      this.picker = null; this.picked = id;
      this._touch(); return true;
    }
    canExtend(id) { const h = this.hand; return !!(h && this.settings.turnSec && !h.extended.has(id) && ((this.phase === 'betting' && h.turn === id) || (this.phase === 'choosing' && this._inLiveHand(id) && !h.chosen[id]))); }
    canStart() { return !this.inProgress() && this.eligible().length >= 2; }

    /* ── 판 시작 ── */
    startHand() {
      if (!this.canStart()) return false;
      const prev = this.hand;
      const redeal = prev && prev.result && prev.result.redeal;
      let participants;
      if (redeal) {
        const base = prev.result.tied ? prev.result.tied : prev.participants.filter(id => !prev.folded.has(id));
        participants = base.filter(id => this.player(id) && this.player(id).connected && !this.player(id).away);
        if (participants.length < 2) participants = null;
      }
      const carry = redeal ? prev.pot : (this.pendingCarry || 0); this.pendingCarry = 0;
      if (!participants) participants = this.eligible().map(p => p.id);
      const mode = this.mode();

      this.handNo++;
      this.picker = null; this.picked = null;
      const order = this.seated().filter(p => participants.includes(p.id)).map(p => p.id);
      let dealer;
      if (redeal && prev && order.includes(prev.dealer)) dealer = prev.dealer;
      else {
        const prevSeat = prev ? (this.player(prev.dealer) ? this.player(prev.dealer).seat : -1) : (this.lastDealerSeat ?? -1);
        const seats = order.map(id => this.player(id).seat);
        dealer = order[seats.findIndex(s => s > prevSeat)] ?? order[0];
      }
      this.lastDealerSeat = this.player(dealer).seat;
      const di = order.indexOf(dealer);
      const turnOrder = order.slice(di + 1).concat(order.slice(0, di + 1));

      const h = this.hand = {
        no: this.handNo, mode: this.settings.mode, dealer, participants, order: turnOrder,
        deck: R.shuffle(this.rng), cards: {}, board: [], boardHidden: 0, folded: new Set(), allin: new Set(),
        contrib: {}, pot: carry, carry, street: 0, stageIdx: -1, stageLabel: '',
        bets: {}, curBet: 0, acted: new Set(), raises: 0, turn: null, turnAt: 0,
        chosen: {}, opened: {}, chooseAt: 0, result: null, actions: [], extended: new Set(),
      };
      for (const id of participants) { h.cards[id] = []; h.contrib[id] = 0; if (this.player(id).chips === 0) h.allin.add(id); }
      this.phase = 'betting';
      this._log(redeal ? `${this.handNo}판 재경기 (${mode.label}${prev.result.tied ? ' · 비긴 사람끼리' : ''}) — 이월 ${carry}원` : `${this.handNo}판 시작 · ${mode.label} (딜러 ${this.player(dealer).name})`);
      if (!redeal) {
        for (const id of participants) {
          const p = this.player(id);
          const a = Math.min(this.settings.ante, p.chips);
          p.chips -= a; h.contrib[id] += a; h.pot += a;
          if (p.chips === 0) h.allin.add(id);
        }
      }
      this._next();
      this._touch();
      return true;
    }

    _bettors() { const h = this.hand; return h.order.filter(id => !h.folded.has(id) && !h.allin.has(id)); }
    _live() { const h = this.hand; return h.order.filter(id => !h.folded.has(id)); }

    /* 다음 스테이지로. deal/board 는 즉시 처리하고 계속, bet/choose 는 입력 대기, show 는 정산 */
    _next() {
      const h = this.hand; const stages = MODES[h.mode].stages;
      while (true) {
        h.stageIdx++;
        const st = stages[h.stageIdx];
        if (!st) { this._finish(this._live(), false); return; }
        const [kind, nStr] = st.split(':'); const n = +nStr || 0;
        if (kind === 'deal') {
          for (let k = 0; k < n; k++) for (const id of h.order) h.cards[id].push(h.deck.pop());
          h.street++;
          const total = h.cards[h.order[0]].length;
          h.stageLabel = h.mode === '2' ? (total === 1 ? '첫 장' : '두 번째 장') : `${total}장`;
          this._log(h.mode === '2' ? (total === 1 ? '첫 장 배분' : '두 번째 장 배분') : `${n}장 배분 (${total}장째)`);
          continue;
        }
        if (kind === 'hide') {                       // 가운데 공유 카드를 뒤집어 깐다
          for (let k = 0; k < n; k++) h.board.push(h.deck.pop());
          h.boardHidden = h.board.length;
          h.stageLabel = '공유 카드 대기';
          this._log('가운데 공유 카드 1장 (뒤집힘)');
          continue;
        }
        if (kind === 'reveal') {                     // 공유 카드 공개
          h.boardHidden = 0; h.street++;
          h.stageLabel = '공유 카드 공개';
          this._log(`공유 카드 공개: ${R.describeOne(h.board[0])}`);
          continue;
        }
        if (kind === 'bet') {
          this.phase = 'betting';
          if (stages[h.stageIdx - 1] === 'choose') h.stageLabel = '마지막 베팅';
          h.bets = {}; h.curBet = 0; h.acted = new Set(); h.raises = 0;
          for (const id of h.order) h.bets[id] = 0;
          const bettors = this._bettors();
          if (bettors.length <= 1) continue;               // 베팅할 사람이 없으면 스킵
          h.turn = bettors[0]; h.turnAt = Date.now();
          return;
        }
        if (kind === 'choose') {
          const live = this._live();
          if (live.length <= 1) continue;
          this.phase = 'choosing'; h.turn = null; h.chosen = {}; h.chooseAt = Date.now();
          h.stageLabel = '2장 선택';
          this._log(h.mode === 'holdem' ? '내 2장 + 공유 1장 중 2장을 고르세요' : '3장 중 공개할 1장을 고르세요 (족보는 3장 중 최선 2장)');
          return;
        }
        if (kind === 'show') { h.turn = null; this._finish(this._live(), false); return; }
      }
    }

    /* 현재 턴 플레이어가 할 수 있는 행동 목록 */
    actionsFor(id) {
      const h = this.hand;
      if (!h || this.phase !== 'betting' || h.turn !== id) return [];
      const p = this.player(id); const s = this.settings;
      const callAmt = h.curBet - h.bets[id];
      const list = [];
      if (callAmt === 0) list.push({ type: 'check', label: '체크', amount: 0 });
      else list.push({ type: 'call', label: '콜', amount: Math.min(callAmt, p.chips) });
      const canRaise = h.raises < s.maxRaises && p.chips > callAmt;
      if (canRaise) {
        const potAfterCall = h.pot + callAmt;
        const raiseTo = (to) => Math.min(to, h.bets[id] + p.chips);
        const add = (type, to) => {
          const target = raiseTo(to);
          if (target <= h.curBet) return;
          list.push({ type, label: ACTION_LABEL[type], amount: target - h.bets[id], to: target });
        };
        if (h.curBet === 0) add('ping', s.ante); else add('ddadang', h.curBet * 2);
        add('quarter', h.curBet + Math.max(s.ante, Math.floor(potAfterCall / 4)));
        add('half', h.curBet + Math.max(s.ante, Math.floor(potAfterCall / 2)));
        /* 올인: 남은 돈 전부. 다른 레이즈가 칩 부족으로 같은 금액이 되면 그쪽을 빼고 올인만 남긴다 */
        const allTo = h.bets[id] + p.chips;
        for (let i = list.length - 1; i >= 0; i--) if (list[i].to === allTo) list.splice(i, 1);
        list.push({ type: 'allin', label: '올인', amount: p.chips, to: allTo });
      }
      list.push({ type: 'die', label: '다이', amount: 0 });
      return list;
    }

    act(id, type) {
      const opts = this.actionsFor(id);
      const a = opts.find(o => o.type === type);
      if (!a) return { ok: false, error: '지금 할 수 없는 행동' };
      const h = this.hand; const p = this.player(id);
      if (type === 'die') { this._fold(id); }
      else {
        const pay = Math.min(a.amount, p.chips);
        p.chips -= pay; h.bets[id] += pay; h.contrib[id] += pay; h.pot += pay;
        if (p.chips === 0) h.allin.add(id);
        if (h.bets[id] > h.curBet) { h.curBet = h.bets[id]; h.raises++; h.acted = new Set(); }
        this._log(`${p.name}: ${a.label}${pay ? ' ' + pay : ''}${p.chips === 0 ? ' (올인)' : ''}`);
      }
      h.acted.add(id);
      h.actions.push({ id, type, amount: a.amount, street: h.street });
      this._afterAction(id);
      this._touch();
      return { ok: true };
    }

    /* 3장 섯다: 3장 중 2장 선택 (idxs = 카드 인덱스 2개) */
    pool(id) { const h = this.hand; return h.mode === 'holdem' ? h.cards[id].concat(h.boardHidden ? [] : h.board) : h.cards[id]; }
    choose(id, idxs) {
      const h = this.hand;
      if (!h || this.phase !== 'choosing' || !this._inLiveHand(id)) return { ok: false, error: '지금은 고를 수 없어요' };
      if (h.chosen[id]) return { ok: false, error: '이미 골랐어요' };
      const cards = this.pool(id);
      if (!Array.isArray(idxs)) return { ok: false, error: '카드를 골라주세요' };
      if (h.mode === '3') {
        /* 3장 섯다: 공개할 1장을 고른다(모두에게 보임). 족보는 공개 카드 포함 3장 중 최선의 2장 */
        const oi = idxs.length === 1 ? idxs[0] : (idxs.length === 2 ? cards.findIndex((c, i) => i !== idxs[0] && i !== idxs[1]) : -1);
        if (!(oi >= 0 && oi < cards.length)) return { ok: false, error: '공개할 1장을 골라주세요' };
        h.opened[id] = cards[oi]; h.chosen[id] = R.bestPair(cards).cards;
        this._log(`${this.player(id).name}: ${R.describeOne(cards[oi])} 공개`);
      } else {
        if (idxs.length !== 2 || idxs[0] === idxs[1] || idxs.some(i => !(i >= 0 && i < cards.length))) return { ok: false, error: '2장을 골라주세요' };
        h.chosen[id] = [cards[idxs[0]], cards[idxs[1]]];
        this._log(`${this.player(id).name}: 2장 선택 완료`);
      }
      this._checkChooseDone();
      this._touch();
      return { ok: true };
    }
    /* 시간 초과: 아직 안 고른 사람은 최선의 2장으로 */
    autoChoose() {
      const h = this.hand; if (!h || this.phase !== 'choosing') return;
      for (const id of this._live()) if (!h.chosen[id]) {
        const pool = this.pool(id); h.chosen[id] = R.bestPair(pool).cards;
        if (h.mode === '3') h.opened[id] = pool.find(c => !h.chosen[id].includes(c));
        this._log(`${this.player(id).name}: 시간 초과 → 자동 선택`);
      }
      this._checkChooseDone();
      this._touch();
    }
    _checkChooseDone() {
      const h = this.hand;
      if (this._live().every(id => h.chosen[id])) this._next();
    }

    /* 타이머 만료 등 자동 행동: 체크 가능하면 체크, 아니면 다이 */
    autoAct(id) {
      const opts = this.actionsFor(id);
      if (!opts.length) return;
      const t = opts.find(o => o.type === 'check') ? 'check' : 'die';
      this._log(`${this.player(id).name}: 시간 초과 → 자동 ${ACTION_LABEL[t]}`);
      this.act(id, t);
    }

    _fold(id, silent) {
      const h = this.hand; h.folded.add(id);
      if (!silent) this._log(`${this.player(id).name}: 다이`);
    }
    _afterFold(id) {
      if (this.phase === 'choosing') {
        const live = this._live();
        if (live.length === 1) this._finish(live, true); else this._checkChooseDone();
      } else if (this.phase === 'betting') this._afterAction(id);
    }

    _afterAction(actorId) {
      const h = this.hand;
      if (this.phase !== 'betting') return;
      const live = this._live();
      if (live.length === 1) { this._finish(live, true); return; }
      const bettors = this._bettors();
      const roundDone = bettors.every(id => h.acted.has(id) && h.bets[id] === h.curBet);
      if (roundDone || bettors.length === 0) { this._next(); return; }
      const start = h.order.indexOf(actorId);
      for (let i = 1; i <= h.order.length; i++) {
        const cand = h.order[(start + i) % h.order.length];
        if (bettors.includes(cand) && !(h.acted.has(cand) && h.bets[cand] === h.curBet)) { h.turn = cand; h.turnAt = Date.now(); return; }
      }
      this._next();
    }

    /* 쇼다운에 쓰는 2장 */
    _handCards(id) {
      const h = this.hand;
      if (h.mode === '3' || h.mode === 'holdem') return h.chosen[id] || R.bestPair(this.pool(id)).cards;
      return h.cards[id];
    }

    /* ── 정산 ── */
    _finish(live, byFold) {
      const h = this.hand; h.turn = null;
      const payouts = {}; for (const id of h.participants) payouts[id] = 0;
      let result;
      if (byFold) {
        const w = live[0];
        payouts[w] = h.pot;
        result = { byFold: true, winners: [w], hands: {}, used: {}, payouts, revealed: [] };
        this._log(`${this.player(w).name} 승리 — 모두 다이 (+${h.pot}원)`);
      } else {
        const used = {}; for (const id of live) used[id] = this._handCards(id);
        const entries = live.map(id => ({ id, cards: used[id] }));
        const r = R.resolve(entries, { special: this.settings.special });
        if (r.redeal) {
          result = { redeal: true, reason: r.reason, by: r.by, tied: r.tied || null, winners: [], hands: r.hands, used, payouts, revealed: live };
          if (r.tied) this._log(`무승부 (${r.tied.map(id => this.player(id).name).join(' vs ')}, ${r.hands[r.tied[0]].name}) — 판돈 ${h.pot}원 묻고 다시!`);
          else this._log(`${this.player(r.by).name}의 ${r.reason} — 재경기! (팟 ${h.pot}원 이월)`);
        } else {
          this._distribute(live, used, r, payouts);
          result = { winners: r.winners, hands: r.hands, used, payouts, revealed: live, caught: r.caught, catcher: r.catcher };
          const names = r.winners.map(id => `${this.player(id).name}(${r.hands[id].name})`).join(', ');
          this._log(`${names} 승리${r.catcher ? ` — ${r.catcher}!` : ''}`);
        }
      }
      h.result = result;
      /* 진 사람(가장 많이 잃은 사람)이 다음 게임을 고른다. 동점이면 딜러 다음 순서가 먼저 */
      if (!result.redeal) {
        let worst = null, worstNet = 0;
        for (const id of h.order) { const net = (payouts[id] || 0) - h.contrib[id]; if (net < worstNet) { worstNet = net; worst = id; } }
        this.picker = worst;
      }
      /* 전적·기록 */
      for (const id of h.participants) {
        const p = this.player(id); if (!p) continue;
        const st = p.stats || (p.stats = newStats());
        st.hands++; st.net += (payouts[id] || 0) - h.contrib[id];
        if (result.winners.includes(id)) { st.wins++; st.streak++; st.maxStreak = Math.max(st.maxStreak, st.streak); st.won += payouts[id] || 0; }
        else st.streak = 0;
        const hd = result.hands && result.hands[id];
        if (hd && (!st.best || hd.score > st.best.score)) st.best = { name: hd.name, score: hd.score };
      }
      if (!result.redeal) {
        const top = result.winners.length && result.hands[result.winners[0]] ? result.hands[result.winners[0]].name : (byFold ? '모두 다이' : '');
        this.history.push({ no: h.no, mode: h.mode, winners: result.winners.map(id => this.player(id) ? this.player(id).name : '?'), hand: top, catcher: result.catcher || null, pot: Object.values(h.contrib).reduce((a, b) => a + b, 0) + h.carry, net: Object.fromEntries(h.participants.map(id => [id, (payouts[id] || 0) - h.contrib[id]])) });
        if (this.history.length > 30) this.history.shift();
      }
      for (const id in payouts) { const p = this.player(id); if (p) p.chips += payouts[id]; }
      h.pot = result.redeal ? h.pot : 0;
      this.phase = 'result';
    }

    /* 사이드팟: 기여액이 적은 올인 플레이어는 자기 몫까지만 가져간다 */
    _distribute(live, used, r, payouts) {
      const h = this.hand;
      const remaining = {}; for (const id of h.participants) remaining[id] = h.contrib[id];
      let carry = h.carry;
      let guard = 0;
      while (guard++ < 20) {
        const stakers = live.filter(id => remaining[id] > 0);
        if (!stakers.length) break;
        const level = Math.min(...stakers.map(id => remaining[id]));
        let pool = carry; carry = 0;
        for (const id of h.participants) { const take = Math.min(remaining[id], level); remaining[id] -= take; pool += take; }
        const sub = stakers.length === live.length ? r : R.resolve(stakers.map(id => ({ id, cards: used[id] })), { special: this.settings.special, noRedeal: true });
        const winners = sub.winners.length ? sub.winners : stakers;
        const share = Math.floor(pool / winners.length);
        let rem = pool - share * winners.length;
        for (const id of h.order) if (winners.includes(id)) { payouts[id] += share + (rem > 0 ? 1 : 0); if (rem > 0) rem--; }
      }
      const left = Object.values(remaining).reduce((a, b) => a + b, 0) + carry;
      if (left > 0) payouts[r.winners[0]] += left;
    }

    /* ── 뷰 ── */
    view(forId) {
      const h = this.hand; const s = this.settings;
      const isResult = this.phase === 'result';
      const spectator = !!(h && !h.participants.includes(forId));   // 이번 판에 안 낀 사람(대기·자리 비움·중간 입장)은 관전자 → 모든 패가 보인다
      const players = this.seated().map(p => {
        const inHand = !!(h && h.participants.includes(p.id));
        const cards = h ? (h.cards[p.id] || []) : [];
        const show = inHand && (p.id === forId || spectator || (isResult && h.result.revealed.includes(p.id)));
        let handName = null, best = null;
        if (show && cards.length) {
          const pool = this.pool(p.id);
          if (isResult && h.result.used[p.id]) { best = h.result.used[p.id]; handName = h.result.hands[p.id] ? h.result.hands[p.id].name : null; }
          else if (h.chosen[p.id]) { best = h.chosen[p.id]; handName = R.evalHand(best).name; }
          else if (pool.length >= 2) { const b = R.bestPair(pool); best = b.cards; handName = b.hand.name; }
          else handName = R.describeOne(cards[0]);
        }
        return {
          id: p.id, name: p.name, avatar: p.avatar || '', chips: p.chips, seat: p.seat, connected: p.connected, rebuys: p.rebuys, bot: !!p.bot,
          inHand, folded: inHand && h.folded.has(p.id), allin: inHand && h.allin.has(p.id),
          bet: inHand ? h.bets[p.id] || 0 : 0, contrib: inHand ? h.contrib[p.id] : 0,
          cards: show ? cards : null, cardCount: cards.length, hand: handName, best,
          chosen: !!(inHand && h.chosen[p.id]),
          open: inHand && h.opened && h.opened[p.id] != null ? h.opened[p.id] : null,     // 3장 섯다 공개 카드(모두에게 보임)
          isDealer: !!(h && h.dealer === p.id), isTurn: !!(h && h.turn === p.id),
          payout: isResult ? (h.result.payouts[p.id] || 0) : 0,
          canRebuy: this.canRebuy(p.id), away: !!p.away, stats: p.stats,
        };
      });
      const me = players.find(p => p.id === forId);
      return {
        v: this.version, phase: this.phase, settings: s, handNo: this.handNo, me: forId,
        mode: h ? h.mode : s.mode, modeLabel: MODES[h ? h.mode : s.mode].label, nextMode: s.mode, nextModeLabel: MODES[s.mode].label,
        pot: h ? h.pot : 0, street: h ? h.street : 0, stageLabel: h ? h.stageLabel : '', curBet: h ? h.curBet : 0, raises: h ? h.raises : 0,
        board: h ? h.board.map((c, i) => (i < h.boardHidden && !spectator ? null : c)) : [], boardMax: MODES[h ? h.mode : s.mode].board,
        spectating: spectator,
        pool: me && me.cards ? this.pool(forId) : null,
        turn: h ? h.turn : null, turnAt: h ? h.turnAt : 0, chooseAt: h ? h.chooseAt : 0,
        needChoose: !!(this.phase === 'choosing' && me && me.inHand && !me.folded && !me.chosen),
        players, actions: this.actionsFor(forId),
        lastAction: h && h.actions.length ? { ...h.actions[h.actions.length - 1], n: h.actions.length } : null,
        canExtend: this.canExtend(forId), history: this.history.slice(-12),
        picker: s.loserPicks ? this.picker : null, pickerName: s.loserPicks && this.picker && this.player(this.picker) ? this.player(this.picker).name : null, picked: this.picked,
        canStart: this.canStart(),
        result: isResult ? h.result : null,
        log: this.log.slice(-30),
      };
    }
  }

  return { Game, DEFAULTS, ACTION_LABEL, MODES, ANTE, START_CHIPS };
});
