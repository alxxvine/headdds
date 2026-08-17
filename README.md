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
- **SOUND** — the creature's voice, off until you ask for it. On an iPhone the
  ring/silent switch mutes web audio, so a phone on silent stays silent.
- Drag to spin, wheel (or pinch) to zoom. Click the creature to poke it.

## Parts

Most of a freak is a menu of kinds, each with its own scatter on top:

| | |
|---|---|
| arms | none, stubs, sticks, noodles, mantis — plus lift, and a lopsidedness slider that makes the two sides differ |
| hands | none, ball, claws, pincer, club |
| hair | none, tendrils, bristles, antennae, dreads, a bony crest |
| eyes | ball, hollow, bead, on stalks; pupils round / slit / goat / cross / ring / blind; eyelids; per-eye size jitter |
| skin | markings — spots, stripes, blotches, veins, crust, a pale belly — with their own hue, coverage and scale, plus a wet sheen and an emissive glow |
| damage | lopsidedness pulls the face out of true; wear knocks out teeth, snaps horns to stumps and stitches scars across the skull |

Defaults are the tame end of every menu, so a link shared before a kind existed
still opens the creature it was saved as. The variety comes from the weights in
the randomizer, not from the defaults.

Markings are painted as vertex colours **after** the creature is assembled, in
one shared space, so a pattern runs across the skull, the torso and the limbs as
a single coat instead of restarting on every part (`src/creature/skin.js`).

**RANDOM never adds them.** A second tone fights the flat toon shading and makes
the silhouette harder to read — a freak in one colour is the better freak. Pick
a pattern in STYLE if you want one; when you do, the marking hue is rolled
against the skin it lands on, because the shading has no gradients and a tone
close to the skin reads as a shadow rather than as a marking.

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
src/creature/skin.js     markings painted as vertex colours across the whole body
src/creature/build.js    buildCreature(params) -> { group, rig, stats, dispose, ... }
src/scene/animator.js    idle motion: springs, blinking, saccades, secondary sway
src/scene/behaviour.js   what it does between idles: twelve gestures, personality
src/scene/mood.js        how it feels about you: four drives, five moods
src/scene/sound.js       its voice: oscillators, noise and envelopes, no samples
src/scene/Stage.jsx      canvas, lights, pixelated render, camera orbit
src/ui/                  the panel, generated straight from the schema
src/lib/noise.js         seeded RNG plus value/fbm noise
src/lib/codec.js         params <-> base64url for the share link
tools/limb-sweep.mjs     checks the limb invariants over a population
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
across a multi-eyed face), tendrils lagging behind the head, a drifting spore
cloud, eyes that follow the cursor, and a recoil-plus-snap when you click.

## Behaviour

Idle motion alone still reads as a breathing statue, so on top of it the
creature actually *does* things. `src/scene/behaviour.js` holds a library of
twelve gestures — look around, fidget, scratch, stretch, shiver, sniff, chomp,
roar, hop, slump, inspect a hand, shake — and picks one every few seconds. Each
one drives the whole body: arms, legs, torso, jaw, eyes and hair all move, not
just the head.

`node tools/limb-sweep.mjs 300` sweeps a population of animated freaks and
checks the three things that must hold in any pose: the two arms never cross,
the two legs never fuse, and no arm dips below the feet. Limbs are measured as
the real capsules and spheres — a rotated sphere's bounding box is far larger
than the sphere, and every mistaken "fix" in this repository so far started
with a bounding box.

Actions never touch the rig. They write offsets into a pose struct which the
animator adds on top of its idle layers and applies in one place, so the two can
never fight over the same transform, and pausing still returns an exact rest
pose.

Which gesture turns up is down to a **personality**: half of it is rolled from
the seed, so two creatures with the same stats still behave differently, and
half comes from the stats, so behaviour matches the body you are looking at. A
quick creature fidgets, hops and looks around; a heavy one slumps and chews; a
frightening one roars and stretches; a blind one sniffs. A poke startles it into
a roar, a shake or a shiver depending on how bold it is.

