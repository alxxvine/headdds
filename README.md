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
| eyes | ball, hollow, bead, on stalks, compound, lantern, gash — 7 kinds. One mismatch slider drives size, bulge and pupil width per eye, so no two on a face agree |
| pupils | round, slit, goat, cross, ring, square, double, blind — plus eyelids |
| teeth | fangs, needles, blocks, tusks — with a mismatch slider, so one mouth holds anything from a stub to a fang three times its neighbour |
| nose | none, bump, beak, snout, nostrils, trunk, tusks, disc — and each one gets its own proportions: wide and flat, narrow and long, or pushed out from the face |
| ears | none, flaps, fins, trumpets, holes — with size and height, and the two never quite the same size |
| hair | none, tendrils, bristles, antennae, dreads, crest, fur, quills, fronds — 9 kinds |
| torso | a surface of its own, like the skull: chest, waist and hip width, boxiness, lumps and a belly |
| aura | spore cloud, orbit ring, rising motes, swarm, halo of shards |
| legs | sticks, thick, bent, stumps — with feet: ball, none, splayed, hoof |
| arms | none, stubs, sticks, noodles, mantis — plus lift and a lopsidedness slider |
| hands | none, ball, claws, pincer, club |

That is 7 × 8 × 4 × 8 × 5 × 9 × 5 × 4 × 4 × 5 × 5 ways to pick the parts alone
— over four million — before any of the sliders, the colours or the per-seed
scatter inside each kind.

Defaults are the tame end of every menu, so a link shared before a kind existed
still opens the creature it was saved as. The variety comes from the weights in
the randomizer, not from the defaults.

The torso is built the same way the skull is (`src/creature/torso.js`): a
star-shaped surface where every direction maps to one point of skin, with its
own three-band width profile, boxiness, lumps and belly. It used to be whichever
primitive its kind named — a squashed sphere, a cylinder, a box — and next to a
skull that is a real surface, a primitive reads as a placeholder. It carries no
ornaments on purpose: the body is a small object here and anything hung off it
competes with the head, so the interest has to come from the shape.

The skull is not one shape all the way up any more. Three sliders widen or
pinch it independently at brow, temple and jaw height, which is what turns a
cone or a ball into a silhouette: a broad brow over narrow temples over a wide
jaw reads as a face, where one global shape only ever reads as a solid.

**A limb grows out of the body, never beside it.** The order in `body.js` is
what makes that true: limbs are sized against the body the player asked for,
then the spread floors that keep them from fusing are worked out, and only then
is the torso widened — if it still has to be — to reach its own attachment
points. Sizing the torso first and spacing the limbs afterwards, which is the
obvious order, left the arms of a narrow freak hanging several body-widths out
in space. Stance is clamped for the same reason: it opens the hips, but never so
far that the shoulders can no longer fit inside the body either.

Hands, feet, ears and fleshy noses are drawn in a **deeper shade of the same
skin**, not a second colour. A tone rather than a hue is what stops a freak
reading as one flat silhouette without turning it into a paint job, and the
`tip shade` slider decides how far into the ink those parts go.

Ears are ellipsoids rather than cones for one reason: a cone has a flat base,
and whichever way it was turned that base showed as a hard disc hanging off the
head — an ear with a lid on it. An ellipsoid has no flat face to show. The
trumpet is still a cone, open-ended so there is no lid, with its point pushed
back into the skull so the only hard edge left is the rim you are meant to see.

Eyes, nose and maw are built by three separate functions, and each used to place
itself as if it were alone on the skull — which is how a nose ends up inside the
maw and an eye ends up wearing the nose. They all read `faceLimits(p)` now, so
they agree about where the others are. Crowding is still allowed; landing one
part fully inside another is not.

An eye only reads as an eye if it stands apart from what surrounds it, and two
things make sure it does. Every eyeball sits in a ring of skin **half as bright
as the face**, so a pale eye on a pale head is an eye rather than a lump with a
dot on it — the black outline is one pixel wide at this resolution and cannot
separate the two by itself. And RANDOM reconciles the palettes after the fact:
the sclera is kept clear of the skin's brightness and the pupil clear of the
sclera's, which is why the pupil palette has pale entries as well as dark ones.
Colours you pick by hand are left exactly as you picked them.

