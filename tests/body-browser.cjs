// Browser test for bodies: bots, punching, losing arms, bleeding out, dying and coming back.
// Usage: node tests/body-browser.cjs [outDir]
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
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
    await page.waitForFunction(t => game.time >= t, until, { timeout: 180000 });
  };
  const until = (fn, arg, ms = 60000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
  const shot = async (file, pos, look) => {
    if (pos) await page.evaluate(([p, l]) => {
      const cam = new game.THREE.PerspectiveCamera(55, game.camera.aspect, 0.05, 200);
      cam.position.set(...p); cam.lookAt(...l); game.debugCamera = cam;
    }, [pos, look]);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(out, file) });
    await page.evaluate(() => { game.debugCamera = null; });
  };

  try {
    await page.goto(`http://localhost:${server.address().port}/`);
    await page.waitForFunction(() => window.game && window.game.avatar, null, { timeout: 30000 });
    await page.click('#desktop');
    await gameWait(1);
    // helpers that live in the page
    await page.evaluate(() => {
      const T = game.THREE, S = game.session;
      game.fx = [];
      const old = S.onBodyFx; S.onBodyFx = e => { game.fx.push(e); old(e); };
      game.T = {
        gibs: () => [...S.props.props.values()].filter(p => p.type.gib).map(p => p.type.id).sort(),
        // stand in front of a bot and look straight at one of its joints
        face(id, joint = 'head', dist = 0.9) {
          const rg = S.rigs.get(id), at = Array.isArray(rg[joint]) ? rg[joint][0] : rg[joint];
          game.loco.teleport(new T.Vector3(at.x, game.loco.origin.y, at.z + dist));
          game.aim = at.clone();
        },
        look() {     // call a frame after face(): point the camera at the joint
          const d = game.aim.clone().sub(game.loco.head);
          game.desktop.yaw = Math.atan2(-d.x, -d.z); game.desktop.pitch = Math.asin(d.y / d.length());
        },
        // put my right hand exactly on a point (moves my whole body)
        handTo(p) { game.loco.origin.add(p.clone().sub(game.loco.hands[1].pos)); game.loco.vel.set(0, 0, 0); for (const h of game.handHist) h.length = 0; },
        still(id) { const b = S.bots.get(id); b.wait = 1e9; b.loco.vel.set(0, 0, 0); },
      };
    });

    // ---- bots
    const calls0 = await page.evaluate(() => game.renderer.info.render.calls);
    await page.evaluate(() => { for (let i = 0; i < 3; i++) game.session.addBot(); });
    check(await until(() => game.session.botCount === 3 && [...game.session.players.values()].every(p => p.avatar && p.pose)), 'three bots appear');
    const start = await page.evaluate(() => [...game.session.bots.values()].map(b => b.loco.head.toArray()));
    await gameWait(6);
    const bots = await page.evaluate(() => [...game.session.bots.values()].map(b => ({ id: b.id, name: b.name, head: b.loco.head.toArray(), grounded: b.loco.grounded })));
    const wandered = bots.filter((b, i) => Math.hypot(b.head[0] - start[i][0], b.head[2] - start[i][2]) > 0.3).length;
    check(wandered >= 2, `bots hop about on their own (${wandered} of 3 moved)`);
    check(bots.every(b => b.head[1] > 0.3 && b.head[1] < 3), `bots stay on the ground: ${JSON.stringify(bots.map(b => +b.head[1].toFixed(2)))}`);
    check(await page.evaluate(() => game.session.playerCount === 1), 'bots do not count as players');
    for (const id of ['b1', 'b2', 'b3']) await page.evaluate(i => game.T.still(i), id);
    await gameWait(1.5);
    const c = await page.evaluate(() => game.session.rigs.get('b1').head.toArray());
    console.log('     draw calls:', calls0, 'alone,', await page.evaluate(() => game.renderer.info.render.calls), 'with 3 bots');
    await shot('body-1-bots.png', [c[0] + 1.6, c[1] + 0.5, c[2] + 2.2], [c[0], c[1] - 0.3, c[2]]);

    // ---- punching (the J key): look at a bot's head and hit it
    await page.evaluate(() => game.T.face('b1', 'head'));
    await gameWait(0.3);
    await page.evaluate(() => { game.T.look(); });
    await gameWait(0.3);
    await page.evaluate(() => { game.fx.length = 0; game.punchAhead(); });
    await gameWait(0.2);
    let r = await page.evaluate(() => ({ blood: game.session.body('b1').blood, fx: game.fx.map(e => e.k + ':' + (e.part || '')), drops: (game.blood.count().drops + game.blood.count().splats), vel: game.session.bots.get('b1').loco.vel.length() }));
    check(r.blood < 80 && r.fx[0] === 'hit:head', `a punch in the head hurts: blood ${r.blood.toFixed(0)}, ${r.fx}`);
    check(r.drops > 3, `the hit sprays blood (${r.drops} drops)`);
    await shot('body-2-punched.png');
    // wounds bleed for a while, then stop, then the blood comes back
    await gameWait(5);
    const low = await page.evaluate(() => game.session.body('b1').blood);
    check(low < r.blood - 3, `the wound bleeds (${r.blood.toFixed(0)} -> ${low.toFixed(0)})`);
    await page.evaluate(() => { const b = game.session.body('b1'); b.calm = 100; });
    await gameWait(2);
    check(await page.evaluate(l => game.session.body('b1').blood > l + 2, low), 'blood returns after the bleeding stops');

    // ---- arms come off piece by piece under punches
    await page.evaluate(() => { game.fx.length = 0; game.session.body('b1').blood = 100; game.session.hit('b1', 'foreL', 40, 1); });
    await gameWait(0.3);
    r = await page.evaluate(() => ({ cut: game.session.body('b1').cut.slice(), bleeding: game.session.body('b1').bleeding, gibs: game.T.gibs(), fx: game.fx.map(e => e.k), foreShown: game.session.players.get('b1').avatar.arms[0].fore.g.visible, capShown: game.session.players.get('b1').avatar.arms[0].upper.cap.visible }));
    check(r.cut[0] === 1 && r.bleeding === 1 && r.gibs.includes('gib_fore') && r.fx.includes('sever'), `a hard punch takes the forearm off: ${JSON.stringify(r)}`);
    check(!r.foreShown && r.capShown, 'the forearm is gone from the body and the stump shows');
    const b1 = await page.evaluate(() => game.session.rigs.get('b1').head.toArray());
    await shot('body-3-forearm-off.png', [b1[0] + 0.9, b1[1] + 0.2, b1[2] + 1.3], [b1[0], b1[1] - 0.3, b1[2]]);
    await page.evaluate(() => { game.session.hit('b1', 'upperL', 50, 1); });
    await gameWait(0.3);
    r = await page.evaluate(() => ({ cut: game.session.body('b1').cut.slice(), gibs: game.T.gibs(), max: game.session.body('b1').maxBlood }));
    check(r.cut[0] === 2 && r.gibs.includes('gib_upper') && r.max === 85, `then the rest of the arm: ${JSON.stringify(r)}`);
    // one arm gone: it clots and the bot lives
    await gameWait(14);
    r = await page.evaluate(() => ({ dead: game.session.body('b1').dead, bleeding: game.session.body('b1').bleeding, blood: game.session.body('b1').blood }));
    check(!r.dead && r.bleeding === 0 && r.blood > 5, `with one arm gone the bleeding stops and it lives: ${JSON.stringify(r)}`);

    // ---- grab an arm (grip) and it tears off when the bot pulls away
    await page.evaluate(() => { game.desktop.yaw = 0; game.desktop.pitch = -0.55; });      // hand held low, about where a hanging wrist is
    await gameWait(0.4);
    await page.evaluate(() => { game.desktop.keys.KeyG = true; game.T.handTo(game.session.rigs.get('b2').wrist[0]); });
    check(await until(() => !!game.session.holding(1)), 'squeezing grip on a bot\'s arm takes hold of it');
    r = await page.evaluate(() => ({ h: game.session.holding(1), d: game.session.rigs.get('b2').hand[0].distanceTo(game.loco.hands[1].pos), punched: game.session.body('b2').blood < 100 }));
    check(r.h.id === 'b2' && r.h.arm === 0 && r.d < 0.05 && !r.punched, `the held arm follows my hand: ${JSON.stringify(r)}`);
    await page.evaluate(() => { const b = game.session.bots.get('b2'); b.wait = 0; });     // let it react
    check(await until(() => game.session.body('b2').cut[0] === 2), 'the bot hops away and its arm tears off');
    r = await page.evaluate(() => { const id = game.session.held[1], p = game.session.props.props.get(id); return { type: p && p.type.id, held: p && p.held && p.held.key, color: p && p.color, botColor: game.session.colorOf('b2') }; });
    check(r.type === 'gib_arm' && r.held === 'h:1' && r.color === r.botColor, `the arm stays in my hand, in the bot's skin colour: ${JSON.stringify(r)}`);
    await shot('body-4-arm-in-hand.png');
    await page.evaluate(() => { game.desktop.keys.KeyG = false; });
    check(await until(() => game.session.held[1] == null), 'letting go of grip drops the arm');

    // ---- the mouse shortcut (Y): take both arms, and it bleeds out, dies, and comes back
    // (the key takes the nearest bot in view, so send the other two well away first)
    await page.evaluate(() => { ['b1', 'b2'].forEach((id, i) => game.session.bots.get(id).loco.teleport(new game.THREE.Vector3(18 + i * 3, 0.5, 18))); });
    await gameWait(0.5);
    await page.evaluate(() => { game.T.still('b3'); game.T.face('b3', 'torsoTop', 1.3); });
    await gameWait(0.3);
    await page.evaluate(() => { game.T.look(); });
    await gameWait(0.3);
    r = await page.evaluate(() => { const a = game.ripAhead(), b = game.ripAhead(); return { a, b }; });
    await gameWait(0.3);
    r = await page.evaluate(() => ({ cut: game.session.body('b3').cut.slice(), bleeding: game.session.body('b3').bleeding, blood: game.session.body('b3').blood }));
    check(r.cut[0] === 2 && r.cut[1] === 2 && r.bleeding === 3, `both arms off: ${JSON.stringify(r)}`);
    await gameWait(1.5);
    const b3 = await page.evaluate(() => game.session.rigs.get('b3').head.toArray());
    await shot('body-5-no-arms.png', [b3[0] + 0.8, b3[1] + 0.3, b3[2] + 1.5], [b3[0], b3[1] - 0.35, b3[2]]);
    const t0 = await page.evaluate(() => game.time);
    check(await until(() => game.session.body('b3').dead, null, 120000), 'with both arms gone it bleeds out and dies');
    r = await page.evaluate(t => ({ took: game.time - t, gibs: game.T.gibs(), shown: game.session.players.get('b3').avatar.root.visible }), t0);
    check(r.took < 12, `and quickly (${(r.took + 1.8).toFixed(1)} s)`);
    check(r.gibs.includes('gib_head') && r.gibs.includes('gib_torso') && !r.shown, `its body is left lying there: ${r.gibs}`);
    await gameWait(0.6);
    await shot('body-6-dead.png', [b3[0] - 0.4, 2.6, b3[2] + 1.6], [b3[0], 0.2, b3[2]]);
    check(await until(() => !game.session.body('b3').dead, null, 120000), 'the bot comes back');
    await gameWait(0.3);
    r = await page.evaluate(() => ({ cut: game.session.body('b3').cut.slice(), blood: game.session.body('b3').blood, shown: game.session.players.get('b3').avatar.root.visible, arm: game.session.players.get('b3').avatar.arms[0].upper.g.visible }));
    check(r.cut[0] === 0 && r.cut[1] === 0 && r.blood === 100 && r.shown && r.arm, `whole again: ${JSON.stringify(r)}`);

    // ---- a body killed in one piece drops as a ragdoll: its parts stay joined, and you can drag it about by one of them
    const frames = n => page.evaluate(k => new Promise(done => { let i = 0; const f = () => (++i >= k ? done() : requestAnimationFrame(f)); f(); }), n);
    await page.evaluate(() => { game.T.face('b1', 'head', 1.2); });
    await gameWait(0.3);
    await page.evaluate(() => { game.session.hit('b1', 'torso', 250, 1); });
    await gameWait(0.2);
    const rag = await page.evaluate(() => {
      const S = game.session, n = Math.max(...[...S.props.props.values()].map(p => p.rag)), mine = [...S.props.props.values()].filter(p => p.rag === n);
      return { n, dead: S.body('b1').dead, shown: S.players.get('b1').avatar.root.visible, parts: mine.map(p => p.type.id).sort().join(), wounds: mine.find(p => p.type.id === 'gib_torso').wounds, joints: S.props.joints.filter(j => mine.some(p => p.id === j.a)).length };
    });
    check(rag.dead && !rag.shown && rag.parts === 'gib_fore,gib_head,gib_torso,gib_upper' && rag.joints === 3 && rag.wounds === 2, `a killed bot is left as a jointed body, missing the arm it had lost: ${JSON.stringify(rag)}`);
    await gameWait(2.5);
    const lying = n => page.evaluate(k => {
      const at = id => [...game.session.props.props.values()].find(p => p.rag === k && p.type.id === id).mesh.position;
      return { high: Math.max(at('gib_torso').y, at('gib_head').y, at('gib_fore').y), neck: at('gib_head').distanceTo(at('gib_torso')), elbow: at('gib_fore').distanceTo(at('gib_upper')), shoulder: at('gib_upper').distanceTo(at('gib_torso')), torso: at('gib_torso').toArray() };
    }, n);
    r = await lying(rag.n);
    check(r.high < 0.7 && r.neck < 0.55 && r.elbow < 0.45 && r.shoulder < 0.6, `it flops to the ground in one piece: ${JSON.stringify(r)}`);
    await shot('body-10-ragdoll.png', [r.torso[0] + 1.1, 1.2, r.torso[2] + 1.5], [r.torso[0], 0.15, r.torso[2]]);
    await page.evaluate(() => { game.desktop.pitch = -0.9; });
    await gameWait(0.3);
    await page.evaluate(k => { game.T.handTo([...game.session.props.props.values()].find(p => p.rag === k && p.type.id === 'gib_fore').mesh.position); game.desktop.keys.KeyG = true; }, rag.n);
    check(await until(() => game.session.held[1] != null), 'grip takes hold of the dead arm');
    for (let i = 0; i < 12; i++) { await page.evaluate(() => { game.loco.origin.x += 0.2; }); await frames(2); }      // walk off with it
    await gameWait(0.8);
    const dragged = await lying(rag.n);
    const toHand = await page.evaluate(t => game.loco.hands[1].pos.distanceTo(new game.THREE.Vector3(...t)), dragged.torso);
    // (the limp arm takes up some slack first, so the body moves less far than the hand did)
    check(dragged.torso[0] - r.torso[0] > 0.5 && toHand < 1.1 && dragged.elbow < 0.6 && dragged.shoulder < 0.75 && dragged.neck < 0.6, `the rest of the body is dragged along behind: moved ${(dragged.torso[0] - r.torso[0]).toFixed(2)} m, now ${toHand.toFixed(2)} m from my hand`);
    await page.evaluate(() => { game.desktop.keys.KeyG = false; });
    await until(() => game.session.held[1] == null);

    // ---- heads come off
    await page.evaluate(() => { game.T.face('b2', 'head', 1.2); });
    await gameWait(0.3);
    await page.evaluate(() => { game.fx.length = 0; game.blood.clear(); game.session.hit('b2', 'head', 40, 1); });
    await gameWait(0.1);
    check(await page.evaluate(() => !game.session.body('b2').dead && game.session.body('b2').hp.head === 30), 'one hard punch in the head does not take it off');
    await page.evaluate(() => { game.session.hit('b2', 'head', 40, 1); });
    await gameWait(0.2);
    r = await page.evaluate(() => {
      const S = game.session, n = Math.max(...[...S.props.props.values()].map(p => p.rag)), all = [...S.props.props.values()];
      const head = all.filter(p => p.type.id === 'gib_head' && !p.rag).pop(), torso = all.find(p => p.rag === n && p.type.id === 'gib_torso');
      return { dead: S.body('b2').dead, off: S.body('b2').headOff, fx: game.fx.map(e => e.k).join(), loose: !!head && head.wounds, torso: torso.wounds, headOn: all.some(p => p.rag === n && p.type.id === 'gib_head'), drops: game.blood.count().drops, at: torso.mesh.position.toArray() };
    });
    check(r.dead && r.off && /behead/.test(r.fx) && r.loose === 1 && (r.torso & 1) && !r.headOn, `the second one does: the head flies off and the body drops without it: ${JSON.stringify(r)}`);
    check(r.drops > 25, `and the neck spurts (${r.drops} drops)`);
    await gameWait(1.2);
    await shot('body-11-headless.png', [r.at[0] + 1.3, 1.3, r.at[2] + 1.6], [r.at[0], 0.3, r.at[2]]);

    // ---- weapons: a blade cuts where a fist only bruises, and stays in your hand
    await page.evaluate(() => { const h = game.loco.head; game.session.request({ t: 'spawn', type: 'sword', pos: [h.x + 1.5, 0.6, h.z + 1.5] }); game.desktop.pitch = -0.9; });
    await gameWait(1.8);
    await page.evaluate(() => { game.T.handTo([...game.session.props.props.values()].find(p => p.type.id === 'sword').mesh.position); game.desktop.keys.KeyG = true; game.desktop.pressed.add('KeyG'); });
    check(await until(() => game.heldWeapon(1) && game.stuck[1]), 'grip picks the sword up');
    await page.evaluate(() => { game.desktop.keys.KeyG = false; });
    await frames(6);
    r = await page.evaluate(() => { const p = game.heldWeapon(1); return { still: !!p, key: p && p.held.key, armed: game.desktop.hands[1].armed, d: p && p.mesh.position.distanceTo(game.loco.hands[1].pos) }; });
    check(r.still && r.key === 'h:1' && r.armed && Math.abs(r.d - 0.38) < 0.06, `and it stays in the hand when grip is let go, held by the hilt: ${JSON.stringify(r)}`);
    await page.evaluate(() => { game.desktop.pitch = -0.3; game.T.face('b3', 'torsoTop', 1.3); });
    await gameWait(0.4);
    await shot('body-12-sword.png');
    r = await page.evaluate(() => {
      const S = game.session, sword = game.heldWeapon(1).id, b = S.body('b3');
      S.hit('b3', 'foreL', 20, 1);                 // a fist (no weapon named)
      const fist = b.cut[0];
      S.hit('b3', 'upperL', 26, 0, sword);         // claiming the sword for the hand that does not hold it
      const cheat = b.cut[0];
      S.hit('b3', 'foreR', 20, 1, sword);          // the sword, in the hand that holds it
      return { fist, cheat, blade: b.cut[1] };
    });
    check(r.fist === 0 && r.cheat === 0 && r.blade === 1, `the same blow that a fist only bruises with takes the forearm off with a sword: ${JSON.stringify(r)}`);
    // (those blows knocked it back: wait for it to land, then step up to it again)
    await page.evaluate(() => game.T.still('b3'));
    await until(() => game.session.bots.get('b3').loco.grounded);
    await gameWait(0.4);
    await page.evaluate(() => { game.T.face('b3', 'torsoTop', 1.3); });
    await gameWait(0.3);
    await page.evaluate(() => { game.T.look(); });
    await gameWait(0.3);
    r = await page.evaluate(() => { const b = game.session.body('b3'), before = b.blood; game.punchAhead(); return { lost: before - b.blood, dead: b.dead }; });
    check(r.lost > 15 || r.dead, `swinging it (J) at the bot in front of me hurts a lot (${r.lost.toFixed(0)} blood)`);
    // ---- gore: stains, a body cut in two, a head burst, and blood on everything
    await page.evaluate(() => { game.session.body('b3').reset(); game.session.body().reset(); });
    await gameWait(0.3);
    await page.evaluate(() => { game.T.still('b3'); game.T.face('b3', 'torsoTop', 1.2); });
    await gameWait(0.4);
    r = await page.evaluate(() => {
      const S = game.session, sword = game.heldWeapon(1), av = S.players.get('b3').avatar, clean = !av._stained && !game.avatar._stained;
      const dry = sword.wounds;
      game.fx.length = 0;
      S.hit('b3', 'torso', 34, 1, sword.id);
      const one = { dead: S.body('b3').dead, stained: av._stained, fist: game.avatar._stained, blade: sword.wounds - dry > 0 || sword.wounds === 3 };
      const bits = game.blood.count().bits;
      S.hit('b3', 'torso', 40, 1, sword.id);
      const all = [...S.props.props.values()], n = Math.max(...all.map(p => p.rag));
      return { clean, one, dead: S.body('b3').dead, halved: S.body('b3').halved, fx: game.fx.map(e => e.k).join(), parts: all.filter(p => p.rag === n).map(p => p.type.id).sort().join(), loose: all.filter(p => !p.rag && p.type.gib && p.age < 0.5).map(p => p.type.id).sort().join(), bits: game.blood.count().bits - bits, drops: game.blood.count().drops, rag: n };
    });
    check(r.clean && !r.one.dead && r.one.stained && r.one.fist && r.one.blade, `a cut leaves blood on the body, on my hand and on the blade: ${JSON.stringify(r.one)}`);
    check(r.dead && r.halved && /bisect/.test(r.fx) && r.parts === 'gib_chest,gib_fore,gib_fore,gib_head,gib_upper,gib_upper' && r.loose === 'gib_belly,gib_guts', `a second deep cut goes right through: the top half drops with head and arms, the bottom half and the guts fall apart from it: ${r.parts} + ${r.loose}`);
    check(r.bits >= 10 && r.drops > 150, `in a cloud of blood and bits (${r.drops} drops, ${r.bits} chunks)`);
    const pooled = await until(k => { const t = [...game.session.props.props.values()].find(p => p.rag === k && p.type.id === 'gib_chest'); return t && game.blood.splats.some(s => s && s.grow && Math.hypot(s.x - t.mesh.position.x, s.z - t.mesh.position.z) < 0.5); }, r.rag, 90000);
    await gameWait(1.5);
    r = await page.evaluate(k => { const t = [...game.session.props.props.values()].find(p => p.rag === k && p.type.id === 'gib_chest'); return { at: t.mesh.position.toArray(), splats: game.blood.count().splats }; }, r.rag);
    check(pooled && r.splats > 150, `once it has come to rest the body lies in a spreading pool (${r.splats} marks on the ground)`);
    await shot('body-13-cut-in-half.png', [r.at[0] + 1.3, 1.2, r.at[2] + 1.7], [r.at[0], 0.1, r.at[2] - 0.2]);
    // a heavy blunt weapon does not take a head off: it bursts it
    await page.evaluate(() => { game.session.addBot(); });
    check(await until(() => { const p = game.session.players.get('b4'); return p && p.pose && game.session.rigs.get('b4'); }), 'another bot');
    r = await page.evaluate(() => {
      const S = game.session, T = game.THREE, bits = game.blood.count().bits, heads = [...S.props.props.values()].filter(p => p.type.id === 'gib_head').length;
      game.fx.length = 0;
      S._bodyEvents('b4', S.body('b4').hit('head', 80, { blunt: true }), { by: 'h', hand: 1, dir: new T.Vector3(0, 0, -1), push: 2, blunt: true });
      const all = [...S.props.props.values()], n = Math.max(...all.map(p => p.rag));
      return { fx: game.fx.map(e => e.k).join(), crushed: S.body('b4').crushed, heads: all.filter(p => p.type.id === 'gib_head').length - heads, neck: all.find(p => p.rag === n && p.type.id === 'gib_torso').wounds & 1, bits: game.blood.count().bits - bits };
    });
    check(/pop/.test(r.fx) && r.crushed && r.heads === 0 && r.neck === 1 && r.bits >= 20, `a hammer bursts a head: no head left, only bits of it: ${JSON.stringify(r)}`);
    // blood marks walls as well as the ground, and runs down them
    await page.evaluate(() => { game.blood.clear(); game.blood.spray(new game.THREE.Vector3(-24, 1.6, -20.3), new game.THREE.Vector3(0, 0.1, -1).normalize(), 60, 5, 0.02, 0.3); });
    await gameWait(1.2);
    r = await page.evaluate(() => { const w = game.blood.splats.filter(s => s && s.wall); return { walls: w.length, onFace: w.filter(s => Math.abs(s.z - -21.488) < 0.02 && s.nz === 1).length }; });
    check(r.walls >= 15 && r.onFace >= 15, `blood sprayed at a wall sticks to it: ${JSON.stringify(r)}`);
    await shot('body-14-wall.png', [-22.2, 1.6, -19.2], [-24, 1.4, -21.5]);
    // a snap turn with a weapon in the hand is not a swing
    await page.evaluate(() => { game.session.addBot(); game.session.bots.get('b5').wait = 1e9; });        // (told to stand still before it can hop off)
    check(await until(() => { const p = game.session.players.get('b5'); return p && p.pose && game.session.rigs.get('b5') && game.session.bots.get('b5').loco.grounded; }), 'and another');
    await gameWait(0.6);
    await page.evaluate(() => { const b = game.session.bots.get('b5'); game.loco.teleport(new game.THREE.Vector3(b.loco.head.x - 1.0, 0, b.loco.head.z), 0); game.desktop.yaw = 0; game.desktop.pitch = 0; });
    await gameWait(0.6);
    await page.evaluate(() => { game.loco.turn(-Math.PI / 2, game.desktop.headLocal); });       // now facing the bot, blade swept round into it
    await gameWait(0.4);
    r = await page.evaluate(() => { const b = game.session.body('b5'), turned = b.blood; game.punchAhead(); return { turned, swung: b.blood, dead: b.dead }; });
    check(r.turned === 100 && (r.swung < 100 || r.dead), `turning on the spot with a sword out hurts nobody, a real swing does: ${JSON.stringify(r)}`);
    await page.evaluate(() => { game.desktop.keys.KeyG = true; game.desktop.pressed.add('KeyG'); });
    check(await until(() => game.session.held[1] == null && !game.stuck[1]), 'squeezing grip again lets go of it');
    await page.evaluate(() => { game.desktop.keys.KeyG = false; game.session.body('b3').reset(); game.session.body().reset(); });

    // ---- TNT hurts bodies
    await page.evaluate(() => { game.T.still('b3'); const h = game.session.rigs.get('b3').head; game.loco.teleport(new game.THREE.Vector3(h.x, 0, h.z + 14)); });   // I stand well back
    await until(() => game.session.bots.get('b3').loco.grounded);       // it drops in from a little way up
    await gameWait(0.6);
    await page.evaluate(() => {
      const S = game.session, h = S.rigs.get('b3').head;
      S.body('b3').blood = 100;
      // next to the bot, but not inside anybody else (bodies shove props out of themselves, hard)
      let spot = null;
      for (let a = 0; a < 8 && !spot; a++) {
        const p = new game.THREE.Vector3(h.x + Math.cos(a * 0.785) * 0.9, 0.4, h.z + Math.sin(a * 0.785) * 0.9);
        if ([...S.rigs].every(([id, r]) => id === 'b3' || Math.hypot(r.head.x - p.x, r.head.z - p.z) > 1)) spot = p;
      }
      S.request({ t: 'spawn', type: 'tnt', pos: (spot || new game.THREE.Vector3(h.x + 0.9, 0.4, h.z)).toArray() });
    });
    const blown = await until(() => game.session.body('b3').dead || game.session.body('b3').blood < 80, null, 120000);
    check(blown, 'TNT hurts a bot standing next to it');
    if (!blown) console.log('     ', JSON.stringify(await page.evaluate(() => ({
      t: game.time, head: game.session.rigs.get('b3').head.toArray(), body: game.session.body('b3').pack(), fx: game.fx.slice(-6),
      props: [...game.session.props.props.values()].map(p => [p.type.id, +p.fuse.toFixed(1), p.mesh.position.toArray().map(v => +v.toFixed(1))]),
    }))));

    // ---- my own body: lose an arm, then the other, bleed out, die, come back
    await page.evaluate(() => { game.session.clearBots(); game.respawn(); game.desktop.yaw = 0; game.desktop.pitch = -0.6; });
    await gameWait(1);
    check(await page.evaluate(() => game.session.botCount === 0 && game.session.players.size === 0), 'clearing bots removes them');
    check(await page.evaluate(() => game.hud.blood === null), 'no blood bar while unhurt');
    await page.evaluate(() => { const S = game.session; game.fx.length = 0; S._bodyEvents('h', S.body().hit('torso', 30), { by: 0, dir: new game.THREE.Vector3(0, 0, 1), push: 2 }); });
    await gameWait(0.1);
    r = await page.evaluate(() => ({ bar: game.hud.blood, pain: game.hud.pain, vz: game.loco.vel.z, face: game.hud.goreT, mine: game.avatar._stained }));
    check(r.bar && r.bar.value < 100 && r.pain > 0.2, `being hit shows the blood bar and flashes red: ${JSON.stringify(r)}`);
    check(r.face > 0 && r.mine, 'and there is blood on my face and on my body');
    await page.evaluate(() => { const S = game.session; S._bodyEvents('h', S.body().sever(0, 2), { by: 0 }); });
    await gameWait(0.5);
    // a stroke with the missing hand does nothing; the other one still works
    const stroke = async hand => {
      const z0 = await page.evaluate(() => game.loco.head.z);
      for (let n = 0; n < 2; n++) {
        await page.evaluate(h => { game.desktop.grab(h, 1); }, hand);
        for (let i = 0; i < 10; i++) { await page.evaluate(() => { game.desktop.dy += 34; }); await page.waitForTimeout(16); }
        await page.evaluate(h => { game.desktop.hands[h].held = 0; }, hand);
        await page.waitForTimeout(350);
      }
      return z0 - await page.evaluate(() => game.loco.head.z);
    };
    await page.evaluate(() => { game.desktop.pitch = -0.5; });
    const gone = await stroke(0), left = await stroke(1);
    check(Math.abs(gone) < 0.3 && left > 0.5, `only the arm I still have moves me (lost arm ${gone.toFixed(2)} m, other arm ${left.toFixed(2)} m)`);
    r = await page.evaluate(() => ({ arm: game.avatar.arms[0].upper.g.visible, other: game.avatar.arms[1].upper.g.visible, bar: game.hud.blood, title: game.hud.title }));
    check(!r.arm && r.other && r.bar.max === 85 && /left arm is gone/.test(r.title), `my arm is gone from my body: ${JSON.stringify(r)}`);
    await page.evaluate(() => { game.desktop.pitch = -0.9; });
    await gameWait(0.3);
    await shot('body-7-my-arm-gone.png');
    await page.evaluate(() => { const S = game.session; S._bodyEvents('h', S.body().sever(1, 1), { by: 0 }); });
    check(await until(() => game.session.body().dead, null, 120000), 'with both arms gone I bleed out');
    await gameWait(0.3);
    r = await page.evaluate(() => ({ title: game.hud.title, body: game.avatar.root.visible, gibs: game.T.gibs(), pain: game.hud.pain }));
    check(/You died/.test(r.title) && !r.body && r.gibs.includes('gib_head') && r.pain > 0.5, `I die: ${JSON.stringify(r)}`);
    const diedAt = await page.evaluate(() => game.loco.head.toArray());
    await gameWait(1.2);
    r = await page.evaluate(() => game.loco.head.toArray());
    check(r[1] - diedAt[1] > 0.3 && Math.hypot(r[0] - diedAt[0], r[2] - diedAt[2]) > 0.5, `and drift up and back out of my body to watch it fall (${(r[1] - diedAt[1]).toFixed(2)} m up)`);
    await page.evaluate(() => { game.desktop.pitch = -0.6; });
    await gameWait(0.2);
    await shot('body-8-dead.png');
    const z1 = await page.evaluate(() => game.loco.head.toArray());
    check(await until(() => !game.session.body().dead, null, 120000), 'and come back a few seconds later');
    await gameWait(0.5);
    r = await page.evaluate(() => ({ cut: game.session.body().cut.slice(), blood: game.session.body().blood, body: game.avatar.root.visible, arm: game.avatar.arms[0].upper.g.visible, bar: game.hud.blood, head: game.loco.head.toArray() }));
    check(r.cut[0] === 0 && r.cut[1] === 0 && r.blood === 100 && r.body && r.arm && r.bar === null, `in one piece: ${JSON.stringify(r)}`);
    check(Math.hypot(r.head[0], r.head[2] - 6) < 3, 'back at the start');

    // ---- no bots or fighting in hide and seek
    await page.evaluate(() => { game.session.addBot(); });
    await gameWait(0.3);
    await page.evaluate(() => game.session.setMode('hideseek'));
    await gameWait(0.5);
    check(await page.evaluate(() => game.session.botCount === 0), 'bots leave when hide and seek starts');
    await page.evaluate(() => { game.session.addBot(); });
    await gameWait(0.3);
    check(await page.evaluate(() => game.session.botCount === 0), 'and cannot be added there');
    await page.evaluate(() => game.session.setMode('sandbox'));
    await gameWait(0.5);
    // the arm menu's game tab, with its bot buttons
    await page.evaluate(() => { game.session.addBot(); game.armMenu.visible = true; game.armMenu.tab = 3; game.desktop.pitch = -0.1; });
    await gameWait(0.4);
    await shot('body-9-menu.png');
    check(errors.length === 0, `no errors on the page ${errors.join(' | ')}`);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
