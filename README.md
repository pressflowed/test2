# Canopy Tag

A VR tag game where you have no legs: you move by pushing off the world with your hands. It's built with WebXR and Three.js and made for Meta Quest. See [PLAN.md](PLAN.md) for the roadmap.

**Current state: Phase 1, the movement test room.**

**Play:** https://pressflowed.github.io/test2/ (open it in the Meta Quest Browser and press Enter VR, or play on desktop)

## Play it on a Quest

WebXR only works from an `https://` address, so the game is hosted on GitHub Pages:

1. On GitHub, open the repo → **Settings → Pages**.
2. Under **Build and deployment**, set *Source* to **Deploy from a branch**, then choose the branch and the `/ (root)` folder and press **Save**. (Pages on a free account needs the repo to be public.)
3. After a minute the page shows your link, like `https://<user>.github.io/<repo>/`.
4. On the headset, open that link in the **Meta Quest Browser** and press **Enter VR**.

### In VR
- **Move:** push the ground down and back. Fast strokes, then let go, to leap.
- **Climb:** push down on walls and posts.
- **A / X:** calibrate. Stand up straight with your arms relaxed, then press. This sets your body height so your real hands hang just above the virtual floor.
- **B / Y:** back to the start.
- **Right stick:** snap turn.

### On desktop (for testing without a headset)
- Hold **left / right click** and drag the mouse down to push with that hand. **Space** uses both hands.
- The mouse looks around. **Q / E** turn, **R** resets, **Esc** pauses.

## Develop

```bash
npm install            # installs three.js for the tests
npm test               # movement physics tests (Node)
node tests/smoke-browser.cjs   # loads the game in headless Chromium, runs and screenshots it
npm run serve          # http://localhost:8000 for desktop testing
```

## Files

| File | What it does |
|---|---|
| `src/locomotion.js` | The arm-push movement. All the feel settings are in `DEFAULTS` at the top. |
| `src/physics.js` | Box collision world |
| `src/avatar.js` | Skeleton body: head follows the headset, IK arms, hand fit (`HAND_FIT`) |
| `src/input-vr.js` / `src/input-desktop.js` | Headset + controllers / mouse + keyboard |
| `src/sandbox.js` | The test room and its info board |
| `assets/skeleton-rig.glb` | The player model, made from `assets/skeleton.glb` by `tools/split_skeleton.py` |
| `prototype/desktop.html` | The first desktop-only prototype, with the forest arena, bots and infection tag (used in Phase 2) |
