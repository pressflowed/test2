// Short synthesized taps for hand contacts. No sound files needed.
let ac = null, noise = null;

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
