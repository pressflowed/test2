// Zombies: the rules. Waves of the dead come at whoever is in the priory (see PRIORY in
// maps.js); every blow and every kill earns points, and points buy weapons, armour, tonics
// and the doors to the rest of the place. It ends when everybody is dead at once.
// The host runs this (the Horde); everyone else is sent what it says (public()).
//
//   waiting  nobody here
//   intro    a few seconds to look about before the first wave
//   round    the dead keep coming until this round's number have been put down
//   break    a breather; the fallen get back up (whole again) for the next round
//   over     everybody is dead: the score, and then it starts again
import { PRIORY } from './maps.js';

export const ZOMBIES = {
  intro: 8, between: 9, over: 14,
  points: { start: 500, hit: 10, kill: 60, head: 100, board: 10, boardsPerRound: 10, fire: 400, nails: 200 },
  boards: 6,                  // planks on a window
  tear: 1,                    // (zombies pull one off with each blow they land on it)
  repair: 0.8,                // seconds for a player to put one back
  arrows: 24,                 // in a full quiver
  drop: { chance: 0.045, perRound: 3, life: 28, reach: 1.1 },
  power: { insta: 30, double: 30 },
  chest: { roll: 3.2, wait: 12 },
  trap: { on: 22, cool: 40 },
  cat: 2,                     // seconds you are safe after Nine Lives picks you up
  maxAlive: (round, players) => Math.min(4 + round + 2 * (players - 1), 9 + 2 * Math.min(players - 1, 2)),      // on their feet at once (a headset has to draw them all)
  count: (round, players) => Math.round((5 + 3 * round + 0.12 * round * round) * (1 + 0.5 * (players - 1))),
  every: round => Math.max(0.5, 2.4 - 0.16 * round),      // seconds between the dead arriving
  tough: round => 0.55 + 0.17 * round + (round > 10 ? 0.05 * (round - 10) ** 1.5 : 0),     // how many times a living body's worth of harm one takes
};

/** The kinds of dead. tough multiplies the round's toughness; pace is a gait in bots.js. */
export const KINDS = {
  walker: { label: 'Walker', pace: 'shuffle', dmg: 17, reach: 0.95, hitEvery: 1.25, scale: 1, tough: 1, color: 0x7d8f6a },
  lurcher: { label: 'Lurcher', pace: 'walk', dmg: 18, reach: 0.95, hitEvery: 1.1, scale: 1, tough: 1, color: 0x8f9478 },
  runner: { label: 'Runner', pace: 'jog', dmg: 16, reach: 0.95, hitEvery: 0.95, scale: 0.95, tough: 0.8, color: 0xa7a58c },
  brute: { label: 'Brute', pace: 'walk', dmg: 34, reach: 1.25, hitEvery: 1.5, scale: 1.5, tough: 4.5, color: 0x4f5d45, armour: true },
  bomber: { label: 'Bomber', pace: 'jog', dmg: 0, reach: 1.15, hitEvery: 0.6, scale: 1.05, tough: 0.7, color: 0xc0452c, bomb: true },
};

export const TONICS = {
  ox: { label: 'Ox Heart', text: 'Blows hurt you half as much', bit: 1, color: 0xc0392b },
  hare: { label: 'Hare Foot', text: 'You move faster', bit: 2, color: 0x4aa3df },
  bear: { label: 'Bear Arm', text: 'Your blows do much more', bit: 4, color: 0xd98a2b },
  cat: { label: 'Nine Lives', text: 'The next time you die, you do not', bit: 8, color: 0x8e5bd0 },
};

export const POWERUPS = {
  insta: { label: "Death's Touch", text: 'One blow kills', color: 0xf2f2f2 },
  double: { label: 'Double Points', text: 'Everything earns twice as much', color: 0xffd23f },
  nails: { label: 'Carpenter', text: 'Every window is boarded up again', color: 0xc58b4a },
  fire: { label: 'Holy Fire', text: 'Every one of them burns', color: 0xff7a2f },
  mend: { label: 'Mend', text: 'Everyone is whole again, with full quivers', color: 0x62d26f },
};
const POWER_KEYS = Object.keys(POWERUPS);

