// Hide and seek rounds. The host runs this; everyone else just sees the state.
//
//   waiting  fewer than two players: free roam
//   hide     hiders (tiny, fast) run and hide; the giant cannot see or move
//   hunt     the giant is loose and can smash things; touching a hider catches them
//   over     results on screen, then the next round starts with a new giant
//
// The giant wins by catching every hider. Hiders win if any are left when time runs out.

export const ROUND = {
  hide: 30,            // seconds
  hunt: 180,
  over: 8,
  giantScale: 2, giantPower: 1,
  hiderScale: 0.25, hiderPower: 3,
  handReach: 0.15,     // catch distances, per unit of giant size: hand to hider...
  bodyReach: 0.25,     // ...and the giant's body to hider
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Is the hider touching the giant? Poses are { head: {x,y,z}, hands: [{x,y,z}, {x,y,z}], scale }. */
export function isCaught(giant, hider) {
  const gs = giant.scale || ROUND.giantScale;
  for (const h of giant.hands) if (dist(h, hider.head) < ROUND.handReach * gs) return true;
  // the giant's body: a line from its head down to its feet
  const feet = giant.head.y - 0.8 * gs;
  const y = Math.min(Math.max(hider.head.y, feet), giant.head.y);
  return Math.hypot(giant.head.x - hider.head.x, y - hider.head.y, giant.head.z - hider.head.z) < ROUND.bodyReach * gs;
}

export class Rounds {
  constructor(random = Math.random) {
    this.random = random;
    this.state = { phase: 'waiting', t: 0, giant: null, out: [], winner: null, n: 0 };
    this._lastGiant = null;
  }

  /** What everyone needs to know, small enough to send 20 times a second. */
  public() {
    const s = this.state;
    return { phase: s.phase, t: Math.max(0, Math.ceil(s.t)), giant: s.giant, out: s.out.slice(), winner: s.winner, n: s.n };
  }

  stop() {
    this.state = { phase: 'waiting', t: 0, giant: null, out: [], winner: null, n: this.state.n };
  }

  /** End the current round now and start another. */
  skip() { if (this.state.phase !== 'waiting') { this.state.phase = 'over'; this.state.t = 0; this.state.winner = null; } }

  /**
   * @param ids    ids of the players in the room
   * @param poses  id -> pose (see isCaught); players with no pose yet are skipped
   * @returns events: { type: 'start', giant } | { type: 'hunt' } | { type: 'caught', id } | { type: 'end', winner } | { type: 'waiting' }
   */
  update(dt, ids, poses) {
    const s = this.state, ev = [];
    if (ids.length < 2) {
      if (s.phase !== 'waiting') { this.stop(); ev.push({ type: 'waiting' }); }
      return ev;
    }
    if (s.phase === 'waiting') { this._start(ids, ev); return ev; }
    s.t -= dt;
    if (s.phase === 'over') { if (s.t <= 0) this._start(ids, ev); return ev; }
    if (!ids.includes(s.giant)) { this._end('hiders', ev); return ev; }   // the giant left
    const hiding = () => ids.filter(id => id !== s.giant && !s.out.includes(id));
    if (s.phase === 'hide') {
      if (s.t <= 0) { s.phase = 'hunt'; s.t = ROUND.hunt; ev.push({ type: 'hunt' }); }
    } else if (s.phase === 'hunt') {
      const g = poses[s.giant];
      if (g) for (const id of hiding()) {
        if (poses[id] && isCaught(g, poses[id])) { s.out.push(id); ev.push({ type: 'caught', id }); }
      }
      if (!hiding().length) this._end('giant', ev);
      else if (s.t <= 0) this._end('hiders', ev);
    }
    return ev;
  }

  _start(ids, ev) {
    // take turns being the giant; the first one is random
    const order = ids.slice().sort();
    let i = order.indexOf(this._lastGiant);
    i = i < 0 ? Math.floor(this.random() * order.length) : (i + 1) % order.length;
    const giant = this._lastGiant = order[i];
    this.state = { phase: 'hide', t: ROUND.hide, giant, out: [], winner: null, n: this.state.n + 1 };
    ev.push({ type: 'start', giant });
  }

  _end(winner, ev) {
    this.state.phase = 'over'; this.state.t = ROUND.over; this.state.winner = winner;
    ev.push({ type: 'end', winner });
  }
}
