// Ex-Changer service worker.
//
// Flow for an automatic conversion:
//   1. downloads.onDeterminingFilename sees a browser download.
//   2. rules.shouldIntercept() decides whether to take it over.
//   3. The browser download is cancelled and erased; a job is created.
//   4. The offscreen document fetches the file (Fandom: original quality),
//      sniffs the real format, converts it and returns a blob: URL.
//   5. The blob is saved with downloads.download() under a corrected name.
//   6. On any failure the original file is downloaded instead (optional).

import { loadSettings, saveSettings, DEFAULTS, mergeSettings } from './lib/settings.js';
import { shouldIntercept } from './lib/rules.js';
import { formatFromExt, guessFormat, labelOf, extOf } from './lib/formats.js';
import {
  bestStem, buildFilename, fandomFileName, fandomOriginalUrl, isFandomMediaUrl, nameFromUrl, splitExt,
} from './lib/filename.js';

const SELF = chrome.runtime.id;
const HISTORY_LIMIT = 60;
const ACTIVE = new Set(['queued', 'fetching', 'converting', 'saving']);

// ---------------------------------------------------------------------------
// Settings cache
// ---------------------------------------------------------------------------
let settingsPromise = null;
const getSettings = () => (settingsPromise ||= loadSettings());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    const next = mergeSettings(changes.settings.newValue);
    settingsPromise = Promise.resolve(next);
    applyLoadingRules(next);
    buildContextMenus(next);
    updateBadge();
  }
});

// ---------------------------------------------------------------------------
// Job history (chrome.storage.local is the source of truth so the popup can
// observe it and jobs survive a service worker restart)
// ---------------------------------------------------------------------------
let jobsCache = null;
let saveTimer = null;

async function getHistory() {
  if (!jobsCache) {
    const { history: stored } = await chrome.storage.local.get('history');
    jobsCache = Array.isArray(stored) ? stored : [];
  }
  return jobsCache;
}

function persistSoon(immediate = false) {
  clearTimeout(saveTimer);
  const write = () => chrome.storage.local.set({ history: jobsCache.slice(0, HISTORY_LIMIT) });
  if (immediate) return write();
  saveTimer = setTimeout(write, 200);
  return undefined;
}

async function addJob(job) {
  const list = await getHistory();
  list.unshift(job);
  if (list.length > HISTORY_LIMIT) list.length = HISTORY_LIMIT;
  await persistSoon(true);
  updateBadge();
}

async function updateJob(id, patch, immediate = false) {
  const list = await getHistory();
  const job = list.find((j) => j.id === id);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: Date.now() });
  await persistSoon(immediate);
  if (patch.status) updateBadge();
  return job;
}

async function findJob(id) {
  return (await getHistory()).find((j) => j.id === id) || null;
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
async function updateBadge() {
  const s = await getSettings();
  const list = await getHistory();
  const active = list.filter((j) => ACTIVE.has(j.status)).length;
  if (!s.enabled) {
    chrome.action.setBadgeText({ text: 'off' });
    chrome.action.setBadgeBackgroundColor({ color: '#3a3a38' });
  } else if (active) {
    chrome.action.setBadgeText({ text: String(active) });
    chrome.action.setBadgeBackgroundColor({ color: '#2c84db' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ---------------------------------------------------------------------------
// Offscreen document
// ---------------------------------------------------------------------------
const OFFSCREEN_URL = 'src/offscreen/offscreen.html';
let creating = null;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (contexts.length) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['BLOBS', 'WORKERS'],
      justification: 'Decode and re-encode downloaded images and audio, and hold the converted file as a blob URL while it is saved.',
    }).catch((e) => {
      if (!/single offscreen/i.test(String(e?.message))) throw e;
    }).finally(() => { creating = null; });
  }
  await creating;
}

async function toOffscreen(msg) {
  await ensureOffscreen();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await chrome.runtime.sendMessage({ to: 'offscreen', ...msg });
    } catch (e) {
      // The document may still be loading its module script.
      await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
    }
  }
  throw new Error('Conversion engine did not start');
}

// ---------------------------------------------------------------------------
// Referer forwarding: some CDNs refuse hotlinked requests, so the request the
// offscreen document makes carries the referrer of the original download.
// ---------------------------------------------------------------------------
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let refererRuleId = 1000;

async function withReferer(url, referrer, fn) {
  if (!referrer || !/^https?:/i.test(referrer) || !/^https?:/i.test(url)) return fn();
  const id = refererRuleId = refererRuleId >= 1999 ? 1000 : refererRuleId + 1;
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [id],
      addRules: [{
        id,
        priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'referer', operation: 'set', value: referrer }] },
        condition: { regexFilter: `^${escapeRe(url)}$`, resourceTypes: ['xmlhttprequest', 'other'], tabIds: [chrome.tabs.TAB_ID_NONE] },
      }],
    });
  } catch { /* regex too long etc. — continue without it */ }
  try {
    return await fn();
  } finally {
    setTimeout(() => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] }).catch(() => {}), 120000);
  }
}

