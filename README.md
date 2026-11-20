# Canopy Tag

A VR tag game where you have no legs: you move by pushing off the world with your hands. It's built with WebXR and Three.js and made for Meta Quest. See [PLAN.md](PLAN.md) for the roadmap.

**Current state: a breakable voxel world with two modes, Sandbox and Hide and seek, solo or online.**

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

### Two modes
Pick one on the start menu, or on the **Game** tab of the arm menu. Anyone in the room can switch.

- **Sandbox:** the original map. Spawn props, build, change your size, and smash things.
- **Hide and seek:** its own big map (Hollow Hamlet), played in rounds that run by themselves once two players are in the room.
  - One player is the **giant** (2x size). Everyone else is a **hider** (0.25x size, 3x power: tiny, but quick for their size).
  - Hiders get 30 seconds to hide while the giant waits in the dark.
  - Then the giant hunts for 3 minutes. Only the giant can smash. Touching a hider with a hand or the body catches them.
  - The giant wins by catching everyone. The hiders win if anyone is left when time runs out.
  - Each round the map is repaired and the next player becomes the giant.
  - Places to hide: houses with attics, chimneys and furniture; a castle with towers and a keep; a hedge maze; a cave hill full of tunnels; a barn with hay stacks; a great hollow tree; hollow logs; bushes, boulders and crates.

### Voice chat
- On the start menu, press **Turn on microphone** before you enter VR (the browser can only ask for permission there). Press it again to mute. In VR, the arm menu's **Game** tab has a mute button.
- You hear the others even if your own microphone is off.
- Voices are full volume within about 3 m, half at 9 m, and gone by 40 m, and they come from the side the speaker is on.
- Each pair of players is connected directly (WebRTC through PeerJS), so it works best with a handful of players.

### Giants shake the ground
- A player of 1.5x size or more makes a deep thump when their hands slap down or they land. Everyone hears it by distance and feels it in their controllers when it is close.
- A giant landing hard cracks the ground under it and knocks a few blocks loose nearby (where smashing is allowed).
- In hide and seek, a hider's heart starts to pound when the giant comes within 15 m: faster and stronger the closer it gets.

### Smashing
Everything except the floor and the outer wall is made of 25 cm blocks and can be broken.

- **Punch** something fast and straight on to break a dent where your fist lands. Harder punches and bigger players make bigger dents. Leaves and hay break easily; stone and brick are tougher.
- Pushing and climbing do not break things. Hitting downward needs a real slam, so running across a roof does not crater it.
- Anything cut off from the ground crumbles. Cut through a pillar and what it held up comes down.
- In sandbox mode smashing can be switched off, and **Repair map** puts everything back (World tab). TNT leaves craters.

### In VR
- **Move:** push the ground down and back. Fast strokes, then let go, to leap. Push down on walls to climb.
- **Arm menu:** a panel floats above your left hand. Poke its tabs and buttons with your right fingertip. To open or close it, poke the small **Menu** tab under it, or press **X**.
  - **Items** (sandbox): small 3D previews of everything you can spawn. Reach into one with your right hand, squeeze **grip** to pull it out, and throw it. It grows to full size where it lands.
  - **Player:** your size (0.25x to 3x) and power (0.5x to 3x), height calibration, back to start.
  - **World:** gravity, sky, smashing on/off, repair map, prop rain, balloons, undo, clear props.
  - **Game:** switch mode, see the round, skip to the next round.
- **Right hand:** trigger quick-spawns the selected item at your hand. **A** picks the next item, **B** undoes your last spawn, the stick snap-turns.
- **Left hand:** trigger deletes the prop nearest that hand. **Y** takes you back to the start.
- **Grip (either hand):** grab a prop; let go to throw it.

Items: crate, ball, beach ball, barrel, cone, big crate, plank, platform, trampoline, TNT (explodes after 4 seconds), balloon (floats away), launch pad (flings you up), super ball, giant ball, domino, bowling pin, dice, tire, anvil, and building pieces that stay where you put them (block, wall, pillar, beam).

### On desktop (for testing without a headset)
- Hold **left / right click** and drag the mouse down to push with that hand. **Space** uses both hands.
- **J** punches whatever you are looking at. **O** switches mode. **K** skips to the next round.
- **F** throws the selected item where you look. The wheel or **1–8** pick an item; **,** and **.** change page. **V** quick-spawns, **G** (hold) grabs with the right hand, **X** deletes near it, **Z** undoes.
- **M** shows or hides the menu, **T** switches tab, **[ ]** change size, **- =** change power, **L** gravity, **N** sky, **H** smashing on/off, **Backspace** repairs the map, **P** prop rain, **B** balloons, **C** clear.
- The mouse looks around. **Q / E** turn, **R** resets, **Esc** pauses.

## Develop

```bash
npm install            # installs three.js for the tests
npm test               # movement physics tests (Node)
node tests/smoke-browser.cjs        # loads the game in headless Chromium, runs and screenshots it
node tests/multiplayer-browser.cjs  # two browsers + a local PeerJS server: sync, voice (fake microphone), a full hide and seek round
npm run serve          # http://localhost:8000 for desktop testing
```

## Files

| File | What it does |
|---|---|
| `src/locomotion.js` | The arm-push movement. All the feel settings are in `DEFAULTS` at the top. |
| `src/voxels.js` | The breakable world: a grid of 25 cm blocks, dents, collapse, collision boxes |
| `src/voxelmesh.js` | Draws the voxel world, one mesh per 8 m chunk, shaded under roofs |
| `src/maps.js` | The two maps, built from blocks: the sandbox and Hollow Hamlet |
| `src/rounds.js` | Hide and seek round rules (run by the host) |
| `src/physics.js` | Collision helpers and the list of unbreakable boxes |
| `src/avatar.js` | Skeleton body: head follows the headset, IK arms, how the hand sits on the controller (`HAND_FIT`) |
| `src/input-vr.js` / `src/input-desktop.js` | Headset + controllers / mouse + keyboard |
| `src/props.js` | Physics props (cannon-es): types, spawning, grabbing, syncing |
| `src/session.js` | Solo and multiplayer play: the map, syncing dents, rounds, other players, requests |
| `src/net.js` | PeerJS host / join with room codes |
| `src/voice.js` | Voice chat: one audio call per pair of players, volume and side by distance |
| `src/armmenu.js` | The arm menu: tabs, buttons you poke, item previews you grab |
| `src/textures.js` | All textures, painted on canvases at startup (no image files) |
| `src/sky.js` | Sky dome, sun, clouds, stars; day, sunset and night |
| `src/fx.js` | Blob shadows, explosion flashes and rubble |
| `src/sandbox.js` | What cannot be broken: the lawn, the border walls, the sandbox control panel and board |
| `src/hud.js` | Messages in front of your eyes, the round status line, and the giant's blackout |
| `assets/skeleton-rig.glb` | The player model, made from `assets/skeleton.glb` by `tools/split_skeleton.py` |
| `prototype/desktop.html` | The first desktop-only prototype, with the forest arena, bots and infection tag (used in Phase 2) |
