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
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', route => {
    const rel = route.request().url().split('three@0.160.0/')[1];
    route.fulfill({ path: path.join(root, 'node_modules/three', rel), contentType: 'text/javascript' });
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

  const moved = before[2] - mid.head[2]; // forward is -Z
  console.log(JSON.stringify({ before, after: mid.head, moved: +moved.toFixed(2), bestLaunch: +mid.best.toFixed(2), errors }, null, 1));
  await browser.close();
  server.close();
  if (errors.length || moved < 1) process.exit(1);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