## Mood

The creature also has an opinion about you. `src/scene/mood.js` keeps four
drives that move in real seconds — attention, arousal, anger and fatigue — and
reads a mood off them:

| | |
|---|---|
| CALM | left alone |
| ALERT | your cursor is on it, or something moved past |
| WIRED | poked or spun about, and still buzzing |
| HOSTILE | poked again and again — pokes in quick succession stack |
| SPENT | worn out after a minute or so of being wound up |

The mood is shown in the panel header. It does three things: it holds a posture
(hunched and bare-toothed when angry, drawn up and wide-eyed when alert, sagging
when spent), it tilts which gesture comes next — an angry freak roars and
chomps, an exhausted one slumps — and it changes the tempo of everything.

Posture is written from the drives, not from the mood name, so it slides in and
out instead of snapping; the name only picks the gesture weights and the label.
And it goes into the same pose struct the gestures write, so the animator still
applies every transform in one place.

## Voice

Nothing in this repository is a sound file either. `src/scene/sound.js` is a
small synthesiser: oscillators with pitch sweeps, one buffer of white noise
through a band-pass, envelopes, and a soft clipper with a low-pass after it so
the noises are as coarse as the picture.

Every gesture has one — roar, chomp, the landing of a hop, sniffing, shivering,
a scratch, a groan, the whuff of a head turning — and the voice behind them
comes out of the stats, exactly as the body comes out of the parameters: VIGOR sets
the pitch (a heavy freak roars around 90 Hz, a light one nearer 270), DREAD sets
how much noise rides on the tone, BITE the sharpness of a chew, SPEED the tempo
of the envelopes. The seed adds the last third, so two creatures with the same
stats still do not sound alike.

Underneath the gestures runs an ambient layer, because a creature that is
silent between them reads as a model rather than an animal. It breathes — each
breath fired off the body actually swelling, so the noise lands with the motion
instead of drifting against it — and fills the gaps with small noises picked
for its mood:

| | |
|---|---|
| CALM | slow breath in and out, a gut gurgle, the odd groan or drip |
| ALERT | short sharp intakes, snorts, teeth clicking |
| WIRED | quick shallow double-breaths and bursts of chittering |
| HOSTILE | a low growl carried on every breath, never quite stopping |
| SPENT | a wheeze with a rasp on the way out, long groans |

A calm freak makes some noise every couple of seconds; a wired or hostile one
roughly twice as often. All of it stops with the IDLE button — pausing the
creature really does silence it.

The panel has a voice of its own — fixed frequencies rather than the creature's,
so a button sounds like a button whichever freak is on screen. A new seed makes
the creature **cry out in its own voice** the moment it is built, which is how
you find out what this one sounds like; RANDOM and the seed box therefore get no
click of their own, since a blip would only step on the cry. Copying gives a
two-note confirm (or a falling one if the clipboard refuses), RESET a descending
wipe, and picking a kind or a colour a short tick. **Sliders stay silent**: they
fire on every pixel of travel and would turn the panel into a rattle.

Sound is off until the SOUND button is pressed: browsers refuse to start an
AudioContext without a gesture, and a page that greets you with a roar is a page
you close. Switching it on plays a short chirp straight away — partly so the
button is obviously working, partly because iOS keeps a context asleep until
something has actually played inside the gesture that started it. On an iPhone
the ring/silent switch mutes web audio outright; there is nothing a page can do
about that except say so.

Every voice also carries a quiet octave above its fundamental. A heavy freak
roars near 90 Hz, and no phone speaker can move enough air for that — the
partial lets the roar carry without raising its pitch.

## What comes next (gameplay)

A creature is already handed out as plain data (`sanitize(params)`), and
`buildCreature` returns a ready group with `dispose()`, so the next step is a
scene holding several of them. A procedural walk cycle, a gallery and PNG/GLB
export are the obvious next steps — the pivot rig is already in place for the
walk.
