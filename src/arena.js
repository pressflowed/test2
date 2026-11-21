// The arena: a knockout tournament of one-against-one fights. The host runs this;
// everyone else just sees the state.
//
//   waiting   fewer than two fighters
//   intro     the bracket is drawn and shown
//   prep      the two fighters are in their own rooms, picking weapons; the gates are shut
//   fight     the gates are open; it ends when one of them is dead (or gives up the floor)
//   result    the winner is announced; then the next match
//   champion  the last one standing; then a new tournament
//
// A fight is lost by dying, by leaving the room, or by staying off the arena floor too
// long. If the clock runs out, whoever has more blood left wins.

export const ARENA = {
  intro: 6,            // seconds
  prep: 20,
  fight: 90,
  result: 6,
  champion: 12,
  away: 15,            // seconds a fighter may be off the arena floor during a fight
};

const blank = n => ({ phase: 'waiting', t: 0, n, rounds: [], r: 0, m: 0, a: null, b: null, w: null, why: '', champion: null, away: [0, 0] });

export class Tournament {
  constructor(random = Math.random) {
    this.random = random;
    this.state = blank(0);
  }

  /** What everyone needs to know, small enough to send 20 times a second. */
  public() {
    const s = this.state;
    return {
      phase: s.phase, t: Math.max(0, Math.ceil(s.t)), n: s.n, r: s.r, m: s.m, a: s.a, b: s.b, w: s.w, why: s.why, champion: s.champion,
      away: s.away.map(x => (x > 0 ? Math.max(0, Math.ceil(ARENA.away - x)) : -1)),      // seconds each fighter has left to get back on the floor (-1: they are on it)
      rounds: s.rounds.map(ms => ms.map(x => [x.a, x.b, x.w])),
    };
  }

  stop() { this.state = blank(this.state.n); }
  /** Throw the bracket away and draw a new one. */
  restart() { if (this.state.phase !== 'waiting') this.stop(); }

  /**
   * @param ids   everyone who can fight (players and bots)
   * @param info  id -> { dead, blood, inside } inside: on the arena floor
   * @returns events: { type: 'start' } | { type: 'match', a, b } | { type: 'fight', a, b } | { type: 'result', w, l, why } | { type: 'champion', id } | { type: 'waiting' }
   */
  update(dt, ids, info = {}) {
    const s = this.state, ev = [];
    if (ids.length < 2) {
      if (s.phase !== 'waiting') { this.stop(); ev.push({ type: 'waiting' }); }
      return ev;
    }
    if (s.phase === 'waiting') { this._begin(ids, ev); return ev; }
    s.t -= dt;
    const here = id => ids.includes(id);
    if (s.phase === 'intro' || s.phase === 'result') { if (s.t <= 0) this._next(ids, ev); }
    else if (s.phase === 'champion') { if (s.t <= 0) this._begin(ids, ev); }
    else if (s.phase === 'prep') {
      if (!here(s.a) || !here(s.b)) this._finish(here(s.a) ? s.a : here(s.b) ? s.b : null, 'left', ev);
      else if (s.t <= 0) { s.phase = 'fight'; s.t = ARENA.fight; s.away = [0, 0]; ev.push({ type: 'fight', a: s.a, b: s.b }); }
    } else if (s.phase === 'fight') {
      const A = info[s.a] || {}, B = info[s.b] || {};
      const outA = !here(s.a) || A.dead, outB = !here(s.b) || B.dead;
      const flip = () => (this.random() < 0.5 ? s.a : s.b);
      if (outA || outB) this._finish(outA && outB ? flip() : outA ? s.b : s.a, !here(s.a) || !here(s.b) ? 'left' : 'kill', ev);
      else {
        s.away[0] = A.inside === false ? s.away[0] + dt : 0;
        s.away[1] = B.inside === false ? s.away[1] + dt : 0;
        const goneA = s.away[0] > ARENA.away, goneB = s.away[1] > ARENA.away;
        if (goneA || goneB) this._finish(goneA && goneB ? flip() : goneA ? s.b : s.a, 'away', ev);
        else if (s.t <= 0) this._finish(A.blood === B.blood ? flip() : A.blood > B.blood ? s.a : s.b, 'time', ev);
      }
    }
    return ev;
  }

  // draw a new bracket
  _begin(ids, ev) {
    const order = ids.slice().sort();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    let size = 2;
    while (size < order.length) size *= 2;
    // with an odd number, some get through the first round without a fight
    const first = [];
    for (let k = 0; k < size / 2; k++) { const a = order[k], b = order[k + size / 2] ?? null; first.push({ a, b, w: b == null ? a : null }); }
    this.state = { ...blank(this.state.n + 1), phase: 'intro', t: ARENA.intro, rounds: [first], m: -1 };
    ev.push({ type: 'start', n: this.state.n, size: order.length });
  }

  // the next match that needs fighting, or the champion
  _next(ids, ev) {
    const s = this.state;
    for (;;) {
      s.m++;
      const round = s.rounds[s.r];
      if (s.m >= round.length) {
        if (round.length === 1) {
          const id = round[0].w;
          if (id == null) { this._begin(ids, ev); return; }      // nobody was left to win it
          Object.assign(s, { phase: 'champion', t: ARENA.champion, champion: id, a: null, b: null });
          ev.push({ type: 'champion', id });
          return;
        }
        const next = [];
        for (let k = 0; k < round.length; k += 2) {
          const a = round[k].w, b = round[k + 1].w;
          next.push({ a: a ?? b, b: a == null ? null : b, w: a == null || b == null ? (a ?? b) : null });
        }
        s.rounds.push(next); s.r++; s.m = -1;
        continue;
      }
      const match = round[s.m];
      if (match.w != null || (match.a == null && match.b == null)) continue;        // a bye, or nobody
      const hereA = ids.includes(match.a), hereB = ids.includes(match.b);
      if (!hereA || !hereB) { match.w = hereA ? match.a : hereB ? match.b : null; continue; }   // someone went home
      Object.assign(s, { phase: 'prep', t: ARENA.prep, a: match.a, b: match.b, w: null, why: '', away: [0, 0] });
      ev.push({ type: 'match', a: match.a, b: match.b, r: s.r, m: s.m });
      return;
    }
  }

  _finish(w, why, ev) {
    const s = this.state, l = w === s.a ? s.b : s.a;
    s.rounds[s.r][s.m].w = w;
    Object.assign(s, { phase: 'result', t: ARENA.result, w, why });
    ev.push({ type: 'result', w, l, why });
  }
}

/** A name for a round: 'Final', 'Semi-final', ... given how many matches it has. */
export function roundName(matches) {
  return matches === 1 ? 'Final' : matches === 2 ? 'Semi-final' : matches === 4 ? 'Quarter-final' : `Round of ${matches * 2}`;
}
