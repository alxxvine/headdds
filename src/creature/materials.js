import * as THREE from 'three';

const INK = new THREE.Color('#07060a');

/** Stepped tone: a few bands of light instead of a smooth gradient. */
function toonGradient(steps, sheen = 0) {
  const n = Math.max(2, Math.min(5, Math.round(steps)));
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    // sheen darkens the shadow end and blows out the lit end: a wet hide reads
    // as a hard bright band rather than as a smoother gradient
    const lo = 0.45 - sheen * 0.2;
    const hi = 1 + sheen * 0.9;
    data[i] = Math.min(255, Math.round(255 * (lo + (hi - lo) * (i === n - 1 ? 1 : t * 0.85))));
  }
  const tex = new THREE.DataTexture(data, n, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Pushes a color towards ink (amount 0..1). */
export function shade(hex, amount) {
  return new THREE.Color(hex).lerp(INK, THREE.MathUtils.clamp(amount, 0, 1));
}

export function makeMaterials(p) {
  const gradientMap = toonGradient(p.toonSteps, p.sheen ?? 0);
  const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap });
  // skin, body and growths carry vertex colours for the markings (see skin.js)
  const painted = (color) => new THREE.MeshToonMaterial({ color, gradientMap, vertexColors: true });
  const glow = p.glow ?? 0;

  return {
    gradientMap,
    skin: painted(new THREE.Color(p.skinColor)),
    body: painted(shade(p.skinColor, p.bodyTint)),
    growth: Object.assign(painted(shade(p.skinColor, 0.35)), {
      // horns, hair and the spore cloud catch the glow too, at half strength
      emissive: shade(p.skinColor, 0.1),
      emissiveIntensity: glow * 0.5,
    }),
    tooth: toon(new THREE.Color('#f4ecd6')),
    lip: toon(new THREE.Color(p.lipColor)),
    // a glowing creature lights its own eyes: emissive needs no post-processing
    // and reads instantly against the dark background
    eye: new THREE.MeshToonMaterial({
      color: new THREE.Color(p.eyeColor),
      gradientMap,
      emissive: new THREE.Color(p.eyeColor),
      emissiveIntensity: glow * 0.85,
    }),
    pupil: new THREE.MeshBasicMaterial({ color: new THREE.Color(p.pupilColor) }),
    cavity: new THREE.MeshBasicMaterial({ color: shade(p.lipColor, 0.78) }),
    socket: new THREE.MeshBasicMaterial({ color: shade(p.skinColor, 0.85) }),
    outline: new THREE.MeshBasicMaterial({ color: INK.clone(), side: THREE.BackSide }),
  };
}

/**
 * Inverted-hull outline: a copy of the mesh, inflated along its normals and
 * turned inside out. Cheap, and it gives exactly that cartoon edge.
 */
export function outlineGeometry(geo, thickness) {
  const out = geo.clone();
  const pos = out.attributes.position;
  const nor = out.attributes.normal;
  if (!nor) return out;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + nor.getX(i) * thickness,
      pos.getY(i) + nor.getY(i) * thickness,
      pos.getZ(i) + nor.getZ(i) * thickness,
    );
  }
  pos.needsUpdate = true;
  out.computeBoundingSphere();
  return out;
}

/** A mesh plus its outline in one call. */
export function withOutline(parent, mesh, geo, thickness, outlineMat) {
  parent.add(mesh);
  if (thickness > 0) {
    const shell = new THREE.Mesh(outlineGeometry(geo, thickness), outlineMat);
    shell.position.copy(mesh.position);
    shell.quaternion.copy(mesh.quaternion);
    shell.scale.copy(mesh.scale);
    parent.add(shell);
  }
  return mesh;
}
