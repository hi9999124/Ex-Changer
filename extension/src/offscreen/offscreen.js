// Offscreen document: fetches the file, converts it and hands a blob: URL
// back to the service worker, which saves it with chrome.downloads.
// (Service workers have no DOM, canvas, Web Audio or URL.createObjectURL.)

import { convertBlob } from '../lib/convert/index.js';

const MAX_PARALLEL = 2;
const queue = [];
let running = 0;
const live = new Map(); // blobUrl -> created timestamp

function send(msg) {
  chrome.runtime.sendMessage({ to: 'background', ...msg }).catch(() => {});
}

async function fetchWithProgress(job, report) {
  const res = await fetch(job.fetchUrl, { credentials: 'include', cache: 'force-cache' });
  if (!res.ok) throw new Error(`Server answered ${res.status} ${res.statusText || ''}`.trim());
  const total = Number(res.headers.get('content-length')) || 0;
  if (job.maxBytes && total > job.maxBytes) throw new Error(`File is larger than the ${Math.round(job.maxBytes / 1048576)} MB limit`);
  if (!res.body) return res.blob();
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  let last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (job.maxBytes && got > job.maxBytes) {
      reader.cancel();
      throw new Error(`File is larger than the ${Math.round(job.maxBytes / 1048576)} MB limit`);
    }
    const now = Date.now();
    if (now - last > 150) {
      last = now;
      report('Downloading', total ? got / total : 0, got);
    }
  }
  return new Blob(chunks, { type: res.headers.get('content-type') || '' });
}

async function run(job) {
  const report = (phase, value, bytes) => send({ type: 'progress', id: job.id, phase, value, bytes });
  try {
    report('Downloading', 0);
    const src = await fetchWithProgress(job, report);
    report('Analysing', 0);
    const out = await convertBlob(src, {
      settings: job.settings,
      forced: job.forced,
      originalExt: job.originalExt,
      hint: job.hint,
      onProgress: (phase, value) => report(phase, value),
    });
    const blobUrl = URL.createObjectURL(out.blob);
    live.set(blobUrl, Date.now());
    send({
      type: 'result', id: job.id, ok: true, blobUrl,
      actual: out.actual, target: out.target, action: out.action, ext: out.ext,
      sizeIn: src.size, sizeOut: out.blob.size, detail: out.detail || '',
    });
  } catch (e) {
    send({ type: 'result', id: job.id, ok: false, error: e?.message || String(e) });
  }
}

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const job = queue.shift();
    running++;
    run(job).finally(() => { running--; pump(); });
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.to !== 'offscreen') return;
  if (msg.type === 'run') {
    queue.push(msg.job);
    pump();
    sendResponse({ queued: true });
  } else if (msg.type === 'revoke') {
    if (live.has(msg.blobUrl)) {
      URL.revokeObjectURL(msg.blobUrl);
      live.delete(msg.blobUrl);
    }
    sendResponse({ ok: true });
  } else if (msg.type === 'ping') {
    sendResponse({ ok: true, running, queued: queue.length, live: live.size });
  }
});

// Safety net: blob URLs that were never revoked (e.g. the service worker was
// restarted mid-save) are released after 30 minutes.
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [url, t] of live) {
    if (t < cutoff) { URL.revokeObjectURL(url); live.delete(url); }
  }
}, 60 * 1000);

send({ type: 'offscreen-ready' });
