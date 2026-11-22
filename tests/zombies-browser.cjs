// Browser test for the zombies mode: the priory, waves of the dead, points and everything they buy,
// windows, the bow, tonics, the chest, the trap, what the dead leave behind, dying and starting again.
// Usage: node tests/zombies-browser.cjs [outDir]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, 'tests', 'out'));
fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg' };
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
  const phase = (ph, ms) => until(p => game.session.zombies.phase === p, ph, ms);
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
  const key = async (code, hold = 3) => { await page.evaluate(c => { game.desktop.keys[c] = true; game.desktop.pressed.add(c); }, code); await frames(hold); await page.evaluate(c => { game.desktop.keys[c] = false; }, code); await frames(2); };
  // stand in front of something for sale (or a door, or a window) and look at it
  const goTo = async what => {
    await page.evaluate(w => {
      const T = game.THREE, P = game.PRIORY;
      let pos, nx, nz, d = 1.25;
      if (w.startsWith('door:')) { const door = P.doors[Number(w.slice(5))], side = game.T.side || 1; pos = [door.x, 1.4, door.z]; nx = door.nx * side; nz = door.nz * side; d = 1.5; }
      else if (w.startsWith('window:')) { const win = P.windows[Number(w.slice(7))]; pos = [win.x + win.nx * 0.35, 1.2, win.z + win.nz * 0.35]; nx = win.nx; nz = win.nz; d = 1.1; }
      else { const s = P.shops.find(x => x.id === w); pos = s.pos; nx = s.nx; nz = s.nz; }
      game.loco.teleport(new T.Vector3(pos[0] + nx * d, P.floor - 0.65, pos[2] + nz * d), game.loco.yaw);
      game.aimAt = new T.Vector3(...pos);
    }, what);
    await frames(8);
    await page.evaluate(() => game.T.lookAt(game.aimAt));
    await frames(4);
  };
  const buy = async what => { await goTo(what); await page.evaluate(() => { game.fx.length = 0; }); await key('KeyG'); await frames(6); };
  const pl = () => page.evaluate(() => game.session.zombies.pl.h);

  try {
    await page.goto(`http://localhost:${server.address().port}/`);
    await page.waitForFunction(() => window.game && window.game.avatar, null, { timeout: 30000 });
    await page.click('#desktop');
    await gameWait(0.5);
    await page.evaluate(() => {
      const T = game.THREE, S = game.session;
      game.fx = [];
      const old = S.onBodyFx; S.onBodyFx = e => { game.fx.push(e); old(e); };
      // how long the host spends on a frame of the game (not counting drawing it)
      const upd = S.update.bind(S); game.ms = 0;
      S.update = (dt, l) => { const t = performance.now(); upd(dt, l); game.ms += (performance.now() - t - game.ms) * 0.05; };
      Object.assign(game.ZOMBIES, { intro: 12, between: 5, over: 6 });     // a quick game (with time to try the first shop before they come)
      game.titles = [];
      const flash = game.hud.flash.bind(game.hud); game.hud.flash = (t, ...a) => { game.titles.push(t); flash(t, ...a); };
      game.armMenu.visible = false;
      game.T = {
        side: 1,
        lookAt(p) {
          const d = p.clone().sub(game.loco.head).applyAxisAngle(new T.Vector3(0, 1, 0), -game.loco.yaw);
          game.desktop.yaw = Math.atan2(-d.x, -d.z); game.desktop.pitch = Math.asin(d.y / d.length());
        },
        zombies: () => [...S.bots.keys()].filter(id => S.isZombie(id) && !S.body(id).dead),
        kinds: () => game.fx.map(e => e.k),
        // put down every one of the dead that is up (as if I had hit each very hard)
        clear() { for (const id of game.T.zombies()) S._harm('h', id, 'head', 1e5, {}, {}); },
      };
    });

    // ---- the map, and the game starting by itself
    await page.evaluate(() => game.session.setMode('zombies'));
    check(await until(() => game.session.mode === 'zombies' && game.session.zombies.phase === 'intro'), 'the priory loads and the game begins');
    await gameWait(0.6);
    let r = await page.evaluate(() => {
      const v = game.voxels, S = game.session, P = game.PRIORY, air = (x, y, z) => !v.solidAt(x, y, z), st = S.zombies;
      return {
        rooms: Object.values(P.zones).every(([x0, z0, x1, z1]) => air((x0 + x1) / 2 + 0.6, 1.5, (z0 + z1) / 2 + 0.6)), walls: v.solidAt(-11.25, 2, 5) && v.solidAt(0, 2, 24.25) && v.solidAt(0, 4.4, 15),
        yardOpen: air(0, 7, 0), doorways: P.doors.every(d => air(d.x, 1.5, d.z)), sky: S.settings.sky, fog: game.scene.fog.far, smash: S.canBreak(), role: S.role(), scale: game.loco.scale,
        me: game.loco.head.toArray(), pts: st.pl.h[0], doors: st.doors.join(''), boards: st.boards.join(''), status: game.hud.status, title: game.hud.title,
        shut: game.world.statics.filter(c => c.nav === false).length, signs: Object.keys(game.level.priory.shops).length, stats: game.voxelView.stats(), calls: game.renderer.info.render.calls,
      };
    });
    console.log('     priory map:', JSON.stringify(r.stats), 'draw calls', r.calls);
    check(r.rooms && r.walls && r.yardOpen && r.doorways, `seven areas with walls between them, doorways cut through, and the graveyard open to the sky: ${JSON.stringify({ rooms: r.rooms, walls: r.walls, yard: r.yardOpen, doorways: r.doorways })}`);
    check(r.sky === 'night' && r.fog < 60 && !r.smash && r.scale === 1, `it is night, foggy, nothing breaks, and everyone is one size: ${r.sky}, fog ${r.fog}`);
    check(Math.abs(r.me[0]) < 3 && r.me[2] > 17 && r.me[2] < 22 && r.me[1] < 1.4, `I start in the chapel, on the floor: ${r.me.map(v => v.toFixed(1))}`);
    check(r.pts === 500 && r.doors === '00000000' && r.boards === '6'.repeat(14) && r.role === 'survivor', `500 points, every door shut, every window boarded: ${r.pts} ${r.doors} ${r.boards}`);
    check(r.shut === 8 + 14 + 1 && r.signs === 18, `8 doors and 14 windows in the way (and a lid on the yard); 18 things for sale: ${r.shut}, ${r.signs}`);
    check(/coming in/.test(r.status) && r.title === 'ZOMBIES', `I am told what is happening: "${r.title}" / "${r.status}"`);
    await page.evaluate(() => { game.scene.fog.near = 300; game.scene.fog.far = 600; });
    await shot('zombies-1-plan.png', [0, 62, 6], [0, 0, 0], 60);
    await page.evaluate(() => { game.scene.fog.near = 9; game.scene.fog.far = 46; });
    await shot('zombies-2-chapel.png', [0, 2.6, 23.4], [0, 1.2, 12], 78);

    // ---- buying: the dagger on the chapel wall
    await goTo('dagger');
    r = await page.evaluate(() => ({ near: game.zNear && game.zNear.what, hint: game.hud.hint }));
    check(r.near === 'dagger' && /Dagger.*250.*press G/.test(r.hint), `standing at the sign, I am told what it is and what it costs: "${r.hint}"`);
    await shot('zombies-3-dagger-sign.png');
    await key('KeyG'); await frames(6);
    r = await page.evaluate(() => ({ held: game.heldWeapon(1) && game.heldWeapon(1).type.id, stuck: game.stuck[1], pts: game.session.zombies.pl.h[0], fx: game.T.kinds(), title: game.hud.title }));
    check(r.held === 'dagger' && r.pts === 250 && r.fx.includes('buy') && r.title === 'Dagger', `G buys it: it is in my hand and I have 250 left: ${JSON.stringify(r)}`);
    await buy('club');
    r = await page.evaluate(() => ({ held: game.heldWeapon(1).type.id, pts: game.session.zombies.pl.h[0], fx: game.fx.map(e => e.k + ':' + (e.why || '')), title: game.hud.title }));
    check(r.held === 'dagger' && r.pts === 250 && r.fx.join() === 'nobuy:You need 500', `the club is 500, which I have not got: ${JSON.stringify(r)}`);
    await buy('door:0');
    check(await page.evaluate(() => game.session.zombies.doors[0] === 0 && /You need 750/.test(game.hud.title)), 'nor can I afford the door');

    // ---- round 1: they climb out of the ground outside, pull the boards off and come in
    await page.evaluate(() => { game.loco.teleport(new game.THREE.Vector3(0, -0.4, 15), game.loco.yaw); game.desktop.yaw = Math.PI; game.desktop.pitch = -0.1; game.fx.length = 0; });
    check(await phase('round'), 'round 1 starts');
    check(await until(() => game.T.zombies().length >= 2, null, 60000), 'the dead appear');
    r = await page.evaluate(() => {
      const S = game.session, P = game.PRIORY, ids = game.T.zombies();
      return { n: ids.length, brains: ids.map(id => S.bots.get(id).brain + ':' + S.bots.get(id).tag), outside: ids.every(id => { const h = S.bots.get(id).loco.head; return P.zoneOf(h.x, h.z) !== 'chapel' || Math.abs(h.x) > 6.9 || h.z > 23.9; }), rise: game.fx.filter(e => e.k === 'rise').length, left: S.zombies.left, title: game.titles.includes('ROUND 1') };
    });
    check(r.brains.every(b => /^zombie:(walker|lurcher)$/.test(b)) && r.rise >= 1 && r.outside, `slow ones, out in the pits beyond the windows: ${JSON.stringify(r)}`);
    check(r.title && r.left === game_count(1), `"ROUND 1" comes up, with ${r.left} to put down`);
    check(await until(() => game.session.zombies.boards.some(b => b < 6), null, 60000), 'they start pulling boards off a window');
    r = await page.evaluate(() => ({ tear: game.fx.filter(e => e.k === 'tear').length, blood: game.session.body().blood }));
    check(r.tear >= 1 && r.blood === 100, 'I hear it; they cannot reach me yet');
    const w0 = await page.evaluate(() => game.session.zombies.boards.findIndex(b => b < 6));
    const win = await page.evaluate(i => game.PRIORY.windows[i], w0);
    await shot('zombies-4-at-the-window.png', [win.x + win.nx * 3.2 + win.nz * 1.2, 1.5, win.z + win.nz * 3.2 + win.nx * 1.2], [win.x, 1.1, win.z], 60);
    check(await until(() => game.session.zombies.boards.some(b => b === 0), null, 120000), 'a window is torn open');
    r = await page.evaluate(() => ({ shut: game.world.statics.filter(c => c.nav === false).length, open: game.level.priory.windows.filter(w => w.n === 0).length }));
    check(r.shut === 23 - r.open && r.open >= 1, `and nothing is in their way there any more: ${JSON.stringify(r)}`);
    check(await until(() => game.T.zombies().some(id => { const h = game.session.bots.get(id).loco.head; return Math.abs(h.x) < 6.5 && h.z > 10.5 && h.z < 23.5; }), null, 120000), 'one of them gets into the chapel');
    await page.evaluate(() => { const id = game.T.zombies().sort((a, b) => game.session.bots.get(a).loco.head.distanceTo(game.loco.head) - game.session.bots.get(b).loco.head.distanceTo(game.loco.head))[0]; game.T.lookAt(game.session.bots.get(id).loco.head); });
    await frames(4);
    await shot('zombies-5-they-are-in.png');
    // they walk on their hands, like a player
    r = await page.evaluate(async () => {
      const S = game.session, id = game.T.zombies().sort((a, b) => S.bots.get(a).loco.head.distanceTo(game.loco.head) - S.bots.get(b).loco.head.distanceTo(game.loco.head))[0], bot = S.bots.get(id);
      let pinned = 0, n = 0; const from = bot.loco.head.clone(), t0 = game.time;
      await new Promise(done => { const f = () => { n++; if (bot.loco.hands[0].pinned || bot.loco.hands[1].pinned) pinned++; if (game.time - t0 > 2.5 || S.body(id).dead) done(); else requestAnimationFrame(f); }; f(); });
      return { pinned: pinned / n, moved: bot.loco.head.distanceTo(from), speed: bot.loco.head.distanceTo(from) / (game.time - t0) };
    });
    check(r.pinned > 0.15 && r.moved > 0.5 && r.speed < 2.6, `it drags itself along with its hands: a hand planted ${(r.pinned * 100).toFixed(0)}% of the time, ${r.speed.toFixed(2)} m/s`);
    check(await until(() => game.session.body().blood < 95, null, 120000), 'they reach me and claw at me');
    r = await page.evaluate(() => ({ blood: game.session.body().blood, near: Math.min(...game.T.zombies().map(id => game.session.bots.get(id).loco.head.distanceTo(game.loco.head))) }));
    check(r.near < 2.2, `from close up: ${r.near.toFixed(1)} m, my blood ${r.blood.toFixed(0)}`);

    // ---- fighting back: blows earn points, kills earn more, and the bodies are cleared away
    await page.evaluate(() => { game.fx.length = 0; game.before = { pts: game.session.zombies.pl.h[0], kills: game.session.zombies.pl.h[2], left: game.session.zombies.left }; });
    let killed = false;
    for (let i = 0; i < 60 && !killed; i++) {
      await page.evaluate(() => {
        const S = game.session, ids = game.T.zombies().sort((a, b) => S.bots.get(a).loco.head.distanceTo(game.loco.head) - S.bots.get(b).loco.head.distanceTo(game.loco.head));
        if (!ids.length) return;
        const rg = S.rigs.get(ids[0]); if (!rg) return;
        const d = new game.THREE.Vector3(rg.head.x - game.loco.head.x, 0, rg.head.z - game.loco.head.z), flat = d.length();
        if (flat > 1.3) { game.loco.origin.addScaledVector(d, 1 - 1.2 / flat); game.loco.vel.set(0, 0, 0); }
        game.T.lookAt(rg.head);
      });
      await frames(3);
      await page.evaluate(() => { const S = game.session, ids = game.T.zombies().sort((a, b) => S.bots.get(a).loco.head.distanceTo(game.loco.head) - S.bots.get(b).loco.head.distanceTo(game.loco.head)); if (ids.length && S.rigs.get(ids[0])) { game.T.lookAt(S.rigs.get(ids[0]).head); game.punchAhead(); } });
      await frames(4);
      killed = await page.evaluate(() => game.session.zombies.pl.h[2] > game.before.kills);
    }
    r = await page.evaluate(() => ({ pts: game.session.zombies.pl.h[0] - game.before.pts, kills: game.session.zombies.pl.h[2] - game.before.kills, left: game.before.left - game.session.zombies.left, hits: game.fx.filter(e => e.k === 'hit' && e.id !== 'h').length, die: game.fx.filter(e => e.k === 'die').length }));
    check(killed && r.hits >= 1 && r.pts >= 60 + 10 * r.hits - 5, `I stab one to death with the dagger: ${r.hits} blows and a kill earn ${r.pts} points`);
    check(r.left >= 1, 'and there is one fewer to go');
    await gameWait(0.5);
    r = await page.evaluate(() => ({ gone: [...game.session.players.keys()].every(id => !game.session.isZombie(id) || !game.session.body(id).dead), corpse: [...game.session.props.props.values()].filter(p => p.type.gib).length }));
    check(r.gone && r.corpse >= 1, `its body drops (${r.corpse} pieces) and it is no longer one of the walking`);
    const me5 = await page.evaluate(() => game.loco.head.toArray());
    await shot('zombies-6-fighting.png', [me5[0] + 2.6, 2.1, me5[2] - 2.6], [me5[0], 0.9, me5[2] + 0.6], 62);

    // ---- the round ends when they are all down; then a breather
    await page.evaluate(() => { game.session.body().heal(); });
    let done = false;
    for (let i = 0; i < 200 && !done; i++) { await page.evaluate(() => { game.T.clear(); game.session.body().blood = 100; }); await frames(6); done = await page.evaluate(() => game.session.zombies.phase === 'break'); }
    check(done, 'when the last one is down the round is over');
    r = await page.evaluate(() => ({ title: game.hud.title, status: game.hud.status, n: game.T.zombies().length, pts: game.session.zombies.pl.h[0] }));
    check(/Round 1 survived/.test(r.title) && /Round 2 in/.test(r.status) && r.n === 0, `"${r.title}" / "${r.status}"`);

    // ---- mending a window
    const broken = await page.evaluate(() => game.session.zombies.boards.findIndex(b => b < 6));
    await page.evaluate(() => { game.ZOMBIES.between = 600; game.session.horde.state.t = 600; game.before = { pts: game.session.zombies.pl.h[0], boards: game.session.zombies.boards.slice() }; game.fx.length = 0; });
    await goTo('window:' + broken);
    r = await page.evaluate(() => ({ near: game.zNear && game.zNear.what, hint: game.hud.hint }));
    check(r.near === 'window:' + broken && /Board it up.*hold G/.test(r.hint), `at the broken window: "${r.hint}"`);
    await page.evaluate(() => { game.desktop.keys.KeyG = true; game.desktop.pressed.add('KeyG'); });
    check(await until(i => game.session.zombies.boards[i] === 6, broken, 60000), 'holding G puts the boards back one at a time');
    await page.evaluate(() => { game.desktop.keys.KeyG = false; });
    r = await page.evaluate(i => ({ pts: game.session.zombies.pl.h[0] - game.before.pts, put: 6 - game.before.boards[i], fx: game.fx.filter(e => e.k === 'board').length, shut: game.level.priory.windows[i].n, held: game.heldWeapon(1) && game.heldWeapon(1).type.id }), broken);
    check(r.pts === 10 * r.put && r.fx === r.put && r.shut === 6, `${r.put} boards, ${r.pts} points, and it is shut again`);
    check(r.held === 'dagger', 'the dagger stayed in my hand while I did it');
    await shot('zombies-7-window-mended.png');

    // ---- doors: the graveyard, and with it more ways in
    await page.evaluate(() => { game.session.horde.player('h').pts = 30000; });
    await frames(3);
    await buy('door:0');
    r = await page.evaluate(() => ({ doors: game.session.zombies.doors.join(''), pts: game.session.zombies.pl.h[0], open: game.level.priory.doors[0].open, way: game.session.nav.ok(game.session.nav.index(0, 9.75)), shutWay: game.session.nav.ok(game.session.nav.index(-11.25, 1)), spawns: game.session.horde.spawns().filter(s => s.window < 0).length, title: game.hud.title }));
    check(r.doors === '10000000' && r.pts === 30000 - 750 && r.open && r.title === 'The door opens', `the door to the graveyard opens for 750: ${JSON.stringify(r)}`);
    check(r.way && !r.shutWay && r.spawns === 8, 'the dead can come through it too (but not through doors still shut), and out of the eight graves');
    await gameWait(1.6);
    await shot('zombies-8-door-open.png', [0, 2.2, 15], [0, 1.4, 8], 70);
    await page.evaluate(() => { game.T.side = -1; });
    for (const d of [1, 2, 3]) await buy('door:' + d);
    await page.evaluate(() => { game.T.side = 1; });
    for (const d of [4, 5, 6, 7]) await buy('door:' + d);
    r = await page.evaluate(() => ({ doors: game.session.zombies.doors.join(''), open: [...game.session.horde.open()].length }));
    check(r.doors === '11111111' && r.open === 7, `every door bought: the whole priory is open: ${r.doors}`);
    await shot('zombies-9-graveyard.png', [0, 3.2, 8.6], [0, 1, -6], 76);
    await shot('zombies-10-tavern.png', [-12.5, 2.6, 7], [-22, 1, -3], 76);
    await shot('zombies-11-smithy.png', [12.5, 2.6, -5], [22, 1, 5], 76);
    await shot('zombies-12-crypt.png', [-12.5, 2.6, -7.5], [-20, 1, -18], 76);
    await shot('zombies-13-library.png', [12.5, 2.6, -7.5], [20, 1, -18], 76);
    await shot('zombies-14-nave.png', [0, 3, -11.2], [0, 1, -22], 76);

    // ---- the sword replaces the dagger; armour goes on; tonics do what they say
    await buy('sword');
    r = await page.evaluate(() => ({ held: game.heldWeapon(1) && game.heldWeapon(1).type.id, daggers: [...game.session.props.props.values()].filter(p => p.type.id === 'dagger').length }));
    check(r.held === 'sword' && r.daggers === 0, `buying a sword puts it in my hand in place of the dagger: ${JSON.stringify(r)}`);
    await buy('helmet'); await buy('chestplate');
    r = await page.evaluate(() => ({ armour: game.session.body().armour.slice(), worn: game.avatar.armour.map(m => !!m && m.visible) }));
    check(r.armour.join() === '6,8', `a helmet and a chest plate go straight on: ${r.armour}`);
    await buy('helmet');
    check(await page.evaluate(() => /wearing one/.test(game.hud.title)), 'one of each');
    await buy('hare');
    r = await page.evaluate(() => ({ power: game.loco.power, perks: game.session.zombies.pl.h[1], title: game.hud.title }));
    check(r.power > 1.3 && (r.perks & 2) && r.title === 'Hare Foot', `Hare Foot makes me quicker: power ${r.power}`);
    await buy('ox'); await buy('bear'); await buy('cat');
    r = await page.evaluate(() => ({ perks: game.session.zombies.pl.h[1], armour: game.session.horde.armour('h'), power: game.session.horde.power('h'), lines: game.session.zombies.pl.h }));
    check(r.perks === 15 && r.armour === 0.5 && r.power === 1.75, `Ox Heart halves what blows do to me, Bear Arm nearly doubles mine: ${JSON.stringify(r)}`);
    await shot('zombies-15-tonic.png');

    // ---- the forge
    await buy('forge');
    r = await page.evaluate(() => ({ forged: game.heldWeapon(1).color, power: game.session.horde.power('h', true), glow: game.heldWeapon(1).mesh.material.emissive.getHex() > 0, title: game.hud.title }));
    check(r.forged === 1 && r.power === 3.5 && r.glow && r.title === 'Forged!', `the forge doubles my sword's harm, and it glows: ${JSON.stringify(r)}`);
    await buy('forge');
    check(await page.evaluate(() => /through the fire already/.test(game.hud.title)), 'only once');
    await shot('zombies-16-forged.png');

    // ---- the chest
    await buy('chest');
    check(await until(() => game.session.zombies.chest[0] === 'ready', null, 60000), 'the chest opens and, after a moment, offers something');
    r = await page.evaluate(() => { const p = [...game.session.props.props.values()].find(x => x.owner === 'chest'); return { item: game.session.zombies.chest[1], prop: p && p.type.id, y: p && p.mesh.position.y, lid: game.level.priory.shops.chest.show.userData.lid.rotation.x }; });
    check(r.prop === r.item && r.y > 1 && r.lid < -0.5, `a ${r.item} floats over it, lid open`);
    await shot('zombies-17-chest.png');
    await page.evaluate(() => { const S = game.session, p = [...S.props.props.values()].find(x => x.owner === 'chest'); game.want = p.id; S.release(0); game.loco.origin.add(p.mesh.position.clone().sub(game.loco.hands[0].pos)); game.loco.vel.set(0, 0, 0); for (const h of game.handHist) h.length = 0; });
    await frames(3);
    await page.evaluate(() => { const p = game.session.props.props.get(game.want); game.loco.origin.add(p.mesh.position.clone().sub(game.loco.hands[0].pos)); game.desktop.keys.KeyA = true; game.desktop.pressed.add('KeyA'); });
    check(await until(() => game.session.held[0] === game.want && game.session.zombies.chest[0] === 'shut', null, 30000), 'I take it with my left hand, and the chest shuts');
    await page.evaluate(() => { game.desktop.keys.KeyA = false; });

    // ---- the bow
    await page.evaluate(() => { game.session.release(0); game.session.release(1); game.stuck[0] = game.stuck[1] = false; });
    await frames(4);
    await buy('bow');
    r = await page.evaluate(() => ({ held: game.heldWeapon(1) && game.heldWeapon(1).type.id, arrows: game.session.zombies.pl.h[4], quiver: game.session.quiver }));
    check(r.held === 'bow' && r.arrows === 24 && r.quiver === 24, `a bow, with 24 arrows: ${JSON.stringify(r)}`);
    // shoot one of them as it comes
    await page.evaluate(() => { game.loco.teleport(new game.THREE.Vector3(0, -0.4, 6), game.loco.yaw); game.session._zSpawn('walker', 0, -6); game.fx.length = 0; });
    await frames(10);
    const target = await page.evaluate(() => game.T.zombies()[0]);
    let hitIt = false;
    for (let i = 0; i < 24 && !hitIt; i++) {
      await page.evaluate(id => { const rg = game.session.rigs.get(id); if (rg) { game.T.lookAt(rg.torsoTop.clone().lerp(rg.torsoBottom, 0.3)); } }, target);
      await frames(2);
      await page.evaluate(id => { const rg = game.session.rigs.get(id); if (rg) { game.T.lookAt(rg.torsoTop.clone().lerp(rg.torsoBottom, 0.3).add(new game.THREE.Vector3(0, 0.05 * rg.head.distanceTo(game.loco.head) / 6, 0))); game.punchAhead(); } }, target);
      await gameWait(0.7);
      hitIt = await page.evaluate(() => game.fx.some(e => e.k === 'arrowhit'));
    }
    r = await page.evaluate(id => ({ arrows: game.session.zombies.pl.h[4], shot: game.fx.filter(e => e.k === 'arrow').length, hit: game.fx.filter(e => e.k === 'arrowhit').length, blood: game.session.bodies.has(id) ? game.session.body(id).blood : 0, flying: game.session.arrows.list.length }), target);
    check(r.shot >= 1 && r.arrows === 24 - r.shot, `J looses arrows: ${r.shot} gone from the quiver`);
    check(hitIt && r.blood < 100, `and one hits it: its blood ${Math.round(r.blood)}`);
    await page.evaluate(() => { game.desktop.pitch = 0.5; game.punchAhead(); });
    await gameWait(1.6);
    check(await page.evaluate(() => game.session.arrows.list.some(a => a.stuck)), 'an arrow shot at the wall sticks in it');
    await page.evaluate(() => { game.T.clear(); });

    // ---- the trap
    await page.evaluate(() => { game.session.horde.player('h').pts = 30000; });
    await frames(3);
    await buy('trap');
    r = await page.evaluate(() => ({ trap: game.session.zombies.trap, title: game.hud.title }));
    check(r.trap[0] === 1 && r.title === 'The spikes are up', `the spikes come up: ${JSON.stringify(r.trap)}`);
    await page.evaluate(() => { game.loco.teleport(new game.THREE.Vector3(6, -0.4, -17), game.loco.yaw); const b = game.session._zSpawn('lurcher', 0, -17); game.spiked = b.id; game.before = { kills: game.session.zombies.kills }; });
    check(await until(() => game.session.zombies.kills > game.before.kills, null, 30000), 'one of them on the spikes dies there');
    await gameWait(0.6);
    await shot('zombies-18-spikes.png', [4.5, 2.2, -11.5], [0, 0.4, -17], 60);

    // ---- what they leave behind (these three come up clear of the spikes, which are still out)
    await page.evaluate(() => { const S = game.session, at = game.loco.head; for (let i = 0; i < 3; i++) S._zSpawn('walker', -9.5 + i * 2, -14); S.horde.state.drops.push({ k: 501, kind: 'fire', x: at.x + 3, z: at.z, t: 20 }); game.fx.length = 0; game.before = { n: game.T.zombies().length, pts: S.zombies.pl.h[0] }; });
    await frames(6);
    r = await page.evaluate(() => ({ shown: game.level.priory.group.children.some(c => c.userData && c.userData.gem), n: game.session.zombies.drops.length }));
    check(r.n === 1 && r.shown, 'something glowing is left on the ground');
    await shot('zombies-19-drop.png', [9, 1.6, -13], [9, 0.9, -17], 50);
    await page.evaluate(() => { game.loco.teleport(new game.THREE.Vector3(game.loco.head.x + 3, -0.4, game.loco.head.z), game.loco.yaw); });
    check(await until(() => game.fx.some(e => e.k === 'power' && e.kind === 'fire'), null, 30000), 'walking into it picks it up');
    await gameWait(0.4);
    r = await page.evaluate(() => ({ left: game.T.zombies().length, ash: game.fx.filter(e => e.k === 'ash').length, pts: game.session.zombies.pl.h[0] - game.before.pts, title: game.hud.title }));
    check(r.left === 0 && r.ash === 3 && r.pts === 400 && r.title === 'Holy Fire', `Holy Fire: all ${r.ash} of them burn, and I get ${r.pts} points`);
    r = await page.evaluate(() => { const S = game.session, at = game.loco.head; S.horde.state.drops.push({ k: 502, kind: 'insta', x: at.x, z: at.z, t: 20 }); return 0; });
    check(await until(() => game.session.zombies.pow[0] > 0 && game.session.horde.power('h') === 1000, null, 30000), "Death's Touch: for half a minute one blow kills");

    // ---- a bomber, and a brute
    await page.evaluate(() => { const S = game.session; S.horde.state.pow.insta = 0; game.loco.teleport(new game.THREE.Vector3(0, -0.4, 4), game.loco.yaw); S.body().heal(); const b = S._zSpawn('bomber', 0, -3); game.bomber = b.id; game.booms = 0; const old = S.onBoom; S.onBoom = p => { game.booms++; old(p); }; });
    check(await until(() => game.booms > 0, null, 60000), 'a bomber runs at me and goes off');
    r = await page.evaluate(() => ({ blood: game.session.body().blood, gone: !game.T.zombies().includes(game.bomber), armour: game.session.body().armour.slice() }));
    check(r.blood < 100 && r.blood > 40 && r.gone, `it hurts (blood ${Math.round(r.blood)}: Ox Heart halves it, armour is no help), and that is the end of it`);
    await page.evaluate(() => { const S = game.session; S.body().heal(); game.loco.teleport(new game.THREE.Vector3(0, -0.4, 4), game.loco.yaw); const b = S._zSpawn('brute', 0, -4); game.brute = b.id; b.wait = 0; });
    await gameWait(1.5);
    r = await page.evaluate(() => { const S = game.session, b = S.bots.get(game.brute); return { scale: b.loco.scale, armour: S.body(game.brute).armour.slice(), tough: b.tough, head: b.loco.head.y }; });
    check(r.scale === 1.5 && r.armour.join() === '6,8' && r.tough > 3, `a brute: half as big again, in armour, and hard to kill: ${JSON.stringify(r)}`);
    const bp = await page.evaluate(() => game.session.bots.get(game.brute).loco.head.toArray());
    await shot('zombies-20-brute.png', [bp[0] + 2.4, 1.7, bp[2] + 3.2], [bp[0], 1.2, bp[2]], 55);

    // ---- many at once: how long the host spends on a frame
    await page.evaluate(() => { const S = game.session; game.T.clear(); for (let i = 0; i < 10; i++) S._zSpawn(i % 3 ? 'lurcher' : 'runner', -8 + (i % 5) * 4, i < 5 ? -7 : 6); S.body().heal(); game.loco.teleport(new game.THREE.Vector3(0, -0.4, 0), game.loco.yaw); });
    await gameWait(4);
    r = await page.evaluate(() => ({ ms: game.ms, n: game.T.zombies().length, calls: game.renderer.info.render.calls, tris: game.renderer.info.render.triangles }));
    console.log(`     with ${r.n} of them on their feet: ${r.ms.toFixed(2)} ms of game logic a frame, ${r.calls} draw calls, ${r.tris} triangles`);
    check(r.n >= 9 && r.ms < 12, `ten of them at once costs ${r.ms.toFixed(1)} ms a frame on this machine`);
    const mid = await page.evaluate(() => game.loco.head.toArray());
    await shot('zombies-21-horde.png', [mid[0] + 1, 4.2, mid[2] + 8], [mid[0], 0.6, mid[2] - 1], 70);
    await page.evaluate(() => game.T.lookAt(game.session.bots.get(game.T.zombies()[0]).loco.head));
    await frames(4);
    await shot('zombies-22-surrounded.png');

    // ---- dying: Nine Lives once, then it is over, and then it starts again
    await page.evaluate(() => { const S = game.session; game.fx.length = 0; S._bodyEvents('h', S.body().hit('torso', 1e5, { pierce: true }), {}); });
    await frames(6);
    r = await page.evaluate(() => ({ dead: game.session.body().dead, blood: game.session.body().blood, perks: game.session.zombies.pl.h[1], fx: game.T.kinds().includes('saved'), title: game.hud.title, phase: game.session.zombies.phase }));
    check(!r.dead && r.blood === 100 && !(r.perks & 8) && r.fx && r.title === 'Nine Lives!' && r.phase !== 'over', `the first death does not count: ${JSON.stringify(r)}`);
    await gameWait(2.5);
    await page.evaluate(() => { const S = game.session; S._bodyEvents('h', S.body().hit('torso', 1e5, { pierce: true }), {}); });
    check(await phase('over', 30000), 'the second one does: with nobody left alive, it is over');
    await gameWait(0.5);
    r = await page.evaluate(() => ({ dead: game.session.body().dead, title: game.hud.title, sub: game.hud.sub, status: game.hud.status, best: game.session.zombies.best }));
    check(r.dead && r.title === 'GAME OVER' && /You lasted/.test(r.sub) && /Game over/.test(r.status), `"${r.title}" / "${r.sub}"`);
    await shot('zombies-23-game-over.png');
    check(await until(() => game.session.zombies.phase === 'intro' && !game.session.body().dead, null, 60000), 'and after a few seconds it starts again');
    await gameWait(0.8);
    r = await page.evaluate(() => ({ st: game.session.zombies, n: [...game.session.bots.keys()].length, held: game.session.held.slice(), armour: game.session.body().armour.slice(), me: game.loco.head.toArray(), props: game.session.props.props.size, power: game.loco.power, shut: game.world.statics.filter(c => c.nav === false).length, way: game.session.nav.ok(game.session.nav.index(0, 9.75)) }));
    check(r.st.round === 0 && r.st.pl.h[0] === 500 && r.st.pl.h[1] === 0 && r.st.doors.join('') === '00000000' && r.st.boards.join('') === '6'.repeat(14) && r.st.best >= 1, `from the beginning: 500 points, doors shut, windows boarded (best so far: round ${r.st.best})`);
    check(r.n === 0 && r.props === 0 && r.held.join() === ',' && r.armour.join() === '0,0' && r.power === 1 && r.shut === 23 && !r.way, 'nothing left over from last time');
    check(Math.abs(r.me[0]) < 3 && r.me[2] > 17 && r.me[2] < 22, 'and I am back in the chapel');

    // ---- leaving: the other modes are as they were
    await page.evaluate(() => game.session.setMode('sandbox'));
    check(await until(() => game.session.mode === 'sandbox' && game.session.settings.sky !== 'night' && game.world.statics.every(c => c.nav !== false) && !game.level.priory.group.visible && game.session.zombies.phase === 'waiting', null, 60000), 'back to the sandbox: daylight, and the priory is gone');
    check(errors.length === 0, `no errors in the page: ${errors.slice(0, 3).join(' | ')}`);
  } catch (e) {
    failures.push('crashed: ' + e.message);
    console.log('CRASH', e);
  }
  console.log(failures.length ? `\n${failures.length} FAILED:\n  ` + failures.join('\n  ') : '\nall passed');
  await browser.close();
  server.close();
  process.exit(failures.length ? 1 : 0);
})();
function game_count(round) { return Math.round(5 + 3 * round + 0.12 * round * round); }
