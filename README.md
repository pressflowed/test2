# Canopy Tag

A VR tag game where you have no legs: you move by pushing off the world with your hands. It's built with WebXR and Three.js and made for Meta Quest. See [PLAN.md](PLAN.md) for the roadmap.

**Current state: a breakable voxel world with three modes, solo or online: Sandbox, Hide and seek, and Arena (a knockout tournament with weapons, shields and armour in a colosseum). You have a real body: you can be hurt, lose arms or your head, bleed out and die, and your corpse flops to the ground as a ragdoll. You can also block.**

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

### Three modes
Pick one on the start menu, or on the **Game** tab of the arm menu. Anyone in the room can switch.

- **Sandbox:** the original map. Spawn props, build, change your size, smash things, and fight (see *Bodies, blood and bots* below).
- **Hide and seek:** its own big map (Hollow Hamlet), played in rounds that run by themselves once two players are in the room.
  - One player is the **giant** (2x size). Everyone else is a **hider** (0.25x size, 3x power: tiny, but quick for their size).
  - Hiders get 30 seconds to hide while the giant waits in the dark.
  - Then the giant hunts for 3 minutes. Only the giant can smash. Touching a hider with a hand or the body catches them.
  - The giant wins by catching everyone. The hiders win if anyone is left when time runs out.
  - Each round the map is repaired and the next player becomes the giant.
  - Places to hide: houses with attics, chimneys and furniture; a castle with towers and a keep; a hedge maze; a cave hill full of tunnels; a barn with hay stacks; a great hollow tree; hollow logs; bushes, boulders and crates.

- **Arena:** a colosseum, and a knockout tournament of one-against-one fights that runs by itself.
  - Everyone in the room is drawn into a bracket. If you are alone, a gladiator bot turns up to fight you; **Add bot** on the Game tab puts more in (up to 6), and they fight each other too. Some bots come with a shield, a helmet or a chest plate.
  - For each match the two fighters appear in their own rooms at opposite ends, behind shut gates, with **20 seconds to kit up**: six weapons and two shields hang on the side walls, and a helmet and a chest plate either side of the door. Everyone else watches from the seats.
  - Then the gates drop and they fight on the sand until one of them is dead. The winner goes through to the next round; the last one standing is the champion, and a new tournament starts.
  - You also lose if you stay off the sand for 15 seconds, or leave. If 90 seconds run out, whoever has more blood left wins.
  - Only the two fighters can hurt each other or pick anything up. Everyone is normal size, and nothing can be smashed.
  - The bracket is shown on boards over both gates, and on the Game tab. **New bracket** there starts the tournament again.

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

### Bodies, blood and bots
In the sandbox and the arena (hide and seek has no fighting). Everyone has a body of skin and flesh (head, torso and two arms, no legs) with the skeleton's bones inside the arms.

- **Punch** someone with a fast hand to hurt them. Faster punches and bigger players hit harder; bigger bodies shrug more off. Head hits hurt most.
- **Blood:** you have 100. Wounds bleed for a few seconds and then stop; after 6 quiet seconds blood slowly comes back. A blood bar appears when you are hurt, your view flashes red, and your heart pounds when you are low. At 0 you die and come back 6 seconds later, whole again.
- **Dying:** your body drops where it stood as a **ragdoll**: head, torso and whatever arms it had left, jointed together and floppy. You drift up out of it and watch it fall. Bodies can be shoved about and dragged by an arm (grip). A body killed by TNT is blown to pieces instead.
- **Heads:** a head can take about two hard punches (or one good blow from an axe) and then it comes off, which kills you at once. The head flies off on its own and the body drops without it. A club or a war hammer does not knock a head off: it **bursts** it, and there is nothing left but bits.
- **Cut in half:** a blade that goes deep enough into the body (a couple of good sword cuts, or the killing blow) goes right through. The top half drops with the head and arms; the bottom half and the guts fall apart from it.
- **Blood everywhere:** hits spray it, stumps spurt with every heartbeat, a severed neck fountains. It marks the ground, **sticks to walls and runs down them**, and a body lies in a pool that spreads and leaves a smear where it is dragged. Chunks of meat and splinters of bone fly off and lie about. Blood **stains** the body where it was hit, the fist that hit it and the blade that cut it, until that player is whole again. When it happens close to you, it spatters across your view.
- **Arms:** each arm can be punched off, at the elbow or the shoulder (a badly hurt arm shows bone first). Or **grab** it: squeeze grip on someone's arm with a slow hand, then pull. Stretch it about 1.3 arm-lengths from the shoulder and it tears off in your hand; you can throw it or hit things with it. A held arm slips free after 4 seconds.
- **One arm gone:** you bleed for 12 seconds, then it stops. You live, but you can only push, grab and punch with the arm you have left, and you can only heal back to 85 blood.
- **Both arms gone:** the bleeding does not stop. You have less than 10 seconds.
- **Weapons:** sword, axe, spear, club, war hammer and dagger. In the sandbox they are on the last pages of the Items tab (with the shield and the armour); in the arena they hang in your room. Squeeze **grip** near one to pick it up: it jumps into your fist and **stays there**, even when you let go of grip. To drop it, squeeze grip **twice quickly**. Swing the business end into someone; faster swings hurt more. Blades (sword, axe, spear, dagger) go through arms and necks far more easily than fists; the club and hammer hit hard and knock people back.
- **Blocking:** a blow caught on something you are holding does nothing. Get your weapon or your shield between you and the blow (it is judged by where the two things really are, so hold it where the blow is going) and there is a **clang**, sparks, and a jolt in both hands. It works against fists too, and bots do it to you: a bot behind a shield has to be hit round it, over it (the head) or from behind.
- **Shields:** a round shield, with the weapons. It sits on your fist and faces the way your knuckles point. It catches blows over its whole face, where a blade only catches what crosses it. You can shove it into someone, but it barely hurts.
- **Armour:** a **helmet** and a **chest plate**. Squeeze grip on one and it is on (it does not stay in your hand). A blow to your head or body then rings off it and does nothing, but each one wears it down: a helmet stops 3 sword cuts, 2 hammer blows or 6 punches, a chest plate 4, 3 or 8. The last one **knocks it off**, and it lands on the ground dented and no use to anyone. Armour does not cover your arms, and it is no help against TNT.
- **TNT** hurts everyone near it and can take arms off.
- **Bots:** the **Game** tab of the arm menu has **Add bot** (up to 6), **Armoured bot** (the same, but in a helmet and chest plate and holding a shield up, to try blocking and armour on) and **Clear bots**. In the sandbox they are dummies: they hop around with no plan, flinch when hit, and hop away when you grab them (which is how their arms come off). They can always be hurt. (In the arena they fight back: they come at their opponent and swing.)
- **Fighting** (Game tab) switches whether *players* can hurt each other. It is on to begin with. Turn it off to build in peace; TNT then only throws you around, as before.
- Bodies and body pieces lie around for 80 seconds. They are ordinary props: grab them, throw them.

