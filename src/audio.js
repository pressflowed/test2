// Short synthesized taps for hand contacts. No sound files needed.
let ac = null, noise = null;

/** The shared audio context, or null before the first click (browsers need one to start sound). */
export function audioContext() { return ac; }

export function initAudio() {
  try {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.15), ac.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
  } catch (e) { ac = null; }
}

// [pitch Hz, amount of noise] per surface
const SURF = {
  grass: [150, 0.55], 'grass-dark': [140, 0.55], leaf: [210, 0.8], wood: [290, 0.25], plank: [340, 0.22],
  crate: [260, 0.3], rock: [520, 0.12], stone: [470, 0.15], metal: [880, 0.08], pad: [190, 0.5],
};

export function tap(kind, vol = 0.5, pan = 0) {
  if (!ac || vol < 0.02) return;
  const [f, nz] = SURF[kind] || [250, 0.3];
  const t = ac.currentTime, k = 0.9 + Math.random() * 0.2;
  const out = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain();
  if (out.pan) out.pan.value = pan;
  out.connect(ac.destination);
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(f * k, t);
  o.frequency.exponentialRampToValueAtTime(f * k * 0.5, t + 0.09);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.25 * vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  o.connect(g).connect(out); o.start(t); o.stop(t + 0.14);
  const s = ac.createBufferSource(), bp = ac.createBiquadFilter(), g2 = ac.createGain();
  s.buffer = noise; bp.type = 'bandpass'; bp.frequency.value = f * 4; bp.Q.value = 1.2;
  g2.gain.setValueAtTime(0.3 * nz * vol, t);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  s.connect(bp).connect(g2).connect(out); s.start(t); s.stop(t + 0.12);
}

/** A rising boing, for launch pads and trampolines. */
export function boing(vol = 0.5) {
  if (!ac) return;
  const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(160, t);
  o.frequency.exponentialRampToValueAtTime(520, t + 0.22);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.3 * vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.32);
}

/** An explosion: a low thump under a burst of noise. */
export function boom(vol = 1) {
  if (!ac || vol < 0.02) return;
  const t = ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(32, t + 0.5);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.9 * vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.75);
  for (let i = 0; i < 4; i++) {   // the noise buffer is short, so layer a few
    const s = ac.createBufferSource(), lp = ac.createBiquadFilter(), g2 = ac.createGain();
    s.buffer = noise; lp.type = 'lowpass'; lp.frequency.value = 1400 - i * 300;
    g2.gain.setValueAtTime(0.5 * vol, t + i * 0.09);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.18);
    s.connect(lp).connect(g2).connect(ac.destination); s.start(t + i * 0.09); s.stop(t + i * 0.09 + 0.15);
  }
}

// what breaking each kind of surface sounds like: [filter Hz, thump Hz]
const CRUNCH = { leaf: [3200, 0], grass: [900, 70], wood: [1500, 110], plank: [1800, 130], crate: [1700, 120], rock: [2400, 80], stone: [2600, 70] };

/** Blocks breaking. kind is the surface, vol 0..1. */
export function crunch(kind, vol = 1) {
  if (!ac || vol < 0.02) return;
  const [cut, thump] = CRUNCH[kind] || CRUNCH.rock;
  const t = ac.currentTime;
  for (let i = 0; i < 3; i++) {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noise; f.type = 'bandpass'; f.frequency.value = cut * (0.7 + Math.random() * 0.6); f.Q.value = 0.7;
    const at = t + i * 0.045;
    g.gain.setValueAtTime(0.55 * vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
    s.connect(f).connect(g).connect(ac.destination); s.start(at); s.stop(at + 0.14);
  }
  if (thump) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(thump * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(thump * 0.5, t + 0.18);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.6 * vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.27);
  }
}

/** A short tune of notes (Hz), for round events. */
export function jingle(notes, vol = 0.5) {
  if (!ac) return;
  const t = ac.currentTime;
  notes.forEach((f, i) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    const at = t + i * 0.13;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.22 * vol, at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
    o.connect(g).connect(ac.destination); o.start(at); o.stop(at + 0.3);
  });
}

