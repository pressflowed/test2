// What a body can take: blood, wounds, losing arms, dying and coming back.
// Pure rules with no graphics; the host runs them for every player and bot.
//
//   blood 100 -> 0 means dead. Wounds bleed for a while and then clot.
//   The head can take so much, and then it comes off (which is the end of you).
//   Each arm can be lost at the elbow (level 1) or the shoulder (level 2).
//   Sharp weapons go through arms and necks much more easily than fists do, and enough
//   of that to the body cuts it in two. A heavy blunt weapon does not take a head off:
//   it bursts it.
//   One arm gone: you bleed, it clots, you live on one-handed (with a lower blood limit).
//   Both arms gone: the bleeding does not stop.
//   Armour: a helmet covers the head and a chest plate the torso. A blow to a covered
//   part does nothing but wear the armour down, until it is knocked off.

export const BODY = {
  blood: 100,
  hp: { upper: 45, fore: 35, head: 70, torso: 90 },   // damage a part takes before it comes off (the torso: before a blade goes right through)
  sharp: { arm: 1.8, head: 1.5, torso: 1.5 },   // how much worse a blade is than a fist, per part
  armBloodCost: 15,                  // each lost arm lowers how much blood you can get back to
  severLoss: 10,                     // blood lost at once when an arm comes off
  bleed: { elbow: [1.6, 12], shoulder: [2.4, 12], both: 9 },   // [blood per second, seconds]
  regenDelay: 6, regen: 2,           // seconds without bleeding before blood returns, and how fast
  respawn: 6,                        // seconds dead before coming back
  strip: 0.45,                       // below this share of its hp, a segment's flesh is torn off
  ripStretch: 1.3,                   // pull a held arm this many arm-lengths from its shoulder and it rips
  holdTime: 4,                       // seconds a held arm stays held if nobody rips it
  armour: [6, 8],                    // how much a helmet and a chest plate can take...
  wear: { fist: 1, sharp: 2, blunt: 3 },   // ...and how much each kind of blow takes off that (so a helmet stops 3 sword cuts, or 2 from a hammer)
};

export const ARM_PARTS = [['upperL', 'foreL'], ['upperR', 'foreR']];

export class Body {
  constructor() { this.reset(); }

  reset() {
    this.blood = BODY.blood;
    this.hp = { upperL: BODY.hp.upper, foreL: BODY.hp.fore, upperR: BODY.hp.upper, foreR: BODY.hp.fore, head: BODY.hp.head, torso: BODY.hp.torso };
    this.headOff = false;         // the head is gone...
    this.crushed = false;         // ...because it was burst, not knocked off
    this.halved = false;          // cut in two at the waist
    this.gen = (this.gen || 0) + 1;   // goes up every time the body is made whole again (so old bloodstains can be wiped)
    this.cut = [0, 0];            // per arm: 0 whole, 1 gone below the elbow, 2 gone at the shoulder
    this.bleeds = [];             // { rate, left, src } where src is an arm index, 'both' or 'body'
    this.dead = false;
    this.respawn = 0;
    this.held = [null, null];     // per arm: "playerId:hand" of whoever has hold of it
    this.holdT = [0, 0];
    this.calm = 0;                // seconds since last hurt or bleeding
    this.armour = [0, 0];         // what is left of the helmet and the chest plate (0: not wearing one)
  }

