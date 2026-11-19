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
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebRtcHideLocalIpsWithMdns', '--allow-loopback-in-peer-connection'],
  });
  try {
    // host
    const a = await open(browser, '', 'Alice');
    await a.click('#host');
    check(await until(a, () => game.net.role === 'host'), 'host opened a room');
    const code = await a.evaluate(() => game.net.code);
    console.log('     room code', code);
    check(/^[A-Z2-9]{4}$/.test(code), 'room code looks right');

    // friend joins from an invite link
    const b = await open(browser, `&room=${code}`, 'Bob');
    check(await until(b, () => game.net.role === 'client'), 'friend joined the room');
    await a.click('#desktop');
    await b.click('#desktop');
    check(await until(a, () => game.session.players.size === 1 && [...game.session.players.values()][0].name === 'Bob'), 'host sees Bob in the room');
    check(await until(b, () => [...game.session.players.values()].some(p => p.name === 'Alice')), 'friend sees Alice in the room');

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
