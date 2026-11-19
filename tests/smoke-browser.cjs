// Browser smoke test: loads the game, plays on desktop, does a hand stroke, saves screenshots.
// Usage: node tests/smoke-browser.cjs [outDir]
// Serves the repo locally and maps the three.js CDN to node_modules, so it works offline.
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

(async () => {
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('https://cdn.jsdelivr.net/npm/**', route => {
    // https://cdn.jsdelivr.net/npm/<package>@<version>/<file>  ->  node_modules/<package>/<file>
    const m = route.request().url().match(/\/npm\/([^@/]+)@[^/]+\/(.*)$/);
    route.fulfill({ path: path.join(root, 'node_modules', m[1], m[2]), contentType: 'text/javascript' });
  });

  // headless Chrome grants pointer lock and then drops it, which pauses the game: stub it out
  await page.addInitScript(() => { Element.prototype.requestPointerLock = () => Promise.resolve(); });
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => window.game && window.game.avatar, null, { timeout: 30000 });
  await page.screenshot({ path: path.join(out, '1-menu.png') });

  await page.click('#desktop');
  await page.evaluate(() => { game.desktop.yaw = 0; game.desktop.pitch = -0.5; });
  await page.waitForTimeout(1500); // settle on the floor
  const before = await page.evaluate(() => game.loco.head.toArray());

  // three running strokes: hold a hand, drag the mouse down fast, let go
  for (let s = 0; s < 3; s++) {
    const hand = s % 2;
    await page.evaluate(h => { game.desktop.grab(h, 1); }, hand);
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => { game.desktop.dy += 34; });
      await page.waitForTimeout(16);
    }
    await page.evaluate(h => { game.desktop.hands[h].held = 0; }, hand);
    await page.waitForTimeout(350);
  }
  const mid = await page.evaluate(() => ({ head: game.loco.head.toArray(), best: game.stats.best }));
  await page.screenshot({ path: path.join(out, '2-after-strokes.png') });

  // look down at your own arms while a hand is held out
  await page.evaluate(() => { game.desktop.pitch = -0.9; game.desktop.hands[0].held = 1; game.desktop.dx = -60; game.desktop.dy = -40; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, '3-arms.png') });
  // the same pose seen from outside, to check the skeleton's arms and head
  await page.evaluate(() => {
    const { THREE, loco } = game;
    const cam = new THREE.PerspectiveCamera(50, game.camera.aspect, 0.05, 100);
    const h = loco.head;
    cam.position.set(h.x + 1.4, h.y + 0.5, h.z - 1.6);
    cam.lookAt(h.x, h.y - 0.4, h.z);
    game.debugCamera = cam;
    game.avatar.firstPerson = false;
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, '4-third-person.png') });
  await page.evaluate(() => { game.debugCamera = null; game.avatar.firstPerson = true; game.desktop.hands[0].held = 0; });

  // sandbox: rain props from the panel and build a little stack, then look at it
  await page.evaluate(() => {
    game.session.pressButton('rain');
    const T = game.THREE;
    game.session.selected = 8; // trampoline
    game.session.spawnSelected(new T.Vector3(-2, 0.15, 1.5), new T.Quaternion());
    game.session.selected = 5; // big crate
    game.session.spawnSelected(new T.Vector3(1.5, 0.8, 1.5), new T.Quaternion());
  });
  await page.waitForTimeout(3500);
  const propCount = await page.evaluate(() => game.session.props.props.size);
  await page.evaluate(() => {
    const cam = new game.THREE.PerspectiveCamera(60, game.camera.aspect, 0.05, 200);
    cam.position.set(0, 5, 8);
    cam.lookAt(0, 0.5, -1.5);
    game.debugCamera = cam;
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, '6-props.png') });
  if (propCount < 15) errors.push(`only ${propCount} props after the rain`);

  // bird's-eye view of the whole map
  await page.evaluate(() => {
    const cam = new game.THREE.PerspectiveCamera(55, game.camera.aspect, 0.5, 300);
    cam.position.set(0, 62, 58);
    cam.lookAt(0, 0, -2);
    game.debugCamera = cam;
    game.scene.fog.far = 400;
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, '5-map.png') });
  await page.evaluate(() => { game.debugCamera = null; game.scene.fog.far = 110; });

  const moved = before[2] - mid.head[2]; // forward is -Z
  console.log(JSON.stringify({ before, after: mid.head, moved: +moved.toFixed(2), bestLaunch: +mid.best.toFixed(2), errors }, null, 1));
  await browser.close();
  server.close();
  if (errors.length || moved < 1) process.exit(1);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