/** What the chest can hold: a weapon id, and whether it comes already forged. */
export const CHEST = [['sword', 0], ['axe', 0], ['spear', 0], ['hammer', 0], ['bow', 0], ['shield', 0], ['greatsword', 0], ['greatsword', 0], ['sword', 1], ['axe', 1], ['hammer', 1], ['dagger', 1], ['club', 1]];

/** Which kind turns up next in a round. */
export function pickKind(round, random = Math.random) {
  const r = random();
  if (round >= 6 && r < Math.min(0.04 + 0.01 * (round - 6), 0.12)) return 'bomber';
  const fast = Math.min(Math.max((round - 3) * 0.09, 0), 0.7), mid = Math.min(Math.max((round - 1) * 0.16, 0), 0.9);
  const k = random();
  return k < fast ? 'runner' : k < mid ? 'lurcher' : 'walker';
}

export class Horde {
  constructor(layout = PRIORY, random = Math.random) {
    this.L = layout;
    this.random = random;
    this.best = 0;
    this.reset();
  }

  reset() {
    const L = this.L;
    this.state = {
      phase: 'waiting', t: 0, round: 0, n: (this.state ? this.state.n : 0),
      left: 0,                                   // still to arrive this round
      alive: 0,                                  // on their feet right now (the session keeps this up to date)
      doors: L.doors.map(() => 0),               // 1: open
      boards: L.windows.map(() => ZOMBIES.boards),
      pl: {},                                    // id -> { pts, perks, kills, out, arrows, rep, safe }
      pow: { insta: 0, double: 0 },
      chest: { s: 'shut', t: 0, item: null, forged: 0, by: null },
      trap: { on: 0, cool: 0 },
      drops: [],                                 // { k, kind, x, z, t }
      kills: 0, dropped: 0, brutes: 0,
    };
    this._spawnT = 0; this._dropK = 0;
    return this.state;
  }

  player(id) {
    const pl = this.state.pl;
    return pl[id] || (pl[id] = { pts: ZOMBIES.points.start, perks: 0, kills: 0, out: 0, arrows: 0, bow: 0, rep: 0, safe: 0, downs: 0 });
  }
  has(id, tonic) { const p = this.state.pl[id]; return !!p && (p.perks & TONICS[tonic].bit) !== 0; }

  /** What everyone needs to know, small enough to send 20 times a second. */
  public() {
    const s = this.state, pl = {};
    for (const [id, p] of Object.entries(s.pl)) pl[id] = [p.pts, p.perks, p.kills, p.out, p.arrows];
    return {
      phase: s.phase, t: Math.max(0, Math.ceil(s.t)), round: s.round, n: s.n, left: s.left + s.alive, doors: s.doors.slice(), boards: s.boards.slice(), pl,
      pow: [Math.ceil(s.pow.insta), Math.ceil(s.pow.double)], chest: [s.chest.s, s.chest.item, s.chest.forged, Math.ceil(s.chest.t)], trap: [s.trap.on > 0 ? 1 : 0, Math.ceil(s.trap.on > 0 ? s.trap.on : s.trap.cool)],
      drops: s.drops.map(d => [d.k, d.kind, d.x, d.z]), kills: s.kills, best: this.best,
    };
  }

  /** The areas the players can get to: the first one, and whatever opened doors lead on to. */
  open() {
    const L = this.L, s = this.state, seen = new Set([L.start]);
    for (let again = true; again;) {
      again = false;
      L.doors.forEach((d, i) => {
        if (!s.doors[i] || seen.has(d.a) === seen.has(d.b)) return;
        seen.add(d.a); seen.add(d.b); again = true;
      });
    }
    return seen;
  }

  /** Everywhere the dead can turn up right now: [{ x, z, window (its number, or -1 for a grave) }]. */
  spawns() {
    const L = this.L, open = this.open(), out = [];
    L.windows.forEach((w, i) => { if (open.has(w.zone)) { const [x, z] = L.pit(w); out.push({ x, z, window: i, zone: w.zone }); } });
    if (open.has('yard')) for (const [x, z] of L.graves) out.push({ x, z, window: -1, zone: 'yard' });
    return out;
  }

