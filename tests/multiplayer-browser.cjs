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