### In VR
- **Move:** push the ground down and back. Fast strokes, then let go, to leap. Push down on walls to climb.
- **Arm menu:** a panel floats above your left hand. Poke its tabs and buttons with your right fingertip. To open or close it, poke the small **Menu** tab under it, or press **X**.
  - **Items** (sandbox): small 3D previews of everything you can spawn. Reach into one with your right hand, squeeze **grip** to pull it out, and throw it. It grows to full size where it lands.
  - **Player:** your size (0.25x to 3x) and power (0.5x to 3x), height calibration, back to start.
  - **World:** gravity, sky, smashing on/off, repair map, prop rain, balloons, undo, clear props.
  - **Game:** switch mode, add or clear bots, fighting on/off, microphone, see the round or the bracket, and skip to the next round (hide and seek) or draw a new bracket (arena).
- **Right hand:** trigger quick-spawns the selected item at your hand. **A** picks the next item, **B** undoes your last spawn, the stick snap-turns.
- **Left hand:** trigger deletes the prop nearest that hand. **Y** takes you back to the start.
- **Grip (either hand):** grab a prop, or someone's arm; let go to throw it. A weapon stays in your hand: squeeze grip twice quickly to let go of it.

Items: crate, ball, beach ball, barrel, cone, big crate, plank, platform, trampoline, TNT (explodes after 4 seconds), balloon (floats away), launch pad (flings you up), super ball, giant ball, domino, bowling pin, dice, tire, anvil, building pieces that stay where you put them (block, wall, pillar, beam), a table, and on the last pages six weapons, a shield, a helmet and a chest plate.

### On desktop (for testing without a headset)
- Hold **left / right click** and drag the mouse down to push with that hand. **Space** uses both hands.
- **J** punches whoever or whatever you are looking at (with the weapon you are holding, if any). **O** goes to the next mode. **K** skips to the next round, or draws a new bracket in the arena.
- **U** adds a bot, **9** adds an armoured one with a shield, **I** clears the bots, **Y** takes an arm off the bot you are looking at (a mouse cannot pull), **0** switches fighting between players on or off.
- **F** throws the selected item where you look. The wheel or **1–8** pick an item; **,** and **.** change page. **V** quick-spawns, **G** (hold) grabs with the right hand (a weapon: **G** once to pick it up, **G** again to drop it; armour: **G** puts it on), **A** does the same with the left hand (for a shield), **X** deletes near it, **Z** undoes.
- **M** shows or hides the menu, **T** switches tab, **[ ]** change size, **- =** change power, **L** gravity, **N** sky, **H** smashing on/off, **Backspace** repairs the map, **P** prop rain, **B** balloons, **C** clear.
- The mouse looks around. **Q / E** turn, **R** resets, **Esc** pauses.

## Develop

```bash
npm install            # installs three.js for the tests
npm test               # movement physics tests (Node)
node tests/smoke-browser.cjs        # loads the game in headless Chromium, runs and screenshots it
node tests/body-browser.cjs         # bots, punches, arms and heads coming off, ragdolls, weapons, bleeding out, dying and coming back
node tests/arena-browser.cjs        # the colosseum: a whole tournament against bots, gates, weapons, forfeits
node tests/guard-browser.cjs        # shields, blocking and armour, in the sandbox and against an arena bot
node tests/multiplayer-browser.cjs  # two browsers + a local PeerJS server: sync, voice (fake microphone), fighting, a full hide and seek round and an arena final
npm run serve          # http://localhost:8000 for desktop testing
```

