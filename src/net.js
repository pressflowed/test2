// Peer-to-peer multiplayer over WebRTC, using PeerJS's free public server to connect.
// One player hosts and gets a 4-letter room code; friends join with the code.
// Everything goes through the host (star network); the host runs the prop physics.
//
// For local testing, add ?signal=localhost:9000 to the page URL to use a local
// PeerJS server instead of the public one.

const PREFIX = 'canopytag-v1-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function peerOptions() {
  const sig = new URLSearchParams(location.search).get('signal');
  if (!sig) return { debug: 1 };
  const [host, port] = sig.split(':');
  return { host, port: Number(port) || 9000, path: '/', secure: false, debug: 1, config: { iceServers: [] } };
}

export function newCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export class Net {
  constructor() {
    this.role = 'solo';        // 'solo' | 'host' | 'client'
    this.myId = 'h';           // the host is always 'h'; joined players get 'p2', 'p3', ...
    this.code = null;
    this.peer = null;
    this.conns = new Map();    // host: playerId -> DataConnection
    this.hostConn = null;      // client: connection to the host
    this.onMessage = () => {}; // (fromId, msg)
    this.onJoin = () => {};    // host: (playerId)
    this.onLeave = () => {};   // (playerId) ; client gets 'h' when the host is gone
    this.onStatus = () => {};  // (text, kind)
    this._next = 2;
  }

  get online() { return this.role !== 'solo'; }
  get playerCount() { return this.role === 'host' ? this.conns.size + 1 : this.role === 'client' ? -1 : 1; }

  _peer(id) {
    if (typeof Peer === 'undefined') throw new Error('The multiplayer library did not load. Check your internet connection.');
    return id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
  }

  /** Start hosting. Resolves with the room code. */
  host(tries = 4) {
    this.leave();
    return new Promise((resolve, reject) => {
      const code = newCode();
      let peer;
      try { peer = this._peer(PREFIX + code); } catch (e) { reject(e); return; }
      this.peer = peer;
      peer.on('open', () => {
        this.role = 'host'; this.myId = 'h'; this.code = code;
        this.onStatus(`Hosting room ${code}`, 'ok');
        resolve(code);
      });
      peer.on('connection', conn => this._accept(conn));
      peer.on('error', err => {
        if (err.type === 'unavailable-id' && tries > 0) { peer.destroy(); this.host(tries - 1).then(resolve, reject); return; }
        if (this.role !== 'host') { peer.destroy(); this.peer = null; reject(new Error(describe(err))); }
        else this.onStatus(describe(err), 'error');
      });
      peer.on('disconnected', () => { if (this.role === 'host') { try { peer.reconnect(); } catch (e) { /* ignore */ } } });
    });
  }

  _accept(conn) {
    const id = 'p' + this._next++;
    conn.on('open', () => {
      this.conns.set(id, conn);
      conn.send({ t: 'welcome', id });
      this.onJoin(id);
    });
    conn.on('data', msg => this.onMessage(id, msg));
    const gone = () => { if (this.conns.delete(id)) this.onLeave(id); };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  /** Join a friend's room by its code. Resolves once connected and welcomed. */
  join(code) {
    this.leave();
    code = code.trim().toUpperCase();
    return new Promise((resolve, reject) => {
      let peer;
      try { peer = this._peer(); } catch (e) { reject(e); return; }
      this.peer = peer;
      let done = false;
      const fail = msg => { if (done) return; done = true; this.leave(); reject(new Error(msg)); };
      const timer = setTimeout(() => fail(`Could not reach room ${code}. Check the code, and that your friend is still hosting.`), 15000);
      peer.on('error', err => {
        if (err.type === 'peer-unavailable') fail(`There is no room ${code}. Check the code.`);
        else if (!done) fail(describe(err));
        else this.onStatus(describe(err), 'error');
      });
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        this.hostConn = conn;
        conn.on('data', msg => {
          if (msg && msg.t === 'welcome' && !done) {
            done = true; clearTimeout(timer);
            this.role = 'client'; this.myId = msg.id; this.code = code;
            this.onStatus(`Joined room ${code}`, 'ok');
            resolve(code);
            return;
          }
          this.onMessage('h', msg);
        });
        const gone = () => {
          if (!done) { fail(`Could not connect to room ${code}.`); return; }
          if (this.role === 'client') { this.role = 'solo'; this.myId = 'h'; this.onLeave('h'); this.onStatus('The host left the room.', 'error'); }
        };
        conn.on('close', gone);
        conn.on('error', gone);
      });
    });
  }

  /** Client: send to the host. */
  send(msg) { if (this.hostConn && this.hostConn.open) this.hostConn.send(msg); }

  /** Host: send to every joined player (or one). */
  broadcast(msg, except = null) {
    for (const [id, c] of this.conns) if (id !== except && c.open) c.send(msg);
  }
  sendTo(id, msg) { const c = this.conns.get(id); if (c && c.open) c.send(msg); }

  leave() {
    for (const c of this.conns.values()) { try { c.close(); } catch (e) { /* ignore */ } }
    this.conns.clear();
    if (this.hostConn) { try { this.hostConn.close(); } catch (e) { /* ignore */ } }
    this.hostConn = null;
    if (this.peer) { try { this.peer.destroy(); } catch (e) { /* ignore */ } }
    this.peer = null;
    this.role = 'solo'; this.myId = 'h'; this.code = null;
  }
}

function describe(err) {
  switch (err && err.type) {
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed':
      return 'Could not reach the multiplayer server. Check your internet connection.';
    case 'browser-incompatible': return 'This browser does not support multiplayer (WebRTC).';
    case 'peer-unavailable': return 'That room does not exist.';
    default: return (err && err.message) || 'Multiplayer error.';
  }
}
