/* 섯다 — 게임 엔진 (호스트 브라우저에서 돈다. 순수 로직, Node 테스트 가능)
 * 모드 3종: 2장 섯다 · 3장 섯다(3장 중 2장 선택) · 홀덤 섯다(개인 2장 + 공유 3장, 최선 2장)
 * 판돈(앤티) 100원 고정 · 시작금 10,000원 · 돈이 0이면 언제든 10,000원으로 재참가.
 * 베팅 용어: 삥(앤티만큼) · 따당(현재 베팅의 2배) · 쿼터(팟 1/4) · 하프(팟 1/2) · 콜 · 체크 · 다이
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'));
  else root.SeotdaEngine = factory(root.SeotdaRules);
})(typeof self !== 'undefined' ? self : this, function (R) {

  const ANTE = 100, START_CHIPS = 10000;
  const DEFAULTS = { mode: '2', ante: ANTE, startChips: START_CHIPS, special: true, maxRaises: 3, turnSec: 30, maxPlayers: 6 };
  const ACTION_LABEL = { check: '체크', call: '콜', ping: '삥', ddadang: '따당', quarter: '쿼터', half: '하프', die: '다이' };
  /* 스테이지: deal:n(개인 카드 n장) · board:n(공유 카드 n장) · bet · choose(3장 중 2장) · show */
  const MODES = {
    '2': { label: '2장 섯다', stages: ['deal:1', 'bet', 'deal:1', 'bet', 'show'], perPlayer: 2, board: 0 },
    '3': { label: '3장 섯다', stages: ['deal:2', 'bet', 'deal:1', 'choose', 'bet', 'show'], perPlayer: 3, board: 0 },
    'holdem': { label: '홀덤 섯다', stages: ['deal:2', 'bet', 'board:2', 'bet', 'board:1', 'bet', 'show'], perPlayer: 2, board: 3 },
  };

  class Game {
    constructor(settings, rng) {
      this.settings = { ...DEFAULTS, ...(settings || {}), ante: ANTE, startChips: START_CHIPS };
      if (!MODES[this.settings.mode]) this.settings.mode = '2';
      this.rng = rng || Math.random;
      this.players = [];          // {id,name,chips,seat,connected,rebuys}
      this.phase = 'lobby';       // lobby | betting | choosing | result
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
    inProgress() { return this.phase === 'betting' || this.phase === 'choosing'; }
    mode() { return MODES[this.settings.mode]; }
    updateSettings(patch) {
      if (this.inProgress()) return false;
      const s = { ...this.settings, ...patch };
      s.ante = ANTE; s.startChips = START_CHIPS;                       // 고정
      if (!MODES[s.mode]) s.mode = this.settings.mode;
      s.maxRaises = Math.min(10, Math.max(0, Math.floor(s.maxRaises) || 0));
      s.turnSec = Math.min(180, Math.max(0, Math.floor(s.turnSec) || 0));
      s.maxPlayers = Math.min(8, Math.max(2, Math.floor(s.maxPlayers) || 6));
      const modeChanged = s.mode !== this.settings.mode;
      this.settings = s;
      this._log(modeChanged ? `다음 판부터 ${MODES[s.mode].label}` : `설정 변경: 특수족보 ${s.special ? 'ON' : 'OFF'} · 레이즈 ${s.maxRaises}회 · 타이머 ${s.turnSec || '없음'}`);
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
      this._log(`${p.name} 입장${this.handNo ? ' (다음 판부터 참가)' : ''}`);
      this._touch();
      return p;
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
    eligible() { return this.seated().filter(p => p.connected && p.chips > 0); }
    canStart() { return !this.inProgress() && this.eligible().length >= 2; }

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
      const mode = this.mode();

      this.handNo++;
      const order = this.seated().filter(p => participants.includes(p.id)).map(p => p.id);
      let dealer;
      if (redeal && prev && order.includes(prev.dealer)) dealer = prev.dealer;
      else {
        const prevSeat = prev ? (this.player(prev.dealer) ? this.player(prev.dealer).seat : -1) : -1;
        const seats = order.map(id => this.player(id).seat);
        dealer = order[seats.findIndex(s => s > prevSeat)] ?? order[0];
      }
      const di = order.indexOf(dealer);
      const turnOrder = order.slice(di + 1).concat(order.slice(0, di + 1));

      const h = this.hand = {
        no: this.handNo, mode: this.settings.mode, dealer, participants, order: turnOrder,
        deck: R.shuffle(this.rng), cards: {}, board: [], folded: new Set(), allin: new Set(),
        contrib: {}, pot: carry, carry, street: 0, stageIdx: -1, stageLabel: '',
        bets: {}, curBet: 0, acted: new Set(), raises: 0, turn: null, turnAt: 0,
        chosen: {}, chooseAt: 0, result: null, actions: [],
      };
      for (const id of participants) { h.cards[id] = []; h.contrib[id] = 0; if (this.player(id).chips === 0) h.allin.add(id); }
      this.phase = 'betting';
      this._log(redeal ? `${this.handNo}판 재경기 (${mode.label}) — 이월 ${carry}원` : `${this.handNo}판 시작 · ${mode.label} (딜러 ${this.player(dealer).name})`);
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
        if (kind === 'board') {
          for (let k = 0; k < n; k++) h.board.push(h.deck.pop());
          h.street++;
          h.stageLabel = `공유 ${h.board.length}장`;
          this._log(`공유 카드 ${n}장 오픈 (${h.board.length}장)`);
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
          this._log('3장 중 2장을 고르세요');
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
    choose(id, idxs) {
      const h = this.hand;
      if (!h || this.phase !== 'choosing' || !this._inLiveHand(id)) return { ok: false, error: '지금은 고를 수 없어요' };
      if (h.chosen[id]) return { ok: false, error: '이미 골랐어요' };
      const cards = h.cards[id];
      if (!Array.isArray(idxs) || idxs.length !== 2 || idxs[0] === idxs[1] || idxs.some(i => !(i >= 0 && i < cards.length))) return { ok: false, error: '2장을 골라주세요' };
      h.chosen[id] = [cards[idxs[0]], cards[idxs[1]]];
      this._log(`${this.player(id).name}: 2장 선택 완료`);
      this._checkChooseDone();
      this._touch();
      return { ok: true };
    }
    /* 시간 초과: 아직 안 고른 사람은 최선의 2장으로 */
    autoChoose() {
      const h = this.hand; if (!h || this.phase !== 'choosing') return;
      for (const id of this._live()) if (!h.chosen[id]) { h.chosen[id] = R.bestPair(h.cards[id]).cards; this._log(`${this.player(id).name}: 시간 초과 → 자동 선택`); }
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
      const h = this.hand; const cards = h.cards[id];
      if (h.mode === '3') return h.chosen[id] || R.bestPair(cards).cards;
      if (h.mode === 'holdem') return R.bestPair(cards.concat(h.board)).cards;
      return cards;
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
          result = { redeal: true, reason: r.reason, by: r.by, winners: [], hands: r.hands, used, payouts, revealed: live };
          this._log(`${this.player(r.by).name}의 ${r.reason} — 재경기! (팟 ${h.pot}원 이월)`);
        } else {
          this._distribute(live, used, r, payouts);
          result = { winners: r.winners, hands: r.hands, used, payouts, revealed: live, caught: r.caught, catcher: r.catcher };
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
      const players = this.seated().map(p => {
        const inHand = !!(h && h.participants.includes(p.id));
        const cards = h ? (h.cards[p.id] || []) : [];
        const show = inHand && (p.id === forId || (isResult && h.result.revealed.includes(p.id)));
        let handName = null, best = null;
        if (show && cards.length) {
          const pool = h.mode === 'holdem' ? cards.concat(h.board) : cards;
          if (isResult && h.result.used[p.id]) { best = h.result.used[p.id]; handName = h.result.hands[p.id] ? h.result.hands[p.id].name : null; }
          else if (h.mode === '3' && h.chosen[p.id]) { best = h.chosen[p.id]; handName = R.evalHand(best).name; }
          else if (pool.length >= 2) { const b = R.bestPair(pool); best = b.cards; handName = b.hand.name; }
          else handName = R.describeOne(cards[0]);
        }
        return {
          id: p.id, name: p.name, chips: p.chips, seat: p.seat, connected: p.connected, rebuys: p.rebuys,
          inHand, folded: inHand && h.folded.has(p.id), allin: inHand && h.allin.has(p.id),
          bet: inHand ? h.bets[p.id] || 0 : 0, contrib: inHand ? h.contrib[p.id] : 0,
          cards: show ? cards : null, cardCount: cards.length, hand: handName, best,
          chosen: !!(inHand && h.chosen[p.id]),
          isDealer: !!(h && h.dealer === p.id), isTurn: !!(h && h.turn === p.id),
          payout: isResult ? (h.result.payouts[p.id] || 0) : 0,
          canRebuy: this.canRebuy(p.id),
        };
      });
      const me = players.find(p => p.id === forId);
      return {
        v: this.version, phase: this.phase, settings: s, handNo: this.handNo, me: forId,
        mode: h ? h.mode : s.mode, modeLabel: MODES[h ? h.mode : s.mode].label, nextMode: s.mode, nextModeLabel: MODES[s.mode].label,
        pot: h ? h.pot : 0, street: h ? h.street : 0, stageLabel: h ? h.stageLabel : '', curBet: h ? h.curBet : 0, raises: h ? h.raises : 0,
        board: h ? h.board : [], boardMax: MODES[h ? h.mode : s.mode].board,
        turn: h ? h.turn : null, turnAt: h ? h.turnAt : 0, chooseAt: h ? h.chooseAt : 0,
        needChoose: !!(this.phase === 'choosing' && me && me.inHand && !me.folded && !me.chosen),
        players, actions: this.actionsFor(forId),
        canStart: this.canStart(),
        result: isResult ? h.result : null,
        log: this.log.slice(-30),
      };
    }
  }

  return { Game, DEFAULTS, ACTION_LABEL, MODES, ANTE, START_CHIPS };
});