To change a surface texture, pick another file on [TextureTown](https://textures.neocities.org), put its name in `CHOSEN` at the top of `tools/fetch_textures.py`, and run `python3 tools/fetch_textures.py` (it needs Pillow: `pip install pillow`). It downloads the picture, makes it 256 x 256 and seamless, and writes it to `assets/textures/`.

## Files

| File | What it does |
|---|---|
| `src/locomotion.js` | The arm-push movement. All the feel settings are in `DEFAULTS` at the top (`gripBrake` is how hard a still hand stops you). |
| `src/voxels.js` | The breakable world: a grid of 25 cm blocks, dents, collapse, collision boxes |
| `src/voxelmesh.js` | Draws the voxel world, one mesh per 8 m chunk, shaded under roofs |
| `src/maps.js` | The three maps, built from blocks: the sandbox, Hollow Hamlet and the colosseum (`COLOSSEUM` says where its rooms, gates, weapon racks, shields, armour and seats are) |
| `src/rounds.js` | Hide and seek round rules (run by the host) |
| `src/arena.js` | The arena tournament: bracket, phases and who wins (run by the host). The times are in `ARENA` at the top |
| `src/weapons.js` | The weapons and the shield: damage, reach, how they sit in a fist, what they look like, and how a held one stops a blow (`guardOf`, `guardStops`). All in `WEAPONS` and `BLOCK` at the top |
| `src/armour.js` | The helmet and the chest plate: what they look like, loose and worn. (How much they take is in `BODY` in `src/body.js`) |
| `src/physics.js` | Collision helpers and the list of unbreakable boxes |
| `src/avatar.js` | The body you see: head follows the headset, IK arms, how the hand sits on the controller, and how wounds and missing arms are shown |
| `src/body.js` | The rules for a body: blood, bleeding, arms and heads coming off, dying and coming back. All the numbers are in `BODY` at the top |
| `src/bodyrig.js` | Where a body's joints are, and what a punch or a grab touched |
| `src/bots.js` | The bots: sandbox dummies, and arena gladiators that come at you and swing |
| `src/gibs.js` | Body pieces (they are props): loose ones, and the jointed parts of a dead body |
| `src/input-vr.js` / `src/input-desktop.js` | Headset + controllers / mouse + keyboard |
| `src/props.js` | Physics props (cannon-es): types, spawning, grabbing, syncing, and the joints that hold a dead body together |
| `src/session.js` | Solo and multiplayer play: the map, syncing dents, rounds, other players, requests |
| `src/net.js` | PeerJS host / join with room codes |
| `src/voice.js` | Voice chat: one audio call per pair of players, volume and side by distance |
| `src/armmenu.js` | The arm menu: tabs, buttons you poke, item previews you grab |
| `src/textures.js` | Textures: loads the surface photos in `assets/textures/` (grass, stone, wood...), and paints the ones with a design of their own (dice, TNT, beach ball...) on canvases |
| `assets/textures/` | The surface photos, from TextureTown. Chosen, resized and made to tile by `tools/fetch_textures.py`; `CREDITS.md` there says which file each one came from |
| `src/sky.js` | Sky dome, sun, clouds, stars; day, sunset and night |
| `src/fx.js` | Blob shadows, explosion flashes, rubble, and blood: droplets, marks on floors and walls, pools, and chunks of meat |
| `src/sandbox.js` | What cannot be broken: the lawn, the border walls, the sandbox control panel and board, the arena's gates and bracket boards |
| `src/hud.js` | Messages in front of your eyes, the round status line, the blood bar, the red flash when hurt, blood spattered on your view, and the giant's blackout |
| `assets/body-rig.glb` | The player model: flesh from `assets/man.glb` (legs removed, cut into head, torso and arm pieces) with the arm bones from `assets/skeleton-rig.glb` inside. Made by `tools/build_body.py` |
| `assets/skeleton-rig.glb` | The skeleton, made from `assets/skeleton.glb` by `tools/split_skeleton.py` |
| `prototype/desktop.html` | The first desktop-only prototype, with the forest arena, bots and infection tag (used in Phase 2) |

## Credits

- Body model: ["Proportional Low Poly Man"](https://sketchfab.com/3d-models/proportional-low-poly-man-free-download-0bfd0e2b49a348a4b64b20cc8196e3b3) by [Robin Butler](https://sketchfab.com/StarTrekGuy), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). Changed for this game: the legs were removed and the body was cut into separate head, torso, arm and hand pieces.
- Surface textures (grass, stone, brick, wood, sand and so on): from [TextureTown](https://textures.neocities.org) by Melon, a free library of textures for websites and 3D worlds. Resized to 256 x 256, and some recoloured or blended at the edges so they tile. `assets/textures/CREDITS.md` lists the original file for each.
