/* 섯다 — 네트워크 (PeerJS / WebRTC P2P)
 * 서버 없음: 방장 브라우저가 호스트(게임 엔진 보유), 친구들은 방 코드로 직접 연결.
 * 시그널링만 PeerJS 공개 브로커를 쓰고, 이후 데이터는 브라우저끼리 직접 오간다.
 */
const SeotdaNet = (() => {
  let PREFIX = 'doppel-seotda-';   // 게임별 방 ID 접두어 (홀덤 등은 setPrefix로 바꿔 쓴다 — 방 코드가 같아도 다른 게임 방에 안 붙게)
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 0/O/1/I 제외

  function makeCode(len = 5) {
    let s = '';
    const buf = new Uint32Array(len);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(buf) : buf.forEach((_, i) => buf[i] = Math.random() * 1e9);
    for (let i = 0; i < len; i++) s += ALPHABET[buf[i] % ALPHABET.length];
    return s;
  }
  function normCode(s) { return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }

  /* 시그널링 서버: 기본은 PeerJS 공개 브로커. ?peer=host:port 로 직접 띄운 peerjs-server를 쓸 수 있다 (테스트·자체 호스팅용) */
  function customServer() {
    const v = new URLSearchParams(location.search).get('peer');
    if (!v) return null;
    const m = v.match(/^([^:/]+)(?::(\d+))?(\/.*)?$/); if (!m) return null;
    const secure = !/^(localhost|127\.0\.0\.1)$/.test(m[1]);
    return { host: m[1], port: +(m[2] || (secure ? 443 : 80)), path: m[3] || '/', secure };
  }
  const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  /* STUN만으로는 이동통신망(CGNAT)·회사망에서 직접 연결이 안 되는 경우가 많다 → 공개 TURN 릴레이(Open Relay)를 폴백으로 */
  const TURN = [
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ];
  function peerOptions(withTurn) {
    const iceMode = new URLSearchParams(location.search).get('ice');   // ?ice=stun 강제 / ?ice=turn 강제 (디버그용)
    const useTurn = iceMode === 'turn' ? true : iceMode === 'stun' ? false : !!withTurn;
    return {
      debug: 0,
      ...(customServer() || {}),
      config: { iceServers: useTurn ? STUN.concat(TURN) : STUN, iceCandidatePoolSize: 2 },
    };
  }

  function errorText(err) {
    const type = err && err.type;
    const map = {
      'unavailable-id': '이 방 코드는 이미 사용 중이에요. 다시 만들어 주세요.',
      'peer-unavailable': '그 코드의 방을 찾을 수 없어요. 코드를 확인하거나 방장이 방을 열어뒀는지 확인해 주세요.',
      'network': '연결 서버에 닿지 못했어요. 인터넷 상태를 확인해 주세요.',
      'server-error': '연결 서버 오류. 잠시 후 다시 시도해 주세요.',
      'browser-incompatible': '이 브라우저는 P2P 연결을 지원하지 않아요. 크롬/사파리 최신 버전을 써주세요.',
      'disconnected': '연결 서버와 끊겼어요.',
      'webrtc': '브라우저 간 직접 연결에 실패했어요 (네트워크 방화벽 가능성).',
    };
    return map[type] || (err && err.message) || '알 수 없는 연결 오류';
  }

  /* ── 호스트 ── */
  class Host {
    constructor(code, h) {
      this.code = code; this.h = h;
      this.peer = null;
      this.conns = new Map();   // pid → DataConnection
      this.closed = false;
    }
    start() {
      this.idTries = (this.idTries || 0);
      /* 탭을 그냥 닫으면 WebRTC 'close'가 안 오는 브라우저가 많다 → 3초마다 하트비트, 10초 무응답이면 끊김 처리 */
      this.lastSeen = new Map();
      this.hb = setInterval(() => {
        const now = Date.now();
        for (const [pid, c] of this.conns) {
          if (now - (this.lastSeen.get(pid) || now) > 10000) { try { c.close(); } catch (e) { } this.conns.delete(pid); this.lastSeen.delete(pid); this.h.onLeave(pid); continue; }
          if (c.open) { try { c.send({ t: 'hb' }); } catch (e) { } }
        }
      }, 3000);
      this.peer = new Peer(PREFIX + this.code, peerOptions(true));
      if (!this._down) { this._down = () => { if (!this.closed) { try { this.broadcast({ t: 'hostdown' }); } catch (e) { } } }; window.addEventListener('pagehide', this._down); }
      this.peer.on('open', () => this.h.onOpen && this.h.onOpen(this.code));
      this.peer.on('error', err => {
        /* 방장 이전: 이전 방장의 ID가 서버에서 아직 안 풀렸으면 2초 간격으로 최대 8번 다시 잡는다 */
        if (err && err.type === 'unavailable-id' && this.takeover && this.idTries < 8) { this.idTries++; clearInterval(this.hb); try { this.peer.destroy(); } catch (e) { } setTimeout(() => { if (!this.closed) this.start(); }, 2000); return; }
        this.h.onError && this.h.onError(errorText(err), err);
      });
      this.peer.on('disconnected', () => { if (!this.closed) setTimeout(() => { try { this.peer.reconnect(); } catch (e) { } }, 1500); });
      this.peer.on('connection', conn => this._accept(conn));
    }
    _accept(conn) {
      let pid = null;
      conn.on('data', msg => {
        if (!msg || typeof msg !== 'object') return;
        if (pid) this.lastSeen.set(pid, Date.now());
        if (msg.t === 'hb') return;
        if (msg.t === 'bye') { if (pid && this.conns.get(pid) === conn) { this.conns.delete(pid); this.h.onLeave(pid); pid = null; } try { conn.close(); } catch (e) { } return; }
        if (msg.t === 'join') {
          if (pid) return;
          pid = String(msg.token || '').slice(0, 24);
          if (!pid) { conn.send({ t: 'err', msg: '잘못된 접속' }); return; }
          const old = this.conns.get(pid);
          if (old && old !== conn) { try { old.close(); } catch (e) { } }
          this.conns.set(pid, conn); this.lastSeen.set(pid, Date.now());
          const ok = this.h.onJoin(pid, String(msg.name || '').slice(0, 10), String(msg.avatar || '').slice(0, 12));
          if (!ok) { conn.send({ t: 'err', msg: '방이 꽉 찼어요', fatal: true }); setTimeout(() => conn.close(), 300); this.conns.delete(pid); pid = null; return; }
          conn.send({ t: 'welcome', pid, code: this.code });
          return;
        }
        if (pid) this.h.onMessage(pid, msg);
      });
      const bye = () => { if (pid && this.conns.get(pid) === conn) { this.conns.delete(pid); this.h.onLeave(pid); } };
      conn.on('close', bye);
      conn.on('error', bye);
    }
    send(pid, msg) { const c = this.conns.get(pid); if (c && c.open) { try { c.send(msg); } catch (e) { } } }
    broadcast(msg) { for (const pid of this.conns.keys()) this.send(pid, msg); }
    kick(pid) { const c = this.conns.get(pid); if (c) { this.send(pid, { t: 'err', msg: '방장이 내보냈어요', fatal: true }); setTimeout(() => c.close(), 300); } }
    close() { this.closed = true; clearInterval(this.hb); if (this._down) window.removeEventListener('pagehide', this._down); try { this.peer && this.peer.destroy(); } catch (e) { } }
  }

  /* ── 클라이언트 ── */
  class Client {
    constructor(code, name, token, h, avatar) {
      this.avatar = avatar || '';
      this.code = code; this.name = name; this.token = token; this.h = h;
      this.peer = null; this.conn = null; this.closed = false; this.tries = 0; this.wasOpen = false;
    }
    _status(msg) { this.h.onStatus && this.h.onStatus(msg); }
    connect() {
      /* 1차: STUN만(빠름, 대부분 성공) → 8초 안에 안 열리면 2차: TURN 중계 포함으로 새로 시도 */
      this._status(this.turn ? '중계 서버를 통해 다시 연결 중…' : '연결 서버에 접속 중…');
      this.lastSeen = Date.now();
      if (this.hb) clearInterval(this.hb);
      this.hb = setInterval(() => {
        if (this.closed || !this.wasOpen) return;
        if (this.conn && this.conn.open && Date.now() - this.lastSeen > 12000) { this.lastSeen = Date.now(); try { this.conn.close(); } catch (e) { } this._retry(); }
      }, 3000);
      /* 탭을 닫거나 다른 앱으로 완전히 나갈 때 방장에게 즉시 알린다 */
      this._bye = () => { try { if (this.conn && this.conn.open) this.conn.send({ t: 'bye' }); } catch (e) { } };
      window.addEventListener('pagehide', this._bye);
      this.peer = new Peer(undefined, peerOptions(this.turn));
      this.peer.on('open', () => this._dial());
      this.peer.on('error', err => {
        if (err && err.type === 'peer-unavailable' && this.wasOpen) { this._retry(); return; }
        this.h.onError && this.h.onError(errorText(err), err);
      });
      this.peer.on('disconnected', () => { if (!this.closed) setTimeout(() => { try { this.peer.reconnect(); } catch (e) { } }, 1500); });
    }
    _dial() {
      if (this.closed) return;
      this._status(this.wasOpen ? '방장과 다시 연결 중…' : '방을 찾는 중…');
      const conn = this.conn = this.peer.connect(PREFIX + this.code, { reliable: true });
      let opened = false, firstFail = this.firstFail || 0;
      conn.on('iceStateChanged', st => { if (!opened && (st === 'checking' || st === 'connected')) this._status('방장과 직접 연결 중… (네트워크에 따라 10초 정도 걸릴 수 있어요)'); });
      conn.on('open', () => {
        opened = true; this.wasOpen = true; this.tries = 0; this.lostNotified = false;
        conn.send({ t: 'join', name: this.name, token: this.token, avatar: this.avatar });
        this.h.onOpen && this.h.onOpen();
      });
      conn.on('data', msg => {
        if (!msg || typeof msg !== 'object') return;
        this.lastSeen = Date.now();
        if (msg.t === 'hb') { try { conn.send({ t: 'hb' }); } catch (e) { } return; }
        if (msg.t === 'hostdown') { try { conn.close(); } catch (e) { } this._retry(); return; }
        this.h.onMessage(msg);
      });
      conn.on('close', () => { if (opened) this._retry(); });
      conn.on('error', () => { if (!opened) this._retry(); });
      setTimeout(() => {
        if (opened || this.closed || this.conn !== conn) return;
        try { conn.close(); } catch (e) { }
        if (this.wasOpen) { this._retry(); return; }
        if (!this.turn) {            // 1차 실패 → TURN 중계 포함해서 피어를 새로 만든다
          this.turn = true;
          try { this.peer.destroy(); } catch (e) { }
          this.connect();
          return;
        }
        this.h.onError && this.h.onError('방에 연결하지 못했어요. ① 방 코드가 맞는지 ② 방장 화면이 열려 있는지 ③ 방장과 같은 브라우저의 다른 탭이 아닌지 확인해 주세요. 이동통신망이면 와이파이로 바꿔 보세요.');
      }, this.turn ? 15000 : 8000);
    }
    _retry() {
      if (this.closed) return;
      if (this.wasOpen && !this.lostNotified) { this.lostNotified = true; this.h.onHostDown && this.h.onHostDown(); }
      if (this.tries >= 16) { this.h.onClose && this.h.onClose('호스트와의 연결이 끊겼어요.'); return; }
      this.tries++;
      this.h.onReconnecting && this.h.onReconnecting(this.tries);
      setTimeout(() => this._dial(), Math.min(4000, 1200 * this.tries));
    }
    send(msg) { if (this.conn && this.conn.open) { try { this.conn.send(msg); } catch (e) { } } }
    close() { this.closed = true; clearInterval(this.hb); if (this._bye) { this._bye(); window.removeEventListener('pagehide', this._bye); } try { this.peer && this.peer.destroy(); } catch (e) { } }
  }

  /* 인앱 브라우저(카카오톡·인스타·페북·네이버·라인)는 WebRTC/WebSocket이 막히거나 불안정한 경우가 많다 */
  function inAppBrowser() {
    const ua = navigator.userAgent || '';
    const m = ua.match(/KAKAOTALK|FBAN|FBAV|Instagram|NAVER\(inapp|Line\/|DaumApps|SamsungBrowser\/[0-9.]+ .*wv|; wv\)/i);
    return m ? m[0].replace(/[\/(;].*/, '') : null;
  }
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  /* 연결 진단: ① WebRTC 지원 ② 연결 서버(시그널링) ③ STUN(공인 주소) ④ TURN(중계) 후보 수집 */
  async function diagnose(onStep) {
    const out = { webrtc: !!window.RTCPeerConnection, signaling: null, host: 0, srflx: 0, relay: 0, secure: location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1', inApp: inAppBrowser(), ios: isIOS(), ua: navigator.userAgent };
    onStep && onStep(out);
    if (!out.webrtc) return out;
    /* 시그널링 서버 */
    await new Promise(res => {
      let done = false; const fin = v => { if (!done) { done = true; out.signaling = v; try { p.destroy(); } catch (e) { } res(); } };
      let p; try { p = new Peer(undefined, peerOptions(true)); } catch (e) { fin('error'); return; }
      p.on('open', () => fin('ok')); p.on('error', err => fin(err && err.type || 'error'));
      setTimeout(() => fin('timeout'), 8000);
    });
    onStep && onStep(out);
    /* ICE 후보 */
    await new Promise(res => {
      let pc; try { pc = new RTCPeerConnection(peerOptions(true).config); } catch (e) { res(); return; }
      pc.createDataChannel('d');
      pc.onicecandidate = e => {
        if (!e.candidate) return;
        const c = e.candidate.candidate || '';
        if (/ typ host/.test(c)) out.host++; else if (/ typ srflx/.test(c)) out.srflx++; else if (/ typ relay/.test(c)) out.relay++;
        onStep && onStep(out);
      };
      pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => { });
      setTimeout(() => { try { pc.close(); } catch (e) { } res(); }, 7000);
    });
    onStep && onStep(out);
    return out;
  }

  return { Host, Client, makeCode, normCode, get PREFIX() { return PREFIX; }, setPrefix(p) { PREFIX = String(p); }, customServer, diagnose, inAppBrowser, isIOS };
})();
