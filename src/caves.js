// The horror mode's rules: money. You dig ore out of the walls of the Deep (see CAVE in
// maps.js), carry it back in your bag, feed it to the crusher, and spend what it pays on
// better kit. The host runs this (the Mine); everyone else is sent what it says (public()).
// What hunts you down there is in bots.js (the 'stalker' brain) and session.js.

/** What each kind of ore is worth, and how much rock (blocks of it) makes one lump. */
export const ORES = {
  copper: { label: 'Copper', value: 8, per: 4 },
  iron: { label: 'Iron', value: 15, per: 4 },
  gold: { label: 'Gold', value: 40, per: 5 },
  crystal: { label: 'Crystal', value: 100, per: 5 },
};
export const ORE_KEYS = Object.keys(ORES);

/** What the shop sells. need: something you must have first. */
export const UPGRADES = {
  pick: { label: 'Pickaxe', cost: 0, text: 'A spare, if you have lost yours' },
  pick2: { label: 'Steel pickaxe', cost: 150, text: 'Takes a bigger bite of ore' },
  pick3: { label: 'Diamond pickaxe', cost: 600, text: 'Takes the biggest bite', need: 'pick2' },
  bag2: { label: 'Big bag', cost: 120, text: 'Holds 16 lumps' },
  bag3: { label: 'Huge bag', cost: 450, text: 'Holds 28 lumps', need: 'bag2' },
  lamp2: { label: 'Bright lamp', cost: 200, text: 'A wider, longer beam' },
  tracker: { label: 'Monster tracker', cost: 250, text: 'Shows how near the nearest one is, and which way' },
  gloves: { label: 'Climbing gloves', cost: 300, text: 'You move faster' },
  hat: { label: 'Hard hat', cost: 180, text: 'Takes a few blows to the head' },
};
const BITS = Object.fromEntries(Object.keys(UPGRADES).map((k, i) => [k, 1 << i]));

export const DEEP = {
  bag: [8, 16, 28],                 // lumps the bag holds, by size
  bite: [0.3, 0.42, 0.56],          // how much a pickaxe takes at a swing (metres across... ish), by kind
  monsters: earned => Math.min(2 + Math.floor(earned / 500), 4),
  // what hunts: how it is built, and how well it sees and hears
  monster: { scale: 1.45, color: 0xa7a296, dmg: 40, reach: 1.25, hitEvery: 1.0, tough: 7, sight: 16, hear: 22, memory: 5, search: 12, back: 25 },
};

export class Mine {
  constructor() { this.reset(); }
  reset() { this.state = { pl: {}, earned: 0 }; }
  player(id) {
    const pl = this.state.pl;
    return pl[id] || (pl[id] = { money: 0, up: 0, bag: [0, 0, 0, 0], frac: [0, 0, 0, 0] });
  }
  has(id, key) { const p = this.state.pl[id]; return !!p && (p.up & BITS[key]) !== 0; }
  pick(id) { return this.has(id, 'pick3') ? 2 : this.has(id, 'pick2') ? 1 : 0; }
  cap(id) { return DEEP.bag[this.has(id, 'bag3') ? 2 : this.has(id, 'bag2') ? 1 : 0]; }
  carrying(id) { return this.player(id).bag.reduce((a, b) => a + b, 0); }
  /** What everyone needs to know: id -> [money, upgrades (bits), in the bag, bag size, copper, iron, gold, crystal]. */
  public() {
    const pl = {};
    for (const [id, p] of Object.entries(this.state.pl)) pl[id] = [p.money, p.up, this.carrying(id), this.cap(id), ...p.bag];
    return { pl, earned: this.state.earned };
  }
  keep(ids) { for (const id of ids) this.player(id); for (const id of Object.keys(this.state.pl)) if (!ids.includes(id)) delete this.state.pl[id]; }