/** The ground shaking under something huge: a deep thud. vol 0..1 */
export function thump(vol = 1) {
  if (!ac || vol < 0.02) return;
  const t = ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(62, t);
  o.frequency.exponentialRampToValueAtTime(30, t + 0.3);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.95 * vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.5);
  const s = ac.createBufferSource(), lp = ac.createBiquadFilter(), g2 = ac.createGain();
  s.buffer = noise; lp.type = 'lowpass'; lp.frequency.value = 320;
  g2.gain.setValueAtTime(0.5 * vol, t);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  s.connect(lp).connect(g2).connect(ac.destination); s.start(t); s.stop(t + 0.15);
}

/** Your own heart, when the giant is close: two soft low beats. vol 0..1 */
export function heartbeat(vol = 1) {
  if (!ac || vol < 0.02) return;
  const t = ac.currentTime;
  for (const [at, f, v] of [[0, 58, 1], [0.16, 48, 0.7]]) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t + at);
    o.frequency.exponentialRampToValueAtTime(f * 0.6, t + at + 0.12);
    g.gain.setValueAtTime(0.0001, t + at);
    g.gain.exponentialRampToValueAtTime(0.5 * vol * v, t + at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.16);
    o.connect(g).connect(ac.destination); o.start(t + at); o.stop(t + at + 0.18);
  }
}

/** A fist landing on a body: a dull wet thud. vol 0..1 */
export function smack(vol = 1) {
  if (!ac || vol < 0.02) return;
  const t = ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.7 * vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.22);
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g2 = ac.createGain();
  s.buffer = noise; f.type = 'lowpass'; f.frequency.value = 900;
  g2.gain.setValueAtTime(0.5 * vol, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  s.connect(f).connect(g2).connect(ac.destination); s.start(t); s.stop(t + 0.1);
}

/** Something being torn off: a ripping crackle, then a pop. vol 0..1 */
export function tear(vol = 1) {
  if (!ac || vol < 0.02) return;
  const t = ac.currentTime;
  for (let i = 0; i < 5; i++) {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noise; f.type = 'bandpass'; f.frequency.value = 500 + i * 380 + Math.random() * 300; f.Q.value = 2.5;
    const at = t + i * 0.035;
    g.gain.setValueAtTime(0.6 * vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    s.connect(f).connect(g).connect(ac.destination); s.start(at); s.stop(at + 0.08);
  }
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(220, t + 0.17);
  o.frequency.exponentialRampToValueAtTime(60, t + 0.3);
  g.gain.setValueAtTime(0.0001, t + 0.17);
  g.gain.exponentialRampToValueAtTime(0.8 * vol, t + 0.178);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  o.connect(g).connect(ac.destination); o.start(t + 0.17); o.stop(t + 0.42);
}

/** Something wet being cut or burst: a blade going in, a body coming apart. vol 0..1 */
export function squelch(vol = 1) {
  if (!ac || vol < 0.02) return;
  const t = ac.currentTime;
  for (let i = 0; i < 3; i++) {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    const at = t + i * 0.04;
    s.buffer = noise; f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(900 - i * 200 + Math.random() * 200, at);
    f.frequency.exponentialRampToValueAtTime(180, at + 0.12);
    g.gain.setValueAtTime(0.7 * vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
    s.connect(f).connect(g).connect(ac.destination); s.start(at); s.stop(at + 0.14);
  }
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.22);
}

/** Bone breaking: a dry snap. vol 0..1 */
export function crack(vol = 1) {
  if (!ac || vol < 0.02) return;
  const t = ac.currentTime;
  for (const [at, f] of [[0, 2600], [0.035, 1700]]) {
    const s = ac.createBufferSource(), hp = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noise; hp.type = 'highpass'; hp.frequency.value = f;
    g.gain.setValueAtTime(0.9 * vol, t + at); g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.035);
    s.connect(hp).connect(g).connect(ac.destination); s.start(t + at); s.stop(t + at + 0.04);
  }
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.05);
  g.gain.setValueAtTime(0.25 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.07);
}

