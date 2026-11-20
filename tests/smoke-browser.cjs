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
  // wait in game seconds, so the test behaves the same however slowly this machine renders
  const gameWait = async sec => {
    const until = (await page.evaluate(() => game.time)) + sec;
    await page.waitForFunction(t => game.time >= t, until, { timeout: 120000 });
  };
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
    const T = game.THREE, fwd = new T.Vector3(0, 0, -1);
    game.session.select('trampoline');
    game.session.spawnSelected(new T.Vector3(-2, 0.15, 1.5), fwd);
    game.session.select('bigcrate');
    game.session.spawnSelected(new T.Vector3(1.5, 0.8, 1.5), fwd);
    // throw a mini launch pad and a TNT: they should grow where they land
    game.session.throwItem('launchpad', new T.Vector3(0, 1.5, 8), new T.Vector3(0, 3, 3));
    game.session.throwItem('tnt', new T.Vector3(0, 1.5, 3), new T.Vector3(3, 3, -5));
  });
  await gameWait(0.3);
  const seeds = await page.evaluate(() => game.session.props.seeds.size);
  if (seeds !== 2) errors.push(`expected 2 flying seeds, saw ${seeds}`);
  await gameWait(3);
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
  const landed = await page.evaluate(() => [...game.session.props.props.values()].filter(p => p.type.id === 'launchpad').map(p => p.mesh.position.toArray()));
  if (landed.length !== 1 || landed[0][1] > 0.3) errors.push(`launch pad did not land on the ground: ${JSON.stringify(landed)}`);

  // TNT goes off after its fuse and is gone
  await gameWait(2.5);
  const tnt = await page.evaluate(() => [...game.session.props.props.values()].filter(p => p.type.id === 'tnt').length);
  if (tnt !== 0) errors.push('TNT did not explode');

  // arm menu: each tab, then size and power
  await page.evaluate(() => { game.debugCamera = null; game.desktop.pitch = -0.1; });
  for (const [tab, file] of [[0, '7-menu-items.png'], [1, '8-menu-player.png'], [2, '9-menu-world.png'], [3, '9b-menu-game.png']]) {
    await page.evaluate(t => { game.armMenu.tab = t; }, tab);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(out, file) });
  }
  // poke the menu the way a fingertip would: hover over the World tab, then touch it
  const poke = await page.evaluate(() => {
    const m = game.armMenu, T = game.THREE;
    const pose = { pos: m.group.position.clone(), quat: m.group.quaternion.clone() };
    const at = (px, py, z) => m.group.localToWorld(new T.Vector3((px / 840 - 0.5) * 0.28, (0.5 - py / 600) * 0.2, z));
    const state = { selected: 'crate', size: 1, power: 1, gravity: 'Normal', sky: 'Day', smash: true, room: 'Solo', players: 1, calib: 0, mode: 'sandbox', locked: false, game: [] };
    m.tab = 0; m.page = 0;
    const hoverOnly = m.update(0.016, pose, 1, at(520, 44, 0.07), state);
    const hovered = m.hover;
    const touched = m.update(0.016, pose, 1, at(520, 44, 0.01), state);
    const tabAfter = m.tab;
    m.tab = 0;
    m.update(0.5, pose, 1, null, state);
    const item = m.itemAt(at(320, 190, 0.03));          // second slot on the first page
    const offPanel = m.itemAt(at(320, 190, 0.3));
    // the open/close tab under the panel: poke to close, move away, poke again to open
    const handle = z => m.group.localToWorld(new T.Vector3(0, -0.1 - 0.032, z));
    const closeEv = m.update(0.6, pose, 1, handle(0.01), state), closed = !m.visible, handleShown = m.handle.visible && m.group.visible;
    const itemWhenClosed = m.itemAt(at(320, 190, 0.03));
    m.update(0.6, pose, 1, handle(0.2), state);
    const openEv = m.update(0.6, pose, 1, handle(0.01), state), reopened = m.visible;
    m.update(0.6, pose, 1, null, state);
    return { hoverOnly, hovered, touched, tabAfter, item, offPanel, closeEv, closed, handleShown, itemWhenClosed, openEv, reopened };
  });
  if (poke.hoverOnly.length || poke.hovered !== 'tab:2' || poke.touched[0] !== 'tab:2' || poke.tabAfter !== 2 || poke.item !== 'ball' || poke.offPanel !== null)
    errors.push(`arm menu poke failed: ${JSON.stringify(poke)}`);
  if (poke.closeEv[0] !== 'toggle' || !poke.closed || !poke.handleShown || poke.itemWhenClosed !== null || poke.openEv[0] !== 'toggle' || !poke.reopened)
    errors.push(`arm menu open/close tab failed: ${JSON.stringify(poke)}`);
  await page.evaluate(() => { game.armMenu.visible = false; });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, '9c-menu-closed.png') });
  await page.evaluate(() => { game.armMenu.visible = true; });

  const sized = await page.evaluate(async () => {
    game.setSize(5);   // 2x
    game.menuAction('power+');
    const t0 = game.time;
    await new Promise(r => { const tick = () => (game.time > t0 + 1.2 ? r() : setTimeout(tick, 50)); tick(); });
    return { scale: game.loco.scale, power: game.loco.power, headY: game.loco.head.y, rig: game.camera.parent.scale.x };
  });
  if (sized.scale !== 2 || sized.rig !== 2 || sized.power !== 1.5) errors.push(`size/power not applied: ${JSON.stringify(sized)}`);
  if (Math.abs(sized.headY - 1.6) > 0.25) errors.push(`a 2x player should stand about 1.6 m tall, head at ${sized.headY}`);
  await page.evaluate(() => { game.menuAction('sky'); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, '10-giant-sunset.png') });
  await page.evaluate(() => { game.setSize(3); game.menuAction('power-'); game.session.pressButton('sky'); });
  await page.waitForTimeout(700);
  await page.evaluate(() => { game.session.pressButton('sky'); });   // night -> back to day
  await page.waitForTimeout(700);

  const view = async (file, pos, look, fog = 400) => {
    await page.evaluate(([p, l, f]) => {
      const cam = new game.THREE.PerspectiveCamera(55, game.camera.aspect, 0.2, 400);
      cam.position.set(...p); cam.lookAt(...l);
      game.debugCamera = cam; game.scene.fog.far = f;
    }, [pos, look, fog]);
    await page.waitForFunction(() => game.voxelView.dirty.size === 0, null, { timeout: 60000 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(out, file) });
    await page.evaluate(() => { game.debugCamera = null; });
  };
  await view('5-map.png', [0, 62, 58], [0, 0, -2]);

  // ---- smashing: punch the stone tower, then keep going until it is cut through
  await page.evaluate(() => { game.session.pressButton('clear'); game.loco.teleport(new game.THREE.Vector3(-24, 0, -20.3)); game.desktop.yaw = 0; game.desktop.pitch = 0.25; });
  await gameWait(0.6);
  const smash = await page.evaluate(() => {
    const before = game.voxels.count();
    game.punchAhead();
    const one = before - game.voxels.count();
    return { one, hollowAhead: !game.voxels.solidAt(-24, 1.1, -21.6), debris: game.scene.children.filter(o => o.isInstancedMesh).map(o => o.count) };
  });
  if (smash.one < 5 || smash.one > 200) errors.push(`one punch should make a dent: ${JSON.stringify(smash)}`);
  await gameWait(0.3);
  await view('11-dent.png', [-21.5, 2.2, -17], [-24, 1.3, -21.5], 110);
  // with smashing switched off nothing breaks
  const off = await page.evaluate(async () => {
    game.session.pressButton('smash');
    const n = game.voxels.count(); game.punchAhead();
    const same = game.voxels.count() === n;
    await new Promise(r => setTimeout(r, 700));
    game.session.pressButton('smash');
    return { same, smash: game.session.settings.smash };
  });
  if (!off.same || !off.smash) errors.push(`smashing off should stop punches: ${JSON.stringify(off)}`);
  // cut the tower through at the base: everything above it comes down
  const felled = await page.evaluate(() => {
    const before = game.voxels.count();
    for (let x = -26.6; x <= -21.4; x += 0.6) for (let z = -26.6; z <= -21.4; z += 0.6) game.session.punch(new game.THREE.Vector3(x, 1.2, z), 0.7);
    return { lost: before - game.voxels.count(), top: game.voxels.solidAt(-24, 10, -24), stump: game.voxels.solidAt(-24, 0.2, -24), log: game.session.carveLog.length };
  });
  if (felled.top || !felled.stump || felled.lost < 15000) errors.push(`cutting the tower should bring it down: ${JSON.stringify(felled)}`);
  await gameWait(0.4);
  await view('12-tower-felled.png', [-14, 6, -12], [-24, 2, -24], 110);
  // repairing the map puts it back
  const repaired = await page.evaluate(() => { game.session.resetMap(); return { top: game.voxels.solidAt(-24, 10, -24), log: game.session.carveLog.length }; });
  if (!repaired.top || repaired.log !== 0) errors.push(`repair failed: ${JSON.stringify(repaired)}`);

  // ---- hide and seek mode: the other map loads; alone, you can explore it
  await page.evaluate(() => game.session.setMode('hideseek'));
  await gameWait(0.3);
  const hs = await page.evaluate(() => ({
    mode: game.session.settings.mode, phase: game.session.round.phase, role: game.session.role(),
    castle: game.voxels.solidAt(13.5, 2, -30), fountain: game.voxels.solidAt(0.4, 1, 0.4), head: game.loco.head.toArray(),
    stats: game.voxelView.stats(), calls: game.renderer.info.render.calls, status: game.hud.status,
  }));
  if (hs.mode !== 'hideseek' || hs.phase !== 'waiting' || hs.role !== 'free' || !hs.castle || !hs.fountain) errors.push(`hide and seek map did not load: ${JSON.stringify(hs)}`);
  console.log('hide and seek map:', JSON.stringify(hs.stats), 'draw calls', hs.calls);
  // the hiding places really are hollow
  const hollow = await page.evaluate(() => {
    const v = game.voxels, air = (x, y, z) => !v.solidAt(x, y, z);
    return {
      caveChamber: air(23, 1, 23), caveRock: v.solidAt(23, 5.2, 27), caveMouth: air(23 + Math.cos(0.3) * 9.6, 0.55, 23 + Math.sin(0.3) * 9.6),
      treeInside: air(25, 3, 2.2) && v.solidAt(27, 3, 2), treeKnot: air(25.1, 0.4, 3.9),
      houseRoom: air(-28, 0.6, -27.5), houseAttic: air(-27.5, 3.3, -28.2), chimney: air(-25.0, 3, -30.0),
      logTube: air(-28, 0.6, -5.4) && v.solidAt(-28, 1.2, -5.4), mazeLane: air(-33.1, 1, 13.9) || air(-33.1, 1, 15.1),
      keepHall: air(25, 1.5, -24), barnLoft: v.solidAt(2, 2.9, 22) && air(2, 3.6, 22),
    };
  });
  for (const [name, ok] of Object.entries(hollow)) if (!ok) errors.push(`hiding place check failed: ${name}`);
  await view('13-hideseek-map.png', [0, 70, 62], [0, 0, 0]);
  await view('14-village.png', [-12, 9, -9], [-24, 1, -24], 140);
  await view('15-castle.png', [6, 12, -6], [24, 2, -24], 140);
  await view('16-maze-barn.png', [-8, 16, 44], [-12, 0, 20], 140);
  await view('17-tree-cave.png', [44, 14, 8], [22, 3, 14], 140);
  // inside a house, at hider height
  await view('18-inside-house.png', [-26.5, 0.5, -26.5], [-29, 0.8, -29.5], 60);
  await view('19-plaza.png', [0, 1.7, 9], [0, 1.2, 0], 140);
  // tiny players really are tiny: stand a 0.25x player by the fountain
  await page.evaluate(() => { game.setSize(0); });
  await gameWait(1.2);
  const tiny = await page.evaluate(() => ({ scale: game.loco.scale, headY: game.loco.head.y }));
  if (tiny.scale !== 0.25 || Math.abs(tiny.headY - 0.2) > 0.08) errors.push(`a 0.25x player should stand 0.2 m tall: ${JSON.stringify(tiny)}`);
  await page.evaluate(() => { game.desktop.pitch = 0.15; });
  await gameWait(0.2);
  await page.screenshot({ path: path.join(out, '20-tiny-view.png') });
  await page.evaluate(() => { game.setSize(3); game.session.setMode('sandbox'); });
  await gameWait(0.5);
  const back = await page.evaluate(() => ({ mode: game.session.settings.mode, tower: game.voxels.solidAt(-24, 10, -24) }));
  if (back.mode !== 'sandbox' || !back.tower) errors.push(`switching back to sandbox failed: ${JSON.stringify(back)}`);

  const moved = before[2] - mid.head[2]; // forward is -Z
  console.log(JSON.stringify({ before, after: mid.head, moved: +moved.toFixed(2), bestLaunch: +mid.best.toFixed(2), errors }, null, 1));
  await browser.close();
  server.close();
  if (errors.length || moved < 1) process.exit(1);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