  // one of them, where the living are: near enough to matter, not so near as to appear in your lap
  _where(alive) {
    const all = this.spawns();
    if (!alive.length || !all.length) return all[Math.floor(this.random() * all.length)] || null;
    const scored = all.map(sp => {
      let d = Infinity;
      for (const p of alive) d = Math.min(d, Math.hypot(sp.x - p.x, sp.z - p.z));
      // a grave under your feet stays shut; windows of the room you are in are favourites
      const w = sp.window < 0 && d < 5 ? 0 : 1 / (1 + Math.max(d - 4, 0) * 0.35);
      return { sp, w };
    }).filter(e => e.w > 0);
    let total = 0;
    for (const e of scored) total += e.w;
    let pick = this.random() * total;
    for (const e of scored) { pick -= e.w; if (pick <= 0) return e.sp; }
    return scored.length ? scored[scored.length - 1].sp : null;
  }

  /**
   * @param ids   the players in the room (not the dead that walk)
   * @param info  id -> { dead, x, z }
   * @returns events: { type: 'intro' } | { type: 'round', n } | { type: 'spawn', kind, x, z, window } |
   *          { type: 'break', n } | { type: 'up', id } (a fallen player gets back up) | { type: 'over', round } |
   *          { type: 'restart' } | { type: 'waiting' } | { type: 'chest', item, forged } | { type: 'chest-gone' } | { type: 'trap', on }
   */
  update(dt, ids, info) {
    const s = this.state, ev = [], Z = ZOMBIES;
    if (!ids.length) {
      if (s.phase !== 'waiting') { this.reset(); ev.push({ type: 'waiting' }); }
      return ev;
    }
    for (const id of ids) this.player(id);
    for (const id of Object.keys(s.pl)) if (!ids.includes(id)) delete s.pl[id];
    const alive = ids.filter(id => info[id] && !info[id].dead && !s.pl[id].out).map(id => info[id]);
    for (const p of Object.values(s.pl)) p.safe = Math.max(0, p.safe - dt);

    // timers that run whatever the phase
    s.pow.insta = Math.max(0, s.pow.insta - dt); s.pow.double = Math.max(0, s.pow.double - dt);
    if (s.trap.on > 0) { s.trap.on -= dt; if (s.trap.on <= 0) { s.trap.on = 0; s.trap.cool = Z.trap.cool; ev.push({ type: 'trap', on: 0 }); } }
    else s.trap.cool = Math.max(0, s.trap.cool - dt);
    for (const d of s.drops) d.t -= dt;
    s.drops = s.drops.filter(d => d.t > 0);
    const c = s.chest;
    if (c.s !== 'shut') {
      c.t -= dt;
      if (c.s === 'roll' && c.t <= 0) { c.s = 'ready'; c.t = Z.chest.wait; ev.push({ type: 'chest', item: c.item, forged: c.forged }); }
      else if (c.s === 'ready' && c.t <= 0) { c.s = 'shut'; c.item = null; ev.push({ type: 'chest-gone' }); }
    }

    if (s.phase === 'waiting') { s.phase = 'intro'; s.t = Z.intro; s.n++; ev.push({ type: 'intro' }); return ev; }
    s.t -= dt;
    if (s.phase === 'over') {
      if (s.t <= 0) { this.reset(); ev.push({ type: 'restart' }); }
      return ev;
    }
    // everybody dead at once ends it
    if ((s.phase === 'round' || s.phase === 'break') && !alive.length) {
      this.best = Math.max(this.best, s.round);
      s.phase = 'over'; s.t = Z.over;
      ev.push({ type: 'over', round: s.round });
      return ev;
    }
    if (s.phase === 'intro' || s.phase === 'break') {
      if (s.t <= 0) {
        s.round++;
        s.phase = 'round'; s.t = 0;
        s.left = Z.count(s.round, ids.length);
        s.dropped = 0;
        // every fifth round something big comes too
        s.brutes = s.round % 5 === 0 ? 1 + Math.floor(s.round / 10) : 0;
        for (const p of Object.values(s.pl)) p.rep = 0;
        this._spawnT = 1.5;
        ev.push({ type: 'round', n: s.round });
      }
      return ev;
    }
    // the round: keep them coming, up to as many as can be on their feet at once
    this._spawnT -= dt;
    if (s.left > 0 && this._spawnT <= 0 && s.alive < Z.maxAlive(s.round, ids.length)) {
      const sp = this._where(alive);
      if (sp) {
        let kind = pickKind(s.round, this.random);
        if (s.brutes > 0 && s.left <= Math.ceil(Z.count(s.round, ids.length) / 2)) { kind = 'brute'; s.brutes--; }
        s.left--; s.alive++;
        this._spawnT = Z.every(s.round) * (0.7 + 0.6 * this.random());
        ev.push({ type: 'spawn', kind, x: sp.x, z: sp.z, window: sp.window });
      }
    }
    if (s.left <= 0 && s.alive <= 0) {
      s.phase = 'break'; s.t = Z.between;
      ev.push({ type: 'break', n: s.round });
      // the fallen get back up
      for (const [id, p] of Object.entries(s.pl)) if (p.out) { p.out = 0; ev.push({ type: 'up', id }); }
    }
    return ev;
  }

