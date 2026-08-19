import { sanitize, DEFAULTS, PARAMS } from '../creature/schema.js';

// A whole creature fits into a link: params -> compact JSON -> base64url.
// Only values that differ from the defaults go into the URL, which keeps links
// short and stops old links from breaking when new parameters are added.

const round = (v) => Math.round(v * 1000) / 1000;

export function toDiff(params) {
  const out = { seed: params.seed };
  for (const p of PARAMS) {
    const v = params[p.key];
    if (v === DEFAULTS[p.key]) continue;
    out[p.key] = typeof v === 'number' ? round(v) : v;
  }
  // hand-placed parts ride the link too; an empty list is the default and
  // stays out of it, so links from before EDIT mode decode unchanged
  if (params.placed?.length) {
    out.placed = params.placed.map((it) => ({
      k: it.k, x: round(it.x), y: round(it.y), z: round(it.z || 0), s: round(it.s),
      ...(it.t ? { t: it.t } : {}),
    }));
  }
  return out;
}

export function encodeParams(params) {
  const json = JSON.stringify(toDiff(params));
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeParams(code) {
  try {
    const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
    return sanitize(JSON.parse(atob(b64)));
  } catch {
    return null;
  }
}

export function readUrlParams() {
  if (typeof location === 'undefined') return null;
  const code = new URLSearchParams(location.search).get('c');
  return code ? decodeParams(code) : null;
}

export function shareUrl(params) {
  const url = new URL(location.href);
  url.search = `?c=${encodeParams(params)}`;
  return url.toString();
}

/** Quietly puts the current freak into the address bar, without a reload. */
export function syncUrl(params) {
  if (typeof history === 'undefined') return;
  history.replaceState(null, '', `?c=${encodeParams(params)}`);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function prettyJson(params) {
  return JSON.stringify(sanitize(params), null, 2);
}