// ---------------------------------------------------------------------------
// Saving. Chrome lets an onDeterminingFilename listener override the name
// passed to downloads.download(), and ours sees our own downloads too, so it
// re-suggests the intended name from this map.
// ---------------------------------------------------------------------------
const pendingNames = new Map(); // url -> {filename, conflictAction}

async function saveFile(url, filename, { saveAs = false, conflictAction = 'uniquify' } = {}) {
  pendingNames.set(url, { filename, conflictAction });
  setTimeout(() => pendingNames.delete(url), 60000);
  return chrome.downloads.download({ url, filename, saveAs, conflictAction });
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------
/**
 * @param {object} p
 * @param {string} p.url original URL
 * @param {string} [p.suggested] browser suggested file name
 * @param {string} [p.mime]
 * @param {string} [p.referrer]
 * @param {string|null} [p.forced] explicit target format
 * @param {'auto'|'menu'|'manual'|'retry'} p.source
 * @param {string} [p.reason]
 */
async function startJob(p) {
  const s = await getSettings();
  const fandom = isFandomMediaUrl(p.url);
  const fetchUrl = fandom && s.fandomOriginal ? fandomOriginalUrl(p.url, { fullSize: s.fandomFullSize }) : p.url;
  const stem = bestStem({ suggested: p.suggested, url: p.url, fandom: s.fandomFixNames });
  const originalExt = splitExt(String(p.suggested || '').split(/[\\/]/).pop()).ext
    || splitExt((fandom && fandomFileName(p.url)) || nameFromUrl(p.url) || '').ext;
  const hint = p.hint || guessFormat({ mime: p.mime, filename: p.suggested, url: p.url });

  const job = {
    id: newId(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    source: p.source,
    reason: p.reason || '',
    url: p.url,
    fetchUrl,
    referrer: p.referrer || '',
    suggested: p.suggested || '',
    mime: p.mime || '',
    stem,
    hint,
    originalExt,
    forced: p.forced || null,
    fandom,
    status: 'queued',
    phase: 'Queued',
    progress: 0,
  };
  await addJob(job);
  runJob(job.id).catch((e) => failJob(job.id, e));
  return job.id;
}

async function runJob(id) {
  const job = await findJob(id);
  const s = await getSettings();
  await updateJob(id, { status: 'fetching', phase: 'Downloading', progress: 0 }, true);
  await withReferer(job.fetchUrl, job.referrer, () => toOffscreen({
    type: 'run',
    job: {
      id,
      fetchUrl: job.fetchUrl,
      forced: job.forced,
      originalExt: job.originalExt,
      hint: job.hint,
      settings: s,
      maxBytes: (s.maxSizeMB || 0) * 1048576,
    },
  }));
}

async function onProgress(msg) {
  const job = await findJob(msg.id);
  if (!job || !ACTIVE.has(job.status)) return;
  const status = msg.phase === 'Downloading' ? 'fetching' : 'converting';
  const patch = { status, phase: msg.phase, progress: Math.max(0, Math.min(1, msg.value || 0)) };
  if (msg.bytes) patch.sizeIn = msg.bytes;
  await updateJob(msg.id, patch, status !== job.status);
}

async function onResult(msg) {
  const job = await findJob(msg.id);
  if (!job) {
    if (msg.blobUrl) toOffscreen({ type: 'revoke', blobUrl: msg.blobUrl }).catch(() => {});
    return;
  }
  if (!msg.ok) return failJob(msg.id, new Error(msg.error));

  const s = await getSettings();
  // "keep" leaves the extension the browser chose; otherwise it follows the
  // real (or new) format.
  const extFormat = msg.action === 'keep' ? (msg.ext || msg.target || job.originalExt || 'bin') : msg.target;
  const finalName = buildFilename(job.stem, extFormat, {
    subfolder: s.subfolder,
    underscoresToSpaces: s.underscoresToSpaces,
  });

  await updateJob(msg.id, {
    status: 'saving', phase: 'Saving', progress: 1,
    actual: msg.actual, target: msg.target, action: msg.action,
    sizeIn: msg.sizeIn, sizeOut: msg.sizeOut, detail: msg.detail, filename: finalName,
  }, true);

  try {
    const downloadId = await saveFile(msg.blobUrl, finalName, {
      saveAs: !!s.saveAs,
      conflictAction: s.conflictAction === 'overwrite' ? 'overwrite' : 'uniquify',
    });
    await updateJob(msg.id, { downloadId, blobUrl: msg.blobUrl }, true);
  } catch (e) {
    toOffscreen({ type: 'revoke', blobUrl: msg.blobUrl }).catch(() => {});
    await failJob(msg.id, e);
  }
  return undefined;
}

async function failJob(id, err) {
  const job = await findJob(id);
  if (!job) return;
  const s = await getSettings();
  const error = err?.message || String(err);
  if (s.fallbackToOriginal && job.source !== 'manual') {
    try {
      const ext = job.originalExt || extOf(job.hint) || '';
      const name = ext ? `${job.stem}.${ext}` : job.stem;
      const downloadId = await saveFile(
        job.url,
        buildFilename(splitExt(name).stem, formatFromExt(name) || ext || 'bin', { subfolder: s.subfolder }),
      );
      await updateJob(id, { status: 'fallback', phase: 'Saved original', error, downloadId }, true);
      return;
    } catch { /* fall through */ }
  }
  await updateJob(id, { status: 'failed', phase: 'Failed', error }, true);
  notify(job, `Could not convert: ${error}`);
}

function notify(job, message) {
  getSettings().then((s) => {
    if (!s.notify) return;
    chrome.notifications.create(`exc-${job.id}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: 'Ex-Changer',
      message,
      priority: 0,
    });
  });
}

// ---------------------------------------------------------------------------
// Offscreen -> background messages
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.to === 'background') {
    if (msg.type === 'progress') onProgress(msg);
    else if (msg.type === 'result') onResult(msg);
    return false;
  }
  if (msg?.to !== 'ex-changer' || sender.id !== SELF) return false;
  handleUiMessage(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: e?.message || String(e) }));
  return true;
});

async function handleUiMessage(msg) {
  switch (msg.type) {
    case 'retry': {
      const job = await findJob(msg.id);
      if (!job) return { ok: false, error: 'Job not found' };
      const id = await startJob({
        url: job.url, suggested: job.suggested, mime: job.mime, referrer: job.referrer,
        forced: job.forced, source: 'retry', reason: 'retry', hint: job.hint,
      });
      return { ok: true, id };
    }
    case 'convert-url': {
      const id = await startJob({ url: msg.url, forced: msg.forced || null, source: 'manual', reason: 'from URL', referrer: msg.referrer });
      return { ok: true, id };
    }
    case 'remove-job': {
      const list = await getHistory();
      const i = list.findIndex((j) => j.id === msg.id);
      if (i >= 0) list.splice(i, 1);
      await persistSoon(true);
      updateBadge();
      return { ok: true };
    }
    case 'clear-history': {
      const list = await getHistory();
      jobsCache = list.filter((j) => ACTIVE.has(j.status));
      await persistSoon(true);
      updateBadge();
      return { ok: true };
    }
    case 'save-file': {
      // Used by the converter page so its saves get the same naming fix.
      const s = await getSettings();
      const downloadId = await saveFile(msg.url, msg.filename, {
        saveAs: !!s.saveAs,
        conflictAction: s.conflictAction === 'overwrite' ? 'overwrite' : 'uniquify',
      });
      return { ok: true, downloadId };
    }
    case 'toggle': {
      const s = await saveSettings({ enabled: msg.enabled });
      return { ok: true, enabled: s.enabled };
    }
    default:
      return { ok: false, error: `Unknown message ${msg.type}` };
  }
}

// ---------------------------------------------------------------------------
// Automatic interception
// ---------------------------------------------------------------------------
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (item.byExtensionId === SELF) {
    const wanted = pendingNames.get(item.url) || pendingNames.get(item.finalUrl);
    if (wanted) suggest(wanted);
    else suggest();
    return false;
  }
  (async () => {
    const s = await getSettings();
    const verdict = shouldIntercept(item, s, SELF);
    if (!verdict.intercept) { suggest(); return; }

    // Stop the browser's own copy before it can be written to disk.
    try { await chrome.downloads.cancel(item.id); } catch { /* already gone */ }
    try { suggest(); } catch { /* the cancelled item no longer needs a name */ }
    chrome.downloads.erase({ id: item.id }).catch(() => {});

    await startJob({
      url: item.finalUrl || item.url,
      suggested: item.filename,
      mime: item.mime,
      referrer: item.referrer,
      source: 'auto',
      reason: verdict.reason,
      hint: verdict.guess,
    });
  })().catch(() => { try { suggest(); } catch { /* ignore */ } });
  return true; // suggest() is called asynchronously
});

// Track our own saves to finish jobs and free the blob memory.
chrome.downloads.onChanged.addListener(async (delta) => {
  if (!delta.state && !delta.error) return;
  const list = await getHistory();
  const job = list.find((j) => j.downloadId === delta.id);
  if (!job) return;
  const state = delta.state?.current;
  if (state === 'complete' || state === 'interrupted') {
    if (job.blobUrl) toOffscreen({ type: 'revoke', blobUrl: job.blobUrl }).catch(() => {});
    if (job.status === 'fallback') return;
    if (state === 'complete') {
      const [item] = await chrome.downloads.search({ id: delta.id });
      await updateJob(job.id, { status: 'done', phase: 'Done', blobUrl: null, savedPath: item?.filename || '' }, true);
      const verb = job.action === 'convert' ? `Converted ${labelOf(job.actual)} → ${labelOf(job.target)}` : 'Saved';
      notify(job, `${verb}: ${job.filename}`);
    } else {
      const reason = delta.error?.current || 'interrupted';
      await updateJob(job.id, { status: reason === 'USER_CANCELED' ? 'cancelled' : 'failed', phase: reason === 'USER_CANCELED' ? 'Cancelled' : 'Failed', error: reason, blobUrl: null }, true);
    }
  }
});

// ---------------------------------------------------------------------------
// Context menus
// ---------------------------------------------------------------------------
const MENU = [
  { id: 'img-png', title: 'Save image as PNG', contexts: ['image'], forced: 'png' },
  { id: 'img-jpeg', title: 'Save image as JPEG', contexts: ['image'], forced: 'jpeg' },
  { id: 'img-webp', title: 'Save image as WebP', contexts: ['image'], forced: 'webp' },
  { id: 'img-bmp', title: 'Save image as BMP', contexts: ['image'], forced: 'bmp' },
  { id: 'media-mp3', title: 'Save audio as MP3', contexts: ['audio', 'video'], forced: 'mp3' },
  { id: 'media-wav', title: 'Save audio as WAV', contexts: ['audio', 'video'], forced: 'wav' },
  { id: 'link-png', title: 'Save linked file as PNG', contexts: ['link'], forced: 'png' },
  { id: 'link-mp3', title: 'Save linked file as MP3', contexts: ['link'], forced: 'mp3' },
  { id: 'sep', type: 'separator', contexts: ['image', 'audio', 'video', 'link'] },
  { id: 'original', title: 'Save original (fix name only)', contexts: ['image', 'audio', 'video', 'link'], forced: null },
];

async function buildContextMenus(settings) {
  await chrome.contextMenus.removeAll();
  if (!settings.contextMenu) return;
  chrome.contextMenus.create({ id: 'root', title: 'Ex-Changer', contexts: ['image', 'audio', 'video', 'link'] });
  for (const m of MENU) {
    chrome.contextMenus.create({ id: m.id, parentId: 'root', title: m.title, contexts: m.contexts, type: m.type || 'normal' });
  }
}

chrome.contextMenus.onClicked.addListener((info) => {
  const m = MENU.find((x) => x.id === info.menuItemId);
  if (!m) return;
  const linkOnly = m.contexts.length === 1 && m.contexts[0] === 'link';
  const url = linkOnly ? info.linkUrl : (info.srcUrl || info.linkUrl);
  if (!url) return;
  startJob({
    url,
    referrer: info.pageUrl,
    forced: m.id === 'original' ? 'keep' : m.forced,
    source: 'menu',
    reason: m.title,
  });
});

// ---------------------------------------------------------------------------
// "Loading": serve Fandom originals while browsing
// ---------------------------------------------------------------------------
async function applyLoadingRules(settings) {
  const removeRuleIds = [1, 2];
  const addRules = !settings.fandomLoadOriginals || !settings.enabled ? [] : [
    {
      // Requests that already ask for the original are left alone, which
      // also stops the redirect below from looping.
      id: 1,
      priority: 2,
      action: { type: 'allow' },
      condition: { urlFilter: '||wikia.nocookie.net/*format=original', resourceTypes: ['main_frame', 'sub_frame', 'image', 'media'] },
    },
    {
      id: 2,
      priority: 1,
      action: {
        type: 'redirect',
        redirect: { transform: { queryTransform: { addOrReplaceParams: [{ key: 'format', value: 'original' }] } } },
      },
      condition: { urlFilter: '||static.wikia.nocookie.net/*/revision/', resourceTypes: ['main_frame', 'sub_frame', 'image', 'media'] },
    },
  ];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules }).catch((e) => console.warn('DNR', e));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
async function init() {
  const s = await getSettings();
  await applyLoadingRules(s);
  await buildContextMenus(s);
  // Jobs that were mid-flight when the browser closed cannot resume.
  const list = await getHistory();
  let changed = false;
  for (const j of list) {
    if (ACTIVE.has(j.status) && Date.now() - (j.updatedAt || 0) > 10 * 60 * 1000) {
      j.status = 'failed'; j.phase = 'Failed'; j.error = 'Interrupted'; changed = true;
    }
  }
  if (changed) await persistSoon(true);
  updateBadge();
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await chrome.storage.sync.set({ settings: DEFAULTS });
    settingsPromise = null;
    chrome.runtime.openOptionsPage();
  }
  init();
});
chrome.runtime.onStartup.addListener(init);