  // ---- points
  earn(id, pts) {
    const p = this.state.pl[id];
    if (!p) return 0;
    const got = Math.round(pts * (this.state.pow.double > 0 ? 2 : 1));
    p.pts += got;
    return got;
  }
  /** A blow from a player landed on one of the dead. */
  hit(by) { return this.earn(by, ZOMBIES.points.hit); }
  /**
   * One of the dead is down for good. `by` is who did it (or null), `head` whether its head came
   * off, (x, z) where. Returns events: maybe { type: 'drop', kind, k, x, z }.
   */
  killed(by, head, x, z, kind = 'walker') {
    const s = this.state, ev = [];
    s.alive = Math.max(0, s.alive - 1);
    s.kills++;
    if (by && s.pl[by]) { s.pl[by].kills++; this.earn(by, head ? ZOMBIES.points.head : ZOMBIES.points.kill); }
    // now and then they leave something behind (a brute always does)
    const D = ZOMBIES.drop;
    if (s.phase === 'round' && (kind === 'brute' || (s.dropped < D.perRound && this.random() < D.chance)) && s.drops.length < 4) {
      const d = { k: ++this._dropK, kind: POWER_KEYS[Math.floor(this.random() * POWER_KEYS.length)], x, z, t: D.life };
      s.drops.push(d); s.dropped++;
      ev.push({ type: 'drop', ...d });
    }
    return ev;
  }
  /** One that was counted as on its feet has gone some other way (the session lost it). */
  gone() { this.state.alive = Math.max(0, this.state.alive - 1); }

  /** A player walked into something the dead left behind. Returns { kind } or null. */
  grab(id, x, z) {
    const s = this.state, i = s.drops.findIndex(d => Math.hypot(d.x - x, d.z - z) < ZOMBIES.drop.reach);
    if (i < 0 || !s.pl[id] || s.pl[id].out) return null;
    const [d] = s.drops.splice(i, 1);
    if (d.kind === 'insta') s.pow.insta = ZOMBIES.power.insta;
    else if (d.kind === 'double') s.pow.double = ZOMBIES.power.double;
    else if (d.kind === 'nails') { s.boards = s.boards.map(() => ZOMBIES.boards); for (const pid of Object.keys(s.pl)) this.earn(pid, ZOMBIES.points.nails); }
    else if (d.kind === 'fire') { for (const pid of Object.keys(s.pl)) this.earn(pid, ZOMBIES.points.fire); }
    else if (d.kind === 'mend') { for (const p of Object.values(s.pl)) if (p.bow) p.arrows = ZOMBIES.arrows; }
    return { kind: d.kind, by: id };
  }

  // ---- windows
  /** One of the dead pulls a board off a window. Returns how many are left. */
  tear(i) { const b = this.state.boards; if (b[i] > 0) b[i] -= ZOMBIES.tear; return b[i]; }
  /** A player puts one back. Returns the points earned (0 if it is whole, or they have had their fill this round). */
  repair(id, i) {
    const s = this.state, p = s.pl[id];
    if (!p || p.out || s.boards[i] === undefined || s.boards[i] >= ZOMBIES.boards) return -1;
    s.boards[i]++;
    if (p.rep >= ZOMBIES.points.boardsPerRound) return 0;
    p.rep++;
    return this.earn(id, ZOMBIES.points.board);
  }

