// Browser test for the arena: the colosseum, the tournament, weapons, gates and bot fighters.
// Usage: node tests/arena-browser.cjs [outDir]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, 'tests', 'out'));
fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(0);

const failures = [];
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures.push(what); };

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('https://cdn.jsdelivr.net/npm/**', route => {
    const m = route.request().url().match(/\/npm\/([^@/]+)@[^/]+\/(.*)$/);
    route.fulfill({ path: path.join(root, 'node_modules', m[1], m[2]), contentType: 'text/javascript' });
  });
  await page.addInitScript(() => { Element.prototype.requestPointerLock = () => Promise.resolve(); });
  const gameWait = async sec => {
    const until = (await page.evaluate(() => game.time)) + sec;
    await page.waitForFunction(t => game.time >= t, until, { timeout: 240000 });
  };
  const until = (fn, arg, ms = 240000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
  const phase = (ph, ms) => until(p => game.session.arena.phase === p, ph, ms);
  const frames = n => page.evaluate(k => new Promise(done => { let i = 0; const f = () => (++i >= k ? done() : requestAnimationFrame(f)); f(); }), n);
  const shot = async (file, pos, look, fov = 60) => {
    if (pos) await page.evaluate(([p, l, f]) => {
      const cam = new game.THREE.PerspectiveCamera(f, game.camera.aspect, 0.1, 300);
      cam.position.set(...p); cam.lookAt(...l); game.debugCamera = cam;
    }, [pos, look, fov]);
    await page.waitForFunction(() => game.voxelView.dirty.size === 0, null, { timeout: 120000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, file) });
    await page.evaluate(() => { game.debugCamera = null; });
  };

  try {
    await page.goto(`http://localhost:${server.address().port}/`);
    await page.waitForFunction(() => window.game && window.game.avatar, null, { timeout: 30000 });
    await page.click('#desktop');
    await gameWait(0.5);
    await page.evaluate(() => {
      const T = game.THREE, S = game.session;
      Object.assign(game.ARENA, { intro: 2, prep: 6, result: 3, champion: 4 });     // a quick tournament
      game.T = {
        foe: () => (S.arena.a === 'h' ? S.arena.b : S.arena.a),
        // turn the view to look at a point
        lookAt(p) {
          const d = p.clone().sub(game.loco.head).applyAxisAngle(new T.Vector3(0, 1, 0), -game.loco.yaw);
          game.desktop.yaw = Math.atan2(-d.x, -d.z); game.desktop.pitch = Math.asin(d.y / d.length());
        },
        // stand `dist` metres from a point (on the level), looking at it
        approach(p, dist) {
          const d = new T.Vector3(p.x - game.loco.head.x, 0, p.z - game.loco.head.z), flat = d.length();
          game.loco.origin.addScaledVector(d, 1 - dist / flat); game.loco.vel.set(0, 0, 0);
          for (const h of game.handHist) h.length = 0;
        },
        handTo(p) { game.loco.origin.add(p.clone().sub(game.loco.hands[1].pos)); game.loco.vel.set(0, 0, 0); for (const h of game.handHist) h.length = 0; },
        r: p => Math.hypot(p.x, p.z),
      };
      game.setSize(5);       // 2x in the sandbox: the arena should put me back to normal
    });

    // ---- the map, and a tournament that starts by itself with a bot to fight
    await page.evaluate(() => game.session.setMode('arena'));
    check(await until(() => game.session.mode === 'arena' && game.session.arena.phase !== 'waiting'), 'the arena loads and a tournament starts');
    let r = await page.evaluate(() => {
      const v = game.voxels, S = game.session, st = S.arena, air = (x, y, z) => !v.solidAt(x, y, z);
      return {
        sand: v.solidAt(0, 0.1, 0) && air(0, 0.5, 0), wall: v.solidAt(13.5, 2, 0), seats: v.solidAt(20, 5.9, 0) && air(20, 6.6, 0), rooms: air(0, 1.5, -19) && air(0, 1.5, 19) && air(0, 1.5, -14.5),
        phase: st.phase, bots: [...S.bots.values()].map(b => b.name), bracket: st.rounds.map(ms => ms.length), role: S.role(), scale: game.loco.scale,
        seat: [game.T.r(game.loco.head), game.loco.head.y], smash: S.canBreak(), stats: game.voxelView.stats(), calls: game.renderer.info.render.calls,
      };
    });
    console.log('     arena map:', JSON.stringify(r.stats), 'draw calls', r.calls);
    check(r.sand && r.wall && r.seats && r.rooms, `sand, a wall, seats and two rooms: ${JSON.stringify(r)}`);
    check(r.bots.length === 1 && r.bracket.join() === '1' && r.phase === 'intro', `alone, a gladiator bot turns up to fight: ${r.bots} ${r.phase}`);
    check(r.role === 'spectator' && r.seat[0] > 15 && r.seat[1] > 5, `I start in the seats: ${JSON.stringify(r.seat)}`);
    check(r.scale === 1 && !r.smash, 'everyone is normal size in the arena, and nothing can be smashed');
    await shot('arena-1-from-above.png', [0, 52, 44], [0, 0, 2]);
    await shot('arena-2-from-my-seat.png');

    // ---- getting ready: my own room, gates shut, weapons on the wall
    check(await phase('prep'), 'the first match is called');
    await gameWait(0.6);
    r = await page.evaluate(() => {
      const S = game.session, foe = S.bots.get(game.T.foe()), all = [...S.props.props.values()];
      return {
        role: S.role(), me: game.loco.head.toArray(), foe: foe.loco.head.toArray(), gates: game.level.gatesOpen, blocked: game.world.colliders.filter(c => c.noProps).length,
        racks: all.filter(p => p.owner === 'rack' && !p.held).length, hanging: all.filter(p => p.owner === 'rack' && !p.held && p.mesh.position.y > 1.1).length,
        botArmed: foe.weaponHand, canHurt: S.canHurt(game.T.foe()), title: game.hud.title, status: game.hud.status,
      };
    });
    check(r.role === 'fighter' && Math.abs(r.me[2]) > 16.5 && Math.abs(r.me[0]) < 4 && Math.abs(r.foe[2]) > 16.5 && r.me[2] * r.foe[2] < 0, `the two fighters are in rooms at opposite ends: me z ${r.me[2].toFixed(1)}, bot z ${r.foe[2].toFixed(1)}`);
    check(!r.gates && r.blocked === 2, 'both gates are shut');
    check(r.racks === 12 && r.hanging === 12, `six weapons hang on the walls of each room: ${r.racks} (${r.hanging} hanging)`);
    check(r.botArmed === 1, 'the bot has been handed one too');
    check(/You fight next/.test(r.title) && /Pick a weapon/.test(r.status), `I am told what to do: "${r.title}" / "${r.status}"`);
    await page.evaluate(() => { game.desktop.pitch = -0.1; });
    await frames(3);
    await shot('arena-3-my-room.png');
    // nobody can be hurt before the gates open
    await page.evaluate(() => { const S = game.session; S.hit(game.T.foe(), 'head', 60, 1); });
    check(await page.evaluate(() => !game.session.canHurt(game.T.foe()) && game.session.body(game.T.foe()).blood === 100), 'nobody can be hurt before the gates open');
    // the gate really stops me
    const side = await page.evaluate(() => Math.sign(game.loco.head.z));
    await page.evaluate(s => { game.loco.teleport(new game.THREE.Vector3(0, 0.25, s * 14.8), game.loco.yaw); }, side);
    for (let i = 0; i < 12; i++) { await page.evaluate(s => { game.loco.vel.set(0, 0, -s * 5); }, side); await frames(2); }
    check(await page.evaluate(() => Math.abs(game.loco.head.z) > 13.7), 'I cannot get through the shut gate');
    // take the sword off the wall
    await page.evaluate(() => {
      const sword = [...game.session.props.props.values()].filter(p => p.type.id === 'sword').sort((a, b) => a.mesh.position.distanceTo(game.loco.head) - b.mesh.position.distanceTo(game.loco.head))[0];
      game.sword = sword.id;
      game.loco.teleport(new game.THREE.Vector3(0, 0.25, sword.mesh.position.z), game.loco.yaw);
    });
    await frames(4);
    await page.evaluate(() => { const p = game.session.props.props.get(game.sword).mesh.position; game.T.approach(p, 1.0); game.T.lookAt(p); });
    await frames(6);
    await shot('arena-4-weapon-wall.png');
    await page.evaluate(() => { game.T.handTo(game.session.props.props.get(game.sword).mesh.position); game.desktop.keys.KeyG = true; game.desktop.pressed.add('KeyG'); });
    check(await until(() => game.heldWeapon(1) && game.heldWeapon(1).id === game.sword && game.stuck[1], null, 30000), 'I take the sword off the wall');
    await page.evaluate(() => { game.desktop.keys.KeyG = false; game.desktop.yaw = 0; game.desktop.pitch = -0.1; });

    // ---- the fight
    check(await phase('fight'), 'the fight starts');
    r = await page.evaluate(() => ({ gates: game.level.gatesOpen, blocked: game.world.colliders.filter(c => c.noProps).length, canHurt: game.session.canHurt(game.T.foe()), sword: !!game.heldWeapon(1), title: game.hud.title }));
    check(r.gates && r.blocked === 0 && r.canHurt && r.sword && r.title === 'FIGHT!', `the gates open and we may hurt each other: ${JSON.stringify(r)}`);
    await gameWait(0.8);
    await shot('arena-5-gate-open.png');
    await page.evaluate(s => { game.loco.teleport(new game.THREE.Vector3(0, 0.3, s * 3), game.loco.yaw); }, side);
    check(await until(() => { const b = game.session.bots.get(game.T.foe()); return b && game.T.r(b.loco.head) < 12.5; }, null, 120000), 'the bot comes out of its room onto the sand');
    check(await until(() => game.session.body().blood < 95, null, 240000), 'it comes for me and lands a blow');
    r = await page.evaluate(() => ({ blood: game.session.body().blood, d: game.session.bots.get(game.T.foe()).loco.head.distanceTo(game.loco.head), bar: !!game.hud.blood }));
    check(r.d < 3.2 && r.bar, `from close up: ${r.d.toFixed(1)} m away, my blood ${r.blood.toFixed(0)}`);
    await page.evaluate(() => { game.T.lookAt(game.session.rigs.get(game.T.foe()).torsoTop); });
    await frames(3);
    await shot('arena-6-bot-attacks.png');
    const me = await page.evaluate(() => game.loco.head.toArray());
    await shot('arena-7-fight.png', [me[0] + 4.5, 2.6, me[2] + 1.5], [me[0], 0.9, me[2]]);
    // fight back with the sword until it is dead
    for (let i = 0; i < 40; i++) {
      const going = await page.evaluate(() => {
        const S = game.session, rg = S.rigs.get(game.T.foe());
        if (S.arena.phase !== 'fight' || !rg) return false;
        game.T.approach(rg.torsoTop, 1.5); game.T.lookAt(rg.torsoTop);
        return true;
      });
      if (!going) break;
      await frames(3);
      await page.evaluate(() => { if (game.session.arena.phase === 'fight') { game.T.lookAt(game.session.rigs.get(game.T.foe()).torsoTop); game.punchAhead(); } });
      await frames(4);
    }
    check(await phase('result', 30000), 'the fight ends');
    r = await page.evaluate(() => ({ st: game.session.arena, dead: game.session.body(game.T.foe()).dead, title: game.hud.title, rag: [...game.session.props.props.values()].filter(p => p.rag).length, gates: game.level.gatesOpen, role: game.session.role() }));
    check(r.st.w === 'h' && r.st.why === 'kill' && r.dead && r.title === 'You win!' && r.rag >= 2, `I killed it and won: ${JSON.stringify({ w: r.st.w, why: r.st.why, title: r.title, rag: r.rag })}`);
    check(!r.gates && r.role === 'spectator', 'the gates shut again');
    const at = await page.evaluate(() => game.loco.head.toArray());
    await shot('arena-8-won.png', [at[0] + 3.5, 2.6, at[2] + 3], [at[0], 0.5, at[2]]);
    check(await phase('champion'), 'with two in the bracket, that was the final');
    r = await page.evaluate(() => ({ champion: game.session.arena.champion, title: game.hud.title, round: game.session.arena.rounds[0][0] }));
    check(r.champion === 'h' && r.title === 'YOU ARE THE CHAMPION' && r.round[2] === 'h', `I am the champion: ${JSON.stringify(r)}`);
    await gameWait(0.5);
    await shot('arena-9-board.png', [0, 4.5, 3], [0, 5.9, -14.4], 32);

    // ---- a bigger bracket: three bots and me; and giving up the floor loses the fight
    await page.evaluate(() => { game.session.addBot(); game.session.addBot(); Object.assign(game.ARENA, { away: 4, fight: 30 }); });
    check(await until(() => game.session.arena.n === 2 && game.session.arena.phase === 'prep'), 'a new tournament starts');
    r = await page.evaluate(() => ({ bracket: game.session.arena.rounds.map(ms => ms.length), names: [...game.session.bots.values()].map(b => b.name), n: game.session.botCount }));
    check(r.n === 3 && r.bracket[0] === 2, `four fighters make two semi-finals: ${JSON.stringify(r)}`);
    // My match might be first or second. Either way: when it is mine I stay in my room and lose it,
    // and when two bots are up I watch them from the seats.
    const watchBots = async () => {
      await gameWait(0.6);
      r = await page.evaluate(() => {
        const S = game.session, st = S.arena, weapon = [...S.props.props.values()].find(p => p.owner === 'rack' && !p.held);
        S.request({ t: 'grab', id: weapon.id, hand: 1 });        // spectators keep their hands to themselves
        return { role: S.role(), seat: [game.T.r(game.loco.head), game.loco.head.y], bots: S.isBot(st.a) && S.isBot(st.b), took: !!weapon.held, status: game.hud.status };
      });
      check(r.role === 'spectator' && r.bots && r.seat[0] > 15 && r.seat[1] > 5 && !r.took && /Next: /.test(r.status), `two bots are up and I watch from the seats: ${JSON.stringify(r)}`);
      check(await phase('fight'), 'the bots\' fight starts');
      check(await until(() => { const S = game.session, st = S.arena; return st.phase !== 'fight' || (S.body(st.a).blood < 100 && S.body(st.b).blood < 100); }, null, 240000), 'they go for each other, and both get hurt');
      const mid = await page.evaluate(() => { const S = game.session, st = S.arena; return [st.a, st.b].map(id => S.bots.get(id).loco.head.toArray()); });
      await shot('arena-10-bots-fight.png', [(mid[0][0] + mid[1][0]) / 2 + 4, 2.4, (mid[0][2] + mid[1][2]) / 2 + 2], [(mid[0][0] + mid[1][0]) / 2, 0.8, (mid[0][2] + mid[1][2]) / 2]);
      await page.evaluate(m => { game.T.lookAt(new game.THREE.Vector3((m[0][0] + m[1][0]) / 2, 1, (m[0][2] + m[1][2]) / 2)); }, mid);
      await frames(3);
      await shot('arena-11-watching.png');
      check(await phase('result'), 'and one of them wins');
      r = await page.evaluate(() => ({ w: game.session.arena.w, why: game.session.arena.why, bot: game.session.isBot(game.session.arena.w), title: game.hud.title }));
      check(r.bot && / wins$/.test(r.title), `the winner is announced: "${r.title}" (${r.why})`);
    };
    const loseMine = async () => {
      check(await phase('fight'), 'my fight starts');
      check(await until(() => /Get onto the sand/.test(game.hud.status), null, 60000), 'staying in my room, I am told to get onto the sand');
      check(await phase('result'), 'and after a few seconds I lose the fight');
      r = await page.evaluate(() => ({ w: game.session.arena.w, why: game.session.arena.why, title: game.hud.title, sub: game.hud.sub }));
      check(r.w !== 'h' && r.why === 'away' && r.title === 'You lose' && /You stayed off the sand/.test(r.sub), `for staying off the sand: ${JSON.stringify(r)}`);
    };
    for (let m = 0; m < 2; m++) {
      if (await page.evaluate(() => game.session.role() === 'fighter')) await loseMine(); else await watchBots();
      if (m === 0) check(await until(k => game.session.arena.phase === 'prep' && game.session.arena.m === 1, null), 'the second semi-final is called');
    }
    check(await until(() => game.session.arena.r === 1 && game.session.arena.phase === 'prep'), 'then the final, between the two winners');
    r = await page.evaluate(() => { const st = game.session.arena; return { final: [st.a, st.b], winners: st.rounds[0].map(x => x[2]), me: game.session.role() }; });
    check(r.final.slice().sort().join() === r.winners.slice().sort().join() && r.me === 'spectator', `which I, having lost, only watch: ${JSON.stringify(r)}`);

    // ---- the arm menu's game tab, a new bracket, clearing bots, and back to the sandbox
    await page.evaluate(() => { game.armMenu.visible = true; game.armMenu.tab = 3; game.desktop.yaw = 0; game.desktop.pitch = -0.1; });
    await gameWait(0.3);
    await shot('arena-12-menu.png');
    const n = await page.evaluate(() => { game.menuAction('skip'); return game.session.arena.n; });
    check(await until(k => game.session.arena.n === k + 1, n), '"New bracket" starts the tournament again');
    await page.evaluate(() => game.menuAction('clearbots'));
    check(await until(() => game.session.botCount === 1), 'clearing the bots leaves one, so there is always someone to fight');
    await page.evaluate(() => game.session.setMode('sandbox'));
    await gameWait(0.5);
    r = await page.evaluate(() => ({ mode: game.session.mode, bots: game.session.botCount, role: game.session.role(), gates: game.world.colliders.filter(c => c.noProps).length, scale: game.loco.scale, tower: game.voxels.solidAt(-24, 10, -24), phase: game.session.arena.phase }));
    check(r.mode === 'sandbox' && r.bots === 0 && r.role === 'free' && r.gates === 0 && r.scale === 2 && r.tower && r.phase === 'waiting', `back in the sandbox everything is as it was: ${JSON.stringify(r)}`);
    check(errors.length === 0, `no errors on the page ${errors.join(' | ')}`);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
