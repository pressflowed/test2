# Canopy Tag: VR plan

An original VR tag game in the style of the arm-locomotion genre. You have no legs, so you move by pushing off the world with your hands. It's built with **WebXR + Three.js**, made for **Meta Quest 2 / 3 / 3S**, and played by opening a link in the Quest browser.

## Decisions

| | Choice |
|---|---|
| Engine | Three.js (ES modules) + WebXR, no build step |
| Headset | Quest 2 / 3 / 3S (standalone, Quest Browser) |
| Hosting | GitHub Pages (WebXR needs HTTPS) |
| Multiplayer | Later (phase 4). Solo against bots first |
| Desktop | A mouse mode stays in so the game can be tested without a headset |

## 1. Movement (the core)

How the player rig works in VR:
- The XR camera and controllers sit inside a `rig` group. Moving the body means moving the rig.
- The body collider is a sphere at the headset position, about 0.3 m wide.
- Each hand's target is its controller's grip position in world space.

What happens every physics tick (fixed step, 90 Hz):
1. **Gravity** always pulls the rig down, and the head sphere collides with the world.
2. **Hand sweep:** each hand sweeps from its last position toward its controller target, stopping at the first surface it hits.
3. **Pinning:** a hand that hits a surface stays pinned there. It lets go once the controller lifts off that surface by more than a small tolerance.
4. **Push:** the rig moves by `pinned point - controller target`, averaged over both hands and clamped per tick. Push the ground down and back, and you go up and forward.
5. **Launch:** when the last hand leaves a surface, you keep the average speed of the last 5 ticks, times 1.1, up to about 7.5 m/s.
6. **Arm length:** hands can't pass through walls, and reach is capped at about 1 m from the head.

Feel, in VR only:
- **Haptics:** a short pulse when a hand touches something, stronger on fast hits.
- **Contact sounds:** a different tap sound per surface (wood, grass, rock, leaves).
- **Height calibration:** a button measures your real floor, so your real hands reach the virtual ground.
- **Comfort (all optional):** snap turn on the right stick, and a vignette that narrows your view at high speed.

Tuning values all live in one table: jump boost, max speed, stickiness, arm length and gravity. Slippery surfaces like ice can come later.

## 2. Game

- **Infection tag:** one player starts as "it", anyone tagged turns "it", and the round ends when everyone is infected. A touch with your hand or body counts as a tag.
- **Arena:** an original treetop forest. It has a big central tree with three decks, six ring trees, bridges, a hut, logs, rocks, climbing posts and a ledge wall.
- **Bots** (7) that hop and climb: chasers lead their target, runners flee.
- **HUD in VR:** a wrist panel showing role, time survived and runners left. Countdown and round-over text float in the world.

## 3. Performance budget (Quest)

- Hold 72 Hz (90 where possible) on Quest 2.
- Merge all static level boxes into a few meshes, aiming for under about 60 draw calls.
- Flat-shaded Lambert materials, no realtime shadows (baked blob shadows instead), and fixed foveation on.
- Keep the collision world as plain axis-aligned boxes.

## 4. Phases

| Phase | What ships | Done when |
|---|---|---|
| **1. Movement sandbox** (built, needs testing on a Quest) | A VR test room with floor, walls, a ramp of steps and a tall pillar. Enter VR button, hand physics, haptics, sounds, height calibration, desktop mouse mode | You can run, jump and climb the pillar on a Quest, and the feel is tuned |
| **2. Game** | Arena, infection rules, bots, wrist HUD, round flow | A full solo round is playable in VR |
| **3. Polish** | Menu in VR, player colors, snap turn and vignette options, sound pass, performance pass | Steady frame rate on Quest 2 |
| **4. Multiplayer** | Room codes, synced head and hands at about 20 Hz, tags decided by the host, optional voice | Two headsets can tag each other |

## Testing

- **Physics:** checked headlessly with scripted controller paths. For example, a fast downward stroke must launch the body forward.
- **Without a headset:** desktop mouse mode, or the Immersive Web Emulator browser extension.
- **Feel:** tested by you on a Quest. Each phase ends with a link to try and a list of things to check.

## Existing work

`index.html` is a desktop prototype. Holding a mouse button swings a hand. It already has the hand-pin physics, the arena, the bots and infection tag. Phase 1 swaps the mouse-driven hand targets for real controller positions and moves the code to ES modules.

## Player model

`assets/skeleton.glb` is the skeleton you exported from Blender. Running `python3 tools/split_skeleton.py` turns it into `assets/skeleton-rig.glb`:
- **Parts:** `Head`, `Torso`, `UpperArm_L/R`, `Forearm_L/R`, `Hand_L/R`. Your export had both arms merged into each part, so the script splits them down the middle.
- **Origins:** each part's origin sits at its joint, and each arm part stores its rest joint positions in `extras.from` / `extras.to` for 2-bone IK.
- **Scale and position:** in metres, facing +Z, with the root at the eye point. Shoulder to wrist is 0.80 m.
- **Material:** one bone-colored material. The export had none, so it would have rendered white.
- **Size:** about 17.9k triangles. That's fine for the local player. Bots and other players may need a lower-poly version on Quest 2.

How it's driven in VR:
- `Head` follows the headset.
- `Torso` hangs below the head and turns with your view direction.
- `Hand_L/R` follow the controllers.
- The upper arm and forearm are solved with 2-bone IK between shoulder and wrist.
- In first person, your own head is hidden.


## Where it stands now

The plan above was the starting point. What exists today, in the order it was built:

1. Arm-push movement in VR, with a skeleton body (phase 1).
2. A 70 m map, physics props and a sandbox (in place of the tag game first planned).
3. Multiplayer rooms over WebRTC (phase 4, done early).
4. An arm menu, textures and sky, player size and power.
5. A breakable voxel world, and a hide and seek mode with its own map.
6. Voice chat by distance, and giants that shake the ground.
7. A flesh body over the skeleton (sandbox): blood, punches, arms that can be knocked or torn off, dying and coming back, and dummy bots to try it on.
8. More gore (heads come off, corpses are ragdolls), weapons, and an arena mode: a knockout tournament in a colosseum, with gladiator bots that fight back.
9. Blocking (a blow caught on a weapon or a shield does nothing), shields, and armour that soaks up a few blows and is then knocked off. Surface textures are now photos from TextureTown instead of being painted in code.

Still open from the original plan: bots that play tag or hide and seek, and a measured performance pass on Quest 2.