Ears are the newest of these and the only part that changes the silhouette from
the side without touching the face, which is why they exist: two freaks with the
same skull read as two creatures the moment one of them has flaps. They sway
with the hair — the animator drives them from the same list.

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
src/creature/hair.js     nine kinds of hair, from fur to a bony crest
src/creature/ears.js     flaps, fins, trumpets, holes
src/creature/arms.js     arm and hand kinds, pose, and keeping limbs off the floor
src/creature/torso.js    the trunk: direction -> point of skin (bodyPoint)
src/creature/body.js     leg kinds, feet and the proportions everything below the
                         neck is fitted into: bodyH = headH * (1-r)/r
src/creature/aura.js     what floats around it: spores, orbit ring, swarm, halo
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
tools/proportion-sweep.mjs checks the silhouette: no pancakes, no wedges
tools/roll-sweep.mjs     checks the randomizer can reach what the panel offers
```

Three ideas hold the whole thing together:

1. **The skull is a star-shaped surface.** `headPoint(params, dir)` turns any
   unit direction into a point of skin (sphere ↔ cube, taper, jaw, three width
   bands at brow, temple and jaw, fbm lumps, brow ridges, profile lean). The
   geometry is just an icosahedron with every vertex run through that function.
   The torso is the same construction one level down (`bodyPoint`), so the body
   has a silhouette of its own instead of being a primitive picked from a list.
2. **Features are planted on skin, not drawn in front of the face.** For frontal
   coordinates (x, y) a ray is cast along −Z and returns a point with a normal;
   horns and warts only need the analytic `headSurfaceByDir`. The maw, the lips
   and hollow sockets are decal patches (`decalGeometry`) built on a grid that
   hugs the skull. That is why teeth never sink into the skull, even on a maw
   that spans the whole face.
3. **The schema is the single source of truth.** Defaults, the panel, the
   randomizer and link validation all come out of `PARAMS`. A new parameter is
   one line in the schema.

## Proportions

Every one of those width terms multiplies, and left alone they multiply without
limit: a full taper times a swollen jaw times three bands took the bottom of a
skull past ten times its own crown while `headHeight` stayed exactly where the
slider put it. The result renders as a blade with a mouth on the end, and it is
the one failure a player reads instantly as *the character is broken*.

So the profiles do not add width, they **redistribute** it. Both surfaces are
divided by their own widest point — `headWidth` and the torso's scale are then
the real size of the thing, not a number the profile multiplies afterwards — and
the skull's profile is additionally pulled back towards that widest point until
nothing along it is thinner than about half of it. The pull is an exponent, not
a clamp: it keeps the *order* of the widths, so a broad brow over narrow temples
over a wide jaw is still exactly that, just no longer extreme enough to look
like damage.

Below the neck the same rule applies to the limbs. The torso may widen to reach
the hips and shoulders it has to carry, but only to a ceiling — half again the
width asked for, and never past its own height. When a ceiling binds, the limbs
come in instead of the body going out. So the trunk is built to reach a quarter
past its own hip line rather than merely down to it: a rounded body narrows
towards its ends, and a joint measured at the very bottom sits where the width
has already fallen to a third, which is a third every limb then gets divided by.

`headRatio` saturates at the top of its own range, and this is the one place a
slider does not deliver exactly what it says. The trunk is the last thing the
head's share takes from, so at r = 0.88 with long legs there was nothing left of
it — 4% of the head's height — and the arms and legs hung straight off the skull
with no body between them. A freak that is mostly head is the point; a freak
with no torso at all is four sticks and a face. So the trunk keeps at least a
tenth of the skull's height and past that the character grows rather than the
trunk vanishing: exact until about r = 0.76, then easing off. Measured over 600
creatures, the asked-for share and the delivered one differ by a median of 0.071
either way — the growths above the skull already move it further than this does.

The outline obeys the same discipline, and for the same reason. It is an
inverted hull pushed out along the normals by an **absolute** distance, and
everything below the neck takes that distance from the skull — so on a freak
whose legs are a fortieth of its head the rim came out thicker than the leg
inside it, and the limb rendered as a solid black stick. That was 400 of 600
random creatures, at a median of 2.3× the leg's own half-width. An outline is a
rim, not a coating: `rim()` caps it at a third of whatever it is drawn around.

`node tools/proportion-sweep.mjs 400` measures both failures over a population:
flatness as mid/min of the three sorted extents (a column is fine, a pancake is
not), and the skull's width profile latitude by latitude, because a wedge fits a
perfectly square bounding box.

`node tools/roll-sweep.mjs` checks the other half of variety: that the
randomizer can reach what the panel offers. A parameter declares a range, and
`randomize` may declare its own draw on top of it — and when the two disagree
nothing errors, because `sanitize` clamps the result. Six width sliders were
drawing `(rng*2-1)*0.6` against a range of `[-0.5, 0.7]`, so 7.5% of every
population sat on exactly the narrowest setting while the top tenth of the
slider was never generated at all. The check measures the RAW draw against the
range, because a deliberately lopsided roll is a choice — half the freaks are
meant to have no wear and no glow — while leaving the range is a bug.

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

The build is what makes those hold, because it is the only place that knows how
much room a particular freak has. Each arm measures its own budgets while it is
being assembled — how far it may tuck in before it crosses the midline or
scrapes the ground, and how far it may swing before the splay that was holding
its hand clear of the body has all been spent — and each leg measures how far it
may tilt before it touches the other one. The gestures then spend those budgets
instead of a constant that suits an average creature and fuses a narrow one.

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

The voice comes out of the stats, exactly as the body comes out of the
parameters: VIGOR sets the pitch (a heavy freak roars around 90 Hz, a light one nearer 270), DREAD sets
how much noise rides on the tone, BITE the sharpness of a chew, SPEED the tempo
of the envelopes. The seed adds the last third, so two creatures with the same
stats still do not sound alike.

**Nothing plays on a timer of its own, and nothing plays for a motion you
cannot see.** Breathing swells the body by two percent and the weight shift
tilts it by a couple of degrees; at this resolution neither is visible, and a
noise hung off them reads as the creature making sounds by itself. Only motion
you can point at gets one:

| event | what makes it | what you hear |
|---|---|---|
| `move` | an arm swinging, at the moment it turns around | the limb through the air, hair after it |
| `turn` | the head spring's own speed topping out | the mass of a head whipping round |
| `launch` / `land` | leaving the ground and arriving back on it | a scuff, then a thump |
| `blink` | an eyelid closing | a small wet tick |
| `bite` | the jaw shutting | teeth, from a dry tick to a snap, by how far it fell |
| `gape` | the jaw opening wide | the voice: a roar, or a yawn if it is stretching or worn out |

The jaw is measured against a floor that follows its resting position, not
against zero: a furious creature stands with its mouth half open, and an
absolute threshold would read every idle chew as a fresh roar. A roar therefore
comes from the mouth actually being open rather than from a gesture being
chosen, so voice and maw peak together however that gesture happens to be timed.

The mood is not a sound of its own — it is the **tone** of every other sound:
how much flutter is in the voice, how far the throat opens, where the pitch
sits. A hostile freak growls through everything it does; a spent one is low,
closed and breathy.

That comes to a noise every second or so — about 48 events a minute standing
still, 82 when it is furious — and every one of them is something you can watch
happen. Measured over two minutes of animation, no event has ever fired while
the part it names was still. With idle motion paused there are no events at all,
so the IDLE button really is a mute.

### Why it does not sound like a synthesiser

A raw oscillator is a buzz, and a swept burst of noise is a laser. Neither is an
animal, so the primitives are built to avoid being either:

- **Every voiced sound goes through a throat.** A resonant lowpass whose cutoff
  tracks the pitch, so the timbre stays voiced at any note instead of turning to
  buzz at the bottom, plus two formant peaks — two resonances is all the ear
  needs to hear a mouth rather than a filter.
- **Nothing holds a perfectly steady pitch.** A little vibrato, randomised per
  sound; without it a pitch sweep is a slide whistle.
- **A growl is amplitude flutter**, an LFO on the gain, and nothing more exotic
  than that.
- **Every envelope opens from actual silence.** The obvious way — an exponential
  ramp up from 0.0001 — starts with a click, and a few hundred of those an hour
  is most of what makes a soundtrack sound cheap.
- **Short noise bursts do not sweep.** A fixed band is a tap; a sweeping one is
  science fiction.

Three noises have no motion behind them, and none of them could: a **new freak
cries out in its own voice** the moment it is built (there is no body yet), a
poke, and the **panel**, which has its own set on fixed frequencies rather than
the creature's, so a button sounds like a button whichever freak is on screen —
a two-note confirm on copy, a falling one when the clipboard refuses, a
descending wipe on RESET, a tick for picking a kind or a colour. Sliders stay
silent: they fire on every pixel of travel and would turn the panel into a
rattle.

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
