import * as THREE from 'three';
import { makeRng } from '../lib/noise.js';
import { makeHeadGeometry } from './head.js';
import { makeMaterials, withOutline } from './materials.js';
import { addEyes, addMouth, addNose, addGrowths, headUnit } from './features.js';
import { buildBody } from './body.js';
import { sanitize } from './schema.js';

/**
 * params -> готовая THREE.Group. Всё детерминировано: один и тот же
 * набор параметров даёт один и тот же меш.
 * Возвращает { group, bbox, dispose } — dispose обязателен, иначе
 * перетаскивание слайдера утечёт памятью GPU.
 */
export function buildCreature(rawParams) {
  const p = sanitize(rawParams);
  const rng = makeRng((p.seed >>> 0) ^ 0x51ed270b);
  const mats = makeMaterials(p);
  const S = headUnit(p);

  // --- голова. Пока она не в графе сцены, её локальные координаты = мировые,
  // поэтому рейкасты в surface.js работают в системе координат черепа.
  const headGeo = makeHeadGeometry(p);
  const headMesh = new THREE.Mesh(headGeo, mats.skin);
  headMesh.updateMatrixWorld(true);

  const head = new THREE.Group();
  withOutline(head, headMesh, headGeo, p.outline * S, mats.outline);
  addGrowths(head, headMesh, p, mats, rng);
  addNose(head, headMesh, p, mats);
  addEyes(head, headMesh, p, mats, rng);
  addMouth(head, headMesh, p, mats, rng);

  // --- тело от доли головы
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

  // Кадрируем по «телу с черепом», без спор и щупалец: иначе облако спор
  // отжимает камеру назад и персонаж превращается в точку.
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
