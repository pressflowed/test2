// Voice chat by distance. Every pair of players in a room has one direct audio call.
// You always hear the others; they hear you once you turn your microphone on.
// Each voice gets quieter with distance and leans left or right toward where it is.
//
// Until the microphone is on, a silent track is sent instead, so calls can be set up
// (and listening works) without asking for permission first.
import { audioContext, initAudio } from './audio.js';

/** How loud a voice is from d metres away: full up close, about half at 9 m, gone by 40 m. */
export function voiceGain(d) {
  if (d >= 40) return 0;
  const far = Math.max(d - 3, 0) / 6;
  return (1 / (1 + far * far)) * Math.min(1, (40 - d) / 8);
}

export class Voice {
  constructor(net) {
    this.net = net;
    this.mic = null;          // the microphone stream, once allowed
    this.muted = false;
    this.silence = null;      // a stream with a silent track, sent until the microphone is on
    this.calls = new Map();   // their peer id -> { call, el, src, gain, pan, analyser }
    this.peers = new Map();   // player id -> peer id, for everyone else in the room
    this.onChange = () => {};
    this._retry = 0;
    this._buf = null;
    net.onCall = call => this._answer(call);
  }

  get on() { return !!this.mic; }
  get speaking() { return this.on && !this.muted; }

  /** Ask for the microphone and start sending it. Throws if the player says no. */
  async enable() {
    if (this.mic) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser cannot use a microphone here.');
    initAudio();
    this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.muted = false;
    this._sendTrack();
    this.onChange();
  }

  setMuted(m) {
    this.muted = m;
    if (this.mic) for (const t of this.mic.getAudioTracks()) t.enabled = !m;
    this.onChange();
  }

  // what we send: the microphone if it is on, otherwise silence
  _outgoing() {
    if (this.mic) return this.mic;
    if (!this.silence) {
      initAudio();
      const ac = audioContext();
      if (!ac) return null;
      this.silence = ac.createMediaStreamDestination().stream;
    }
    return this.silence;
  }

  // swap the track on calls that are already up (no need to call again)
  _sendTrack() {
    const track = this._outgoing() && this._outgoing().getAudioTracks()[0];
    for (const c of this.calls.values()) {
      const pc = c.call.peerConnection;
      const sender = pc && pc.getSenders().find(s => s.track && s.track.kind === 'audio') || (pc && pc.getSenders()[0]);
      if (sender && track) sender.replaceTrack(track).catch(() => {});
    }
  }

  /** Who else is in the room: Map of player id -> peer id. Calls are made and dropped to match. */
  sync(peers) {
    this.peers = new Map(peers);
    const wanted = new Set(this.peers.values());
    for (const [peerId, c] of this.calls) if (!wanted.has(peerId)) this._drop(peerId, c);
    this._dial();
  }

  // Of each pair, the player whose peer id sorts later makes the call, so there is only one.
  _dial() {
    const me = this.net.peer && this.net.peer.id;
    if (!me || !this.net.peer.open) return;
    for (const peerId of this.peers.values()) {
      if (this.calls.has(peerId) || !(me > peerId)) continue;
      const out = this._outgoing();
      if (!out) return;
      this._track(this.net.peer.call(peerId, out));
    }
  }

  _answer(call) {
    const old = this.calls.get(call.peer);
    if (old) this._drop(call.peer, old);
    call.answer(this._outgoing() || undefined);
    this._track(call);
  }

  _track(call) {
    if (!call) return;
    const entry = { call, el: null, src: null, gain: null, pan: null, analyser: null, level: 0 };
    this.calls.set(call.peer, entry);
    call.on('stream', stream => this._play(entry, stream));
    const gone = () => { if (this.calls.get(call.peer) === entry) this._drop(call.peer, entry); };
    call.on('close', gone);
    call.on('error', gone);
  }

  _play(entry, stream) {
    initAudio();
    const ac = audioContext();
    if (!ac || entry.src) return;
    // Chrome only feeds a remote stream into Web Audio if an element is playing it too
    entry.el = new Audio();
    entry.el.srcObject = stream;
    entry.el.muted = true;
    entry.el.play().catch(() => {});
    entry.src = ac.createMediaStreamSource(stream);
    entry.analyser = ac.createAnalyser(); entry.analyser.fftSize = 256;
    entry.gain = ac.createGain(); entry.gain.gain.value = 0;
    entry.pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
    entry.src.connect(entry.analyser);
    entry.src.connect(entry.gain);
    if (entry.pan) entry.gain.connect(entry.pan).connect(ac.destination); else entry.gain.connect(ac.destination);
    this.onChange();
  }

  _drop(peerId, c) {
    try { c.call.close(); } catch (e) { /* already closed */ }
    if (c.src) { try { c.src.disconnect(); c.gain.disconnect(); if (c.pan) c.pan.disconnect(); } catch (e) { /* ignore */ } }
    if (c.el) c.el.srcObject = null;
    this.calls.delete(peerId);
    this.onChange();
  }

  /** How many other players' voices are connected. */
  get connected() { let n = 0; for (const c of this.calls.values()) if (c.src) n++; return n; }

  /**
   * Every frame: set each voice's volume and side from where its player is.
   * @param head      my head position (THREE.Vector3)
   * @param right     unit vector pointing to my right
   * @param whereIs   player id -> their head position, or null if unknown
   */
  update(dt, head, right, whereIs) {
    const ac = audioContext();
    this._retry -= dt;
    if (this._retry <= 0) { this._retry = 4; this._dial(); }   // retry calls that did not connect
    if (!ac) return;
    const idOf = new Map();
    for (const [id, peerId] of this.peers) idOf.set(peerId, id);
    for (const [peerId, c] of this.calls) {
      if (!c.gain) continue;
      const pos = whereIs(idOf.get(peerId));
      let g = 0, pan = 0;
      if (pos) {
        const dx = pos.x - head.x, dy = pos.y - head.y, dz = pos.z - head.z, d = Math.hypot(dx, dy, dz);
        g = voiceGain(d);
        if (d > 0.3) pan = Math.max(-1, Math.min(1, (dx * right.x + dy * right.y + dz * right.z) / d)) * 0.85;
      }
      c.gain.gain.setTargetAtTime(g, ac.currentTime, 0.08);
      if (c.pan) c.pan.pan.setTargetAtTime(pan, ac.currentTime, 0.08);
      c.volume = g; c.side = pan;
      // how loud they are talking right now (for tests, and anything that wants to show it)
      if (!this._buf) this._buf = new Uint8Array(c.analyser.fftSize);
      c.analyser.getByteTimeDomainData(this._buf);
      let peak = 0;
      for (let i = 0; i < this._buf.length; i++) peak = Math.max(peak, Math.abs(this._buf[i] - 128));
      c.level = peak / 128;
    }
  }

  /** Hang up everything (leaving the room). */
  reset() {
    for (const [peerId, c] of [...this.calls]) this._drop(peerId, c);
    this.peers.clear();
  }
}
