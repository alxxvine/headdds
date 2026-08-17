import * as THREE from 'three';
import { fbm3, noise3 } from '../lib/noise.js';

// Markings are painted as vertex colours after the creature is assembled, so
// the pattern is evaluated in one shared space and runs across the skull, the
// torso and the limbs as a single coat rather than restarting on every part.
//
// It runs last for a reason: only then does every mesh know where it sits.

const _v = new THREE.Vector3();
const WHITE = new THREE.Color(1, 1, 1);

// vertex colours multiply the material tint, so a marking is expressed as the
// ratio that turns the part's tone into the marking's tone
const ratio = (want, have) => THREE.MathUtils.clamp(want / Math.max(have, 0.02), 0, 6);

/**
 * 1 where the marking shows, 0 where the base skin does, with a crisp edge.
 * `q` is normalised: the creature spans roughly -1..1 on every axis, so a
 * pattern looks the same on a tall freak and on a squat one.
 */
function maskAt(kind, q, amount, scale) {
  // a narrow band keeps the marking's edge crisp; the toon shading has no
  // gradients of its own and a soft edge just reads as dirt
  const edge = (v, t) => THREE.MathUtils.smoothstep(v, t - 0.025, t + 0.025);

  if (kind === 'spots') {
    const n = fbm3(q.x * scale, q.y * scale, q.z * scale, 17, 2);
    return edge(n, 1 - amount * 0.75);
  }
  if (kind === 'stripes') {
    const wobble = fbm3(q.x * scale * 0.6, q.y * scale * 0.35, q.z * scale * 0.6, 41, 2) - 0.5;
    const band = Math.sin((q.y * scale * 2.6) + wobble * 5) * 0.5 + 0.5;
    return edge(band, 1 - amount * 0.9);
  }
  if (kind === 'blotches') {
    const n = fbm3(q.x * scale * 0.45, q.y * scale * 0.45, q.z * scale * 0.45, 7, 3);
    return edge(n, 1 - amount * 0.7);
  }
  if (kind === 'veins') {
    const n = fbm3(q.x * scale, q.y * scale, q.z * scale, 91, 3);
    const ridge = 1 - Math.abs(n * 2 - 1); // ridged noise: thin bright lines
    return edge(ridge, 1 - amount * 0.35);
  }
  if (kind === 'crust') {
    const n = noise3(q.x * scale * 3.5, q.y * scale * 3.5, q.z * scale * 3.5, 313);
    return edge(n, 1 - amount * 0.6);
  }
  if (kind === 'belly') {
    // pale front and underside, like most animals
    const front = THREE.MathUtils.clamp((q.z * 1.1 - q.y * 0.7 + 1) * 0.5, 0, 1);
    return edge(front, 1 - amount * 0.75);
  }
  return 0;
}

/**
 * Paints every mesh that uses a skin-ish material. Geometries are cloned per
 * mesh first: the legs share one capsule, and a shared geometry would take the
 * colours of whichever leg happened to be painted last.
 */
export function paintSkin(root, p, mats) {
  const painted = new Set([mats.skin, mats.body, mats.growth]);
  const base = new THREE.Color(p.skinColor);
  const bodyTone = mats.body.color;
  const mark = new THREE.Color(p.patternColor);
  const scale = 9 / Math.max(0.5, p.patternScale); // cycles across the body
  const on = p.skinPattern !== 'none';

  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const local = new THREE.Matrix4();
  const tone = new THREE.Color();

  // Sample in a space where the creature spans about -1..1: in raw world units
  // a marking's scale would depend on how tall the freak happens to be, and
  // "pale belly" would sit entirely below its feet.
  const bounds = new THREE.Box3().setFromObject(root);
  const centre = bounds.getCenter(new THREE.Vector3());
  const span = bounds.getSize(new THREE.Vector3());
  const norm = 2 / Math.max(0.01, Math.max(span.x, span.y, span.z));

  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !painted.has(o.material)) return;

    const geo = o.geometry.clone();
    o.geometry = geo;
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    // vertex colours multiply the material colour, so the base has to be white
    // and the marking has to be expressed relative to whatever tone this part
    // already carries (the body is a darker shade of the same skin)
    const partTone = o.material === mats.body ? bodyTone : base;
    local.multiplyMatrices(inv, o.matrixWorld);

    for (let i = 0; i < pos.count; i++) {
      let m = 0;
      if (on) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(local).sub(centre).multiplyScalar(norm);
        m = maskAt(p.skinPattern, _v, p.patternAmount, scale);
      }
      if (m <= 0) {
        colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = 1;
      } else {
        // divide out the material tint so the marking lands on its own colour
        // rather than on the skin colour multiplied by it
        colors[i * 3] = 1 + (ratio(mark.r, partTone.r) - 1) * m;
        colors[i * 3 + 1] = 1 + (ratio(mark.g, partTone.g) - 1) * m;
        colors[i * 3 + 2] = 1 + (ratio(mark.b, partTone.b) - 1) * m;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  });

  // instanced growths get one tone per instance instead of per vertex
  if (on) {
    root.traverse((o) => {
      if (!o.isInstancedMesh || !painted.has(o.material)) return;
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m4);
        _v.setFromMatrixPosition(m4).applyMatrix4(o.matrixWorld).sub(centre).multiplyScalar(norm);
        const m = maskAt(p.skinPattern, _v, p.patternAmount, scale);
        const g = mats.growth.color;
        tone.setRGB(
          m > 0.5 ? ratio(mark.r, g.r) : 1,
          m > 0.5 ? ratio(mark.g, g.g) : 1,
          m > 0.5 ? ratio(mark.b, g.b) : 1,
        );
        o.setColorAt(i, tone);
      }
      if (o.instanceColor) o.instanceColor.needsUpdate = true;
    });
  }
}
