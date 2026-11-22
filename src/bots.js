// Bots. They get about exactly the way players do: by planting a hand on the ground and
// pulling themselves along (the same physics, see locomotion.js), one hand after the
// other, faster or slower depending on what they are up to. They find their way with
// the navigation grid (nav.js).
//
// What a bot does is its "brain":
//   dummy    (sandbox) wanders about, looks at you, scrambles away when hit or grabbed
//   still    stays put and watches (the arena's crowd)
//   fight    (arena) goes for its opponent: closes in, circles, strikes, guards, backs off when hurt
//   zombie   goes for the nearest living player by the shortest way, tears down barricades
//            in its path, and claws at whoever it reaches
// The host runs them; to everyone else they look like any other player.
import * as THREE from 'three';
import { Locomotion } from './locomotion.js';
import { restGrip, ARMED_GRIP } from './avatar.js';

const UP = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
const COLORS = [0xe0ac86, 0xb97a56, 0x7a4a30, 0x9ec7a0, 0xa9b6d8, 0xd8a9c8];
const HEAD = new THREE.Vector3(0, 1.5, 0);      // where the head is in the bot's own play space
const FLOOR = 0.8;                              // how far below the head the ground is when it rests on it
const GRIP = [restGrip(1), restGrip(-1)];
export const MAX_BOTS = 6;
export const GLADIATORS = ['Brutus', 'Maximus', 'Spartacus', 'Crixus', 'Flamma', 'Priscus', 'Verus', 'Commodus'];
const SWING = 0.3;      // seconds from winding up to landing a blow

// How a bot moves at each pace: how far a hand pulls (m), how long the pull takes, how much it
// pushes the body up, and the pause before the other hand goes. As for a player, a pull only
// speeds the body up if the hand goes back faster than the ground is already passing, so the
// speed a bot settles at is set by how fast it pulls: about one and a half times len / pull as
// it lets go, and rather less on average. Slow paces drag along the ground; fast ones leave it
// between strokes.
export const GAITS = {
  shuffle: { len: 0.34, pull: 0.36, lift: 0.03, rest: 0.1 },
  walk: { len: 0.44, pull: 0.30, lift: 0.05, rest: 0.06 },
  jog: { len: 0.54, pull: 0.24, lift: 0.09, rest: 0.03 },
  run: { len: 0.64, pull: 0.21, lift: 0.13, rest: 0.02 },
  // both hands at once, mostly down: a jump
  hop: { len: 0.26, pull: 0.11, lift: 0.3, rest: 0.1, both: true },
};
const REST = 0, REACH = 1, PLANT = 2, PULL = 3;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3();
const turnTo = (from, to, most) => { let d = to - from; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return from + Math.max(-most, Math.min(most, d)); };

