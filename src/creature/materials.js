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
  const glow = p.glow ?? 0;

  return {
    gradientMap,
    skin: toon(new THREE.Color(p.skinColor)),
    body: toon(shade(p.skinColor, p.bodyTint)),
    growth: Object.assign(toon(shade(p.skinColor, 0.35)), {
      // horns, hair and the spore cloud catch the glow too, at half strength
      emissive: shade(p.skinColor, 0.1),
      emissiveIntensity: glow * 0.5,
    }),
    // hands, feet and ears: the same skin, further into the ink
    trim: toon(shade(p.skinColor, p.trim ?? 0.35)),
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
    // What floats around the creature rather than growing on it. It used to
    // share the growth tone, which is the skin two shades down — so a cloud of
    // spores read as bits of the creature coming off it, and a ring in orbit
    // read as a bar of skin through the head. The eye colour instead: it is
    // already chosen to stand away from the skin, and it glows, so the motes
    // read as something the creature gives off.
    mote: new THREE.MeshToonMaterial({
      color: new THREE.Color(p.eyeColor),
      gradientMap,
      emissive: new THREE.Color(p.eyeColor),
      emissiveIntensity: 0.35 + glow * 0.5,
    }),
    pupil: new THREE.MeshBasicMaterial({ color: new THREE.Color(p.pupilColor) }),
    cavity: new THREE.MeshBasicMaterial({ color: shade(p.lipColor, 0.78) }),
    // The rim an eyeball sits in. Well darker than the face on purpose: a
    // bulging eye the same tone as the skin reads as a lump, and the thin
    // outline around it is not enough to separate the two.
    socket: new THREE.MeshBasicMaterial({ color: shade(p.skinColor, 0.5) }),
    // The outline is an inverted hull, so only its BACK faces are drawn — and
    // for anything lying flat on the skull (a nose disc, an ear root, a wart)
    // those back faces sit within a hair of the skin they are pressed against.
    // At that grazing angle the depth test cannot decide between them and the
    // rim renders as a dotted ring around the part, which reads as a rendering
    // fault rather than as ink. Pushed back in depth, it always loses, and the
    // dots become a line.
    outline: new THREE.MeshBasicMaterial({
      color: INK.clone(),
      side: THREE.BackSide,
      polygonOffset: true,
      polygonOffsetFactor: 1.5,
      polygonOffsetUnits: 1.5,
    }),
  };
}

/**
 * How thin the part is at its thinnest, from the geometry itself. This is what
 * an outline has to stay inside of.
 */
function thinnestHalf(geo) {
  if (!geo.boundingBox) geo.computeBoundingBox();
  const b = geo.boundingBox;
  return Math.max(1e-6, Math.min(
    b.max.x - b.min.x,
    b.max.y - b.min.y,
    b.max.z - b.min.z,
  ) / 2);
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
  // The clone inherits whatever bounds the source had cached, and the vertices
  // it inherited them with have just moved. Both have to be redone, not only
  // the sphere the renderer culls by.
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/**
 * A mesh plus its outline in one call.
 *
 * The thickness every caller asks for is an ABSOLUTE distance scaled off the
 * skull, because that is the one size the whole creature shares. On the head
 * itself that is right. On everything small it was not: a needle tooth is a
 * hundredth of the skull across, so a rim two hundredths wide turned each white
 * sliver into a black bar with a highlight, and a row of them into a barcode.
 * The same arithmetic made legs into black sticks — 400 of 600 creatures — and
 * did it to quills, tendrils, horns and eye beads too.
 *
 * So the cap lives here rather than at the thirty call sites that would each
 * have to remember it: an outline is a rim, never more than a third of the
 * part it is drawn around, measured on the part's own geometry.
 */
export function withOutline(parent, mesh, geo, thickness, outlineMat) {
  parent.add(mesh);
  thickness = Math.min(thickness, thinnestHalf(geo) * 0.34);
  if (thickness > 0) {
    const shell = new THREE.Mesh(outlineGeometry(geo, thickness), outlineMat);
    shell.position.copy(mesh.position);
    shell.quaternion.copy(mesh.quaternion);
    shell.scale.copy(mesh.scale);
    parent.add(shell);
  }
  return mesh;
}
