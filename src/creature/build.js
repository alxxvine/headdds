import * as THREE from 'three';
import { makeRng } from '../lib/noise.js';
import { makeHeadGeometry, headPoint } from './head.js';
import { makeMaterials, withOutline } from './materials.js';
import { addEyes, addMouth, addNose, addGrowths, addScars, pruneWarts, addPlaced, headUnit } from './features.js';
import { buildBody } from './body.js';
import { sanitize } from './schema.js';
import { computeStats } from './stats.js';


const _pv = new THREE.Vector3();
const _pd = new THREE.Vector3();
const _ps = new THREE.Vector3();

/**
 * Takes the outline off anything that is buried in the skull.
 *
 * The outline is an inverted hull — a shell of the part, grown and drawn
 * back-faces-only — so it draws a line wherever the part has a silhouette. A
 * part that is nine tenths inside the head has a silhouette a few pixels long,
 * and what a player sees is a black dash lying on bare skin with nothing under
 * it: "a black outline through the middle of the body rather than around its
 * edge". A frond that has curled back into the scalp, a wart under a lump, the
 * far side of a half-sunk nose — each leaves one.
 *
 * Nothing is moved and nothing is deleted but the shell: the part is still
 * there, still shading, just no longer ringed. Sampled rather than exhaustive,
 * because this runs on every slider drag.
 */
function pruneBuriedOutlines(head, headMesh, p) {
  head.updateMatrixWorld(true);
  const doomed = [];
  head.traverse((o) => {
    if (!o.isMesh || o.material?.side !== THREE.BackSide || o === headMesh) return;
    const pos = o.geometry.attributes.position;
    if (!pos) return;
    const step = Math.max(1, Math.floor(pos.count / 48));
    let proud = 0;
    let seen = 0;
    for (let i = 0; i < pos.count; i += step) {
      _pv.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      headMesh.worldToLocal(_pv);
      if (_pv.lengthSq() < 1e-9) continue;
      _pd.copy(_pv).normalize();
      headPoint(p, _pd, _ps);
      seen++;
      if (_pv.lengthSq() > _ps.lengthSq()) proud++;
    }
    if (seen > 4 && proud / seen < 0.18) doomed.push(o);
  });
  for (const o of doomed) {
    o.parent.remove(o);
    o.geometry.dispose();
  }
}

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
  head.userData.part = 'skull';   // editor fallback: the bare skull and its decals
  withOutline(head, headMesh, headGeo, p.outline * S, mats.outline);
  const growths = addGrowths(head, headMesh, p, mats, rng);
  addNose(head, headMesh, p, mats, rng);
  const eyes = addEyes(head, headMesh, p, mats, rng);
  const { jaw, maw } = addMouth(head, headMesh, p, mats, rng);
  // the parts the player put on by hand — placed eyes join the rig's list so
  // they blink and look around like the grown ones
  eyes.push(...addPlaced(head, headMesh, p, mats));
  // now that the eyes and the nose exist, bury the warts that broke into them
  pruneWarts(head, headMesh, p, eyes);
  addScars(head, headMesh, p, mats, rng, maw);
  // ...and while the head is still in its own coordinates, before it is hung
  // on the neck, so the skin can be asked about directly.
  pruneBuriedOutlines(head, headMesh, p);

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
  // The aura is in the frame too, under the same cap. It was left out of it
  // entirely so a two-hundred-mote cloud could not shrink the creature to a
  // dot — but out of the frame means out of the VIEWPORT, and a cloud sitting
  // on the crown was cut off square by the top of the picture: not a cloud any
  // more, a slab of ice glued to the head.
  if (growths.spores) {
    group.updateMatrixWorld(true);
    const auraBox = new THREE.Box3().setFromObject(growths.spores);
    if (!auraBox.isEmpty()) {
      const cap = fitBox.max.y + (fitBox.max.y - fitBox.min.y) * 0.25;
      fitBox.union(auraBox);
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
    // the editor drags placed parts across this mesh; its local coordinates
    // are the face coordinates the placed list is stored in
    headMesh,
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