/**
 * Metal on metal: a blow caught on a blade, a shield or armour. `heavy` (0 to 1) lowers
 * it and makes it ring longer (a shield or a breastplate rather than a sword).
 */
export function clang(vol = 1, heavy = 0) {
  if (!ac || vol < 0.02) return;
  const t = ac.currentTime, base = (1500 - 700 * heavy) * (0.92 + Math.random() * 0.16), ring = 0.28 + 0.3 * heavy;
  // a handful of partials that do not line up, which is what makes it sound like metal
  for (const [mult, gain, len] of [[1, 0.3, 1], [1.47, 0.22, 0.8], [2.09, 0.18, 0.6], [2.56, 0.12, 0.45], [3.6, 0.08, 0.3]]) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = mult === 1 ? 'triangle' : 'sine';
    o.frequency.value = base * mult;
    g.gain.setValueAtTime(gain * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + ring * len);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + ring * len + 0.02);
  }
  // and the knock itself
  const s = ac.createBufferSource(), bp = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noise; bp.type = 'bandpass'; bp.frequency.value = 3200 - 1400 * heavy; bp.Q.value = 1.2;
  g.gain.setValueAtTime(0.8 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  s.connect(bp).connect(g).connect(ac.destination); s.start(t); s.stop(t + 0.06);
}

/** One of the dead, moaning. `deep` (0 to 1) lowers it: a brute. */
export function groan(vol = 1, deep = 0) {
  if (!ac || vol < 0.02) return;
  const t = ac.currentTime, f = (120 - 45 * deep) * (0.85 + Math.random() * 0.3), len = 0.7 + Math.random() * 0.5;
  const o = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * (0.7 + Math.random() * 0.5), t + len * 0.6); o.frequency.linearRampToValueAtTime(f * 0.6, t + len);
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(380, t); lp.frequency.linearRampToValueAtTime(700, t + len * 0.4); lp.frequency.linearRampToValueAtTime(260, t + len); lp.Q.value = 5;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3 * vol, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(lp).connect(g).connect(ac.destination); o.start(t); o.stop(t + len + 0.05);
}

/** A bowstring let go. */
export function twang(vol = 1) {
  if (!ac || vol < 0.02) return;
  const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(340, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.22);
  g.gain.setValueAtTime(0.4 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.27);
}

/** Something big, breathing and rumbling in the dark. */
export function growl(vol = 1) {
  if (!ac || vol < 0.02) return;
  const t = ac.currentTime, len = 1.1 + Math.random() * 0.8, f = 46 + Math.random() * 14;
  const o = ac.createOscillator(), lfo = ac.createOscillator(), depth = ac.createGain(), lp = ac.createBiquadFilter(), g = ac.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 0.8, t + len);
  lfo.frequency.value = 22 + Math.random() * 8; depth.gain.value = 0.5;        // the rattle in it
  lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 3;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.45 * vol, t + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  lfo.connect(depth).connect(g.gain);
  o.connect(lp).connect(g).connect(ac.destination);
  o.start(t); lfo.start(t); o.stop(t + len + 0.05); lfo.stop(t + len + 0.05);
}

/** It has seen you: a shriek. */
export function screech(vol = 1) {
  if (!ac || vol < 0.02) return;
  const t = ac.currentTime, len = 1.3;
  for (const [f0, f1, gain] of [[620, 1500, 0.3], [933, 2260, 0.22], [310, 700, 0.25]]) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + 0.25); o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain * vol, t + 0.05); g.gain.setValueAtTime(gain * vol, t + len * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + len + 0.05);
  }
  const n = ac.createBufferSource(), hp = ac.createBiquadFilter(), g = ac.createGain();
  n.buffer = noise; n.loop = true; hp.type = 'highpass'; hp.frequency.value = 2500;
  g.gain.setValueAtTime(0.25 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  n.connect(hp).connect(g).connect(ac.destination); n.start(t); n.stop(t + len);
}
