import { encodeParams, decodeParams } from './codec.js';

// The collection: freaks the player starred, kept in localStorage. Each entry
// stores the same compact code the share links use — so a favourite survives
// schema changes exactly as well as a link does — plus the name it wore when
// it was saved and a small thumbnail taken off the live canvas.

const KEY = 'headdds-favs';
const THUMB_W = 96;
const THUMB_H = 116;

export function loadFavs() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((f) => f && f.code) : [];
  } catch {
    return [];
  }
}

function store(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;   // full or blocked — the caller tells the player
  }
}

/**
 * A thumbnail from the live canvas. The render buffer is already tiny in
 * pixel mode, so this is a downscale of a downscale — cheap, and it keeps the
 * chunky look. Drawn un-smoothed so the pixels stay pixels.
 */
export function snapThumb(canvas) {
  if (!canvas) return null;
  try {
    const out = document.createElement('canvas');
    out.width = THUMB_W;
    out.height = THUMB_H;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    // crop the middle column of the frame: the creature stands centred and
    // the thumb is taller than it is wide, like the creature is
    const srcW = Math.min(canvas.width, canvas.height * (THUMB_W / THUMB_H));
    const srcH = srcW * (THUMB_H / THUMB_W);
    ctx.drawImage(
      canvas,
      (canvas.width - srcW) / 2, (canvas.height - srcH) / 2, srcW, srcH,
      0, 0, THUMB_W, THUMB_H,
    );
    return out.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** Returns the new list, or null if this freak is already in it. */
export function addFav(list, params, name, thumb) {
  const code = encodeParams(params);
  if (list.some((f) => f.code === code)) return null;
  const next = [{ code, seed: params.seed, name, thumb, at: Date.now() }, ...list];
  // A thumbnail is a few KB and localStorage is a few MB: cap the collection
  // rather than letting the next save die mid-write. Oldest goes first.
  while (next.length > 80 || (!store(next) && next.length > 1)) next.pop();
  return next;
}

export function removeFav(list, code) {
  const next = list.filter((f) => f.code !== code);
  store(next);
  return next;
}

export function favParams(fav) {
  return decodeParams(fav.code);
}
