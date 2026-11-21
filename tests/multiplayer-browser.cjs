// Two-player test: a local PeerJS server, two separate browsers, one hosts, one joins.
// Checks that props and players show up on both sides.
// Usage: node tests/multiplayer-browser.cjs [outDir]
const { chromium } = require('playwright');
const { ExpressPeerServer } = require('peer');
const express = require('express');
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
const SIGNAL_PORT = 9123;
// local PeerJS server on IPv4 (this sandbox has no IPv6)
const sigApp = express();
const signal = sigApp.listen(SIGNAL_PORT, '127.0.0.1');
sigApp.use('/', ExpressPeerServer(signal, { path: '/' }));

const failures = [];
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures.push(what); };

async function open(browser, query, name) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.addInitScript(() => { Element.prototype.requestPointerLock = () => Promise.resolve(); });
  await page.route('https://cdn.jsdelivr.net/npm/**', route => {
    const m = route.request().url().match(/\/npm\/([^@/]+)@[^/]+\/(.*)$/);
    route.fulfill({ path: path.join(root, 'node_modules', m[1], m[2]), contentType: 'text/javascript' });
  });
  await page.goto(`http://localhost:${server.address().port}/?signal=127.0.0.1:${SIGNAL_PORT}${query}`);
  await page.waitForFunction(() => window.game && window.game.avatar, null, { timeout: 30000 });
  await page.fill('#name', name);
  await page.dispatchEvent('#name', 'change');
  return page;
}
const until = (page, fn, arg, ms = 15000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

(async () => {
  const browser = await chromium.launch({
    // a fake microphone (it beeps) that needs no permission click, and sound without a click
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebRtcHideLocalIpsWithMdns', '--allow-loopback-in-peer-connection',
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    // host
    const a = await open(browser, '', 'Alice');
    await a.click('#host');
    check(await until(a, () => game.net.role === 'host'), 'host opened a room');
    const code = await a.evaluate(() => game.net.code);
    console.log('     room code', code);
    check(/^[A-Z2-9]{4}$/.test(code), 'room code looks right');

    // the host smashes a hole in the stone tower before anyone joins
    const P = '(x, y, z, r) => game.session.punch(new game.THREE.Vector3(x, y, z), r)';
    await a.evaluate(`(${P})(-24, 3, -21.5, 0.9)`);
    check(await a.evaluate(() => !game.voxels.solidAt(-24, 3, -21.8)), 'host punched a hole in the tower');

    // friend joins from an invite link
    const b = await open(browser, `&room=${code}`, 'Bob');
    check(await until(b, () => game.net.role === 'client'), 'friend joined the room');
    await a.click('#desktop');
    await b.click('#desktop');
    check(await until(a, () => game.session.players.size === 1 && [...game.session.players.values()][0].name === 'Bob'), 'host sees Bob in the room');
    check(await until(b, () => [...game.session.players.values()].some(p => p.name === 'Alice')), 'friend sees Alice in the room');

    // ---- voice chat: a call connects by itself, so each can hear the other even before any microphone is on
    check(await until(a, () => game.voice.connected === 1, null, 30000), 'the host has a voice link to the friend');
    check(await until(b, () => game.voice.connected === 1, null, 30000), 'the friend has a voice link to the host');
    check(await a.evaluate(() => !game.voice.on), 'no microphone is used until you turn it on');
    await a.evaluate(() => document.getElementById('mic').click());   // the start menu is hidden while playing
    check(await until(a, () => game.voice.speaking && document.getElementById('mic').textContent.includes('Microphone on')), 'the host turned the microphone on from the menu');
    const hears = page => until(page, () => { for (const c of game.voice.calls.values()) if (c.level > 0.02) return true; return false; }, null, 30000);
    check(await hears(b), 'the friend receives the host\'s voice');
    await b.evaluate(() => game.voice.enable());
    check(await hears(a), 'and the host receives the friend\'s');
    // distance: right next to each other is loud, far away is quiet, and the side matches
    const hostHead = await a.evaluate(() => { game.desktop.yaw = 0; return game.loco.head.toArray(); });
    const friendAt = async (dx, dz) => { await b.evaluate(([h, x, z]) => game.loco.teleport(new game.THREE.Vector3(h[0] + x, 0, h[2] + z)), [hostHead, dx, dz]); await b.waitForTimeout(900); };
    const heard = () => a.evaluate(() => { const c = [...game.voice.calls.values()][0]; return { volume: c.volume, side: c.side }; });
    await friendAt(1.5, 0);
    let v = await heard();
    check(v.volume > 0.9 && v.side > 0.4, `close on the right: loud and to the right (${JSON.stringify(v)})`);
    await friendAt(-12, 0);
    v = await heard();
    check(v.volume > 0.2 && v.volume < 0.45 && v.side < -0.4, `12 m to the left: quieter and to the left (${JSON.stringify(v)})`);
    await friendAt(0, 34);
    v = await heard();
    check(v.volume < 0.05, `34 m away: almost silent (${JSON.stringify(v)})`);
    await a.evaluate(() => document.getElementById('mic').click());   // the start menu is hidden while playing
    check(await a.evaluate(() => game.voice.muted && !game.voice.mic.getAudioTracks()[0].enabled), 'clicking again mutes the microphone');
    await a.evaluate(() => document.getElementById('mic').click());   // the start menu is hidden while playing
    await friendAt(2, 2);

    // ---- big players shake the ground: others hear and feel it; small players do not shake anything
    for (const pg of [a, b]) await pg.evaluate(() => { window.thumps = []; const f = game.session.onThump; game.session.onThump = (p, s) => { window.thumps.push(s); f(p, s); }; });
    await b.evaluate(() => game.session.thump(game.loco.head, 1));
    await b.waitForTimeout(500);
    check(await a.evaluate(() => window.thumps.length === 0), 'a normal-sized player cannot shake the ground');
    await a.evaluate(() => game.setSize(5));
    await a.waitForTimeout(700);     // let the friend see the new size
    await a.evaluate(() => game.stomp({ speed: 14, point: game.loco.head.clone().setY(0), col: null }, performance.now()));
    check(await until(b, () => window.thumps.length === 1 && window.thumps[0] > 0.8), 'a 2x player landing hard is felt by the friend');
    check(await a.evaluate(() => window.thumps.length === 0), 'the stomper does not get an echo of their own stomp');
    await a.evaluate(() => game.setSize(3));

    // someone who joins later still gets every hole made so far
    check(await until(b, () => !game.voxels.solidAt(-24, 3, -21.8) && game.voxels.solidAt(-24, 6, -22)), 'the friend sees the hole that was made before they joined');
    // a new punch by the host shows up for the friend, and the other way round
    await a.evaluate(`(${P})(-21.5, 2, -24, 0.9)`);
    check(await until(b, () => !game.voxels.solidAt(-21.8, 2, -24)), 'friend sees the host\'s new hole');
    check(await b.evaluate(`(${P})(-26.5, 2, -24, 0.9)`), 'friend can punch too');
    check(await until(a, () => !game.voxels.solidAt(-26.2, 2, -24)), 'host sees the friend\'s hole');
    const same = async () => (await a.evaluate(() => game.voxels.count())) === (await b.evaluate(() => game.voxels.count()));
    check(await same(), 'both worlds have exactly the same blocks');

    // host spawns things; friend sees them
    await a.evaluate(() => { game.session.select('crate'); for (let i = 0; i < 3; i++) game.session.spawnSelected(new game.THREE.Vector3(i, 1, 2), new game.THREE.Vector3(0, 0, -1)); });
    check(await until(b, () => game.session.props.props.size === 3), 'friend sees 3 props the host spawned');
    // friend spawns a trampoline; host sees it
    await b.evaluate(() => { game.session.select('trampoline'); game.session.spawnSelected(new game.THREE.Vector3(0, 0.5, -4), new game.THREE.Vector3(0, 0, -1)); });
    check(await until(a, () => [...game.session.props.props.values()].some(p => p.type.id === 'trampoline' && p.owner !== 'h')), 'host sees the trampoline the friend spawned');
    // prop rain from the panel, pressed by the friend
    await b.evaluate(() => game.session.pressButton('rain'));
    check(await until(b, () => game.session.props.props.size >= 20), 'prop rain reaches the friend');
    // low gravity from the friend applies on both sides
    await b.evaluate(() => game.session.pressButton('lowgrav'));
    check(await until(a, () => game.session.settings.gravity === 'low'), 'host gets low gravity');
    check(await until(b, () => game.loco.cfg.gravity > -5), 'friend falls slower too');
    // the friend throws a mini beach ball; it flies, lands and grows on both sides
    await b.evaluate(() => game.session.throwItem('beachball', new game.THREE.Vector3(0, 1.5, 4), new game.THREE.Vector3(0, 3, -3)));
    check(await until(a, () => game.session.props.seeds.size === 1), 'host sees the thrown mini in the air');
    check(await until(b, () => [...game.session.props.props.values()].some(p => p.type.id === 'beachball' && p.owner !== 'rain')), 'the thrown item grew where it landed, for the friend too');
    // the friend grows to 2x; the host sees a bigger skeleton
    await b.evaluate(() => { game.menuAction('size+'); game.menuAction('size+'); });
    check(await until(a, () => { const p = [...game.session.players.values()][0]; return p.cur && Math.abs(p.cur[21] - 2) < 0.05 && Math.abs(p.avatar.root.scale.x - 2) < 0.05; }), 'host sees the friend at 2x size');
    // sky change reaches everyone
    await a.evaluate(() => game.session.pressButton('sky'));
    check(await until(b, () => game.sky.name === 'sunset'), 'friend sees the sunset');
    // TNT: thrown by the friend, explodes for both
    await a.evaluate(() => { window.booms = 0; const f = game.session.onBoom; game.session.onBoom = p => { window.booms++; f(p); }; });
    await b.evaluate(() => { window.booms = 0; const f = game.session.onBoom; game.session.onBoom = p => { window.booms++; f(p); }; });
    await b.evaluate(() => game.session.throwItem('tnt', new game.THREE.Vector3(8, 1.5, 8), new game.THREE.Vector3(1, 2, 1)));
    // (two software-rendered browsers run slowly here, so allow plenty of real time for the 4 s fuse)
    check(await until(a, () => window.booms === 1, null, 90000), 'TNT exploded on the host');
    check(await until(b, () => window.booms === 1, null, 30000), 'TNT exploded for the friend');
    await b.evaluate(() => { game.session.select('dice'); game.session.spawnSelected(new game.THREE.Vector3(0, 0.5, -6), new game.THREE.Vector3(0, 0, -1)); });
    check(await until(a, () => [...game.session.props.props.values()].some(p => p.type.id === 'dice' && p.owner !== 'rain')), 'host sees the dice the friend spawned');

    // undo: the friend's last spawn (the dice) goes away for everyone
    await b.evaluate(() => game.session.undo());
    check(await until(a, () => ![...game.session.props.props.values()].some(p => p.type.id === 'dice' && p.owner !== 'rain')), 'friend undid their dice');

    // friend grabs a crate near their right hand and the host sees it held by them
    const grabbed = await b.evaluate(() => {
      game.desktop.keys.KeyG = true; // hold G, the desktop grab key
      const crate = [...game.session.props.props.values()].find(p => p.type.id === 'crate' && p.owner === 'h');
      return game.session.grab(1, crate.mesh.position.clone());
    });
    check(grabbed, 'friend grabbed a crate');
    check(await until(a, () => [...game.session.props.props.values()].some(p => p.held && p.held.key.startsWith('p'))), 'host sees the crate held by the friend');
    // letting go hands it back to physics
    await b.evaluate(() => { game.desktop.keys.KeyG = false; });
    check(await until(a, () => ![...game.session.props.props.values()].some(p => p.held)), 'friend let go of the crate');

    // ---- bodies: bots, punches, torn-off arms and dying are the same for both players
    await b.evaluate(() => game.setSize(3));
    const bId = await b.evaluate(() => game.session.myId);
    for (const pg of [a, b]) await pg.evaluate(() => {
      window.fx = []; const S = game.session, f = S.onBodyFx;
      S.onBodyFx = e => { window.fx.push(e.k + ':' + e.id); f(e); };
      const m = S._onMessage.bind(S); S._onMessage = (from, msg) => { if (msg && msg.t === 'given') window.given = msg; m(from, msg); };
    });
    await b.evaluate(() => game.session.addBot());      // the friend asks; the host makes it
    check(await until(a, () => game.session.botCount === 1 && game.session.bots.size === 1), 'the friend asked for a bot and the host made one');
    check(await until(b, () => { const p = game.session.players.get('b1'); return p && p.bot && p.avatar && p.avatar.root.visible && game.session.playerCount === 2; }), 'the friend sees the bot, and it is not counted as a player');
    await a.evaluate(() => { game.session.bots.get('b1').wait = 1e9; });
    await a.waitForTimeout(1500);
    const botAt = await a.evaluate(() => game.session.bots.get('b1').loco.head.toArray());
    await b.evaluate(h => game.loco.teleport(new game.THREE.Vector3(h[0], 0, h[2] + 1)), botAt);
    await b.waitForTimeout(1500);
    await b.evaluate(() => game.session.hit('b1', 'head', 30, 1));
    check(await until(a, () => game.session.body('b1').blood < 80), 'the friend\'s punch hurts the bot on the host');
    check(await until(b, () => game.session.body('b1').blood < 80 && window.fx.includes('hit:b1') && game.blood.drops.length + game.blood.splats.length > 0), 'and the friend sees it bleed');
    // the mouse shortcut: the friend takes the bot's arm off, and ends up holding it
    await b.evaluate(() => game.session.ripArm('b1', 0, 1));
    check(await until(a, () => game.session.body('b1').cut[0] === 2 && [...game.session.props.props.values()].some(p => p.type.id === 'gib_arm')), 'the friend tore the bot\'s arm off');
    check(await until(b, () => game.session.body('b1').cut[0] === 2 && !game.session.players.get('b1').avatar.arms[0].upper.g.visible && [...game.session.props.props.values()].some(p => p.type.id === 'gib_arm')), 'the friend sees the arm gone and lying about');
    check(await until(b, () => window.given && window.given.hand === 1), 'the arm was handed to the friend\'s hand');

    // players can hurt each other: the host punches the friend
    const bHead = await b.evaluate(() => game.loco.head.toArray());
    await a.evaluate(h => game.loco.teleport(new game.THREE.Vector3(h[0] + 1, 0, h[2])), bHead);
    await a.waitForTimeout(1500);
    await a.evaluate(id => game.session.hit(id, 'torso', 30, 1), bId);
    check(await until(b, id => game.session.body().blood < 90 && game.hud.blood && window.fx.includes('hit:' + id), bId), 'the host\'s punch hurts the friend, who gets a blood bar');
    check(await until(a, id => game.session.body(id).blood < 90, bId), 'the host sees the friend hurt');
    // with fighting switched off players are safe, but bots are not
    await b.evaluate(() => game.menuAction('pvp'));
    check(await until(a, () => game.session.settings.pvp === false), 'either player can switch fighting off');
    check(await until(b, () => game.session.settings.pvp === false), 'and both see it off');
    const safe = await a.evaluate(async id => {
      const S = game.session, before = S.body(id).blood, bot = S.body('b1').blood;
      S.hit(id, 'head', 60, 1); S.hit('b1', 'torso', 20, 1);
      return { same: S.body(id).blood >= before - 0.5, canHurt: S.canHurt(id), botHurt: S.body('b1').blood < bot };
    }, bId);
    check(safe.same && !safe.canHurt && safe.botHurt, `fighting off: players are safe, bots are not (${JSON.stringify(safe)})`);
    await a.waitForTimeout(700);
    await a.evaluate(() => game.menuAction('pvp'));
    check(await until(b, () => game.session.settings.pvp === true), 'fighting back on');

    // the friend takes hold of the host's arm (grip) and pulls it off
    await a.evaluate(() => { game.desktop.yaw = 0; game.desktop.pitch = 0; });
    await b.evaluate(() => { game.desktop.yaw = 0; game.desktop.pitch = -0.55; });
    await b.waitForTimeout(800);
    const reach = () => b.evaluate(() => { game.loco.origin.add(game.session.rigs.get('h').wrist[0].clone().sub(game.loco.hands[1].pos)); game.loco.vel.set(0, 0, 0); for (const h of game.handHist) h.length = 0; });
    await reach();
    await b.waitForTimeout(1500);        // let the host see where the hand went
    await reach();
    await b.waitForTimeout(800);
    await b.evaluate(() => { game.desktop.keys.KeyG = true; });
    check(await until(a, id => game.session.body().held[0] === id + ':1', bId, 20000), 'the friend has hold of the host\'s left arm');
    check(await until(b, () => { const h = game.session.holding(1); return h && h.id === 'h' && h.arm === 0; }), 'and knows it');
    check(await a.evaluate(() => !game.session.body().canUse(0) && game.session.body().canUse(1) && /has your arm/.test(game.hud.title)), 'the host cannot use the held arm, and is told who has it');
    // pull: straight away from the host's shoulder
    await b.evaluate(() => { const away = game.loco.hands[1].pos.clone().sub(game.session.rigs.get('h').shoulder[0]).normalize(); game.loco.origin.addScaledVector(away, 1.2); game.loco.vel.set(0, 0, 0); });
    check(await until(a, () => game.session.body().cut[0] === 2, null, 20000), 'pulled far enough, the host\'s arm tears off');
    check(await a.evaluate(() => !game.avatar.arms[0].upper.g.visible && game.avatar.arms[1].upper.g.visible && /left arm is gone/.test(game.hud.title) && game.hud.blood.bleeding), 'the host sees and feels it');
    check(await until(b, () => { const p = game.session.props.props.get(game.session.held[1]); return p && p.type.id === 'gib_arm' && game.session.body('h').cut[0] === 2 && !game.session.players.get('h').avatar.arms[0].upper.g.visible; }), 'the friend is left holding the host\'s arm');
    await b.evaluate(() => { game.desktop.pitch = -0.2; });
    await b.waitForTimeout(600);
    await b.screenshot({ path: path.join(out, 'mp-arm-torn-off.png') });
    await b.evaluate(() => { game.desktop.keys.KeyG = false; });
    check(await until(a, () => ![...game.session.props.props.values()].some(p => p.held)), 'letting go drops it');

    // the host kills the friend, who comes back whole at the start
    await a.evaluate(id => game.session.hit(id, 'head', 250, 1), bId);
    check(await until(b, () => game.session.body().dead && /lost your head/.test(game.hud.title) && !game.avatar.root.visible), 'the friend dies (a blow that hard takes the head off)');
    check(await until(a, id => game.session.body(id).dead && !game.session.players.get(id).avatar.root.visible && [...game.session.props.props.values()].some(p => p.type.id === 'gib_head'), bId), 'the host sees the friend fall apart');
    check(await until(b, () => !game.session.body().dead && game.session.body().blood === 100 && game.avatar.root.visible && Math.hypot(game.loco.head.x, game.loco.head.z - 6) < 3, null, 90000), 'and a few seconds later the friend is back at the start, whole');
    check(await until(a, id => !game.session.body(id).dead && game.session.players.get(id).avatar.root.visible, bId), 'the host sees the friend again');
    await a.evaluate(() => game.session.clearBots());
    check(await until(b, () => game.session.botCount === 0 && !game.session.players.has('b1')), 'clearing the bots removes them for the friend too');
    await b.evaluate(() => game.setSize(5));
    await b.waitForTimeout(700);

    // both players' skeletons are visible to each other
    check(await until(a, () => [...game.session.players.values()].every(p => p.avatar && p.avatar.root.visible)), 'host draws the friend\'s skeleton');
    check(await until(b, () => [...game.session.players.values()].every(p => p.avatar && p.avatar.root.visible)), 'friend draws the host\'s skeleton');

    // a look from the host's side at the friend
    await a.evaluate(() => {
      const other = [...game.session.players.values()][0];
      const c = other.cur;
      const cam = new game.THREE.PerspectiveCamera(60, game.camera.aspect, 0.05, 200);
      cam.position.set(c[0] + 1.2, c[1] + 0.6, c[2] - 2.2);
      cam.lookAt(c[0], c[1] - 0.3, c[2]);
      game.debugCamera = cam;
    });
    await a.waitForTimeout(400);
    await a.screenshot({ path: path.join(out, 'mp-host-view.png') });

    // ---- hide and seek
    await a.evaluate(() => { game.ROUND.hide = 3; game.ROUND.hunt = 60; game.ROUND.over = 3; game.debugCamera = null; });
    await b.evaluate(() => game.session.setMode('hideseek'));      // either player can switch mode
    check(await until(a, () => game.session.settings.mode === 'hideseek' && game.voxels.solidAt(13.5, 2, -30)), 'host switched to the hide and seek map');
    check(await until(b, () => game.session.mode === 'hideseek' && game.voxels.solidAt(13.5, 2, -30) && game.session.props.props.size === 0), 'friend got the new map, with no props left over');
    check(await until(a, () => game.session.round.phase === 'hide'), 'a round started by itself');
    check(await until(b, () => game.session.round.phase === 'hide'), 'the friend sees the round');
    const roles = async () => [await a.evaluate(() => game.session.role()), await b.evaluate(() => game.session.role())];
    const r1 = await roles();
    check(r1.includes('giant') && r1.includes('hider'), `one giant and one hider: ${r1}`);
    const [giant, hider] = r1[0] === 'giant' ? [a, b] : [b, a];
    check(await until(giant, () => game.loco.scale === 2 && game.loco.power === 1), 'the giant is 2x size');
    check(await until(hider, () => game.loco.scale === 0.25 && game.loco.power === 3), 'the hider is 0.25x size with 3x power');
    check(await giant.evaluate(() => game.hud.blind === true), 'the giant cannot see while they hide');
    check(await hider.evaluate(() => game.hud.blind === false), 'the hider can see');
    check(await giant.evaluate(() => game.session.canBreak() === false), 'nobody can smash during hiding');
    const gy = await giant.evaluate(() => game.loco.head.toArray());
    await giant.screenshot({ path: path.join(out, 'mp-giant-waiting.png') });
    check(await until(a, () => game.session.round.phase === 'hunt', null, 60000), 'hiding time ended and the hunt began');
    check(await until(giant, () => game.hud.blind === false && game.session.canBreak() === true), 'the giant can see and smash now');
    check(await until(hider, () => game.session.round.phase === 'hunt' && game.session.canBreak() === false), 'the hider still cannot smash');
    // each sees the other at the right size
    check(await until(giant, () => { const p = [...game.session.players.values()][0]; return p.cur && Math.abs(p.cur[21] - 0.25) < 0.02 && !p.avatar.label.visible; }), 'the giant sees a tiny hider with no name tag');
    check(await until(hider, () => { const p = [...game.session.players.values()][0]; return p.cur && Math.abs(p.cur[21] - 2) < 0.05; }), 'the hider sees a giant');
    // the giant smashes the fountain; the hider sees it break
    const before = await hider.evaluate(() => game.voxels.count());
    check(await giant.evaluate(`(${P})(0, 2.2, 0, 1.0)`), 'the giant breaks something');
    check(await until(hider, n => game.voxels.count() < n, before), 'the hider sees it break');
    check(!(await hider.evaluate(`(${P})(8, 1, -6, 0.8)`)), 'a hider\'s punch does nothing');
    // a view of the hunt from the hider's side
    await hider.evaluate(() => { game.desktop.yaw = Math.PI; game.desktop.pitch = 0.5; });
    await hider.waitForTimeout(600);
    await hider.screenshot({ path: path.join(out, 'mp-hider-view.png') });
    // a hider's heart pounds when the giant is near, and calms down far away
    const gHead = await giant.evaluate(() => game.loco.head.toArray());
    await hider.evaluate(g => { game.stats.beats = 0; game.loco.teleport(new game.THREE.Vector3(g[0] + 22, 0, g[2] + 14)); }, gHead);
    await hider.waitForTimeout(2500);
    check(await hider.evaluate(() => game.stats.beats === 0), 'no heartbeat when the giant is far away');
    await hider.evaluate(g => game.loco.teleport(new game.THREE.Vector3(g[0] + 4, 0, g[2] + 3)), gHead);
    check(await until(hider, () => game.stats.beats >= 2, null, 30000), 'the heartbeat starts when the giant is close');
    check(await giant.evaluate(() => !game.stats.beats), 'the giant has no heartbeat');

    // the hider runs into the giant's hand: caught, and with nobody left the giant wins
    const hand = await giant.evaluate(() => game.loco.hands[1].pos.toArray());
    await hider.evaluate(h => { game.loco.teleport(new game.THREE.Vector3(h[0], h[1] - 0.2 - 1.5 * 0.25 + 0.0, h[2])); }, hand);
    check(await until(a, () => game.session.round.phase === 'over' && game.session.round.winner === 'giant', null, 30000), 'the hider was caught and the giant won');
    check(await until(hider, () => game.session.round.out.length === 1), 'the hider is marked as caught');
    // next round: the map is repaired and the roles swap
    check(await until(a, () => game.session.round.phase === 'hide' && game.session.round.n === 2, null, 60000), 'the next round started');
    check(await until(hider, () => game.session.role() === 'giant' && game.loco.scale === 2, null, 20000), 'last round\'s hider is the giant now');
    check(await until(giant, () => game.session.role() === 'hider' && game.loco.scale === 0.25, null, 20000), 'and the giant is hiding');
    check(await until(giant, () => game.voxels.solidAt(0.4, 2.3, 0.4)), 'the fountain is whole again');
    check(await same(), 'both worlds match after the repair');
    // back to sandbox: everyone returns to normal size
    await a.evaluate(() => game.session.setMode('sandbox'));
    check(await until(b, () => game.session.mode === 'sandbox' && game.loco.scale === 2 && game.voxels.solidAt(-24, 6, -24)), 'back in the sandbox, at the 2x size the friend had picked there');
    check(await until(a, () => game.loco.scale === 1 && game.session.role() === 'free'), 'host is back to normal too');

    // ---- the arena: with two players, the two of them are the whole bracket
    await b.evaluate(() => game.setSize(3));
    await a.evaluate(() => { Object.assign(game.ARENA, { intro: 2, prep: 6, result: 3, champion: 5 }); });
    await b.evaluate(() => game.session.setMode('arena'));
    check(await until(a, () => game.session.mode === 'arena' && game.session.arena.phase !== 'waiting', null, 60000), 'the friend switched to the arena and a tournament began');
    check(await until(b, () => game.session.mode === 'arena' && game.voxels.solidAt(13.5, 2, 0) && !game.voxels.solidAt(0, 1.5, -19), null, 60000), 'the friend has the colosseum too');
    check(await until(a, () => game.session.arena.phase === 'prep', null, 120000), 'the match is called');
    check(await until(b, () => game.session.arena.phase === 'prep' && game.session.role() === 'fighter' && Math.abs(game.loco.head.z) > 16.5, null, 30000), 'the friend is sent to a room');
    check(await until(a, () => game.session.role() === 'fighter' && Math.abs(game.loco.head.z) > 16.5, null, 30000), 'and so is the host');
    let ar = { a: await a.evaluate(() => ({ z: game.loco.head.z, gates: game.level.gatesOpen, bots: game.session.botCount, bracket: game.session.arena.rounds[0][0] })), b: await b.evaluate(() => ({ z: game.loco.head.z, gates: game.level.gatesOpen, racks: [...game.session.props.props.values()].filter(p => p.owner === 'rack').length, board: game.session.arena.rounds[0][0] })) };
    check(ar.a.z * ar.b.z < 0 && !ar.a.gates && !ar.b.gates && ar.a.bots === 0, `they are at opposite ends behind shut gates, with no bots needed: ${JSON.stringify(ar)}`);
    check(ar.b.racks === 12 && ar.b.board.slice(0, 2).sort().join() === ['h', bId].sort().join(), 'the friend sees the weapons and the bracket');
    // the friend takes an axe off the wall
    await b.evaluate(() => {
      const T = game.THREE, axe = [...game.session.props.props.values()].filter(p => p.type.id === 'axe').sort((p, q) => p.mesh.position.distanceTo(game.loco.head) - q.mesh.position.distanceTo(game.loco.head))[0];
      game.axe = axe.id;
      game.loco.teleport(new T.Vector3(0, 0.25, axe.mesh.position.z), game.loco.yaw);
      const d = axe.mesh.position.clone().sub(new T.Vector3(0, 1.05, axe.mesh.position.z)).applyAxisAngle(new T.Vector3(0, 1, 0), -game.loco.yaw);
      game.desktop.yaw = Math.atan2(-d.x, -d.z); game.desktop.pitch = 0;
    });
    await b.waitForTimeout(1200);
    await b.evaluate(() => { const p = game.session.props.props.get(game.axe).mesh.position; game.loco.origin.add(p.clone().sub(game.loco.hands[1].pos)); game.loco.vel.set(0, 0, 0); for (const h of game.handHist) h.length = 0; });
    await b.waitForTimeout(1500);        // let the host see where the hand went
    await b.evaluate(() => { const p = game.session.props.props.get(game.axe).mesh.position; game.loco.origin.add(p.clone().sub(game.loco.hands[1].pos)); game.desktop.keys.KeyG = true; game.desktop.pressed.add('KeyG'); });
    check(await until(a, id => [...game.session.props.props.values()].some(p => p.type.id === 'axe' && p.held && p.held.key === id + ':1'), bId, 30000), 'the friend takes an axe off the wall');
    await b.evaluate(() => { game.desktop.keys.KeyG = false; });
    await b.waitForTimeout(600);
    check(await b.evaluate(() => !!game.heldWeapon(1) && game.stuck[1] && game.desktop.hands[1].armed), 'and it stays in the friend\'s hand');
    await b.screenshot({ path: path.join(out, 'mp-arena-armed.png') });
    // before the gates open nobody can be hurt
    await a.evaluate(id => game.session.hit(id, 'head', 100, 1), bId);
    check(await a.evaluate(id => game.session.body(id).blood === 100 && !game.session.canHurt(id), bId), 'nobody can be hurt before the gates open');
    check(await until(a, () => game.session.arena.phase === 'fight', null, 120000), 'the fight starts');
    check(await until(b, () => game.session.arena.phase === 'fight' && game.level.gatesOpen && game.hud.title === 'FIGHT!', null, 30000), 'the friend\'s gate opens too');
    // they meet in the middle; the friend's axe takes the host's forearm off in one blow
    await a.evaluate(() => { game.loco.teleport(new game.THREE.Vector3(0.6, 0.3, 0), game.loco.yaw); });
    await b.evaluate(() => { game.loco.teleport(new game.THREE.Vector3(-0.6, 0.3, 0), game.loco.yaw); });
    await a.waitForTimeout(2000);
    await b.evaluate(() => game.session.hit('h', 'foreL', 20, 1, game.axe));
    check(await until(a, () => game.session.body().cut[0] === 1 && /forearm is gone/.test(game.hud.title), null, 30000), 'the friend\'s axe takes the host\'s forearm off in one blow');
    // the host knocks the friend's head off
    await a.evaluate(id => game.session.hit(id, 'head', 250, 1), bId);
    check(await until(b, () => game.session.body().dead && /lost your head/.test(game.hud.title), null, 30000), 'the host knocks the friend\'s head off, and the friend is told so');
    check(await until(a, () => game.session.arena.phase === 'result' && game.session.arena.w === 'h' && game.hud.title === 'You win!', null, 30000), 'the host wins the fight');
    check(await until(b, () => game.session.arena.w === 'h' && [...game.session.props.props.values()].some(p => p.type.id === 'gib_head' && !p.rag) && [...game.session.props.props.values()].some(p => p.type.id === 'gib_torso' && p.wounds & 1), null, 30000), 'the friend sees their own headless body and the head lying apart');
    await b.waitForTimeout(1500);
    await b.screenshot({ path: path.join(out, 'mp-arena-dead.png') });
    check(await until(a, () => game.session.arena.phase === 'champion' && game.session.arena.champion === 'h', null, 60000), 'and is the champion');
    check(await until(b, () => game.session.arena.champion === 'h' && /is the champion/.test(game.hud.title), null, 30000), 'the friend sees who won');
    check(await until(b, () => !game.session.body().dead && game.session.role() === 'spectator' && Math.hypot(game.loco.head.x, game.loco.head.z) > 15, null, 90000), 'the friend comes back to life in the seats');
    await a.evaluate(() => game.session.setMode('sandbox'));
    check(await until(b, () => game.session.mode === 'sandbox' && game.session.role() === 'free' && game.session.props.props.size === 0, null, 60000), 'back to the sandbox');

    // friend leaves; host's room empties
    await b.evaluate(() => game.session.leave());
    check(await until(a, () => game.session.players.size === 0), 'host sees the friend leave');

    check(a.errors.length === 0, `no errors on host page ${a.errors.join(' | ')}`);
    check(b.errors.filter(e => !/Lost connection|peer/i.test(e)).length === 0, `no errors on friend page ${b.errors.join(' | ')}`);
  } finally {
    await browser.close();
    server.close();
    signal.close && signal.close();
  }
  console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
