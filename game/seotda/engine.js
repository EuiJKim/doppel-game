/* 섯다 — 게임 엔진 (호스트 브라우저에서 돈다. 순수 로직, Node 테스트 가능)
 * 플레이어 관리 · 앤티 · 1장/2장 배분 · 베팅 라운드 2회 · 쇼다운 · 사이드팟 · 재경기.
 * 베팅 용어: 삥(앤티만큼) · 따당(현재 베팅의 2배) · 쿼터(팟 1/4) · 하프(팟 1/2) · 콜 · 체크 · 다이
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'));
  else root.SeotdaEngine = factory(root.SeotdaRules);
})(typeof self !== 'undefined' ? self : this, function (R) {

  const DEFAULTS = { ante: 100, startChips: 10000, special: true, maxRaises: 3, turnSec: 30, maxPlayers: 6 };
  const ACTION_LABEL = { check: '체크', call: '콜', ping: '삥', ddadang: '따당', quarter: '쿼터', half: '하프', die: '다이' };

  class Game {
    constructor(settings, rng) {
      this.settings = { ...DEFAULTS, ...(settings || {}) };
      this.rng = rng || Math.random;
      this.players = [];          // {id,name,chips,seat,connected,rebuys}
      this.phase = 'lobby';       // lobby | betting | result
      this.hand = null;
      this.handNo = 0;
      this.log = [];
      this.version = 0;
      this.onChange = null;
    }

    /* ── 유틸 ── */
    _touch() { this.version++; if (this.onChange) this.onChange(); }
    _log(text) { this.log.push({ t: Date.now(), text }); if (this.log.length > 80) this.log.shift(); }
    player(id) { return this.players.find(p => p.id === id); }
    seated() { return this.players.slice().sort((a, b) => a.seat - b.seat); }
    updateSettings(patch) {
      if (this.phase === 'betting') return false;
      const s = { ...this.settings, ...patch };
      s.ante = Math.max(10, Math.floor(s.ante) || 100);
      s.startChips = Math.max(s.ante * 5, Math.floor(s.startChips) || 10000);
      s.maxRaises = Math.min(10, Math.max(0, Math.floor(s.maxRaises)));
      s.turnSec = Math.min(180, Math.max(0, Math.floor(s.turnSec)));
      s.maxPlayers = Math.min(8, Math.max(2, Math.floor(s.maxPlayers)));
      this.settings = s;
      this._log(`설정 변경: 기본 ${s.ante} · 시작칩 ${s.startChips} · 특수족보 ${s.special ? 'ON' : 'OFF'} · 타이머 ${s.turnSec || '없음'}`);
      this._touch();
      return true;
    }

    /* ── 플레이어 ── */
    addPlayer(id, name) {
      const existing = this.player(id);
      if (existing) { existing.connected = true; existing.name = name || existing.name; this._log(`${existing.name} 재접속`); this._touch(); return existing; }
      const connected = this.players.filter(p => p.connected).length;
      if (connected >= this.settings.maxPlayers) return null;
      const used = new Set(this.players.map(p => p.seat));
      let seat = 0; while (used.has(seat)) seat++;
      const p = { id, name: (name || '익명').slice(0, 10), chips: this.settings.startChips, seat, connected: true, rebuys: 0 };
      this.players.push(p);
      this._log(`${p.name} 입장`);
      this._touch();
      return p;
    }
    disconnectPlayer(id) {
      const p = this.player(id); if (!p) return;
      p.connected = false;
      this._log(`${p.name} 접속 끊김`);
      if (this.hand && this.phase === 'betting' && this.hand.participants.includes(id) && !this.hand.folded.has(id)) {
        this._fold(id, true);
        this._afterAction(id);
      } else if (this.phase === 'lobby') {
        this.players = this.players.filter(x => x.id !== id);
      }
      this._touch();
    }
    removePlayer(id) {
      const p = this.player(id); if (!p) return;
      if (this.hand && this.phase === 'betting' && this.hand.participants.includes(id) && !this.hand.folded.has(id)) {
        this._fold(id, true);
        this.players = this.players.filter(x => x.id !== id);
        this._afterAction(id);
      } else {
        this.players = this.players.filter(x => x.id !== id);
      }
      this._log(`${p.name} 퇴장`);
      this._touch();
    }
    rebuy(id) {
      const p = this.player(id); if (!p || p.chips > 0) return false;
      if (this.hand && this.phase === 'betting' && this.hand.participants.includes(id)) return false;
      p.chips = this.settings.startChips; p.rebuys++;
      this._log(`${p.name} 리바이 (${p.rebuys}회)`);
      this._touch();
      return true;
    }
    /* 다음 판에 참가 가능한 사람 */
    eligible() { return this.seated().filter(p => p.connected && p.chips > 0); }
    canStart() { return this.phase !== 'betting' && this.eligible().length >= 2; }

    /* ── 판 시작 ── */
    startHand() {
      if (!this.canStart()) return false;
      const prev = this.hand;
      const redeal = prev && prev.result && prev.result.redeal;
      let participants;
      if (redeal) {
        participants = prev.participants.filter(id => !prev.folded.has(id) && this.player(id) && this.player(id).connected);
        if (participants.length < 2) participants = null;
      }
      const carry = redeal ? prev.pot : 0;
      if (!participants) participants = this.eligible().map(p => p.id);

      this.handNo++;
      /* 딜러 순환: 이전 딜러 다음 자리 */
      const order = this.seated().filter(p => participants.includes(p.id)).map(p => p.id);
      let dealer;
      if (redeal && prev && order.includes(prev.dealer)) dealer = prev.dealer;
      else {
        const prevSeat = prev ? (this.player(prev.dealer) ? this.player(prev.dealer).seat : -1) : -1;
        const seats = order.map(id => this.player(id).seat);
        dealer = order[seats.findIndex(s => s > prevSeat)] ?? order[0];
      }
      const di = order.indexOf(dealer);
      const turnOrder = order.slice(di + 1).concat(order.slice(0, di + 1)); // 딜러 다음부터, 딜러가 마지막

      const h = this.hand = {
        no: this.handNo, dealer, participants, order: turnOrder,
        deck: R.shuffle(this.rng), cards: {}, folded: new Set(), allin: new Set(),
        contrib: {}, pot: carry, carry, round: 0,
        bets: {}, curBet: 0, acted: new Set(), raises: 0, turn: null, turnAt: 0,
        result: null, actions: [],
      };
      for (const id of participants) { h.cards[id] = []; h.contrib[id] = 0; if (this.player(id).chips === 0) h.allin.add(id); }
      this.phase = 'betting';
      this._log(redeal ? `${this.handNo}판 재경기 — 이월 ${carry}` : `${this.handNo}판 시작 (딜러 ${this.player(dealer).name})`);

      if (!redeal) {
        for (const id of participants) {
          const p = this.player(id);
          const a = Math.min(this.settings.ante, p.chips);
          p.chips -= a; h.contrib[id] += a; h.pot += a;
          if (p.chips === 0) h.allin.add(id);
        }
      }
      this._deal();
      this._startRound();
      this._touch();
      return true;
    }

    _deal() {
      const h = this.hand;
      for (const id of h.order) h.cards[id].push(h.deck.pop());
      h.round++;
      this._log(h.round === 1 ? '첫 장 배분' : '두 번째 장 배분');
    }

    _bettors() { const h = this.hand; return h.order.filter(id => !h.folded.has(id) && !h.allin.has(id)); }
    _live() { const h = this.hand; return h.order.filter(id => !h.folded.has(id)); }

    _startRound() {
      const h = this.hand;
      h.bets = {}; h.curBet = 0; h.acted = new Set(); h.raises = 0;
      for (const id of h.order) h.bets[id] = 0;
      const bettors = this._bettors();
      if (bettors.length <= 1) { this._advanceStage(); return; }
      h.turn = bettors[0]; h.turnAt = Date.now();
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
        const raiseTo = (to) => Math.min(to, h.bets[id] + p.chips); // 칩 한도(올인)
        const add = (type, to) => {
          const target = raiseTo(to);
          if (target <= h.curBet) return; // 칩이 모자라 레이즈가 안 되면 생략(콜 올인으로)
          list.push({ type, label: ACTION_LABEL[type], amount: target - h.bets[id], to: target });
        };
        if (h.curBet === 0) add('ping', s.ante); else add('ddadang', h.curBet * 2);
        add('quarter', h.curBet + Math.max(s.ante, Math.floor(potAfterCall / 4)));
        add('half', h.curBet + Math.max(s.ante, Math.floor(potAfterCall / 2)));
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
        const isAllin = p.chips === 0 ? ' (올인)' : '';
        this._log(`${p.name}: ${a.label}${pay ? ' ' + pay : ''}${isAllin}`);
      }
      h.acted.add(id);
      h.actions.push({ id, type, amount: a.amount, round: h.round });
      this._afterAction(id);
      this._touch();
      return { ok: true };
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

    _afterAction(actorId) {
      const h = this.hand;
      if (this.phase !== 'betting') return;
      const live = this._live();
      if (live.length === 1) { this._finish(live, true); return; }
      const bettors = this._bettors();
      const roundDone = bettors.every(id => h.acted.has(id) && h.bets[id] === h.curBet);
      if (roundDone || bettors.length === 0) { this._advanceStage(); return; }
      /* 다음 턴: 행동한 사람 다음 순서의 베터 */
      const start = h.order.indexOf(actorId);
      for (let i = 1; i <= h.order.length; i++) {
        const cand = h.order[(start + i) % h.order.length];
        if (bettors.includes(cand) && !(h.acted.has(cand) && h.bets[cand] === h.curBet)) { h.turn = cand; h.turnAt = Date.now(); return; }
      }
      this._advanceStage();
    }

    _advanceStage() {
      const h = this.hand;
      if (h.round === 1) { this._deal(); this._startRound(); }
      else { h.turn = null; this._finish(this._live(), false); }
    }

    /* ── 정산 ── */
    _finish(live, byFold) {
      const h = this.hand; h.turn = null;
      const payouts = {}; for (const id of h.participants) payouts[id] = 0;
      let result;
      if (byFold) {
        const w = live[0];
        payouts[w] = h.pot;
        result = { byFold: true, winners: [w], hands: {}, payouts, revealed: [] };
        this._log(`${this.player(w).name} 승리 — 모두 다이 (+${h.pot})`);
      } else {
        const entries = live.map(id => ({ id, cards: h.cards[id] }));
        const r = R.resolve(entries, { special: this.settings.special });
        if (r.redeal) {
          result = { redeal: true, reason: r.reason, by: r.by, winners: [], hands: r.hands, payouts, revealed: live };
          this._log(`${this.player(r.by).name}의 ${r.reason} — 재경기! (팟 ${h.pot} 이월)`);
        } else {
          this._distribute(live, r, payouts);
          result = { winners: r.winners, hands: r.hands, payouts, revealed: live, caught: r.caught, catcher: r.catcher };
          const names = r.winners.map(id => `${this.player(id).name}(${r.hands[id].name})`).join(', ');
          this._log(`${names} 승리${r.catcher ? ` — ${r.catcher}!` : ''}`);
        }
      }
      h.result = result;
      for (const id in payouts) { const p = this.player(id); if (p) p.chips += payouts[id]; }
      h.pot = result.redeal ? h.pot : 0;
      this.phase = 'result';
    }

    /* 사이드팟: 기여액이 적은 올인 플레이어는 자기 몫까지만 가져간다 */
    _distribute(live, r, payouts) {
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
        const sub = stakers.length === live.length ? r : R.resolve(stakers.map(id => ({ id, cards: h.cards[id] })), { special: this.settings.special, noRedeal: true });
        const winners = sub.winners.length ? sub.winners : stakers;
        const share = Math.floor(pool / winners.length);
        let rem = pool - share * winners.length;
        for (const id of h.order) if (winners.includes(id)) { payouts[id] += share + (rem > 0 ? 1 : 0); if (rem > 0) rem--; }
      }
      /* 남은 잔여(폴드한 사람의 초과 기여 등)는 메인 승자에게 */
      const left = Object.values(remaining).reduce((a, b) => a + b, 0) + carry;
      if (left > 0) payouts[r.winners[0]] += left;
    }

    /* ── 뷰 ── */
    view(forId) {
      const h = this.hand; const s = this.settings;
      const isResult = this.phase === 'result';
      const players = this.seated().map(p => {
        const inHand = !!(h && h.participants.includes(p.id));
        const cards = h ? (h.cards[p.id] || []) : [];
        const show = inHand && (p.id === forId || (isResult && h.result.revealed.includes(p.id)));
        let handName = null;
        if (show && cards.length === 2) handName = R.evalHand(cards).name;
        else if (show && cards.length === 1) handName = R.describeOne(cards[0]);
        return {
          id: p.id, name: p.name, chips: p.chips, seat: p.seat, connected: p.connected, rebuys: p.rebuys,
          inHand, folded: inHand && h.folded.has(p.id), allin: inHand && h.allin.has(p.id),
          bet: inHand ? h.bets[p.id] || 0 : 0, contrib: inHand ? h.contrib[p.id] : 0,
          cards: show ? cards : null, cardCount: cards.length, hand: handName,
          isDealer: !!(h && h.dealer === p.id), isTurn: !!(h && h.turn === p.id),
          payout: isResult ? (h.result.payouts[p.id] || 0) : 0,
        };
      });
      return {
        v: this.version, phase: this.phase, settings: s, handNo: this.handNo, me: forId,
        pot: h ? h.pot : 0, round: h ? h.round : 0, curBet: h ? h.curBet : 0, raises: h ? h.raises : 0,
        turn: h ? h.turn : null, turnAt: h ? h.turnAt : 0,
        players, actions: this.actionsFor(forId),
        canStart: this.canStart(),
        result: isResult ? h.result : null,
        log: this.log.slice(-30),
      };
    }
  }

  return { Game, DEFAULTS, ACTION_LABEL };
});
