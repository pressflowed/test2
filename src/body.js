// What a body can take: blood, wounds, losing arms, dying and coming back.
// Pure rules with no graphics; the host runs them for every player and bot.
//
//   blood 100 -> 0 means dead. Wounds bleed for a while and then clot.
//   Each arm can be lost at the elbow (level 1) or the shoulder (level 2).
//   One arm gone: you bleed, it clots, you live on one-handed (with a lower blood limit).
//   Both arms gone: the bleeding does not stop.

export const BODY = {
  blood: 100,
  hp: { upper: 45, fore: 35 },       // damage an arm segment takes before it comes off
  armBloodCost: 15,                  // each lost arm lowers how much blood you can get back to
  severLoss: 10,                     // blood lost at once when an arm comes off
  bleed: { elbow: [1.6, 12], shoulder: [2.4, 12], both: 9 },   // [blood per second, seconds]
  regenDelay: 6, regen: 2,           // seconds without bleeding before blood returns, and how fast
  respawn: 6,                        // seconds dead before coming back
  strip: 0.45,                       // below this share of its hp, a segment's flesh is torn off
  ripStretch: 1.3,                   // pull a held arm this many arm-lengths from its shoulder and it rips
  holdTime: 4,                       // seconds a held arm stays held if nobody rips it
};

export const ARM_PARTS = [['upperL', 'foreL'], ['upperR', 'foreR']];

export class Body {
  constructor() { this.reset(); }

  reset() {
    this.blood = BODY.blood;
    this.hp = { upperL: BODY.hp.upper, foreL: BODY.hp.fore, upperR: BODY.hp.upper, foreR: BODY.hp.fore };
    this.cut = [0, 0];            // per arm: 0 whole, 1 gone below the elbow, 2 gone at the shoulder
    this.bleeds = [];             // { rate, left, src } where src is an arm index, 'both' or 'body'
    this.dead = false;
    this.respawn = 0;
    this.held = [null, null];     // per arm: "playerId:hand" of whoever has hold of it
    this.holdT = [0, 0];
    this.calm = 0;                // seconds since last hurt or bleeding
  }

  get maxBlood() { return BODY.blood - BODY.armBloodCost * ((this.cut[0] ? 1 : 0) + (this.cut[1] ? 1 : 0)); }
  /** Can this arm still be used to move, grab and hit? */
  canUse(arm) { return !this.dead && this.cut[arm] === 0 && !this.held[arm]; }
  /** bit 0: left stump bleeding, bit 1: right stump, bit 2: a body wound */
  get bleeding() {
    let m = 0;
    for (const b of this.bleeds) m |= b.src === 0 ? 1 : b.src === 1 ? 2 : b.src === 'both' ? 3 : 4;
    return m;
  }
  /** Segments whose flesh has been torn off: bits foreL, upperL, foreR, upperR. */
  get stripped() {
    const s = (part, max) => this.hp[part] < max * BODY.strip;
    return (s('foreL', BODY.hp.fore) ? 1 : 0) | (s('upperL', BODY.hp.upper) ? 2 : 0) | (s('foreR', BODY.hp.fore) ? 4 : 0) | (s('upperR', BODY.hp.upper) ? 8 : 0);
  }

  /**
   * Take a hit on a part: 'head', 'torso', 'upperL', 'foreL', 'upperR' or 'foreR'.
   * Returns what happened: [{ type: 'hit', part, dmg }, { type: 'sever', arm, level, was }, { type: 'die' }].
   */
  hit(part, dmg) {
    if (this.dead || !(dmg > 0)) return [];
    const ev = [{ type: 'hit', part, dmg }];
    this.calm = 0;
    if (part === 'head') { this.blood -= dmg * 1.1; this.bleeds.push({ rate: dmg * 0.08, left: 4, src: 'body' }); }
    else if (part === 'torso') { this.blood -= dmg * 0.6; this.bleeds.push({ rate: dmg * 0.04, left: 4, src: 'body' }); }
    else if (part in this.hp) {
      const arm = part.endsWith('L') ? 0 : 1, level = part.startsWith('fore') ? 1 : 2;
      if (this.cut[arm] >= level) return [];              // that piece is already gone
      this.hp[part] -= dmg;
      this.blood -= dmg * 0.2;
      if (this.hp[part] <= 0) ev.push(...this.sever(arm, level));
    } else return [];
    if (this.blood <= 0 && !this.dead) ev.push(...this._die());
    return ev;
  }

  /** Take an arm off at the elbow (1) or shoulder (2). */
  sever(arm, level) {
    if (this.dead || this.cut[arm] >= level) return [];
    const was = this.cut[arm];
    this.cut[arm] = level;
    this.held[arm] = null;
    this.calm = 0;
    this.blood -= BODY.severLoss;
    this.bleeds = this.bleeds.filter(b => b.src !== arm);
    if (this.cut[0] && this.cut[1]) this.bleeds = [{ rate: BODY.bleed.both, left: Infinity, src: 'both' }];
    else { const [rate, left] = level === 2 ? BODY.bleed.shoulder : BODY.bleed.elbow; this.bleeds.push({ rate, left, src: arm }); }
    const ev = [{ type: 'sever', arm, level, was }];      // was: how much of the arm was already gone
    if (this.blood <= 0) ev.push(...this._die());
    return ev;
  }

  _die() {
    this.dead = true;
    this.blood = 0;
    this.respawn = BODY.respawn;
    this.bleeds = [];
    this.held = [null, null];
    return [{ type: 'die' }];
  }

  /** Bleeding, clotting, healing, and coming back from the dead. Returns events like hit(). */
  update(dt) {
    if (this.dead) {
      this.respawn -= dt;
      if (this.respawn > 0) return [];
      this.reset();
      return [{ type: 'respawn' }];
    }
    if (this.bleeds.length) {
      this.calm = 0;
      for (const b of this.bleeds) { this.blood -= b.rate * Math.min(dt, b.left); b.left -= dt; }
      this.bleeds = this.bleeds.filter(b => b.left > 0);
      if (this.blood <= 0) return this._die();
    } else {
      this.calm += dt;
      if (this.calm > BODY.regenDelay) this.blood = Math.min(this.maxBlood, this.blood + BODY.regen * dt);
    }
    return [];
  }

  // ---- sending it to other players
  pack() { return [Math.round(this.blood), this.cut[0], this.cut[1], this.dead ? 1 : 0, this.held[0] || 0, this.held[1] || 0, this.bleeding, this.stripped]; }
  /** Joined players: take the host's word for it. Returns true if anything visible changed. */
  apply(a) {
    const changed = this.cut[0] !== a[1] || this.cut[1] !== a[2] || this.dead !== !!a[3] || this._strip !== a[7];
    this.blood = a[0]; this.cut[0] = a[1]; this.cut[1] = a[2]; this.dead = !!a[3];
    this.held[0] = a[4] || null; this.held[1] = a[5] || null;
    this._bleed = a[6]; this._strip = a[7];
    return changed;
  }
  /** What to draw: works on the host (real state) and for joined players (what the host sent). */
  get view() {
    return { cut: this.cut, dead: this.dead, bleeding: this._bleed ?? this.bleeding, stripped: this._strip ?? this.stripped, blood: this.blood };
  }
}
