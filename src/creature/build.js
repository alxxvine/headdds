import * as THREE from 'three';
import { makeRng } from '../lib/noise.js';
import { makeHeadGeometry } from './head.js';
import { makeMaterials, withOutline } from './materials.js';
import { addEyes, addMouth, addNose, addGrowths, addScars, headUnit } from './features.js';
import { buildBody } from './body.js';
import { sanitize } from './schema.js';
import { computeStats } from './stats.js';

/**
 * params -> a ready THREE.Group. Fully deterministic: the same parameter set
 * always produces the same mesh.
 * Returns { group, bbox, dispose } — dispose is mandatory, otherwise dragging
 * a slider leaks GPU memory.
 */
export function buildCreature(rawParams) {
  const p = sanitize(rawParams);
  const rng = makeRng((p.seed >>> 0) ^ 0x51ed270b);
  const mats = makeMaterials(p);
  const S = headUnit(p);

  // --- head. While it is outside the scene graph its local coordinates are
  // world coordinates, so the raycasts in surface.js work in skull space.
  const headGeo = makeHeadGeometry(p);
  const headMesh = new THREE.Mesh(headGeo, mats.skin);
  headMesh.updateMatrixWorld(true);

  const head = new THREE.Group();
  withOutline(head, headMesh, headGeo, p.outline * S, mats.outline);
  const growths = addGrowths(head, headMesh, p, mats, rng);
  addNose(head, headMesh, p, mats, rng);
  const eyes = addEyes(head, headMesh, p, mats, rng);
  const { jaw, maw } = addMouth(head, headMesh, p, mats, rng);
  addScars(head, headMesh, p, mats, rng, maw);

  // --- body derived from the head share
  const skull = headGeo.boundingBox;
  const body = buildBody(p, mats, skull, rng);

  // The head hangs on a pivot at the neck rather than at the skull's centre:
  // a top-heavy head has to swing from where it meets the body, otherwise
  // nodding looks like the skull spinning on the spot.
  const headPivot = new THREE.Group();
  headPivot.position.y = body.legH + body.torsoH * 0.86;
  head.position.y = -skull.min.y;
  headPivot.add(head);

  const group = new THREE.Group();
  group.add(body.group);
  group.add(headPivot);

  const bbox = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bbox.getSize(size);
  bbox.getCenter(center);

  // Frame on "skull plus body", ignoring spores and tendrils: otherwise the
  // spore cloud pushes the camera back and the character becomes a dot.
  const fitBox = new THREE.Box3().setFromObject(body.group);
  fitBox.union(skull.clone().translate(new THREE.Vector3(0, headPivot.position.y + head.position.y, 0)));

  // Hair belongs to the silhouette — a crest cropped in half looks broken — but
  // long tendrils must not shrink the creature to a dot either, so hair may
  // grow the frame by at most a quarter of the body height.
  if (growths.tendrils.length) {
    group.updateMatrixWorld(true);
    const hairBox = new THREE.Box3();
    for (const t of growths.tendrils) hairBox.expandByObject(t.pivot);
    if (!hairBox.isEmpty()) {
      const cap = fitBox.max.y + (fitBox.max.y - fitBox.min.y) * 0.25;
      fitBox.union(hairBox);
      fitBox.max.y = Math.min(fitBox.max.y, cap);
      fitBox.min.y = Math.max(fitBox.min.y, 0);
    }
  }
  const fitSize = new THREE.Vector3();
  const fitCenter = new THREE.Vector3();
  fitBox.getSize(fitSize);
  fitBox.getCenter(fitCenter);

  const dispose = () => {
    const geos = new Set();
    const materials = new Set();
    group.traverse((o) => {
      if (o.geometry) geos.add(o.geometry);
      if (o.material) materials.add(o.material);
    });
    geos.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    mats.gradientMap.dispose();
  };

  // Named pivots for the animator. Everything here is a group that owns both
  // its mesh and its outline shell, so animating it keeps the two together.
  const rig = {
    root: group,
    headPivot,
    bodyPivot: body.group,
    torso: body.torso,
    legs: body.legs,
    shoulders: body.shoulders,
    eyes,
    jaw,
    maw,
    tendrils: growths.tendrils,
    spores: growths.spores,
    scale: S,
    neckY: headPivot.position.y,
    seed: p.seed,
  };

  return {
    group,
    rig,
    stats: computeStats(p),
    bbox, size, center, fitSize, fitCenter,
    params: p,
    dispose,
  };
}
