import * as THREE from 'three';
import { makeRng } from '../lib/noise.js';
import { makeHeadGeometry } from './head.js';
import { makeMaterials, withOutline } from './materials.js';
import { addEyes, addMouth, addNose, addGrowths, headUnit } from './features.js';
import { buildBody } from './body.js';
import { sanitize } from './schema.js';

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
  addGrowths(head, headMesh, p, mats, rng);
  addNose(head, headMesh, p, mats);
  addEyes(head, headMesh, p, mats, rng);
  addMouth(head, headMesh, p, mats, rng);

  // --- body derived from the head share
  const skull = headGeo.boundingBox;
  const body = buildBody(p, mats, skull);
  head.position.y = body.legH + body.torsoH * 0.86 - skull.min.y;

  const group = new THREE.Group();
  group.add(body.group);
  group.add(head);

  const bbox = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bbox.getSize(size);
  bbox.getCenter(center);

  // Frame on "skull plus body", ignoring spores and tendrils: otherwise the
  // spore cloud pushes the camera back and the character becomes a dot.
  const fitBox = new THREE.Box3().setFromObject(body.group);
  fitBox.union(skull.clone().translate(new THREE.Vector3(0, head.position.y, 0)));
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

  return { group, bbox, size, center, fitSize, fitCenter, params: p, dispose };
}
