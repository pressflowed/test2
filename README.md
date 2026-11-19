# Canopy Tag

A VR tag game where you have no legs: you move by pushing off the world with your hands. It's built with WebXR and Three.js and made for Meta Quest. See [PLAN.md](PLAN.md) for the roadmap.

**Current state: sandbox with physics props and multiplayer.**

**Play:** https://pressflowed.github.io/test2/ (open it in the Meta Quest Browser and press Enter VR, or play on desktop)

## Play it on a Quest

WebXR only works from an `https://` address, so the game is hosted on GitHub Pages:

1. On GitHub, open the repo → **Settings → Pages**.
2. Under **Build and deployment**, set *Source* to **Deploy from a branch**, then choose the branch and the `/ (root)` folder and press **Save**. (Pages on a free account needs the repo to be public.)
3. After a minute the page shows your link, like `https://<user>.github.io/<repo>/`.
4. On the headset, open that link in the **Meta Quest Browser** and press **Enter VR**.

### Play with a friend
1. One of you presses **Host a room** in the menu and gets a 4-letter code (and an invite link).
2. The other types the code and presses **Join**, or just opens the invite link.
3. Then both press **Enter VR** (or **Play on desktop**).

It connects you directly (WebRTC through PeerJS's free public server), so there's no server to run. The host runs the prop physics, so if the host leaves, the room closes.

### In VR
- **Move:** push the ground down and back. Fast strokes, then let go, to leap. Push down on walls to climb.
- **Right hand:** trigger spawns the item shown above your left hand. **A** picks the next item, **B** undoes your last spawn, the stick snap-turns.
- **Left hand:** trigger deletes the prop nearest that hand. **X** calibrates your height (stand tall, arms relaxed), **Y** takes you back to the start.
- **Grip (either hand):** grab a prop; let go to throw it.
- **Control panel** by the start: slap the buttons for low gravity, clearing props, or prop rain.

Items: crate, ball, beach ball, barrel, cone, big crate, plank, platform (floats where you put it), trampoline.

### On desktop (for testing without a headset)
- Hold **left / right click** and drag the mouse down to push with that hand. **Space** uses both hands.
- **1–9** or the mouse wheel pick an item, **F** spawns it, **G** (hold) grabs with the right hand, **X** deletes near it, **Z** undoes.
- The mouse looks around. **Q / E** turn, **R** resets, **Esc** pauses.

## Develop

```bash
npm install            # installs three.js for the tests
npm test               # movement physics tests (Node)
node tests/smoke-browser.cjs        # loads the game in headless Chromium, runs and screenshots it
node tests/multiplayer-browser.cjs  # two browsers + a local PeerJS server: host, join, sync props
npm run serve          # http://localhost:8000 for desktop testing
```

## Files

| File | What it does |
|---|---|
| `src/locomotion.js` | The arm-push movement. All the feel settings are in `DEFAULTS` at the top. |
| `src/physics.js` | Box collision world |
| `src/avatar.js` | Skeleton body: head follows the headset, IK arms, hand fit (`HAND_FIT`) |
| `src/input-vr.js` / `src/input-desktop.js` | Headset + controllers / mouse + keyboard |
| `src/props.js` | Physics props (cannon-es): types, spawning, grabbing, syncing |
| `src/session.js` | Solo and multiplayer play: rooms, other players, requests, control panel |
| `src/net.js` | PeerJS host / join with room codes |
| `src/hud.js` | The display above your left hand |
| `src/sandbox.js` | The 70 x 70 m test map (`MAP` sets its size) and its info board |
| `assets/skeleton-rig.glb` | The player model, made from `assets/skeleton.glb` by `tools/split_skeleton.py` |
| `prototype/desktop.html` | The first desktop-only prototype, with the forest arena, bots and infection tag (used in Phase 2) |
