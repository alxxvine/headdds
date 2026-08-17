import { sanitize, DEFAULTS, PARAMS } from '../creature/schema.js';

// Персонаж целиком помещается в ссылку: params -> компактный JSON -> base64url.
// В URL пишем только то, что отличается от дефолтов, — так ссылка короче
// и старые ссылки не ломаются при добавлении новых параметров.

const round = (v) => Math.round(v * 1000) / 1000;

export function toDiff(params) {
  const out = { seed: params.seed };
  for (const p of PARAMS) {
    const v = params[p.key];
    if (v === DEFAULTS[p.key]) continue;
    out[p.key] = typeof v === 'number' ? round(v) : v;
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

/** Тихо кладёт текущего уродца в адресную строку, без перезагрузки. */
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
