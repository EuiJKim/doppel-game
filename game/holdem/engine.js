/* 텍사스 홀덤 — 게임 엔진 (호스트 브라우저에서 돈다. 순수 로직, Node 테스트 가능)
 * 노리밋 홀덤: 개인 2장 + 공유 5장(플롭 3 · 턴 1 · 리버 1), 7장 중 최선 5장.
 * 블라인드(SB = BB/2) · 시작금은 설정 · 돈이 0이면 언제든 시작금으로 재참가.
 * 베팅: 체크 · 콜 · 벳/레이즈(금액 지정, 최소 = 직전 레이즈 폭) · 올인 · 폴드. 올인 사이드팟, 동점은 팟 분배.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'));
  else root.HoldemEngine = factory(root.HoldemRules);
})(typeof self !== 'undefined' ? self : this, function (R) {

  const START_CHIPS = 10000, BB = 100;
  const clampStart = v => { v = Math.floor(+v || 0); if (!v) return START_CHIPS; return Math.min(10000000, Math.max(1000, Math.round(v / 100) * 100)); };
  const clampBB = v => { v = Math.floor(+v || 0); if (!v) return BB; return Math.min(100000, Math.max(20, Math.round(v / 10) * 10)); };
  const newStats = () => ({ hands: 0, wins: 0, net: 0, won: 0, best: null, streak: 0, maxStreak: 0 });
  const DEFAULTS = { bb: BB, startChips: START_CHIPS, turnSec: 30, maxPlayers: 8 };
  const ACTION_LABEL = { check: '체크', call: '콜', bet: '벳', raise: '레이즈', allin: '올인', fold: '폴드' };
  const STREETS = ['프리플롭', '플롭', '턴', '리버'];
  const CHIP_UNIT = 10;

  class Game {
    constructor(settings, rng) {
      this.settings = { ...DEFAULTS, ...(settings || {}) };
      this.settings.startChips = clampStart(this.settings.startChips);
      this.settings.bb = clampBB(this.settings.bb);
      this.rng = rng || Math.random;
      this.players = [];          // {id,name,avatar,chips,seat,connected,rebuys,away,stats,bot}
      this.phase = 'lobby';       // lobby | betting | result
      this.hand = null;
      this.handNo = 0;
      this.log = [];
      this.loser = null;          // 직전 판에 가장 많이 잃은 사람 — 다음 판을 시작할 권한
      this.history = [];
      this.lastDealerSeat = null;
      this.version = 0;
      this.onChange = null;
    }

    /* ── 스냅샷(카드 제외) / 복원 — 방장 이전용 ── */
    snapshot(hostId) {
      const h = this.hand;
      return {
        v: 1, hostId, settings: this.settings, handNo: this.handNo, lastDealerSeat: this.lastDealerSeat, loser: this.loser,
        players: this.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, chips: p.chips, seat: p.seat, connected: p.connected, rebuys: p.rebuys, away: p.away, stats: p.stats, bot: !!p.bot })),
        refund: h && this.inProgress() ? { ...h.contrib } : null,
        history: this.history.slice(-30), log: this.log.slice(-40),
      };
    }
    static restore(snap, newHostId, rng) {
      const g = new Game(snap.settings, rng);
      g.players = (snap.players || []).map(p => ({ ...p, away: !!p.away, stats: p.stats || newStats(), connected: p.id === newHostId || !!p.bot }));
      g.handNo = snap.handNo || 0; g.lastDealerSeat = snap.lastDealerSeat ?? null; g.loser = snap.loser || null;
      g.history = snap.history || []; g.log = snap.log || [];
      g.phase = 'lobby';
      const oldHost = g.players.find(p => p.id === snap.hostId);
      const me = g.player(newHostId);
      g._log(`방장 연결 끊김 → ${me ? me.name : '?'}이(가) 방장을 이어받음`);
      if (snap.refund) {
        for (const id in snap.refund) { const p = g.player(id); if (p) p.chips += snap.refund[id]; }
        g._log('진행 중이던 판은 무효 — 넣은 돈을 돌려드렸어요');
      }
      if (oldHost) oldHost.connected = false;
      return g;
    }

    /* ── 유틸 ── */
    _touch() { this.version++; if (this.onChange) this.onChange(); }
    _log(text) { this.log.push({ t: Date.now(), text }); if (this.log.length > 80) this.log.shift(); }
    player(id) { return this.players.find(p => p.id === id); }
    seated() { return this.players.slice().sort((a, b) => a.seat - b.seat); }
    inProgress() { return this.phase === 'betting'; }
    sb() { return Math.max(CHIP_UNIT, Math.floor(this.settings.bb / 2 / CHIP_UNIT) * CHIP_UNIT); }
    updateSettings(patch) {
      if (this.inProgress()) return false;
      const s = { ...this.settings, ...patch };
      s.startChips = clampStart(s.startChips);
      s.bb = clampBB(s.bb);
      if (s.startChips !== this.settings.startChips && this.handNo === 0) for (const p of this.players) p.chips = s.startChips;
      s.turnSec = Math.min(180, Math.max(0, Math.floor(s.turnSec) || 0));
      s.maxPlayers = Math.min(9, Math.max(2, Math.floor(s.maxPlayers) || 8));
      this.settings = s;
      this._log(`설정 변경: 블라인드 ${this.sb()}/${s.bb} · 시작 돈 ${s.startChips.toLocaleString()} · 타이머 ${s.turnSec || '없음'}`);
      this._touch();
      return true;
    }

    /* ── 플레이어 ── */
    addPlayer(id, name, avatar, bot) {
      const existing = this.player(id);
      if (existing) { existing.connected = true; existing.name = name || existing.name; if (avatar) existing.avatar = avatar; this._log(`${existing.name} 재접속`); this._touch(); return existing; }
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
      [h.cards, h.contrib, h.bets].forEach(renObj);
      [h.folded, h.allin, h.acted, h.extended].forEach(renSet);
      for (const k of ['dealer', 'turn', 'sbId', 'bbId']) if (h[k] === oldId) h[k] = newId;
      const r = h.result;
      if (r) { ren(r.winners); ren(r.revealed); [r.hands, r.used, r.payouts].forEach(renObj); }
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
    setAway(id, away) {
      const p = this.player(id); if (!p) return false;
      away = !!away; if (p.away === away) return true;
      p.away = away; this._log(`${p.name} ${away ? '자리 비움' : '돌아옴'}`); this._touch(); return true;
    }
    extendTurn(id) {
      const h = this.hand; if (!h || !this.settings.turnSec) return false;
      if (h.extended.has(id)) return false;
      if (this.phase === 'betting' && h.turn === id) h.turnAt += 15000; else return false;
      h.extended.add(id); this._log(`${this.player(id).name}: +15초`); this._touch(); return true;
    }
    canExtend(id) { const h = this.hand; return !!(h && this.settings.turnSec && !h.extended.has(id) && this.phase === 'betting' && h.turn === id); }
    canStart() { return !this.inProgress() && this.eligible().length >= 2; }
    /* 다음 판을 시작하는 사람: 진 사람(접속 중이면). 없으면 방장(null) */
    starter() { const p = this.loser && this.player(this.loser); return p && p.connected && !p.away ? p.id : null; }
    startBy(id) { if (this.starter() !== id) return false; return this.startHand(); }

    /* ── 판 시작: 딜러 버튼 이동 → 블라인드 → 2장씩 → 프리플롭 베팅 ── */
    startHand() {
      if (!this.canStart()) return false;
      const prev = this.hand;
      const participants = this.eligible().map(p => p.id);
      this.handNo++; this.loser = null;
      const order0 = this.seated().filter(p => participants.includes(p.id)).map(p => p.id);
      const prevSeat = prev ? (this.player(prev.dealer) ? this.player(prev.dealer).seat : -1) : (this.lastDealerSeat ?? -1);
      const seats = order0.map(id => this.player(id).seat);
      const dealer = order0[seats.findIndex(s => s > prevSeat)] ?? order0[0];
      this.lastDealerSeat = this.player(dealer).seat;
      const di = order0.indexOf(dealer);
      const order = order0.slice(di + 1).concat(order0.slice(0, di + 1));   // 딜러 왼쪽부터, 딜러가 마지막
      const hu = order.length === 2;
      const sbId = hu ? dealer : order[0], bbId = hu ? order[0] : order[1];

      const h = this.hand = {
        no: this.handNo, dealer, participants, order, sbId, bbId,
        deck: R.shuffle(this.rng), cards: {}, board: [], folded: new Set(), allin: new Set(),
        contrib: {}, pot: 0, street: 0, stageLabel: STREETS[0],
        bets: {}, curBet: 0, minRaise: this.settings.bb, acted: new Set(), turn: null, turnAt: 0,
        result: null, actions: [], extended: new Set(), runout: false,
      };
      for (const id of participants) { h.cards[id] = []; h.contrib[id] = 0; h.bets[id] = 0; }
      this.phase = 'betting';
      this._log(`${this.handNo}판 시작 (딜러 ${this.player(dealer).name} · 블라인드 ${this.sb()}/${this.settings.bb})`);
      this._post(sbId, this.sb(), '스몰 블라인드'); this._post(bbId, this.settings.bb, '빅 블라인드');
      h.curBet = Math.max(h.bets[sbId], h.bets[bbId]); h.minRaise = this.settings.bb;
      for (let k = 0; k < 2; k++) for (const id of order) h.cards[id].push(h.deck.pop());
      const first = hu ? order[1] : order[2 % order.length];
      if (!this._startBetting(first, true)) this._advance();
      this._touch();
      return true;
    }
    _post(id, amt, label) {
      const p = this.player(id); const h = this.hand;
      const pay = Math.min(amt, p.chips);
      p.chips -= pay; h.bets[id] += pay; h.contrib[id] += pay; h.pot += pay;
      if (p.chips === 0) h.allin.add(id);
      this._log(`${p.name}: ${label} ${pay}${p.chips === 0 ? ' (올인)' : ''}`);
    }

    _bettors() { const h = this.hand; return h.order.filter(id => !h.folded.has(id) && !h.allin.has(id)); }
    _live() { const h = this.hand; return h.order.filter(id => !h.folded.has(id)); }

    /* 베팅 라운드 시작. 베팅이 성립하지 않으면(칩 있는 사람이 1명 이하이고 맞출 돈도 없음) false */
    _startBetting(firstId, keepBets) {
      const h = this.hand;
      if (!keepBets) { for (const id of h.order) h.bets[id] = 0; h.curBet = 0; h.minRaise = this.settings.bb; }
      h.acted = new Set();
      const bettors = this._bettors();
      const need = bettors.length >= 2 || bettors.some(id => h.bets[id] < h.curBet);
      if (!need) return false;
      const start = h.order.indexOf(firstId);
      for (let i = 0; i < h.order.length; i++) {
        const cand = h.order[(start + i) % h.order.length];
        if (bettors.includes(cand)) { h.turn = cand; h.turnAt = Date.now(); this.phase = 'betting'; return true; }
      }
      return false;
    }

    /* 다음 스트리트로 (플롭 3 → 턴 1 → 리버 1 → 쇼다운). 베팅할 사람이 없으면 보드를 끝까지 깐다 */
    _advance() {
      const h = this.hand;
      while (true) {
        if (this._live().length === 1) { this._finish(this._live(), true); return; }
        if (h.street >= 3) { h.turn = null; this._finish(this._live(), false); return; }
        h.street++;
        const n = h.street === 1 ? 3 : 1;
        for (let k = 0; k < n; k++) h.board.push(h.deck.pop());
        h.stageLabel = STREETS[h.street];
        this._log(`${STREETS[h.street]}: ${h.board.slice(-n).map(c => R.cardById(c).name).join(' ')}`);
        if (this._startBetting(h.order[0], false)) return;
        h.runout = true;   // 더 이상 베팅이 없다 — 보드를 끝까지
      }
    }

    /* 현재 턴 플레이어가 할 수 있는 행동 */
    actionsFor(id) {
      const h = this.hand;
      if (!h || this.phase !== 'betting' || h.turn !== id) return [];
      const p = this.player(id);
      const callAmt = h.curBet - h.bets[id];
      const list = [];
      if (callAmt <= 0) list.push({ type: 'check', label: '체크', amount: 0 });
      else list.push({ type: 'call', label: '콜', amount: Math.min(callAmt, p.chips) });
      const others = this._bettors().filter(x => x !== id);
      const maxTo = h.bets[id] + p.chips;
      if (p.chips > callAmt && others.length) {
        const kind = h.curBet === 0 ? 'bet' : 'raise';
        const minTo = h.curBet === 0 ? Math.min(this.settings.bb, maxTo) : Math.min(h.curBet + h.minRaise, maxTo);
        if (maxTo > minTo) {
          const pot = h.pot + callAmt;
          const presets = [
            { key: 'min', label: '최소', to: minTo },
            { key: 'third', label: '⅓팟', to: h.curBet + Math.floor(pot / 3 / CHIP_UNIT) * CHIP_UNIT },
            { key: 'half', label: '½팟', to: h.curBet + Math.floor(pot / 2 / CHIP_UNIT) * CHIP_UNIT },
            { key: 'pot', label: '팟', to: h.curBet + pot },
            { key: 'x2', label: '2배', to: h.curBet * 2 },
          ].map(x => ({ ...x, to: Math.max(minTo, Math.min(maxTo, x.to)) }));
          list.push({ type: kind, label: ACTION_LABEL[kind], amount: minTo - h.bets[id], to: minTo, min: minTo, max: maxTo, presets, step: CHIP_UNIT });
        }
        list.push({ type: 'allin', label: '올인', amount: p.chips, to: maxTo });
      } else if (p.chips > 0 && p.chips <= callAmt) {
        /* 콜하면 올인 — 콜 항목이 곧 올인 */
      }
      list.push({ type: 'fold', label: '폴드', amount: 0 });
      return list;
    }

    act(id, type, to) {
      const opts = this.actionsFor(id);
      const a = opts.find(o => o.type === type);
      if (!a) return { ok: false, error: '지금 할 수 없는 행동' };
      const h = this.hand; const p = this.player(id);
      let label = a.label, pay = 0;
      if (type === 'fold') { this._fold(id); }
      else if (type === 'check') { }
      else {
        let target;
        if (type === 'call') target = h.bets[id] + a.amount;
        else if (type === 'allin') target = a.to;
        else {
          to = Math.floor(+to || a.min);
          if (to >= a.max) to = a.max; else { to = Math.round(to / CHIP_UNIT) * CHIP_UNIT; if (to < a.min) to = a.min; }
          target = to;
        }
        pay = Math.min(target - h.bets[id], p.chips);
        p.chips -= pay; h.bets[id] += pay; h.contrib[id] += pay; h.pot += pay;
        if (p.chips === 0) h.allin.add(id);
        if (h.bets[id] > h.curBet) {
          const inc = h.bets[id] - h.curBet;
          if (inc >= h.minRaise) { h.minRaise = inc; h.acted = new Set(); }   // 정식 레이즈면 모두 다시 행동
          h.curBet = h.bets[id];
          if (type === 'allin') label = '올인'; else label = (a.type === 'bet' ? '벳' : '레이즈');
        } else if (type === 'allin') label = '올인 콜';
        this._log(`${p.name}: ${label} ${h.bets[id]}${p.chips === 0 ? ' (올인)' : ''}`);
      }
      if (type === 'fold' || type === 'check') this._log(`${p.name}: ${label}`);
      h.acted.add(id);
      h.actions.push({ id, type: type === 'raise' || type === 'bet' ? a.type : type, label, amount: pay, to: h.bets[id], street: h.street });
      this._afterAction(id);
      this._touch();
      return { ok: true };
    }

    /* 타이머 만료: 체크 가능하면 체크, 아니면 폴드 */
    autoAct(id) {
      const opts = this.actionsFor(id);
      if (!opts.length) return;
      const t = opts.find(o => o.type === 'check') ? 'check' : 'fold';
      this._log(`${this.player(id).name}: 시간 초과 → 자동 ${ACTION_LABEL[t]}`);
      this.act(id, t);
    }

    _fold(id, silent) {
      const h = this.hand; h.folded.add(id);
      if (!silent) this._log(`${this.player(id).name}: 폴드`);
    }
    _afterFold(id) { if (this.phase === 'betting') this._afterAction(id); }

    _afterAction(actorId) {
      const h = this.hand;
      if (this.phase !== 'betting') return;
      const live = this._live();
      if (live.length === 1) { this._finish(live, true); return; }
      const bettors = this._bettors();
      const roundDone = bettors.every(id => h.acted.has(id) && h.bets[id] >= h.curBet);
      if (roundDone || bettors.length === 0) { h.turn = null; this._advance(); return; }
      const start = h.order.indexOf(actorId);
      for (let i = 1; i <= h.order.length; i++) {
        const cand = h.order[(start + i) % h.order.length];
        if (bettors.includes(cand) && !(h.acted.has(cand) && h.bets[cand] >= h.curBet)) { h.turn = cand; h.turnAt = Date.now(); return; }
      }
      h.turn = null; this._advance();
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
        this._log(`${this.player(w).name} 승리 — 모두 폴드 (+${h.pot}원)`);
      } else {
        const used = {}, entries = live.map(id => ({ id, cards: h.cards[id].concat(h.board) }));
        const r = R.resolve(entries);
        for (const id of live) used[id] = r.hands[id].cards;
        this._distribute(live, r, payouts);
        result = { winners: r.winners, hands: r.hands, used, payouts, revealed: live };
        const names = r.winners.map(id => `${this.player(id).name}(${r.hands[id].desc})`).join(', ');
        this._log(`${names} 승리${r.winners.length > 1 ? ' — 팟 분배' : ''}`);
      }
      h.result = result;
      /* 가장 많이 잃은 사람 = 다음 판 시작 권한. 동점이면 딜러 왼쪽부터 */
      { let worst = null, worstNet = 0; for (const id of h.order) { const net = (payouts[id] || 0) - h.contrib[id]; if (net < worstNet) { worstNet = net; worst = id; } } this.loser = worst; }
      for (const id of h.participants) {
        const p = this.player(id); if (!p) continue;
        const st = p.stats || (p.stats = newStats());
        st.hands++; st.net += (payouts[id] || 0) - h.contrib[id];
        if (result.winners.includes(id)) { st.wins++; st.streak++; st.maxStreak = Math.max(st.maxStreak, st.streak); st.won += payouts[id] || 0; }
        else st.streak = 0;
        const hd = result.hands && result.hands[id];
        if (hd && (!st.best || hd.score > st.best.score)) st.best = { name: hd.name, score: hd.score };
      }
      const top = result.winners.length && result.hands[result.winners[0]] ? result.hands[result.winners[0]].name : (byFold ? '모두 폴드' : '');
      this.history.push({ no: h.no, winners: result.winners.map(id => this.player(id) ? this.player(id).name : '?'), hand: top, pot: Object.values(h.contrib).reduce((a, b) => a + b, 0), net: Object.fromEntries(h.participants.map(id => [id, (payouts[id] || 0) - h.contrib[id]])) });
      if (this.history.length > 30) this.history.shift();
      for (const id in payouts) { const p = this.player(id); if (p) p.chips += payouts[id]; }
      h.pot = 0;
      this.phase = 'result';
    }

    /* 사이드팟: 기여액이 적은 올인 플레이어는 자기 몫까지만. 동점은 나눠 갖고 나머지 1원 단위는 딜러 왼쪽부터 */
    _distribute(live, r, payouts) {
      const h = this.hand;
      const remaining = {}; for (const id of h.participants) remaining[id] = h.contrib[id];
      let guard = 0;
      while (guard++ < 30) {
        const stakers = live.filter(id => remaining[id] > 0);
        if (!stakers.length) break;
        const level = Math.min(...stakers.map(id => remaining[id]));
        let pool = 0;
        for (const id of h.participants) { const take = Math.min(remaining[id], level); remaining[id] -= take; pool += take; }
        let top = -1; for (const id of stakers) top = Math.max(top, r.hands[id].score);
        const winners = stakers.filter(id => r.hands[id].score === top);
        const share = Math.floor(pool / winners.length);
        let rem = pool - share * winners.length;
        for (const id of h.order) if (winners.includes(id)) { payouts[id] += share + (rem > 0 ? 1 : 0); if (rem > 0) rem--; }
      }
      const left = Object.values(remaining).reduce((a, b) => a + b, 0);
      if (left > 0) payouts[r.winners[0]] += left;
    }

    /* ── 뷰 ── */
    view(forId) {
      const h = this.hand; const s = this.settings;
      const isResult = this.phase === 'result';
      const spectator = !!(h && !h.participants.includes(forId));   // 이번 판에 안 낀 사람은 관전자 → 모든 패가 보인다
      const players = this.seated().map(p => {
        const inHand = !!(h && h.participants.includes(p.id));
        const cards = h ? (h.cards[p.id] || []) : [];
        const show = inHand && (p.id === forId || spectator || (isResult && h.result.revealed.includes(p.id)));
        let handName = null, best = null, handDesc = null;
        if (show && cards.length === 2) {
          if (isResult && h.result.hands[p.id]) { const hd = h.result.hands[p.id]; best = hd.cards; handName = hd.name; handDesc = hd.desc; }
          else if (h.board.length >= 3) { const hd = R.evalBest(cards.concat(h.board)); best = hd.cards; handName = hd.name; handDesc = hd.desc; }
          else { handName = R.holeDesc(cards); handDesc = handName; }
        }
        return {
          id: p.id, name: p.name, avatar: p.avatar || '', chips: p.chips, seat: p.seat, connected: p.connected, rebuys: p.rebuys, bot: !!p.bot,
          inHand, folded: inHand && h.folded.has(p.id), allin: inHand && h.allin.has(p.id),
          bet: inHand ? h.bets[p.id] || 0 : 0, contrib: inHand ? h.contrib[p.id] : 0,
          cards: show ? cards : null, cardCount: cards.length, hand: handName, handDesc, best,
          isDealer: !!(h && h.dealer === p.id), isSB: !!(h && h.sbId === p.id), isBB: !!(h && h.bbId === p.id), isTurn: !!(h && h.turn === p.id),
          payout: isResult ? (h.result.payouts[p.id] || 0) : 0,
          canRebuy: this.canRebuy(p.id), away: !!p.away, stats: p.stats,
        };
      });
      const me = players.find(p => p.id === forId);
      return {
        v: this.version, phase: this.phase, settings: s, sb: this.sb(), handNo: this.handNo, me: forId,
        pot: h ? h.pot : 0, street: h ? h.street : 0, stageLabel: h ? h.stageLabel : '', curBet: h ? h.curBet : 0, minRaise: h ? h.minRaise : s.bb,
        board: h ? h.board.slice() : [], runout: !!(h && h.runout),
        turn: h ? h.turn : null, turnAt: h ? h.turnAt : 0,
        players, actions: this.actionsFor(forId),
        lastAction: h && h.actions.length ? { ...h.actions[h.actions.length - 1], n: h.actions.length } : null,
        canExtend: this.canExtend(forId), history: this.history.slice(-12),
        canStart: this.canStart(), starter: this.starter(), starterName: this.starter() ? this.player(this.starter()).name : null, spectating: spectator,
        result: isResult ? h.result : null,
        log: this.log.slice(-30),
      };
    }
  }

  return { Game, DEFAULTS, ACTION_LABEL, STREETS, clampStart, clampBB, CHIP_UNIT };
});
