// Decides what happens to a download. Pure functions, unit tested in Node.

import { FORMATS, formatFromExt, formatFromMime, guessFormat, kindOf, extOf } from './formats.js';
import { hostOf, hostMatches, isFandomHost, isFandomMediaUrl, splitExt } from './filename.js';

const MEDIA = new Set(['image', 'audio', 'video']);

export function inScope(settings, urls) {
  const hosts = urls.map(hostOf).filter(Boolean);
  if (!hosts.length) return settings.scope === 'all';
  if (hosts.some((h) => (settings.excludeList || []).some((p) => hostMatches(h, p)))) return false;
  switch (settings.scope) {
    case 'fandom': return hosts.some(isFandomHost);
    case 'list': return hosts.some((h) => (settings.siteList || []).some((p) => hostMatches(h, p)));
    default: return true;
  }
}

/**
 * Should a browser download be taken over? Called from
 * downloads.onDeterminingFilename, before any bytes have been read.
 * @returns {{intercept: boolean, reason: string, guess?: string}}
 */
export function shouldIntercept(item, settings, selfId) {
  if (!settings.enabled) return { intercept: false, reason: 'paused' };
  if (item.byExtensionId && item.byExtensionId === selfId) return { intercept: false, reason: 'own download' };
  const url = item.finalUrl || item.url || '';
  if (!/^(https?|data):/i.test(url)) return { intercept: false, reason: 'unsupported scheme' };
  const urls = [url, item.url, item.referrer].filter(Boolean);
  if (!inScope(settings, urls)) return { intercept: false, reason: 'out of scope' };
  const maxBytes = (settings.maxSizeMB || 0) * 1048576;
  if (maxBytes && item.fileSize > maxBytes) return { intercept: false, reason: 'too large' };

  const byExt = formatFromExt(item.filename);
  const byMime = formatFromMime(item.mime);
  const guess = guessFormat({ mime: item.mime, filename: item.filename, url });

  if (isFandomMediaUrl(url) && (settings.fandomFixNames || settings.fandomOriginal)) {
    return { intercept: true, reason: 'fandom media', guess };
  }
  if (guess && settings.rules[guess] && settings.rules[guess] !== 'keep') {
    return { intercept: true, reason: `rule ${guess}→${settings.rules[guess]}`, guess };
  }
  // The extension and the Content-Type disagree, e.g. "latest.mpeg" holding MP3,
  // or "photo.png" that is really WebP. Read the bytes to find out.
  if (settings.fixExtensions && byExt && byMime && byExt !== byMime
      && MEDIA.has(kindOf(byExt)) && MEDIA.has(kindOf(byMime))) {
    const rule = settings.rules[byMime];
    return { intercept: true, reason: 'extension mismatch', guess: rule && rule !== 'keep' ? byMime : guess };
  }
  if (settings.fixExtensions && !byExt && byMime && MEDIA.has(kindOf(byMime))) {
    return { intercept: true, reason: 'missing extension', guess: byMime };
  }
  return { intercept: false, reason: 'no rule', guess };
}

/**
 * Once the real format is known, decide the output.
 * @param {string} actual sniffed format
 * @param {object} settings
 * @param {string|null} forced explicit target from the context menu / converter
 * @param {string} originalExt extension of the name the browser suggested
 * @returns {{action: 'convert'|'rename'|'keep', target: string, ext: string}}
 */
export function resolveOutput(actual, settings, forced = null, originalExt = '') {
  const known = actual && FORMATS[actual];
  let target = forced || (known ? settings.rules[actual] : 'keep') || 'keep';
  if (target === 'keep' || !known) {
    if (known && settings.fixExtensions && !sameExtFamily(originalExt, actual)) {
      return { action: 'rename', target: actual, ext: extOf(actual) };
    }
    return { action: 'keep', target: actual || null, ext: originalExt || (known ? extOf(actual) : '') };
  }
  if (target === actual && (settings.skipSameFormat || forced === actual)) {
    return sameExtFamily(originalExt, actual)
      ? { action: 'keep', target, ext: originalExt }
      : { action: 'rename', target, ext: extOf(actual) };
  }
  return { action: 'convert', target, ext: extOf(target) };
}

function sameExtFamily(ext, format) {
  return !!ext && formatFromExt(`x.${ext}`) === format;
}

export { splitExt };
