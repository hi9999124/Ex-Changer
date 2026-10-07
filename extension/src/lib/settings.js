// Settings schema, defaults and storage helpers.

export const DEFAULT_RULES = {
  // source format -> target format ("keep" leaves the file as it is)
  webp: 'png',
  avif: 'png',
  gif: 'keep',
  bmp: 'png',
  ico: 'png',
  svg: 'keep',
  jpeg: 'keep',
  png: 'keep',
  mp3: 'keep',
  mp2: 'mp3',
  ogg: 'mp3',
  opus: 'mp3',
  wav: 'keep',
  flac: 'keep',
  aac: 'keep',
  m4a: 'keep',
  aiff: 'keep',
  mpeg: 'mp3',
  ts: 'keep',
  mp4: 'keep',
  webm: 'keep',
  mkv: 'keep',
  ogv: 'keep',
};

export const DEFAULTS = {
  enabled: true,
  rules: DEFAULT_RULES,

  // Where automatic conversion applies.
  scope: 'all', // 'all' | 'fandom' | 'list'
  siteList: ['*.fandom.com', '*.wikia.nocookie.net'],
  excludeList: [],

  // Behaviour
  fixExtensions: true,   // rename files whose extension lies about their content
  skipSameFormat: true,  // never re-encode a file that is already in the target format
  fallbackToOriginal: true,
  saveAs: false,
  subfolder: '',
  underscoresToSpaces: false,
  conflictAction: 'uniquify', // 'uniquify' | 'overwrite'
  notify: false,
  maxSizeMB: 512,

  // Images
  jpegQuality: 92,
  webpQuality: 90,
  jpegBackground: '#ffffff',
  maxDimension: 0, // 0 = keep the original size

  // Audio
  mp3Bitrate: 192,
  mp3Channels: 'auto', // 'auto' | 'mono' | 'stereo'
  sampleRate: 44100,
  wavBitDepth: 16, // 16 | 24 | 32 (float)

  // Fandom
  fandomFixNames: true,
  fandomOriginal: true,    // fetch format=original instead of the WebP rendition
  fandomFullSize: true,    // strip /scale-to-width-down/... from thumbnails
  fandomLoadOriginals: false, // serve originals while browsing (declarativeNetRequest)

  // Context menu
  contextMenu: true,
};

export async function loadSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return mergeSettings(settings);
}

export function mergeSettings(stored) {
  const s = { ...DEFAULTS, ...(stored || {}) };
  s.rules = { ...DEFAULT_RULES, ...((stored && stored.rules) || {}) };
  return s;
}

export async function saveSettings(patch) {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  if (patch.rules) next.rules = { ...current.rules, ...patch.rules };
  await chrome.storage.sync.set({ settings: next });
  return next;
}

export async function resetSettings() {
  await chrome.storage.sync.set({ settings: DEFAULTS });
  return mergeSettings(DEFAULTS);
}