  // ---- buying
  /**
   * A player tries to buy something. `what` is a shop's id, or 'door:3'. `holding` says what is in
   * their hand: { weapon: true, forged: false } or null. Returns { ok: false, why } or
   * { ok: true, kind, item, forged, cost, ... } for the session to carry out.
   */
  buy(id, what, holding = null, worn = [0, 0]) {
    const s = this.state, L = this.L, p = s.pl[id];
    if (!p || p.out || s.phase === 'over' || s.phase === 'waiting') return { ok: false, why: 'Not now' };
    const pay = cost => { if (p.pts < cost) return false; p.pts -= cost; return true; };
    const poor = cost => ({ ok: false, why: `You need ${cost}` });
    if (what.startsWith('door:')) {
      const i = Number(what.slice(5)), d = L.doors[i];
      if (!d) return { ok: false, why: 'No such door' };
      if (s.doors[i]) return { ok: false, why: 'Already open' };
      const open = this.open();
      if (!open.has(d.a) && !open.has(d.b)) return { ok: false, why: 'You cannot reach it' };
      if (!pay(d.cost)) return poor(d.cost);
      s.doors[i] = 1;
      return { ok: true, kind: 'door', door: i, cost: d.cost, opens: open.has(d.a) ? d.b : d.a };
    }
    const shop = L.shops.find(x => x.id === what);
    if (!shop) return { ok: false, why: 'Nothing here' };
    if (!this.open().has(shop.zone)) return { ok: false, why: 'You cannot reach it' };
    if (shop.kind === 'weapon') {
      // a bow you already have: this is a full quiver for it, at half the price
      const refill = shop.item === 'bow' && !!p.bow, cost = refill ? Math.round(shop.cost / 3) : shop.cost;
      if (refill && p.arrows >= ZOMBIES.arrows) return { ok: false, why: 'Your quiver is full' };
      if (!pay(cost)) return poor(cost);
      if (shop.item === 'bow') { p.arrows = ZOMBIES.arrows; p.bow = 1; }
      return { ok: true, kind: refill ? 'arrows' : 'weapon', item: shop.item, forged: 0, cost };
    }
    if (shop.kind === 'armour') {
      const slot = shop.item === 'helmet' ? 0 : 1;
      if (worn[slot] > 0) return { ok: false, why: 'You are wearing one' };
      if (!pay(shop.cost)) return poor(shop.cost);
      return { ok: true, kind: 'armour', item: shop.item, slot, cost: shop.cost };
    }
    if (shop.kind === 'tonic') {
      const t = TONICS[shop.item];
      if (p.perks & t.bit) return { ok: false, why: 'You have had that one' };
      if (!pay(shop.cost)) return poor(shop.cost);
      p.perks |= t.bit;
      return { ok: true, kind: 'tonic', item: shop.item, cost: shop.cost };
    }
    if (shop.kind === 'forge') {
      if (!holding || !holding.weapon) return { ok: false, why: 'Hold a weapon to the fire' };
      if (holding.forged) return { ok: false, why: 'It has been through the fire already' };
      if (!pay(shop.cost)) return poor(shop.cost);
      return { ok: true, kind: 'forge', cost: shop.cost };
    }
    if (shop.kind === 'chest') {
      if (s.chest.s !== 'shut') return { ok: false, why: s.chest.s === 'roll' ? 'Wait for it' : 'Take what is in it' };
      if (!pay(shop.cost)) return poor(shop.cost);
      const [item, forged] = CHEST[Math.floor(this.random() * CHEST.length)];
      s.chest = { s: 'roll', t: ZOMBIES.chest.roll, item, forged, by: id };
      if (item === 'bow') { p.arrows = ZOMBIES.arrows; p.bow = 1; }
      return { ok: true, kind: 'chest', cost: shop.cost };
    }
    if (shop.kind === 'trap') {
      if (s.trap.on > 0) return { ok: false, why: 'It is already sprung' };
      if (s.trap.cool > 0) return { ok: false, why: `Resetting: ${Math.ceil(s.trap.cool)}` };
      if (!pay(shop.cost)) return poor(shop.cost);
      s.trap.on = ZOMBIES.trap.on;
      return { ok: true, kind: 'trap', cost: shop.cost };
    }
    return { ok: false, why: 'Nothing here' };
  }
  /** The chest's weapon has been taken out. */
  took() { const c = this.state.chest; if (c.s === 'ready') { c.s = 'shut'; c.item = null; } }

