// File name and URL helpers, including Fandom (Wikia) CDN handling.
//
// Fandom media lives at URLs like
//   https://static.wikia.nocookie.net/<wiki>/images/a/ab/Song.ogg/revision/latest?cb=2020
//   https://static.wikia.nocookie.net/<wiki>/images/a/ab/Art.png/revision/latest/scale-to-width-down/250?cb=1
// Browsers name these downloads "latest", "latest.webp" or "latest.mpeg". The
// CDN also re-encodes images to WebP unless `format=original` is requested.

import { extOf } from './formats.js';

const FANDOM_CDN = /(^|\.)(wikia\.nocookie\.net|wikia\.com|fandom\.com)$/i;

export function isFandomMediaUrl(url) {
  try {
    const u = new URL(url);
    return FANDOM_CDN.test(u.hostname) && /\/revision\//.test(u.pathname);
  } catch {
    return false;
  }
}

export function isFandomHost(hostname) {
  return /(^|\.)(fandom\.com|wikia\.org|wikia\.com|wikia\.nocookie\.net)$/i.test(hostname || '');
}

/** The real file name embedded in a Fandom CDN URL, e.g. "Song.ogg". */
export function fandomFileName(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/');
    const i = parts.indexOf('revision');
    if (i > 0) return safeDecode(parts[i - 1]);
  } catch { /* not a URL */ }
  return null;
}

/**
 * Rewrite a Fandom CDN URL so it returns the original upload: drop the
 * thumbnail/scaling path (when fullSize is set) and add format=original so
 * the CDN does not substitute WebP.
 */
export function fandomOriginalUrl(url, { fullSize = true } = {}) {
  if (!isFandomMediaUrl(url)) return url;
  const u = new URL(url);
  if (fullSize) {
    u.pathname = u.pathname.replace(/(\/revision\/(?:latest|\d+))(\/.*)?$/, '$1');
  }
  u.searchParams.set('format', 'original');
  return u.toString();
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** The last meaningful path segment of a URL. */
export function nameFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'data:' || u.protocol === 'blob:') return null;
    const fandom = fandomFileName(url);
    if (fandom) return fandom;
    const segs = u.pathname.split('/').filter(Boolean);
    return segs.length ? safeDecode(segs[segs.length - 1]) : u.hostname;
  } catch {
    return null;
  }
}

// Names that carry no information and should be replaced by a URL-derived one.
const GENERIC = /^(latest|download|file|image|index|media|original|unknown|untitled|view|get|raw)$/i;

export function splitExt(name) {
  const m = /^(.*?)(\.[a-z0-9]{1,5})?$/i.exec(name || '');
  return { stem: m[1] || '', ext: (m[2] || '').slice(1).toLowerCase() };
}

/**
 * Pick the best base name (without extension) for a download.
 * Fandom names win over the browser's "latest"; otherwise the browser's
 * suggestion (which honours Content-Disposition) is preferred.
 */
export function bestStem({ suggested, url, fandom = true }) {
  const fromFandom = fandom ? fandomFileName(url) : null;
  if (fromFandom) return splitExt(fromFandom).stem;
  const base = String(suggested || '').split(/[\\/]/).pop();
  const { stem } = splitExt(base);
  if (stem && (!GENERIC.test(stem) || (!fandom && isFandomMediaUrl(url)))) return stem;
  const fromUrl = nameFromUrl(url);
  const urlStem = splitExt(fromUrl || '').stem;
  if (urlStem && !GENERIC.test(urlStem)) return urlStem;
  return stem || urlStem || 'download';
}

// Characters Windows, macOS and Chrome's downloads API all reject.
export function sanitize(name) {
  let out = String(name || '')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(out)) out = `_${out}`;
  return out.slice(0, 180) || 'download';
}

function sanitizeFolder(folder) {
  return String(folder || '')
    .split(/[\\/]+/)
    .map((p) => p.trim())
    .filter((p) => p && p !== '.' && p !== '..')
    .map(sanitize)
    .join('/');
}

/**
 * Final relative path handed to chrome.downloads.download().
 * @param {string} stem
 * @param {string} format key of FORMATS
 * @param {{subfolder?: string, underscoresToSpaces?: boolean}} opts
 */
export function buildFilename(stem, format, opts = {}) {
  let s = stem;
  if (opts.underscoresToSpaces) s = s.replace(/_+/g, ' ');
  const file = `${sanitize(s)}.${extOf(format)}`;
  const folder = sanitizeFolder(opts.subfolder);
  return folder ? `${folder}/${file}` : file;
}

export function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

/**
 * Domain pattern matching for the site lists. Patterns are host names,
 * optionally with a leading "*." ("*.fandom.com" matches the apex too).
 */
export function hostMatches(host, pattern) {
  const p = String(pattern || '').trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
  if (!p || !host) return false;
  const bare = p.replace(/^\*\./, '');
  return host === bare || host.endsWith(`.${bare}`);
}