export class Bot {
  /**
   * @param opts name, color, scale; brain ('dummy' | 'still' | 'fight' | 'zombie'); for zombies also
   *             pace (a GAITS name), reach (m), hitEvery (s between blows), tag (shown to nobody: the kind)
   */
  constructor(id, n, world, pos, opts = {}) {
    if (typeof opts === 'string') opts = { name: opts };
    this.id = id;
    this.name = opts.name === undefined ? `Dummy ${n}` : opts.name;
    this.color = opts.color ?? COLORS[(n - 1) % COLORS.length];
    this.brain = opts.brain || 'dummy';
    this.pace = opts.pace || 'walk';
    this.reach = opts.reach || 0.95;
    this.hitEvery = opts.hitEvery || 1.1;
    this.tag = opts.tag || null;
    this.alert = opts.alert ?? 0.6;           // how often a fighter sees a blow coming in time to guard against it (0..1)
    this.loco = new Locomotion(world);
    if (opts.scale && opts.scale !== 1) this.loco.setScale(opts.scale, HEAD);
    this.loco.teleport(pos);
    this.home = pos.clone();
    this.yaw = Math.random() * Math.PI * 2;
    this.faceYaw = this.yaw;
    this.wait = 0.5 + Math.random() * 2;      // seconds until it next decides to do something
    this.flinch = 0;
    this.t = Math.random() * 10;
    this.swing = 0;                           // seconds left of the blow it is throwing
    this.cool = 0;                            // seconds until it may throw another
    this.strike = false;                      // a blow landed this frame (the session works out what it hit)
    this.target = null;                       // who that blow was meant for (zombies; a fighter has only the one opponent)
    this.events = [];                         // other things it did this frame: { type: 'tear', id } | { type: 'lost' }
    this.weaponHand = -1;                     // the hand it holds a weapon in, if any (the session keeps this up to date)
    this.shieldHand = -1;                     // the hand it holds a shield in, likewise: that one stays up in front of it
    this.guard = 0;                           // 0..1: how high it has its shield (or weapon) up against a blow
    this.caught = null;                       // set by the session if the blow it is throwing has run into a guard
    this.lastTip = null;
    // what it wants this frame (the brain sets these; the body does its best)
    this.move = new THREE.Vector3();          // which way to go (on the level; length is effort, 0..1)
    this.gait = 'walk';
    this.hop = false;                         // the next stroke should be a jump
    this.leap = null;                         // ...and this (a velocity) is what it should launch with
    this.aim = null;                          // a point its free hand reaches for (a zombie's arms)
    // strokes
    this.strokes = [0, 1].map(() => ({ phase: REST, t: 0, len: 0, lift: 0, pull: 0.2, dir: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), base: new THREE.Vector3(), off: new THREE.Vector3(0, -0.62, -0.12) }));
    this.next = Math.random() < 0.5 ? 0 : 1;  // which hand strokes next
    this.pause = 0;                           // seconds before the next stroke may start
    // getting unstuck, and odds and ends for the brains
    this._was = pos.clone(); this._stuckT = 0; this._stuck = 0;
    this._dir = new THREE.Vector3(); this._dirT = 0; this._dirOk = false; this._aim = new THREE.Vector3(); this._turn = 1;
    this.ease = 1;                            // 0.3..1: how much of a full stroke to take (less when there is a corner to get round)
    this._circle = Math.random() < 0.5 ? -1 : 1; this._circleT = 1; this._retreat = 0; this._goal = null; this._tearT = 0; this._leapT = 0;
    this.pose = {
      head: { pos: new THREE.Vector3(), quat: new THREE.Quaternion() },
      hands: [0, 1].map(() => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion() })),
      scale: this.loco.scale,
    };
    this._locals = [new THREE.Vector3(), new THREE.Vector3()];
    this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion();
    this._fresh = true;                       // the hands go straight to where they belong the first time
    this.update(0.016, null);
  }

  /** Knocked by a hit: stagger away. */
  knock(dir, strength) {
    this.loco.vel.addScaledVector(dir, strength);
    this.loco.vel.y += strength * 0.6;
    this.flinch = 0.8;
    for (const s of this.strokes) s.phase = REST;
    this.pause = 0.35;
  }

  /** Throw your arms up (the crowd does this when a blow lands). */
  cheer() { this.flinch = Math.max(this.flinch, 0.5 + Math.random() * 0.5); }

  /** Put it somewhere, facing a way, and make that its home. */
  place(pos, yaw = this.yaw) {
    this.loco.teleport(pos);
    this.home.copy(pos);
    this.yaw = this.faceYaw = yaw;
    this.wait = 0.5; this.swing = 0; this.cool = 0.8; this.strike = false;
    for (const s of this.strokes) s.phase = REST;
    this._goal = null; this._stuck = 0; this._stuckT = 0; this._was.copy(pos);
  }

  respawn() {
    const a = Math.random() * Math.PI * 2;
    this.loco.teleport(this.home.clone().add(new THREE.Vector3(Math.cos(a) * 1.5, 0.2, Math.sin(a) * 1.5)));
    this.wait = 1;
    for (const s of this.strokes) s.phase = REST;
  }

  /** Throw a blow now (if it is not already throwing one). */
  attack(target = null) {
    if (this.swing > 0 || this.cool > 0) return false;
    this.swing = SWING; this.target = target;
    return true;
  }

  // ------------------------------------------------------------------ brains
  /**
   * Decide what to do this frame. `ctx` is what the session knows:
   *   nav         the navigation grid (or null: then it just heads straight for things)
   *   near        (dummy) where the nearest player's head is, or null
   *   foe         (fight) { pos, threat (0..1: are they swinging at me), blood } or null: stand and wait
   *   goal        (fight) somewhere to go first (out of its room), or null
   *   reach       (fight) how far its blows reach
   *   field       (fight, zombie) a nav field leading to the foe / to the nearest living player
   *   foes        (zombie) [{ id, pos }] the living players
   *   barricades  (zombie) [{ id, pos, nx, nz, boards }] boarded-up ways in; (nx, nz) points inside
   *   crowd       [Vector3] where the other bots are, to keep out of each other's way
   */
  think(dt, body, pulledFrom, ctx = {}) {
    const lo = this.loco, at = lo.head, alive = !body || !body.dead;
    this.move.set(0, 0, 0); this.aim = null; this.events.length = 0;
    this.gait = 'walk'; this.ease = 1;
    this.wait -= dt;
    this._leapT -= dt;
    if (!alive) return;
    const nav = ctx.nav;
    // head for a place: by the grid if there is one and a way, otherwise straight at it
    const toward = (p, field) => {
      if (nav && field) {
        // (asked afresh a few times a second: the way does not change faster than that)
        this._dirT -= dt;
        if (this._dirT <= 0) {
          const aim = nav.dir(field, at.x, at.z, this._dir);
          this._dirOk = aim >= 0 && this._dir.lengthSq() > 0;
          if (this._dirOk) { nav.pos(aim, this._aim); this._turn = nav.turn; }
          this._dirT = 0.12 + Math.random() * 0.06;
        }
        if (this._dirOk) {
          // A sharp turn coming up, and close? Then shorter pulls, so as not to lunge straight past it.
          if (this._turn < 0.6) this.ease = Math.min(this.ease, Math.max(0.35, Math.hypot(this._aim.x - at.x, this._aim.z - at.z) / 1.5));
          this.move.copy(this._dir);
          return true;
        }
      }
      this.move.set(p.x - at.x, 0, p.z - at.z);
      const len = this.move.length();
      if (len < 0.05) { this.move.set(0, 0, 0); return false; }
      this.move.divideScalar(len);
      return true;
    };
    const face = p => { this.faceYaw = Math.atan2(-(p.x - at.x), -(p.z - at.z)); };
    const flat = p => Math.hypot(p.x - at.x, p.z - at.z);

    if (pulledFrom) {
      // someone has its arm: get away from them as fast as one arm will take it (which is how arms come off)
      if (this.wait > 0.3) this.wait = 0.3;
      if (this.wait <= 0) {
        this.move.set(at.x - pulledFrom.x, 0, at.z - pulledFrom.z).normalize();
        this.faceYaw = Math.atan2(-this.move.x, -this.move.z);
        this.gait = 'run';
      }
    } else if (this.brain === 'zombie') this._zombie(dt, ctx, toward, face, flat);
    else if (this.brain === 'stalker') this._stalker(dt, ctx, toward, face, flat);
    else if (this.brain === 'fight') this._fight(dt, body, ctx, toward, face, flat);
    else if (this.brain === 'dummy') this._dummy(dt, ctx, toward, face, flat);
    else if (ctx.near) face(ctx.near);

    // keep out of the others' laps
    if (ctx.crowd && this.move.lengthSq() > 0) {
      for (const p of ctx.crowd) {
        const dx = at.x - p.x, dz = at.z - p.z, d = Math.hypot(dx, dz);
        if (d > 0.01 && d < 0.75) { this.move.x += dx / d * (0.75 - d) * 1.6; this.move.z += dz / d * (0.75 - d) * 1.6; }
      }
      if (this.move.lengthSq() > 1) this.move.normalize();
    }
    // a step up ahead: hop it
    if (nav && this.move.lengthSq() > 0.01) {
      const here = nav.nearest(at.x, at.z, 1), there = nav.index(at.x + this.move.x * 0.55, at.z + this.move.z * 0.55);
      if (here >= 0 && nav.ok(there) && nav.floor[there] - (at.y - FLOOR * lo.scale) > 0.2) this.hop = true;
    }
    // not getting anywhere: jump, try a way round, and in the end say so
    this._stuckT += dt;
    this._tryT = this.move.lengthSq() > 0.05 && this.swing <= 0 && this._tearT <= 0 ? (this._tryT || 0) + dt : 0;
    if (this._stuckT > 1) {
      const trying = this._tryT > 0.95;          // (it has been trying to move for the whole of the last second)
      if (trying && this._was.distanceTo(at) < 0.25) {
        this._stuck++;
        this.hop = true;
        this._side = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random());
        if (this._stuck >= 5) { this.events.push({ type: 'lost' }); this._stuck = 0; }
      } else { this._stuck = 0; this._side = 0; }
      this._stuckT = 0; this._was.copy(at);
    }
    if (this._side && this.move.lengthSq() > 0) { this.move.set(this.move.x - this.move.z * this._side, 0, this.move.z + this.move.x * this._side).normalize(); }
  }

  _dummy(dt, ctx, toward, face, flat) {
    const at = this.loco.head;
    if (this.wait > 600) { this._goal = null; return; }          // told to stay put (tests do this): it does not so much as turn its head
    if (this.flinch > 0.05 && ctx.near) {
      // just been hit: scramble away from whoever is nearest
      this.move.set(at.x - ctx.near.x, 0, at.z - ctx.near.z).normalize();
      this.faceYaw = Math.atan2(-this.move.x, -this.move.z);
      this.gait = 'jog'; this._goal = null; this.wait = Math.max(this.wait, 1.2);
      return;
    }
    if (this._goal) {
      if (flat(this._goal) < 0.5 || this.wait < -6) { this._goal = null; this.wait = 1 + Math.random() * 3; }
      else { toward(this._goal, null); this.faceYaw = Math.atan2(-this.move.x, -this.move.z); return; }
    }
    if (ctx.near && flat(ctx.near) < 6) face(ctx.near);          // it watches you
    if (this.wait > 0) return;
    if (Math.random() < 0.75) {
      // wander: somewhere near, or homeward if it has strayed
      const far = Math.hypot(at.x - this.home.x, at.z - this.home.z) > 7, from = far ? this.home : at;
      const a = Math.random() * Math.PI * 2, d = 1.5 + Math.random() * 3;
      const goal = new THREE.Vector3(from.x + Math.cos(a) * d, 0, from.z + Math.sin(a) * d);
      if (!ctx.nav || (ctx.nav.ok(ctx.nav.index(goal.x, goal.z)) && ctx.nav.clear(at.x, at.z, goal.x, goal.z)) || far) this._goal = goal;
      this.wait = 0;
    } else this.wait = 1 + Math.random() * 2;   // or just stand there
  }

  _fight(dt, body, ctx, toward, face, flat) {
    const foe = ctx.foe;
    this.guard = Math.max(0, this.guard - dt * 2.5);
    if (!foe) return;
    const reach = ctx.reach || this.reach, d = flat(foe.pos), at = this.loco.head;
    if (ctx.goal) { toward(ctx.goal, null); this.faceYaw = Math.atan2(-this.move.x, -this.move.z); this.gait = 'jog'; return; }
    const inSight = !ctx.nav || ctx.nav.clear(at.x, at.z, foe.pos.x, foe.pos.z);
    if (d > reach + 1.6 || !inSight) {
      // close in, by the shortest way
      toward(foe.pos, ctx.field);
      this.faceYaw = Math.atan2(-this.move.x, -this.move.z);
      this.gait = d > reach + 5 ? 'run' : d > reach + 2.6 ? 'jog' : 'walk';        // it slows as it closes, so as not to skid into their lap
      return;
    }
    face(foe.pos);
    // they are swinging: get something in the way (if it sees it coming, which it does not always)
    if (foe.threat > 0.3) {
      if (!this._seen) { this._seen = true; this._react = Math.random() < this.alert; }
      if (this._react) this.guard = Math.min(1, this.guard + dt * 9);
    } else this._seen = false;
    // badly hurt, and worse off than them: back off for a bit and make them come
    this._retreat -= dt;
    if (this._retreat <= -4 && body && body.blood < 40 && foe.blood > body.blood + 15) this._retreat = 2 + Math.random() * 1.5;
    const want = this._retreat > 0 ? reach + 2.2 : reach * 0.82;
    this._circleT -= dt;
    if (this._circleT <= 0) { this._circle = -this._circle; this._circleT = 1.2 + Math.random() * 1.8; }
    const rx = (foe.pos.x - at.x) / (d || 1), rz = (foe.pos.z - at.z) / (d || 1), radial = Math.max(-1, Math.min(1, (d - want) * 2.2));
    this.move.set(rx * radial - rz * this._circle * 0.55, 0, rz * radial + rx * this._circle * 0.55);
    if (this.move.lengthSq() > 1) this.move.normalize();
    this.gait = this._retreat > 0 ? 'jog' : 'walk';
    // close to where it wants to be, it takes small steps (a full stride would carry it straight into them)
    if (this._retreat <= 0) this.ease = Math.min(1, Math.max(0.4, Math.abs(d - want) / 0.9));
    if (d < want * 0.55) { this.move.set(-rx, 0, -rz); this.ease = 1; }           // too close: straight back out
    if (this._retreat <= 0 && d < reach * 1.02 && this.cool <= 0 && this.swing <= 0 && this.flinch <= 0.3) {
      this.swing = SWING;
      this.cool = 0.75 + Math.random() * 0.8;
      this.guard = 0;
    }
  }

  _zombie(dt, ctx, toward, face, flat) {
    const at = this.loco.head, s = this.loco.scale;
    this.gait = this.pace;
    this._tearT -= dt;
    // a boarded-up way in, right in front: stop and pull it down
    for (const b of ctx.barricades || []) {
      if (b.boards <= 0) continue;
      const dx = at.x - b.pos.x, dz = at.z - b.pos.z, along = dx * b.nx + dz * b.nz;      // negative: still outside it
      if (along > 0.2 || along < -1.5 || Math.abs(dx * b.nz - dz * b.nx) > 0.9) continue;
      face(b.pos);
      this.aim = b.pos;
      if (along < -0.75) { this.move.set(b.nx, 0, b.nz); this.gait = 'shuffle'; }
      else if (this.cool <= 0 && this.swing <= 0) { this.swing = SWING; this.cool = this.hitEvery * 1.2; this.target = null; this._tear = b.id; }
      this._tearT = 0.5;
      return;
    }
    this._tear = null;
    // who to go for: whoever is nearest by the way there (the field knows); up close, whoever is in reach
    let best = null, bd = Infinity;
    for (const f of ctx.foes || []) { const d = at.distanceTo(f.pos); if (d < bd) { bd = d; best = f; } }
    if (!best) return;
    const d = flat(best.pos), up = best.pos.y - at.y;
    const close = d < 2.5 && (!ctx.nav || ctx.nav.clear(at.x, at.z, best.pos.x, best.pos.z));
    if (close || !ctx.field) { this.move.set(best.pos.x - at.x, 0, best.pos.z - at.z); if (d > 0.01) this.move.divideScalar(d); }
    else toward(best.pos, ctx.field);
    if (d < 4) { face(best.pos); this.aim = best.pos; } else if (this.move.lengthSq() > 0) this.faceYaw = Math.atan2(-this.move.x, -this.move.z);
    const reach = this.reach * s;
    if (d < reach && Math.abs(up) < 1.1 * s) {
      if (d < reach * 0.6) this.move.set(0, 0, 0);                   // near enough: stand and claw
      if (this.cool <= 0 && this.swing <= 0 && this.flinch <= 0.2) { this.swing = SWING; this.cool = this.hitEvery * (0.85 + Math.random() * 0.3); this.target = best.id; }
    } else if (up > 0.9 * s && d < 3.2 && this._leapT <= 0 && this.loco.grounded) {
      // they are up on something: jump for them
      this.hop = true; this._leapT = 2.4;
      const vy = Math.min(Math.sqrt(2 * 9.8 * (up + 0.5)), 8.5), tt = vy / 9.8;
      this.leap = new THREE.Vector3((best.pos.x - at.x) / tt * 0.9, vy, (best.pos.z - at.z) / tt * 0.9);
    }
  }

  // What hunts in the Deep. It walks from cavern to cavern, turning its head as it goes; a sound
  // (somebody mining) brings it to look; and anyone it sees in front of it, it runs down. When it
  // loses them it goes to where it saw them last, stands turning this way and that for a while,
  // and then goes back to its rounds. ctx: prey [{ id, pos, seen, safe }], noises [{ pos, t }],
  // nodes [{ x, z, depth }], M (how well it sees, hears and remembers), field (the way to this.want).
  _stalker(dt, ctx, toward, face, flat) {
    const at = this.loco.head, M = ctx.M || { sight: 16, hear: 22, memory: 5, search: 12 }, s = this.loco.scale;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    this.mood = this.mood || 'roam';
    this.moodT = (this.moodT || 0) + dt;
    this.last = this.last || new THREE.Vector3();
    const go = mood => { this.mood = mood; this.moodT = 0; };
    // who can it see? Anyone in line of sight who is in front of it (or right beside it; or whom it is already after)
    let seen = null, sd = Infinity;
    for (const p of ctx.prey || []) {
      if (p.safe || !p.seen) continue;
      const dx = p.pos.x - at.x, dz = p.pos.z - at.z, d = Math.hypot(dx, dz) || 1;
      if ((d < 3.5 || (dx * fx + dz * fz) / d > 0.1 || this.mood === 'chase') && d < sd) { sd = d; seen = p; }
    }
    if (seen) {
      if (this.mood !== 'chase') this.events.push({ type: 'spot', target: seen.id });
      if (this.mood !== 'chase') go('chase');
      this.prey = seen.id; this.last.copy(seen.pos); this._lost = 0;
    }
    if (this.mood === 'chase') {
      this.gait = 'run';
      this.want = this.last;
      if (!seen) {
        // out of sight: on to where they were, for as long as it remembers
        this._lost += dt;
        if (this._lost > M.memory || flat(this.last) < 1.2) { go('search'); this._look = this.yaw; return; }
        toward(this.last, ctx.field);
        if (this.move.lengthSq() > 0) this.faceYaw = Math.atan2(-this.move.x, -this.move.z);
        return;
      }
      const reach = this.reach * s;
      if (sd < 2.5 && (!ctx.nav || ctx.nav.clear(at.x, at.z, seen.pos.x, seen.pos.z))) this.move.set((seen.pos.x - at.x) / sd, 0, (seen.pos.z - at.z) / sd);
      else toward(seen.pos, ctx.field);
      face(seen.pos); this.aim = seen.pos;
      if (sd < reach && Math.abs(seen.pos.y - at.y) < 1.3 * s) {
        if (sd < reach * 0.55) this.move.set(0, 0, 0);
        if (this.cool <= 0 && this.swing <= 0) { this.swing = SWING; this.cool = this.hitEvery * (0.85 + Math.random() * 0.3); this.target = seen.id; }
      }
      return;
    }
    // a noise, newer than the last one it went to look at?
    for (const n of ctx.noises || []) {
      if (n.t <= (this._heard || 0) || Math.hypot(n.pos.x - at.x, n.pos.z - at.z) > M.hear) continue;
      this._heard = n.t; this.last.copy(n.pos); go('hunt');
    }
    if (this.mood === 'hunt') {
      this.gait = 'jog'; this.want = this.last;
      if (flat(this.last) < 2 || this.moodT > 25) { go('search'); this._look = this.yaw; return; }
      toward(this.last, ctx.field);
      if (this.move.lengthSq() > 0) this.faceYaw = Math.atan2(-this.move.x, -this.move.z) + Math.sin(this.t * 2.2) * 0.5;
      return;
    }
    if (this.mood === 'search') {
      // standing, looking all about; now and then a few steps one way or another
      this.faceYaw = this._look + Math.sin(this.moodT * 1.5) * 1.5 + this.moodT * 0.5;
      if (Math.sin(this.moodT * 0.9) > 0.75) { this.move.set(fx, 0, fz); this.gait = 'shuffle'; }
      if (this.moodT > M.search) { go('roam'); this.want = null; }
      return;
    }
    // its rounds: on to another cavern (never the camp)
    if (!this.want || flat(this.want) < 2.5 || this.moodT > 45) {
      const arrived = !!this.want && flat(this.want) < 2.5;
      const nodes = (ctx.nodes || []).filter(n => n.depth > 0 && Math.hypot(n.x - at.x, n.z - at.z) > 6);
      const n = nodes[Math.floor(Math.random() * nodes.length)];
      this.want = n ? new THREE.Vector3(n.x, 0, n.z) : null;
      this.moodT = 0;
      if (arrived && Math.random() < 0.6) { go('search'); this._look = this.yaw; this.moodT = M.search * 0.6; return; }       // a look round before it moves on
    }
    if (!this.want) return;
    this.gait = 'walk';
    toward(this.want, ctx.field);
    if (this.move.lengthSq() > 0) this.faceYaw = Math.atan2(-this.move.x, -this.move.z) + Math.sin(this.t * 1.4) * 0.75;     // its head goes from side to side as it walks
  }

  // ------------------------------------------------------------------ body
  // Start a stroke with one hand (or, for a jump, both).
  _begin(i, g, dir, effort = 1) {
    const st = this.strokes[i], s = this.loco.scale, side = i ? 1 : -1;
    st.phase = REACH; st.t = 0;
    st.g = g; st.effort = effort; st.pull = g.pull;
    if (!g.both) { this._going = (this._going || new THREE.Vector3()).copy(dir); this._most = 2.1 * g.len / g.pull + 0.4; }
    st.dir.copy(dir);
    st.from.copy(st.off);
    // out in front (the way it is going), a little to this hand's side, just above the ground
    const sx = Math.cos(this.yaw) * side * 0.2, sz = -Math.sin(this.yaw) * side * 0.2, ahead = g.both ? 0.16 : g.len * 0.62 + 0.1;
    st.to.set((sx + dir.x * ahead) * s, -(FLOOR - 0.12) * s, (sz + dir.z * ahead) * s);
    st.reach = Math.max(0.07, st.from.distanceTo(st.to) / (3.4 * s));
  }

  // A reaching hand has found something to push on: pull.
  _grip(st) {
    const s = this.loco.scale, g = st.g, k = g.both ? 1 : (0.55 + 0.45 * Math.min(st.effort, 1)) * this.ease;
    st.phase = PULL; st.t = 0; st.base.copy(st.off);
    st.len = g.len * s * k; st.lift = g.lift * s * k;
  }

  // Move each stroking hand along; returns which hands may touch things.
  _stroke(dt, usable) {
    const lo = this.loco, s = lo.scale, active = [false, false];
    for (let i = 0; i < 2; i++) {
      const st = this.strokes[i], h = lo.hands[i];
      if (st.phase === REST) continue;
      if (!usable[i]) { st.phase = REST; continue; }
      st.t += dt;
      active[i] = true;
      // Touching the ground while already going faster than this hand will pull only throws the body
      // forward faster still (as it does a player), so until it has slowed the hand waits just above it.
      const g = st.g, fast = !g.both && lo.vel.x * st.dir.x + lo.vel.z * st.dir.z > 0.6 * g.len / g.pull * s;
      if (st.phase === REACH) {
        st.off.lerpVectors(st.from, st.to, Math.min(st.t / st.reach, 1));
        if (fast) active[i] = false;
        else if (h.pinned) this._grip(st);
        if (st.phase === REACH && st.t >= st.reach) { st.phase = PLANT; st.t = 0; }
      } else if (st.phase === PLANT) {
        if (fast) { active[i] = false; st.off.copy(st.to); st.t = 0; continue; }
        // feel for the ground (in the air, hold the hand out low until it comes)
        if (st.off.y > -(FLOOR + 0.25) * s) st.off.y -= 1.7 * s * dt;
        if (h.pinned) this._grip(st);
        else if (st.t > (lo.grounded ? 0.3 : 1.5)) { st.phase = REST; this.pause = 0.05; }       // nothing there: try again
      } else if (st.phase === PULL) {
        const k = Math.min(st.t / st.pull, 1), e = Math.pow(k, 1.3);
        st.off.set(st.base.x - st.dir.x * st.len * e, st.base.y - st.lift * e, st.base.z - st.dir.z * st.len * e);
        if (k >= 1 || !h.pinned) {
          // let go: lift the hand clear
          st.off.y += 0.16 * s;
          st.phase = REST;
          active[i] = false;
        }
      }
    }
    return active;
  }

  /**
   * Move. `body` is this bot's Body (or null): the dead do not move, and an arm that is
   * gone or held cannot be used.
   */
  update(dt, body) {
    const lo = this.loco, alive = !body || !body.dead, s = lo.scale;
    this.t += dt;
    this.flinch = Math.max(0, this.flinch - dt);
    this.cool -= dt;
    this.pause -= dt;
    this.strike = false;
    if (this.swing > 0 && (this.swing -= dt) <= 0) {
      if (alive && this._tear != null && this._tearT > 0) this.events.push({ type: 'tear', id: this._tear });
      else this.strike = alive;
    }
    this.yaw = turnTo(this.yaw, this.faceYaw, 7 * dt);
    lo.yaw = this.yaw;

    // which hands can pull it along: not one that is gone or held, nor the one throwing a blow, nor (if
    // there is any other) one with something in it
    const striker = this.weaponHand >= 0 ? this.weaponHand : !body || body.canUse(1) ? 1 : 0;
    const can = i => (!body || body.canUse(i)) && !(this.swing > 0 && i === striker);
    const free = i => can(i) && i !== this.weaponHand && i !== this.shieldHand;
    const usable = free(0) || free(1) ? [free(0), free(1)] : [can(0) && this.shieldHand !== 0, can(1) && this.shieldHand !== 1];
    if (!usable[0] && !usable[1]) { usable[0] = can(0); usable[1] = can(1); }

    // start the next stroke when the last one is over
    const effort = this.move.length(), busy = this.strokes[0].phase !== REST || this.strokes[1].phase !== REST;
    if (alive && !busy && this.pause <= 0 && (effort > 0.1 || this.hop) && this.flinch <= 0.6 && (usable[0] || usable[1])) {
      const g = this.hop ? GAITS.hop : GAITS[this.gait] || GAITS.walk;
      const dir = effort > 0.1 ? _d.copy(this.move).divideScalar(effort) : _d.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      if (g.both) { for (let i = 0; i < 2; i++) if (usable[i]) this._begin(i, g, dir, effort); this._jumping = true; this.hop = false; }
      else {
        const i = usable[this.next] ? this.next : 1 - this.next;
        this._begin(i, g, dir, effort);
        this.next = 1 - i;
      }
      this.pause = g.rest;
    }
    const active = alive ? this._stroke(dt, usable) : [false, false];
    if (!alive) for (const st of this.strokes) st.phase = REST;

    // arms: stroking; or throwing a blow; or holding something up; or reaching; or just hanging
    const q = this._q.setFromAxisAngle(UP, this.yaw);
    const blow = this.swing > 0 ? 1 - this.swing / SWING : -1;      // 0 wound up .. 1 landed
    const ease = 1 - Math.exp(-16 * dt);
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1, sway = Math.sin(this.t * 1.3 + i * 2) * 0.05, st = this.strokes[i];
      const local = this._locals[i];
      if (st.phase === REST) {
        // where this hand would like to be, in the bot's own directions (relative to its head)
        let quick = false;
        if (blow >= 0 && i === striker) { _w.set(side * (0.32 - 0.2 * blow), 0.05 - 0.4 * blow, 0.05 - 0.75 * blow); quick = true; }
        else if (i === this.shieldHand) _w.set(side * 0.1, -0.5 + 0.42 * this.guard + sway * 0.3, -0.42);         // shield up, in front of the chest (higher when a blow is coming)
        else if (this.flinch > 0) _w.set(side * 0.22, -0.12 + sway, -0.3);
        else if (i === this.weaponHand) _w.set(side * (0.3 - 0.22 * this.guard), -0.38 + 0.2 * this.guard + sway * 0.4, -0.32);       // weapon held up, ready
        else if (this.aim) {
          // reaching for someone: arms out toward them
          _v.copy(this.aim).sub(lo.head).divideScalar(s).applyAxisAngle(UP, -this.yaw);
          _v.y = Math.max(-0.5, Math.min(0.25, _v.y)); _v.x = Math.max(-0.4, Math.min(0.4, _v.x));
          _w.set(side * 0.17 + _v.x * 0.3, -0.2 + _v.y * 0.5 + sway, -0.5 + sway * (i ? 1 : -1));
        } else if (!lo.grounded) _w.set(side * 0.4, -0.3, -0.2);
        else _w.set(side * 0.3, -0.62 + sway * 0.4, -0.12 + sway);
        // the hand glides there (it is kept relative to the head, in the world's directions, which is
        // also where the next stroke starts from)
        _w.applyAxisAngle(UP, this.yaw).multiplyScalar(s);
        if (quick || this._fresh) st.off.copy(_w); else st.off.lerp(_w, ease);
      }
      local.copy(st.off).divideScalar(s).applyAxisAngle(UP, -this.yaw).add(HEAD);
    }
    this._fresh = false;
    const wasTouching = lo.touching;
    if (alive) lo.update(Math.min(dt, 0.05), HEAD, this._locals, active);
    if (wasTouching && !lo.touching) {
      if (this._jumping) {
        // a jump leaves the ground with whatever it was meant to (a zombie going for someone up high)
        if (this.leap) lo.vel.copy(this.leap);
        this.leap = null; this._jumping = false;
      } else if (this._going) {
        // Letting go of a wall or a ledge can fling a body any way at all. A bot only ever means to
        // go the way it was pulling, and no faster than its pace: anything else is taken off.
        const d = this._going, back = lo.vel.x * d.x + lo.vel.z * d.z, most = this._most * s;
        if (back < 0) { lo.vel.x -= d.x * back; lo.vel.z -= d.z * back; }
        const flat = Math.hypot(lo.vel.x, lo.vel.z);
        if (flat > most) { lo.vel.x *= most / flat; lo.vel.z *= most / flat; }
        if (lo.vel.y > most * 0.6) lo.vel.y = most * 0.6;
      }
    }
    this.pose.head.pos.copy(lo.head);
    this.pose.head.quat.copy(q);
    this.pose.scale = s;
    for (let i = 0; i < 2; i++) {
      // a pinned hand is where it is pinned, not where it was asked to go
      const h = lo.hands[i];
      if (active[i] && h.pinned) this.pose.hands[i].pos.copy(h.pos); else lo.toWorld(this._locals[i], this.pose.hands[i].pos);
      const hq = this.pose.hands[i].quat.copy(q);
      if (i === this.weaponHand) hq.multiply(this._q2.setFromAxisAngle(X, blow >= 0 && i === striker ? 0.5 - 1.7 * blow : this.guard * 0.9)).multiply(ARMED_GRIP);   // the blade comes over and down
      else if (i === this.shieldHand) hq.multiply(ARMED_GRIP);       // knuckles forward: so is the face of the shield
      else hq.multiply(GRIP[i]);
    }
  }

  /** Think, then move: one frame of a bot's life. */
  step(dt, body, pulledFrom = null, ctx = {}) {
    this.think(dt, body, pulledFrom, ctx);
    this.update(dt, body);
  }
}