  /** A player dug out `blocks` blocks of an ore: how many whole lumps does that make (the odd bits add up)? */
  dug(id, ore, blocks) {
    const p = this.player(id), k = ORE_KEYS.indexOf(ore);
    if (k < 0) return 0;
    p.frac[k] += blocks * (1 + 0.35 * this.pick(id));          // a better pickaxe wastes less
    const lumps = Math.floor(p.frac[k] / ORES[ore].per);
    p.frac[k] -= lumps * ORES[ore].per;
    return lumps;
  }
  /** Put a lump in the bag. False if it is full. */
  stow(id, ore) {
    const k = ORE_KEYS.indexOf(ore);
    if (k < 0 || this.carrying(id) >= this.cap(id)) return false;
    this.player(id).bag[k]++;
    return true;
  }
  /** Tip the whole bag into the crusher. Returns the money it made. */
  sell(id) {
    const p = this.player(id);
    let got = 0;
    p.bag.forEach((n, k) => { got += n * ORES[ORE_KEYS[k]].value; });
    p.bag = [0, 0, 0, 0];
    p.money += got; this.state.earned += got;
    return got;
  }
  /** One lump thrown straight into the hopper. */
  crush(id, ore) {
    const v = ORES[ore] ? ORES[ore].value : 0;
    if (id) this.player(id).money += v;
    this.state.earned += v;
    return v;
  }
  /** Buy something from the shop: { ok, why } or { ok: true, key, cost }. */
  buy(id, key) {
    const u = UPGRADES[key], p = this.player(id);
    if (!u) return { ok: false, why: 'Nothing here' };
    if (key !== 'pick' && key !== 'hat' && (p.up & BITS[key])) return { ok: false, why: 'You have that' };
    if (u.need && !(p.up & BITS[u.need])) return { ok: false, why: `Get the ${UPGRADES[u.need].label.toLowerCase()} first` };
    if (p.money < u.cost) return { ok: false, why: `You need $${u.cost}` };
    p.money -= u.cost;
    if (key !== 'pick' && key !== 'hat') p.up |= BITS[key];
    return { ok: true, key, cost: u.cost };
  }
  /** A player died: whatever was in the bag is gone. Returns how many lumps that was. */
  died(id) { const p = this.player(id), n = this.carrying(id); p.bag = [0, 0, 0, 0]; return n; }
}

/**
 * What a player at the camp could use from where they are: { what, label, cost, pos } or null.
 * `what` is a shop key, or 'sell'. A hand on the sign, or standing looking at it.
 */
export function campNear(C, mine, hands, head, look) {
  let best = null, bd = Infinity;
  const consider = (pos, reach, far, what, label, cost) => {
    let d = Infinity;
    for (const h of hands) d = Math.min(d, Math.hypot(h.x - pos[0], h.y - pos[1], h.z - pos[2]));
    if (d > reach) {
      const dx = pos[0] - head.x, dy = pos[1] - head.y, dz = pos[2] - head.z, len = Math.hypot(dx, dy, dz);
      if (len > far || (dx * look.x + dy * look.y + dz * look.z) / (len || 1) < 0.9) return;
      d = reach + len;
    }
    if (d < bd) { bd = d; best = { what, label, cost, pos }; }
  };
  for (const s of C.shops) {
    const u = UPGRADES[s.id], have = mine && s.id !== 'pick' && s.id !== 'hat' && (mine[1] & BITS[s.id]);
    consider(s.pos, 0.5, 2.6, s.id, have ? `${u.label}: you have it` : `${u.label}: ${u.text}  ·  ${u.cost ? '$' + u.cost : 'free'}`, have ? -1 : u.cost);
  }
  const n = mine ? mine[2] : 0;
  consider(C.crusher.pos, 0.9, 2.6, 'sell', n ? `Tip your bag into the crusher (${n} lump${n === 1 ? '' : 's'})` : 'The crusher: bring it ore', n ? 0 : -1);
  return best;
}
