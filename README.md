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
- Drag to spin, wheel (or pinch) to zoom.

## How the mechanism works

```
src/creature/schema.js   every parameter, defaults, palettes, randomize(seed)
src/creature/head.js     the skull: direction -> point of skin (headPoint)
src/creature/surface.js  planting features on skin: raycasts, orientation, decals
src/creature/features.js eyes, toothed maw, nose, warts, horns, tendrils, spores
src/creature/body.js     the body derived from the head share: bodyH = headH * (1-r)/r
src/creature/build.js    buildCreature(params) -> { group, dispose, ... }
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

## What comes next (gameplay)

A creature is already handed out as plain data (`sanitize(params)`), and
`buildCreature` returns a ready group with `dispose()`, so the next step is a
scene holding several of them. Idle animation, a gallery and PNG/GLB export are
deliberately missing from v1 — they are easier to add once the gameplay exists.
