// Format tables and content sniffing.
// Detection is based on the file's actual bytes, never only on the name or
// the server's Content-Type, because sites like Fandom routinely serve WebP
// under a ".png" URL or MP3 audio under an "audio/mpeg" type that browsers
// save as "latest.mpeg".

export const FORMATS = {
  // ---- images -----------------------------------------------------------
  png:  { kind: 'image', label: 'PNG',  ext: 'png',  mime: 'image/png' },
  jpeg: { kind: 'image', label: 'JPEG', ext: 'jpg',  mime: 'image/jpeg' },
  webp: { kind: 'image', label: 'WebP', ext: 'webp', mime: 'image/webp' },
  avif: { kind: 'image', label: 'AVIF', ext: 'avif', mime: 'image/avif' },
  gif:  { kind: 'image', label: 'GIF',  ext: 'gif',  mime: 'image/gif' },
  bmp:  { kind: 'image', label: 'BMP',  ext: 'bmp',  mime: 'image/bmp' },
  ico:  { kind: 'image', label: 'ICO',  ext: 'ico',  mime: 'image/x-icon' },
  svg:  { kind: 'image', label: 'SVG',  ext: 'svg',  mime: 'image/svg+xml' },
  heic: { kind: 'image', label: 'HEIC', ext: 'heic', mime: 'image/heic', undecodable: true },
  // ---- audio ------------------------------------------------------------
  mp3:  { kind: 'audio', label: 'MP3',  ext: 'mp3',  mime: 'audio/mpeg' },
  mp2:  { kind: 'audio', label: 'MP2',  ext: 'mp2',  mime: 'audio/mpeg' },
  ogg:  { kind: 'audio', label: 'OGG Vorbis', ext: 'ogg', mime: 'audio/ogg' },
  opus: { kind: 'audio', label: 'Opus', ext: 'opus', mime: 'audio/ogg; codecs=opus' },
  wav:  { kind: 'audio', label: 'WAV',  ext: 'wav',  mime: 'audio/wav' },
  flac: { kind: 'audio', label: 'FLAC', ext: 'flac', mime: 'audio/flac' },
  aac:  { kind: 'audio', label: 'AAC',  ext: 'aac',  mime: 'audio/aac' },
  m4a:  { kind: 'audio', label: 'M4A',  ext: 'm4a',  mime: 'audio/mp4' },
  aiff: { kind: 'audio', label: 'AIFF', ext: 'aiff', mime: 'audio/aiff' },
  // ---- video containers (audio can be extracted) --------------------------
  mpeg: { kind: 'video', label: 'MPEG', ext: 'mpeg', mime: 'video/mpeg' },
  ts:   { kind: 'video', label: 'MPEG-TS', ext: 'ts', mime: 'video/mp2t' },
  mp4:  { kind: 'video', label: 'MP4',  ext: 'mp4',  mime: 'video/mp4' },
  webm: { kind: 'video', label: 'WebM', ext: 'webm', mime: 'video/webm' },
  mkv:  { kind: 'video', label: 'MKV',  ext: 'mkv',  mime: 'video/x-matroska' },
  ogv:  { kind: 'video', label: 'OGV',  ext: 'ogv',  mime: 'video/ogg' },
};

// Formats the converter can produce.
export const IMAGE_TARGETS = ['png', 'jpeg', 'webp', 'bmp'];
export const AUDIO_TARGETS = ['mp3', 'wav'];

export function targetsFor(format) {
  const kind = FORMATS[format]?.kind;
  if (kind === 'image') return IMAGE_TARGETS;
  if (kind === 'audio' || kind === 'video') return AUDIO_TARGETS;
  return [];
}

const EXT_ALIASES = {
  png: 'png', apng: 'png', jpg: 'jpeg', jpeg: 'jpeg', jpe: 'jpeg', jfif: 'jpeg',
  webp: 'webp', avif: 'avif', gif: 'gif', bmp: 'bmp', ico: 'ico', cur: 'ico',
  svg: 'svg', heic: 'heic', heif: 'heic',
  mp3: 'mp3', mpga: 'mp3', mp2: 'mp2', ogg: 'ogg', oga: 'ogg', opus: 'opus',
  wav: 'wav', wave: 'wav', flac: 'flac', aac: 'aac', m4a: 'm4a', aif: 'aiff', aiff: 'aiff',
  mpeg: 'mpeg', mpg: 'mpeg', mpe: 'mpeg', m1v: 'mpeg', m2v: 'mpeg', vob: 'mpeg',
  ts: 'ts', m2ts: 'ts', mts: 'ts', mp4: 'mp4', m4v: 'mp4', mov: 'mp4',
  webm: 'webm', mkv: 'mkv', ogv: 'ogv',
};

