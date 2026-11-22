// Browser test for shields, blocking and armour (and that the photo textures load).
// Usage: node tests/guard-browser.cjs [outDir]
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
  // pick something up: go to it, put a hand on it, and hold the key until it is taken (or worn)
  const take = async (type, code = 'KeyG', hand = 1) => {
    const pitch = await page.evaluate(() => game.desktop.pitch);
    await page.evaluate(t => {
      const T = game.THREE, p = game.T.prop(t), at = p.mesh.position;
      game.want = p.id;
      if (at.y < 0.9) game.desktop.pitch = -0.9;        // on the ground: reach down for it
      else {
        // on a wall: stand a metre off, facing it
        const d = new T.Vector3(at.x - game.loco.head.x, 0, at.z - game.loco.head.z), flat = d.length();
        game.loco.origin.addScaledVector(d, 1 - 1 / flat); game.loco.vel.set(0, 0, 0);
        game.T.lookAt(at);
      }
    }, type);
    await frames(4);
    await page.evaluate(h => { const at = game.session.props.props.get(game.want).mesh.position; if (at.y >= 0.9) game.T.lookAt(at); game.T.handTo(at, h); }, hand);
    await frames(3);
    await page.evaluate(([h, c]) => { game.T.handTo(game.session.props.props.get(game.want).mesh.position, h); game.desktop.keys[c] = true; game.desktop.pressed.add(c); }, [hand, code]);
    await until(h => { const p = game.session.props.props.get(game.want); return !p || p.held || p.heldKey || game.session.held[h] === game.want; }, hand, 20000);
    await page.evaluate(([c, pt]) => { game.desktop.keys[c] = false; game.desktop.pitch = pt; }, [code, pitch]);
    await frames(3);
  };
  const key = async code => { await page.evaluate(c => { game.desktop.keys[c] = true; game.desktop.pressed.add(c); }, code); await frames(3); await page.evaluate(c => { game.desktop.keys[c] = false; }, code); await frames(2); };

  try {
    await page.goto(`http://localhost:${server.address().port}/`);
    await page.waitForFunction(() => window.game && window.game.avatar, null, { timeout: 30000 });
    await page.click('#desktop');
    await gameWait(0.5);
    await page.evaluate(() => {
      const T = game.THREE, S = game.session;
      game.fx = [];
      const old = S.onBodyFx; S.onBodyFx = e => { game.fx.push(e); old(e); };
      game.T = {
        foe: () => (S.arena.a === 'h' ? S.arena.b : S.arena.a),
        lookAt(p) {
          const d = p.clone().sub(game.loco.head).applyAxisAngle(new T.Vector3(0, 1, 0), -game.loco.yaw);
          game.desktop.yaw = Math.atan2(-d.x, -d.z); game.desktop.pitch = Math.asin(d.y / d.length());
        },
        // stand `dist` metres from a point (on the level), on the side `from` (a direction), looking at it
        stand(p, dist, from = new T.Vector3(0, 0, 1)) {
          game.loco.teleport(new T.Vector3(p.x + from.x * dist, game.loco.origin.y, p.z + from.z * dist), game.loco.yaw);
        },
        handTo(p, i = 1) { game.loco.origin.add(p.clone().sub(game.loco.hands[i].pos)); game.loco.vel.set(0, 0, 0); for (const h of game.handHist) h.length = 0; },
        still(id) { const b = S.bots.get(id); b.wait = 1e9; b.loco.vel.set(0, 0, 0); },
        prop: (type, dented = 0) => [...S.props.props.values()].filter(p => p.type.id === type && !p.held && !!p.wounds === !!dented).sort((a, b) => a.mesh.position.distanceTo(game.loco.head) - b.mesh.position.distanceTo(game.loco.head))[0],
        // the way a bot is facing, on the level
        front(id) { return new T.Vector3(0, 0, -1).applyQuaternion(S.poses.get(id).head.quat).setY(0).normalize(); },
        kinds: () => game.fx.map(e => e.k),
      };
    });

    let r, k;
    if (process.env.GUARD_ONLY !== 'arena') {
    // ---- textures
    r = await page.evaluate(() => ({ photos: game.photoCount }));
    check(r.photos === 15, `all fifteen photo textures loaded: ${r.photos}`);
    await shot('guard-1-sandbox.png', [9, 5, 15], [-2, 1, 0]);

    // ---- a knight: a dummy in armour, with a shield up
    await page.evaluate(() => { game.session.addBot(true); });
    check(await until(() => game.session.botCount === 1 && [...game.session.players.values()].every(p => p.avatar && p.pose)), 'a knight appears');
    await page.evaluate(() => { game.T.still('b1'); });
    await gameWait(1.2);
    r = await page.evaluate(() => {
      const S = game.session, b = S.body('b1'), sh = S.weaponIn('b1', 0), av = S.players.get('b1').avatar, bot = S.bots.get('b1');
      return {
        name: bot.name, armour: b.armour.slice(), shield: !!sh && sh.type.id, shieldHand: bot.shieldHand, worn: av.armour.map(m => !!m && m.visible),
        ahead: sh ? sh.mesh.position.clone().sub(bot.loco.head).dot(game.T.front('b1')) : 0, faces: sh ? new game.THREE.Vector3(1, 0, 0).applyQuaternion(sh.mesh.quaternion).dot(game.T.front('b1')) : 0,
        guards: S.guards('b1').map(g => [g.hand, !!g.g.disc]),
      };
    });
    check(r.name === 'Knight 1' && r.armour.join() === '6,8', `the knight wears a helmet and a chest plate: ${JSON.stringify(r)}`);
    check(r.worn.join() === 'true,true', 'and you can see them on it');
    check(r.shield === 'shield' && r.shieldHand === 0 && r.ahead > 0.3 && r.faces > 0.7 && r.guards.length === 1 && r.guards[0][1], `it holds a shield up in front of it, facing forward: ${r.ahead.toFixed(2)} m ahead, facing ${r.faces.toFixed(2)}`);
    k = await page.evaluate(() => { const b = game.session.bots.get('b1'), f = game.T.front('b1'); return { at: b.loco.head.toArray(), f: f.toArray() }; });
    await shot('guard-2-knight.png', [k.at[0] + k.f[0] * 1.5 + k.f[2] * 0.7, k.at[1] - 0.1, k.at[2] + k.f[2] * 1.5 - k.f[0] * 0.7], [k.at[0], k.at[1] - 0.35, k.at[2]], 50);

    // ---- blocking: a blow at the shield does nothing; one that goes round it lands
    await page.evaluate(() => { const S = game.session, f = game.T.front('b1'); game.T.stand(S.bots.get('b1').loco.head, 1.25, f); });
    await frames(4);
    await page.evaluate(() => { const rg = game.session.rigs.get('b1'); game.T.lookAt(rg.torsoTop.clone().lerp(rg.torsoBottom, 0.5)); });
    await frames(3);
    await shot('guard-3-facing-the-shield.png');
    await page.evaluate(() => { game.fx.length = 0; game.punchAhead(); });
    await frames(6);
    r = await page.evaluate(() => ({ fx: game.T.kinds(), armour: game.session.body('b1').armour.slice(), blood: game.session.body('b1').blood, e: game.fx[0] }));
    check(r.fx.join() === 'block' && r.armour.join() === '6,8' && r.blood === 100, `a punch at its shield is blocked and does nothing: ${JSON.stringify(r.fx)}`);
    check(r.e && r.e.id === 'b1' && r.e.dh === 0 && r.e.by === 'h', `everyone is told whose blow was caught on what: ${JSON.stringify(r.e)}`);
    // from behind there is no shield in the way: the chest plate takes it instead
    await page.evaluate(() => { const S = game.session, f = game.T.front('b1'); game.T.stand(S.bots.get('b1').loco.head, 0.9, f.multiplyScalar(-1)); });
    await frames(4);
    await page.evaluate(() => { const rg = game.session.rigs.get('b1'); game.T.lookAt(rg.torsoTop.clone().lerp(rg.torsoBottom, 0.4)); });
    await frames(3);
    await page.evaluate(() => { game.fx.length = 0; game.punchAhead(); });
    await frames(6);
    r = await page.evaluate(() => ({ fx: game.T.kinds(), armour: game.session.body('b1').armour.slice(), blood: game.session.body('b1').blood, e: game.fx[0] }));
    check(r.fx.join() === 'armour' && r.armour.join() === '6,7' && r.blood === 100, `a punch from behind gets past the shield, and rings off the chest plate: ${JSON.stringify(r)}`);

    // ---- armour: it soaks up a few blows, then it is knocked off
    await page.evaluate(() => { const S = game.session; S.select('sword'); const at = game.loco.head.clone(); at.y = 0.6; at.x += 1.2; S.request({ t: 'spawn', type: 'sword', pos: at.toArray() }); S.request({ t: 'spawn', type: 'hammer', pos: [at.x + 0.6, 0.6, at.z] }); });
    await gameWait(1);
    await take('sword');
    check(await until(() => game.heldWeapon(1) && game.heldWeapon(1).type.id === 'sword', null, 20000), 'I pick up a sword');
    const cut = (part, n = 1) => page.evaluate(([p, k]) => { game.fx.length = 0; for (let i = 0; i < k; i++) game.session.hit('b1', p, 40, 1, game.session.held[1]); }, [part, n]);
    // (stand well clear of its shield and behind it, so nothing is in the way)
    await page.evaluate(() => { const S = game.session, f = game.T.front('b1'); game.T.stand(S.bots.get('b1').loco.head, 1.3, f.multiplyScalar(-1)); });
    await frames(4);
    await cut('head', 2);
    await frames(4);
    r = await page.evaluate(() => ({ fx: game.fx.map(e => e.k + ':' + e.left), armour: game.session.body('b1').armour.slice(), blood: game.session.body('b1').blood, worn: game.session.players.get('b1').avatar.armour.map(m => !!m && m.visible) }));
    check(r.fx.join() === 'armour:4,armour:2' && r.blood === 100 && r.worn[0], `two sword cuts to the head: the helmet takes both: ${JSON.stringify(r)}`);
    await cut('head');
    await gameWait(0.5);
    r = await page.evaluate(() => ({ fx: game.fx.map(e => e.k + ':' + e.left), armour: game.session.body('b1').armour.slice(), blood: game.session.body('b1').blood, worn: game.session.players.get('b1').avatar.armour.map(m => !!m && m.visible), scrap: !!game.T.prop('helmet', 1), sub: game.hud.sub, title: game.hud.title }));
    check(r.fx.join() === 'armour:0' && r.armour[0] === 0 && r.blood === 100 && !r.worn[0] && r.scrap, `the third knocks it off, dented: ${JSON.stringify(r)}`);
    check(!/knocked off|Armour/.test(r.title), `nothing pops up about it on my screen (I hear it, and see it fly off): "${r.title}"`);
    k = await page.evaluate(() => game.session.bots.get('b1').loco.head.toArray());
    await shot('guard-4-helmet-off.png', [k[0] + 1.6, k[1], k[2] + 1.2], [k[0], k[1] - 0.5, k[2]], 55);
    await cut('head');
    await frames(4);
    r = await page.evaluate(() => ({ fx: game.T.kinds(), blood: game.session.body('b1').blood }));
    check(r.fx.includes('hit') && r.blood < 100, `now the head is bare, and the next cut hurts: blood ${r.blood.toFixed(0)}`);
    // the arms were never covered
    await page.evaluate(() => { game.session.body('b1').blood = 100; });
    await cut('foreR');
    await frames(4);
    r = await page.evaluate(() => ({ fx: game.T.kinds(), cut: game.session.body('b1').cut.slice(), armour: game.session.body('b1').armour.slice() }));
    check(r.fx.includes('hit') && r.armour[1] === 7, `armour does not cover the arms: ${JSON.stringify(r)}`);
    // a scrap helmet is no use: picking it up just holds it
    r = await page.evaluate(() => { const S = game.session, p = game.T.prop('helmet', 1); S.request({ t: 'wear', id: p.id }); return { mine: S.body().armour.slice(), still: S.props.props.has(p.id) }; });
    check(r.mine.join() === '0,0' && r.still, 'a dented helmet cannot be put on');

    // ---- wearing it myself: pick a piece up and it is on
    await page.evaluate(() => { const S = game.session, at = game.loco.head.clone(); S.request({ t: 'spawn', type: 'helmet', pos: [at.x - 1.5, 0.6, at.z] }); S.request({ t: 'spawn', type: 'chestplate', pos: [at.x - 2.2, 0.6, at.z] }); S.request({ t: 'spawn', type: 'shield', pos: [at.x - 2.9, 0.6, at.z] }); });
    await gameWait(1);
    await page.evaluate(() => { game.fx.length = 0; });
    await take('helmet', 'KeyA', 0);
    check(await until(() => game.session.body().armour[0] === 6, null, 20000), 'I pick up a helmet with my left hand, and it is on my head');
    r = await page.evaluate(() => ({ held: game.session.held.slice(), left: !!game.T.prop('helmet', 0), fx: game.T.kinds(), title: game.hud.title }));
    check(r.held[0] == null && !r.left && r.fx.includes('wear') && r.title === 'Helmet on', `not in my hand: ${JSON.stringify(r)}`);
    await take('chestplate', 'KeyA', 0);
    check(await until(() => game.session.body().armour[1] === 8, null, 20000), 'and a chest plate');
    await take('shield', 'KeyA', 0);
    check(await until(() => game.heldWeapon(0) && game.heldWeapon(0).type.id === 'shield' && game.stuck[0], null, 20000), 'and a shield stays in my left hand');
    r = await page.evaluate(() => ({ guards: game.session.guards('h').map(g => [g.hand, !!g.g.disc]), sword: !!game.heldWeapon(1) }));
    check(r.sword && r.guards.length === 2, `sword and shield: both can catch a blow: ${JSON.stringify(r.guards)}`);
    await page.evaluate(() => { game.desktop.pitch = -0.15; });
    await frames(4);
    await shot('guard-5-first-person.png');
    k = await page.evaluate(() => ({ at: game.loco.head.toArray(), f: new game.THREE.Vector3(0, 0, -1).applyQuaternion(game.camera.quaternion).setY(0).normalize().toArray() }));
    await page.evaluate(() => { game.avatar.firstPerson = false; });
    await shot('guard-6-me-in-armour.png', [k.at[0] + k.f[0] * 1.7 + k.f[2] * 0.6, k.at[1], k.at[2] + k.f[2] * 1.7 - k.f[0] * 0.6], [k.at[0], k.at[1] - 0.35, k.at[2]], 50);
    await page.evaluate(() => { game.avatar.firstPerson = true; });
    // blows to me: fighting on, the host's rules
    r = await page.evaluate(() => {
      const S = game.session, me = S.body();
      const a = me.hit('head', 30, { sharp: true }).map(e => e.type + ':' + e.left), b = me.hit('torso', 30, { blunt: true }).map(e => e.type + ':' + e.left);
      const c = me.hit('torso', 60, { pierce: true }).map(e => e.type);
      return { a, b, c, armour: me.armour.slice(), blood: me.blood };
    });
    check(r.a.join() === 'armour:4' && r.b.join() === 'armour:5' && r.c.includes('hit') && r.blood < 100, `a blade takes 2 off my helmet, a hammer 3 off my chest plate, and a blast goes straight through: ${JSON.stringify(r)}`);

    }

    // ---- the arena: kit on the walls, and a bot that blocks and is blocked
    await page.evaluate(() => { Object.assign(game.ARENA, { intro: 2, prep: 8, result: 3, champion: 4 }); game.session.botKit = 1; game.session.clearBots(); game.session.setMode('arena'); });
    check(await until(() => game.session.mode === 'arena' && game.session.arena.phase !== 'waiting'), 'the arena loads');
    check(await phase('prep'), 'a match is called');
    await gameWait(0.6);
    r = await page.evaluate(() => {
      const S = game.session, all = [...S.props.props.values()].filter(p => p.owner === 'rack' && !p.held), n = t => all.filter(p => p.type.id === t).length, foe = game.T.foe();
      const sh = S.weaponIn(foe, 0), w = S.weaponIn(foe, 1);
      return { weapons: all.filter(p => p.type.weapon && !p.type.weapon.shield).length, shields: n('shield'), helmets: n('helmet'), plates: n('chestplate'), mine: S.body().armour.slice(), held: S.held.slice(), foe: { armour: S.body(foe).armour.slice(), shield: !!sh && sh.type.id, weapon: !!w && w.type.id }, sub: game.hud.sub };
    });
    check(r.weapons === 12 && r.shields === 4 && r.helmets === 2 && r.plates === 2, `each room has six weapons, two shields, a helmet and a chest plate: ${JSON.stringify(r)}`);
    check(r.mine.join() === '0,0' && r.held.join() === ',', 'I start the match with nothing');
    check(r.foe.armour.join() === '6,8' && r.foe.shield === 'shield' && r.foe.weapon && r.foe.weapon !== 'shield', `this bot was given the lot: ${JSON.stringify(r.foe)}`);
    await page.evaluate(() => { game.desktop.yaw = 0; game.desktop.pitch = -0.05; });
    await frames(3);
    await shot('guard-7-my-room.png');
    const side = await page.evaluate(() => Math.sign(game.loco.head.z));
    await shot('guard-8-armour-by-the-door.png', [0, 1.7, side * 20.6], [0, 1.6, side * 16.5], 74);
    await shot('guard-9-shield-on-the-wall.png', [1.2, 1.7, side * 19.2], [-3.7, 1.6, side * 19.4], 58);
    // kit up: helmet, chest plate, sword, shield
    for (const [type, code, hand] of [['helmet', 'KeyG', 1], ['chestplate', 'KeyG', 1], ['sword', 'KeyG', 1], ['shield', 'KeyA', 0]]) await take(type, code, hand);
    check(await until(() => { const S = game.session; return S.body().armour.join() === '6,8' && game.heldWeapon(1) && game.heldWeapon(1).type.id === 'sword' && game.heldWeapon(0) && game.heldWeapon(0).type.id === 'shield'; }, null, 30000), 'I put on the helmet and chest plate, and take a sword and a shield');
    check(await phase('fight'), 'the fight starts');
    // hold the shield square in front of me and let it come
    await page.evaluate(s => { game.loco.teleport(new game.THREE.Vector3(0, 0.3, s * 4), game.loco.yaw); game.fx.length = 0; game.desktop.hands[0].rest.set(0.02, -0.2); }, side);
    const mine = e => e.k + (e.id === 'h' ? ':me' : ':bot');
    const seen = await until(() => {
      const S = game.session, b = S.bots.get(game.T.foe());
      if (b && S.rigs.get(game.T.foe())) game.T.lookAt(S.rigs.get(game.T.foe()).torsoTop);
      return game.fx.some(e => e.k === 'block' && e.id === 'h') || S.arena.phase !== 'fight';
    }, null, 240000);
    r = await page.evaluate(() => ({ fx: game.fx.filter(e => e.k === 'block' || e.k === 'armour').map(e => e.k + (e.id === 'h' ? ':me' : ':bot')), blood: game.session.body().blood, armour: game.session.body().armour.slice(), title: game.hud.title, phase: game.session.arena.phase }));
    check(seen && r.fx.includes('block:me'), `the bot's blow is caught on my shield: ${JSON.stringify(r)}`);
    await shot('guard-10-blocked.png');
    k = await page.evaluate(() => ({ me: game.loco.head.toArray(), bot: game.session.bots.get(game.T.foe()).loco.head.toArray() }));
    await page.evaluate(() => { game.avatar.firstPerson = false; });
    await shot('guard-11-duel.png', [(k.me[0] + k.bot[0]) / 2 + 3.2, 1.9, (k.me[2] + k.bot[2]) / 2 + 0.4], [(k.me[0] + k.bot[0]) / 2, 1.1, (k.me[2] + k.bot[2]) / 2], 50);
    await page.evaluate(() => { game.avatar.firstPerson = true; });
    // go at it with the sword: its shield and its armour both get in the way before it bleeds
    // (it is told to keep its own weapon to itself meanwhile, so that this part always plays out the same way)
    for (let i = 0; i < 60; i++) {
      const going = await page.evaluate(() => {
        const S = game.session, rg = S.rigs.get(game.T.foe());
        if (S.arena.phase !== 'fight' || !rg) return false;
        S.bots.get(game.T.foe()).cool = 1e9;
        S._threat = () => 0;                      // (nor does it raise its shield at each swing: here it just holds it in front of its chest)
        const at = i => (i % 3 ? rg.head : rg.torsoTop.clone().lerp(rg.torsoBottom, 0.4));        // two at the head (over its shield), then one at the body (into it)
        game.aimAt = at(game.swings = (game.swings || 0) + 1);
        const d = new game.THREE.Vector3(game.aimAt.x - game.loco.head.x, 0, game.aimAt.z - game.loco.head.z), flat = d.length();
        game.loco.origin.addScaledVector(d, 1 - 1.5 / flat); game.loco.vel.set(0, 0, 0);
        return true;
      });
      if (!going) break;
      await frames(3);
      await page.evaluate(() => { const S = game.session; if (S.arena.phase === 'fight' && S.rigs.get(game.T.foe())) { game.T.lookAt(game.aimAt); game.punchAhead(); } });
      await frames(4);
    }
    r = await page.evaluate(() => {
      const count = k => game.fx.filter(e => e.id !== 'h' && e.k === k).length;
      return { blocks: count('block'), armour: count('armour'), hits: count('hit'), off: game.fx.filter(e => e.id !== 'h' && e.k === 'armour' && e.left === 0).length, phase: game.session.arena.phase, w: game.session.arena.w };
    });
    check(r.blocks > 0, `some of my blows were caught on its shield or weapon: ${JSON.stringify(r)}`);
    check(r.armour > 0 && r.off > 0, `some rang off its armour, until that was knocked off: ${r.armour} (${r.off} pieces lost)`);
    check(r.hits > 0, `and after that it bled: ${r.hits} hits`);
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
