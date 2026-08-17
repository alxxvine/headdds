# HEADDDS

A browser-based builder of 3D freaks: a huge head (70% of the character by
default) on a tiny body with tiny arms and legs. Everything is procedural —
there is not a single model or texture in this repository. The render is
deliberately pixelated: the scene is drawn into a small buffer and upscaled
with a nearest-neighbour filter, with stepped tone and a black outline on top.

A creature is fully described by a handful of numbers, so it fits into a link,
into JSON, and later into a save file of the game.

**Live: https://alxxvine.github.io/headdds/**

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build into dist/
```

Deployment to GitHub Pages is set up in `.github/workflows/pages.yml`
(Pages has to be switched to Source: GitHub Actions once).

## Using it

- **RANDOM** — a new random freak; its seed is shown next to the button.
- **seed** — type a number and get the same freak everyone else with that
  number gets.
- The sliders edit the creature on top of the seed: skull, eyes, maw, nose,
  growths, body, style.
- **LINK** — copies a `?c=...` URL that carries the whole creature.
- **JSON** — copies the same creature as a parameter object.
- **IDLE** — pauses the idle motion (handy for screenshots); off by default for
  anyone whose system asks for reduced motion.
- Drag to spin, wheel (or pinch) to zoom. Click the creature to poke it.

## Parts

Most of a freak is a menu of kinds, each with its own scatter on top:

| | |
|---|---|
| arms | none, stubs, sticks, noodles, mantis — plus lift, and a lopsidedness slider that makes the two sides differ |
| hands | none, ball, claws, pincer, club |
| hair | none, tendrils, bristles, antennae, dreads, a bony crest |
| eyes | ball, hollow, bead, on stalks; pupils round / slit / goat / cross / ring / blind; eyelids; per-eye size jitter |

Defaults are the tame end of every menu, so a link shared before a kind existed
still opens the creature it was saved as. The variety comes from the weights in
the randomizer, not from the defaults.

## Stats

Every creature rolls six stats out of its own anatomy — no dice, no hidden
rolls, just a pure function of the parameters:

| Stat | Comes from |
|---|---|
| VIGOR | skull volume, body width, boxiness, warts, jaw |
| BITE | tooth count, tooth length, maw width, fanginess |
| SPEED | leg length, minus skull mass, head share and body width |
| SIGHT | eye count, size, bulge, spread (hollow and bead eyes see less) |
| DREAD | teeth, horns, hair, spores, lumps, dark skin |
| BALANCE | stance and body width, minus head share and leg length |

**Every creature spends the same 300 points.** The six stats are normalized to
that budget, so pushing one up always pulls the others down and no anatomy can
produce a strictly better freak — piling on every growth at once just yields a
flat, mediocre creature. A build is about *where* the points go: a boulder of a
skull buys VIGOR 95 and pays with SPEED 12, stilt legs do the opposite, a maw
full of fangs hits BITE 95 and leaves SIGHT at 11.

On top of the numbers, loud features grant **traits** — `MANY-EYED`, `FANGED`,
`HORNED`, `SPOREBEARER`, `TOP-HEAVY`, `BLIND` and more — each carrying its own
modifiers (hover a trait chip to see them). Because of the budget those
modifiers move points between stats instead of adding to the pool.

The panel header shows the **archetype** — the stat the build leans into
(`BRUTE`, `DEVOURER`, `SKITTERER`, `WATCHER`, `HORROR`, `PILLAR`) — and how
specialised it is, from an even 0% generalist to a 90%+ one-trick freak. The
tick in each bar marks the even split at 50.

Stats live in `src/creature/stats.js` and depend on nothing but the parameter
object, so gameplay can call `computeStats(params)` on a saved creature without
loading three.js.

## How the mechanism works

```
src/creature/schema.js   every parameter, defaults, palettes, randomize(seed)
src/creature/stats.js    six stats and traits derived from the parameters
src/creature/head.js     the skull: direction -> point of skin (headPoint)
src/creature/surface.js  planting features on skin: raycasts, orientation, decals
src/creature/features.js eyes, toothed maw, nose, warts, horns, spores
src/creature/hair.js     tendrils, bristles, antennae, dreads, a bony crest
src/creature/arms.js     arm and hand kinds, pose, and keeping limbs off the floor
src/creature/body.js     the body derived from the head share: bodyH = headH * (1-r)/r
src/creature/build.js    buildCreature(params) -> { group, rig, stats, dispose, ... }
src/scene/animator.js    idle motion: springs, blinking, saccades, secondary sway
src/scene/Stage.jsx      canvas, lights, pixelated render, camera orbit
src/ui/                  the panel, generated straight from the schema
src/lib/noise.js         seeded RNG plus value/fbm noise
src/lib/codec.js         params <-> base64url for the share link
```

Three ideas hold the whole thing together:

1. **The skull is a star-shaped surface.** `headPoint(params, dir)` turns any
   unit direction into a point of skin (sphere ↔ cube, taper, jaw, fbm lumps,
   brow ridges, profile lean). The geometry is just an icosahedron with every
   vertex run through that function.
2. **Features are planted on skin, not drawn in front of the face.** For frontal
   coordinates (x, y) a ray is cast along −Z and returns a point with a normal;
   horns and warts only need the analytic `headSurfaceByDir`. The maw, the lips
   and hollow sockets are decal patches (`decalGeometry`) built on a grid that
   hugs the skull. That is why teeth never sink into the skull, even on a maw
   that spans the whole face.
3. **The schema is the single source of truth.** Defaults, the panel, the
   randomizer and link validation all come out of `PARAMS`. A new parameter is
   one line in the schema.

## Idle motion

The creature has no skeleton — it is a puppet of named pivot groups, and
`buildCreature` hands them out as a `rig`: the head hangs on a pivot at the
neck, each eye, the lower jaw and every tendril own their group (together with
their outline shell, which is a separate mesh and would otherwise stay behind).

`src/scene/animator.js` drives those pivots and owns all the motion state —
phases, springs, blink and saccade timers. It lives outside the creature on
purpose: `buildCreature` throws the whole mesh away on every slider move, and
the pose must not restart with it. Every frame writes an absolute transform
(base pose + delta), so nothing drifts and pausing leaves a clean pose.

The stats decide *how* a freak carries itself:

| Stat | What it changes |
|---|---|
| SPEED | tempo of breathing, fidgeting and saccades |
| BALANCE | stiffness and damping of the head spring — a low score wobbles and overshoots |
| VIGOR | heavy slow arms versus light quick ones |
| DREAD | slow predatory sway |
| SIGHT / `BLIND` | how eagerly the eyes track things; a blind head gropes around instead |

On top of that: breathing, weight shifting from foot to foot, blinking (staggered
across a multi-eyed face), an occasional chew, tendrils lagging behind the head,
a drifting spore cloud, eyes that follow the cursor, and a recoil-plus-snap when
you click.

## What comes next (gameplay)

A creature is already handed out as plain data (`sanitize(params)`), and
`buildCreature` returns a ready group with `dispose()`, so the next step is a
scene holding several of them. A procedural walk cycle, a gallery and PNG/GLB
export are the obvious next steps — the pivot rig is already in place for the
walk.