const MIME_ALIASES = {
  'image/png': 'png', 'image/apng': 'png', 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg',
  'image/pjpeg': 'jpeg', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif',
  'image/bmp': 'bmp', 'image/x-ms-bmp': 'bmp', 'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico', 'image/svg+xml': 'svg', 'image/heic': 'heic',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mpeg3': 'mp3', 'audio/x-mpeg': 'mp3',
  'audio/mpa': 'mp3', 'audio/ogg': 'ogg', 'audio/vorbis': 'ogg', 'audio/opus': 'opus',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/vnd.wave': 'wav',
  'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/aac': 'aac', 'audio/x-aac': 'aac',
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aiff': 'aiff', 'audio/x-aiff': 'aiff',
  'audio/webm': 'webm', 'video/mpeg': 'mpeg', 'video/mp2t': 'ts', 'video/mp4': 'mp4',
  'video/quicktime': 'mp4', 'video/webm': 'webm', 'video/x-matroska': 'mkv',
  'video/ogg': 'ogv', 'application/ogg': 'ogg',
};

export function formatFromExt(name) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(String(name || '').split(/[?#]/)[0]);
  return m ? EXT_ALIASES[m[1].toLowerCase()] || null : null;
}

export function formatFromMime(mime) {
  const base = String(mime || '').split(';')[0].trim().toLowerCase();
  return MIME_ALIASES[base] || null;
}

const ascii = (b, off, len) => {
  let s = '';
  for (let i = off; i < off + len && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

const indexOfAscii = (b, needle, limit) => {
  const end = Math.min(b.length, limit) - needle.length;
  outer: for (let i = 0; i <= end; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (b[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
};

// Classify an MPEG audio frame header (sync word 0xFFE). Returns mp3, mp2,
// aac or null.
function mpegAudioFrame(b, i) {
  if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const layer = (b[i + 1] >> 1) & 0x03;
  const version = (b[i + 1] >> 3) & 0x03;
  if (layer === 0) return (b[i + 1] & 0xf6) === 0xf0 ? 'aac' : null; // ADTS
  if (version === 1) return null; // reserved
  const bitrate = b[i + 2] >> 4;
  const rate = (b[i + 2] >> 2) & 0x03;
  if (bitrate === 0x0f || rate === 0x03) return null;
  if (layer === 1) return 'mp3';
  if (layer === 2) return 'mp2';
  return 'mp2'; // layer I, decoded the same way as layer II
}

/**
 * Detect the real format of a file from its first bytes (4 KiB is plenty).
 * @param {Uint8Array} b
 * @returns {string|null} a key of FORMATS
 */
export function sniff(b) {
  if (!b || b.length < 4) return null;
  const s4 = ascii(b, 0, 4);

  if (b[0] === 0x89 && s4.slice(1) === 'PNG') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (s4 === 'GIF8') return 'gif';
  if (s4 === 'RIFF') {
    const t = ascii(b, 8, 4);
    if (t === 'WEBP') return 'webp';
    if (t === 'WAVE') return 'wav';
    if (t === 'AVI ') return 'mp4'; // treated as a generic video container
  }
  if (s4 === 'FORM' && /^AIF[FC]$/.test(ascii(b, 8, 4))) return 'aiff';
  if (s4 === 'fLaC') return 'flac';
  if (s4 === 'OggS') {
    const head = ascii(b, 0, Math.min(b.length, 512));
    if (head.includes('OpusHead')) return 'opus';
    if (head.includes('theora')) return 'ogv';
    return 'ogg';
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    return indexOfAscii(b, 'webm', 64) >= 0 ? 'webm' : 'mkv';
  }
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    const compat = ascii(b, 16, Math.max(0, Math.min(64, b.length) - 16));
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) {
      return compat.includes('avif') ? 'avif' : 'heic';
    }
    if (brand === 'M4A ' || brand === 'M4B ' || brand === 'M4P ') return 'm4a';
    return 'mp4';
  }
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && (b[3] === 0xba || b[3] === 0xb3)) return 'mpeg';
  if (b[0] === 0x47 && b.length > 376 && b[188] === 0x47 && b[376] === 0x47) return 'ts';
  if (b[0] === 0x42 && b[1] === 0x4d && b.length > 26) return 'bmp';
  if (b[0] === 0 && b[1] === 0 && (b[2] === 1 || b[2] === 2) && b[3] === 0 && b[4] > 0) return 'ico';

  if (ascii(b, 0, 3) === 'ID3') {
    // Skip the ID3v2 tag to see what kind of MPEG audio follows.
    const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
    const at = 10 + size + ((b[5] & 0x10) ? 10 : 0);
    return (at + 4 <= b.length && mpegAudioFrame(b, at)) || 'mp3';
  }
  const frame = mpegAudioFrame(b, 0);
  if (frame) return frame;

  // Text based formats.
  let start = 0;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) start = 3;
  const text = ascii(b, start, Math.min(b.length, 1024)).trimStart().toLowerCase();
  if (text.startsWith('<svg') || ((text.startsWith('<?xml') || text.startsWith('<!doctype svg')) && text.includes('<svg'))) {
    return 'svg';
  }
  return null;
}

/** Best guess before the bytes are available. */
export function guessFormat({ mime, filename, url }) {
  return formatFromExt(filename) || formatFromMime(mime) || formatFromExt(pathOf(url));
}

function pathOf(url) {
  try { return new URL(url).pathname; } catch { return ''; }
}

export const kindOf = (format) => FORMATS[format]?.kind || null;
export const extOf = (format) => FORMATS[format]?.ext || format;
export const mimeOf = (format) => FORMATS[format]?.mime || 'application/octet-stream';
export const labelOf = (format) => FORMATS[format]?.label || String(format || '?').toUpperCase();