  /** Put on a helmet (slot 0) or a chest plate (slot 1). Returns false if one is already on. */
  wear(slot) {
    if (this.dead || !(slot === 0 || slot === 1) || this.armour[slot] > 0) return false;
    this.armour[slot] = BODY.armour[slot];
    return true;
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
   * `sharp` is for blades: they cut where a fist only bruises. `blunt` is for clubs and hammers.
   * Returns what happened: [{ type: 'hit', part, dmg }, { type: 'sever', arm, level, was },
   * { type: 'behead', crushed }, { type: 'bisect' }, { type: 'die' }], or, if armour took it,
   * just [{ type: 'armour', slot, left }] (left 0: that knocked it off).
   */
  hit(part, dmg, { sharp = false, blunt = false, pierce = false } = {}) {
    if (this.dead || !(dmg > 0)) return [];
    const slot = part === 'head' ? 0 : part === 'torso' ? 1 : -1;
    if (slot >= 0 && this.armour[slot] > 0 && !pierce) {       // pierce: an explosion, which armour is no help against
      this.armour[slot] = Math.max(0, this.armour[slot] - (blunt ? BODY.wear.blunt : sharp ? BODY.wear.sharp : BODY.wear.fist));
      return [{ type: 'armour', slot, left: this.armour[slot], dmg }];
    }
    const ev = [{ type: 'hit', part, dmg }];
    this.calm = 0;
    if (part === 'head') {
      this.blood -= dmg * 1.1; this.bleeds.push({ rate: dmg * 0.08, left: 4, src: 'body' });
      this.hp.head -= dmg * (sharp ? BODY.sharp.head : 1);
      if (this.hp.head <= 0) { ev.push(...this.behead(blunt)); return ev; }
    } else if (part === 'torso') {
      this.blood -= dmg * 0.6 * (sharp ? BODY.sharp.torso : 1); this.bleeds.push({ rate: dmg * 0.04, left: 4, src: 'body' });
      if (sharp) {
        // a blade that goes deep enough, or that lands the killing blow hard, goes right through
        this.hp.torso -= dmg * BODY.sharp.torso;
        if (this.hp.torso <= 0 || (this.blood <= 0 && dmg >= 25)) { ev.push(...this.bisect()); return ev; }
      }
    }
    else if (part in this.hp) {
      const arm = part.endsWith('L') ? 0 : 1, level = part.startsWith('fore') ? 1 : 2;
      if (this.cut[arm] >= level) return [];              // that piece is already gone
      this.hp[part] -= dmg * (sharp ? BODY.sharp.arm : 1);
      this.blood -= dmg * 0.2;
      if (this.hp[part] <= 0) ev.push(...this.sever(arm, level));
    } else return [];
    if (this.blood <= 0 && !this.dead) ev.push(...this._die());
    return ev;
  }

  /** The head comes off, or (crushed) bursts. Nobody survives that. */
  behead(crushed = false) {
    if (this.dead) return [];
    this.headOff = true; this.crushed = crushed;
    return [{ type: 'behead', crushed }, ...this._die()];
  }

  /** Cut in two at the waist. */
  bisect() {
    if (this.dead) return [];
    this.halved = true;
    return [{ type: 'bisect' }, ...this._die()];
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
  pack() { return [Math.round(this.blood), this.cut[0], this.cut[1], this.dead ? 1 : 0, this.held[0] || 0, this.held[1] || 0, this.bleeding, this.stripped, this.gen, this.armour[0] * 16 + this.armour[1]]; }
  /** Joined players: take the host's word for it. Returns true if anything visible changed. */
  apply(a) {
    const arm = a[9] || 0;
    const changed = this.cut[0] !== a[1] || this.cut[1] !== a[2] || this.dead !== !!a[3] || this._strip !== a[7] || this.armour[0] !== arm >> 4 || this.armour[1] !== (arm & 15);
    this.blood = a[0]; this.cut[0] = a[1]; this.cut[1] = a[2]; this.dead = !!a[3];
    this.armour[0] = arm >> 4; this.armour[1] = arm & 15;
    this.held[0] = a[4] || null; this.held[1] = a[5] || null;
    this._bleed = a[6]; this._strip = a[7]; this._gen = a[8];
    return changed;
  }
  /** What to draw: works on the host (real state) and for joined players (what the host sent). */
  get view() {
    return { cut: this.cut, dead: this.dead, bleeding: this._bleed ?? this.bleeding, stripped: this._strip ?? this.stripped, blood: this.blood, gen: this._gen ?? this.gen, armour: this.armour };
  }
}
