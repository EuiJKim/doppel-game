/* 섯다 — 네트워크 (PeerJS / WebRTC P2P)
 * 서버 없음: 방장 브라우저가 호스트(게임 엔진 보유), 친구들은 방 코드로 직접 연결.
 * 시그널링만 PeerJS 공개 브로커를 쓰고, 이후 데이터는 브라우저끼리 직접 오간다.
 */
const SeotdaNet = (() => {
  const PREFIX = 'doppel-seotda-';
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
  function peerOptions() {
    return {
      debug: 0,
      ...(customServer() || {}),
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] },
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
      this.peer = new Peer(PREFIX + this.code, peerOptions());
      this.peer.on('open', () => this.h.onOpen && this.h.onOpen(this.code));
      this.peer.on('error', err => this.h.onError && this.h.onError(errorText(err), err));
      this.peer.on('disconnected', () => { if (!this.closed) setTimeout(() => { try { this.peer.reconnect(); } catch (e) { } }, 1500); });
      this.peer.on('connection', conn => this._accept(conn));
    }
    _accept(conn) {
      let pid = null;
      conn.on('data', msg => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'join') {
          if (pid) return;
          pid = String(msg.token || '').slice(0, 24);
          if (!pid) { conn.send({ t: 'err', msg: '잘못된 접속' }); return; }
          const old = this.conns.get(pid);
          if (old && old !== conn) { try { old.close(); } catch (e) { } }
          this.conns.set(pid, conn);
          const ok = this.h.onJoin(pid, String(msg.name || '').slice(0, 10));
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
    close() { this.closed = true; try { this.peer && this.peer.destroy(); } catch (e) { } }
  }

  /* ── 클라이언트 ── */
  class Client {
    constructor(code, name, token, h) {
      this.code = code; this.name = name; this.token = token; this.h = h;
      this.peer = null; this.conn = null; this.closed = false; this.tries = 0; this.wasOpen = false;
    }
    connect() {
      this.peer = new Peer(undefined, peerOptions());
      this.peer.on('open', () => this._dial());
      this.peer.on('error', err => {
        if (err && err.type === 'peer-unavailable' && this.wasOpen) { this._retry(); return; }
        this.h.onError && this.h.onError(errorText(err), err);
      });
      this.peer.on('disconnected', () => { if (!this.closed) setTimeout(() => { try { this.peer.reconnect(); } catch (e) { } }, 1500); });
    }
    _dial() {
      if (this.closed) return;
      const conn = this.conn = this.peer.connect(PREFIX + this.code, { reliable: true });
      let opened = false;
      conn.on('open', () => {
        opened = true; this.wasOpen = true; this.tries = 0;
        conn.send({ t: 'join', name: this.name, token: this.token });
        this.h.onOpen && this.h.onOpen();
      });
      conn.on('data', msg => { if (msg && typeof msg === 'object') this.h.onMessage(msg); });
      conn.on('close', () => { if (opened) this._retry(); });
      conn.on('error', () => { if (!opened) this._retry(); });
      setTimeout(() => { if (!opened && !this.closed && this.conn === conn) { try { conn.close(); } catch (e) { } if (!this.wasOpen) this.h.onError && this.h.onError('방에 연결하지 못했어요. 코드를 확인해 주세요.'); else this._retry(); } }, 12000);
    }
    _retry() {
      if (this.closed) return;
      if (this.tries >= 6) { this.h.onClose && this.h.onClose('호스트와의 연결이 끊겼어요.'); return; }
      this.tries++;
      this.h.onReconnecting && this.h.onReconnecting(this.tries);
      setTimeout(() => this._dial(), 1500 * this.tries);
    }
    send(msg) { if (this.conn && this.conn.open) { try { this.conn.send(msg); } catch (e) { } } }
    close() { this.closed = true; try { this.peer && this.peer.destroy(); } catch (e) { } }
  }

  return { Host, Client, makeCode, normCode, PREFIX, customServer };
})();
