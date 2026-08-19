import * as THREE from 'three';
import { makeRng } from '../lib/noise.js';

// The walk-test micro-world. The ground is a FORMULA, not a mesh: the drawn
// terrain, the walker's feet and the prop seating all sample groundHeight(),
// so nothing raycasts and nothing can disagree about where the floor is —
// the same trick the creature plays with its analytic skull.
//
// Layout (units: the creature is normalized to ~2.2 tall):
//   - a flat spawn circle at the origin, so tuning starts on level ground;
//   - THE HILL to the north (-z): tall enough to feel the uphill slowdown;
//   - a gentler mound to the west for a second slope grade;
//   - a bump field to the east: a washboard for uneven-footing testing;
//   - a raised rim all around, so nobody walks off the world.

export const WORLD = 30;           // half-size of the square world

// the hand-placed landmarks: [x, z, height, spread]
const HILL = [4, -17, 8.5, 78];
const MOUND = [-15, 6, 3.4, 60];

// the bump field: a deterministic scatter of small round bumps east of spawn
const BUMPS = (() => {
  const rng = makeRng(0x77a1cd0e);
  const list = [];
  for (let i = 0; i < 26; i++) {
    list.push([
      6 + rng() * 18,             // x: east strip
      -8 + rng() * 18,            // z
      0.35 + rng() * 0.75,        // height
      1.2 + rng() * 2.4,          // radius^2-ish spread
    ]);
  }
  return list;
})();

const gauss = (x, z, [cx, cz, h, spread]) =>
  h * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / spread);

export function groundHeight(x, z) {
  // long rolling swells, faded to zero on the spawn circle
  const swell = Math.sin(x * 0.17) * Math.cos(z * 0.14) * 0.5
    + Math.sin(x * 0.33 + 1.7) * Math.sin(z * 0.29 + 0.6) * 0.28;
  const fromSpawn = Math.hypot(x, z);
  const settle = THREE.MathUtils.smoothstep(fromSpawn, 3.5, 9);

  let h = swell * settle;
  h += gauss(x, z, HILL);
  h += gauss(x, z, MOUND);
  for (const b of BUMPS) h += gauss(x, z, b) * settle;

  // the rim: the last few units before the edge climb steeply
  const rim = Math.max(0, fromSpawn - (WORLD - 5));
  h += rim * rim * 0.35;
  return h;
}

/** Ground normal by central differences — cheap and exact enough to lean on. */
export function groundNormal(x, z, out = new THREE.Vector3()) {
  const e = 0.35;
  out.set(
    groundHeight(x - e, z) - groundHeight(x + e, z),
    2 * e,
    groundHeight(x, z - e) - groundHeight(x, z + e),
  );
  return out.normalize();
}

// ---------------------------------------------------------------- colors ---
// Flat low-poly palette in the app's own dusk key: two greens in big checker
// cells (the gorilla-tag floor), dirt where it tilts, bare rock where it is
// steep enough to be a wall.
const C_GRASS_A = new THREE.Color('#4e7f3e');
const C_GRASS_B = new THREE.Color('#46713a');
const C_DIRT = new THREE.Color('#77583c');
const C_ROCK = new THREE.Color('#6a6377');

function faceColor(cx, cy, cz, ny, out) {
  const checker = (Math.floor(cx / 2.6) + Math.floor(cz / 2.6)) & 1;
  out.copy(checker ? C_GRASS_A : C_GRASS_B);
  // ny is the face normal's up-component: 1 flat, 0 vertical
  if (ny < 0.995) out.lerp(C_DIRT, THREE.MathUtils.smoothstep(1 - ny, 0.005, 0.16));
  if (ny < 0.86) out.lerp(C_ROCK, THREE.MathUtils.smoothstep(1 - ny, 0.14, 0.5));
  return out;
}

// ----------------------------------------------------------------- props ---
// A few rocks and toy trees, seated by the same formula the feet use. All
// flat-shaded, no outlines: scenery stays quieter than the creature.

function seat(obj, x, z) {
  obj.position.set(x, groundHeight(x, z), z);
}

function addProps(group, rng) {
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshLambertMaterial({ color: '#6a6377', flatShading: true });
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 1.6, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: '#5d4632', flatShading: true });
  const crownGeo = new THREE.ConeGeometry(1.25, 2.4, 7);
  const crownMat = new THREE.MeshLambertMaterial({ color: '#3f6d3d', flatShading: true });

  let placed = 0;
  while (placed < 14) {
    const x = (rng() * 2 - 1) * (WORLD - 6);
    const z = (rng() * 2 - 1) * (WORLD - 6);
    // keep the spawn circle and the steep faces clear
    if (Math.hypot(x, z) < 7) continue;
    if (groundNormal(x, z).y < 0.9) continue;
    if (rng() < 0.45) {
      const rock = new THREE.Mesh(rockGeo, rockMat);
      const s = 0.5 + rng() * 1.1;
      rock.scale.set(s * (0.8 + rng() * 0.5), s * (0.55 + rng() * 0.4), s * (0.8 + rng() * 0.5));
      rock.rotation.y = rng() * Math.PI;
      seat(rock, x, z);
      rock.position.y += s * 0.1;
      group.add(rock);
    } else {
      const tree = new THREE.Group();
      const s = 0.8 + rng() * 0.9;
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 0.8;
      tree.add(trunk);
      const crown = new THREE.Mesh(crownGeo, crownMat);
      crown.position.y = 2.4;
      tree.add(crown);
      tree.scale.setScalar(s);
      tree.rotation.y = rng() * Math.PI;
      seat(tree, x, z);
      group.add(tree);
    }
    placed++;
  }
}

/**
 * The world mesh: a grid pushed through groundHeight(), de-indexed so every
 * triangle keeps its own normal and color — the flat-faceted look.
 */
export function buildTerrain() {
  const seg = 100;
  let geo = new THREE.PlaneGeometry(WORLD * 2, WORLD * 2, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
  }
  const indexed = geo;
  geo = geo.toNonIndexed();
  indexed.dispose();
  geo.computeVertexNormals();

  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let f = 0; f < p.count; f += 3) {
    const cx = (p.getX(f) + p.getX(f + 1) + p.getX(f + 2)) / 3;
    const cz = (p.getZ(f) + p.getZ(f + 1) + p.getZ(f + 2)) / 3;
    faceColor(cx, 0, cz, n.getY(f), c);
    for (let v = 0; v < 3; v++) c.toArray(colors, (f + v) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const group = new THREE.Group();
  const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  group.add(ground);
  addProps(group, makeRng(0x5eed7ee5));

  const dispose = () => {
    const geos = new Set();
    const mats = new Set();
    group.traverse((o) => {
      if (o.geometry) geos.add(o.geometry);
      if (o.material) mats.add(o.material);
    });
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
  };

  return { group, dispose };
}