  // ---- dying
  /**
   * A player has died. Returns 'saved' (Nine Lives: the session should make them whole instead)
   * or 'out' (they sit out until the round is over).
   */
  died(id) {
    const p = this.state.pl[id];
    if (!p) return 'out';
    if (p.perks & TONICS.cat.bit) { p.perks &= ~TONICS.cat.bit; p.safe = ZOMBIES.cat; return 'saved'; }
    p.out = 1; p.downs++;
    p.perks = 0;              // tonics do not outlast you
    return 'out';
  }

  /** By how much to multiply the harm of a blow from a player (bear arm, a forged weapon, death's touch). */
  power(id, forged = false) {
    if (this.state.pow.insta > 0) return 1000;
    return (this.has(id, 'bear') ? 1.75 : 1) * (forged ? 2 : 1);
  }
  /** By how much to multiply the harm of a blow to a player. */
  armour(id) { const p = this.state.pl[id]; return !p ? 1 : p.safe > 0 ? 0 : this.has(id, 'ox') ? 0.5 : 1; }
}

/**
 * What a player could buy, open or mend from where they are: { what, label, cost, pos: [x, y, z] }
 * or null. `hands` are their hand positions and `head`/`look` where they are and the way they
 * face (all {x, y, z}); `mine` is their own entry in public().pl. Something counts if a hand is
 * on it, or if they are standing in front of it looking at it.
 */
export function within(L, st, hands, head, look, mine = null) {
  if (!st || st.phase === 'waiting' || st.phase === 'over') return null;
  let best = null, bd = Infinity;
  const consider = (pos, reach, far, make) => {
    let d = Infinity;
    for (const h of hands) d = Math.min(d, Math.hypot(h.x - pos[0], h.y - pos[1], h.z - pos[2]));
    if (d > reach) {
      // not touching it: are they looking at it from close by?
      const dx = pos[0] - head.x, dy = pos[1] - head.y, dz = pos[2] - head.z, len = Math.hypot(dx, dy, dz);
      if (len > far || (dx * look.x + dy * look.y + dz * look.z) / (len || 1) < 0.82) return;
      d = reach + len;
    }
    if (d < bd) { bd = d; best = make(); best.pos = pos; }
  };
  L.doors.forEach((d, i) => {
    if (st.doors[i]) return;
    consider([d.x, 1.4, d.z], 0.8, 2.2, () => ({ what: 'door:' + i, label: `Open the door  ·  ${d.cost}`, cost: d.cost }));
  });
  for (const s of L.shops) {
    const cost = s.cost;
    const label = s.kind === 'tonic' ? `${TONICS[s.item].label}: ${TONICS[s.item].text}  ·  ${s.cost}`
      : s.kind === 'chest' ? (st.chest[0] === 'shut' ? `Mystery chest  ·  ${s.cost}` : st.chest[0] === 'roll' ? 'Wait for it...' : 'Take it!')
        : s.kind === 'forge' ? `Forge your weapon (twice the harm)  ·  ${s.cost}`
          : s.kind === 'trap' ? (st.trap[0] ? `Spikes are up: ${st.trap[1]}` : st.trap[1] ? `Spikes resetting: ${st.trap[1]}` : `Spring the spikes  ·  ${s.cost}`)
            : `${s.item === 'chestplate' ? 'Chest plate' : s.item === 'hammer' ? 'War hammer' : s.id[0].toUpperCase() + s.id.slice(1)}  ·  ${cost}${s.item === 'bow' ? '  (again: arrows)' : ''}`;
    // (cost 0: there is nothing to pay for just now, only something to be told)
    const idle = (s.kind === 'chest' && st.chest[0] !== 'shut') || (s.kind === 'trap' && (st.trap[0] || st.trap[1]));
    consider(s.pos, 0.65, 1.9, () => ({ what: s.id, label, cost: idle ? 0 : cost }));
  }
  L.windows.forEach((w, i) => {
    if (st.boards[i] >= ZOMBIES.boards) return;
    consider([w.x + w.nx * 0.35, 1.2, w.z + w.nz * 0.35], 0.95, 1.8, () => ({ what: 'window:' + i, label: `Board it up (${st.boards[i]} of ${ZOMBIES.boards})`, cost: 0 }));
  });
  return best;
}
