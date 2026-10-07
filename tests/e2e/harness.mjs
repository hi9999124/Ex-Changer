// Shared E2E harness: a local HTTP server that imitates Fandom's CDN and a
// Chromium instance with the unpacked extension loaded.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const withTimeout = (promise, ms, what) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms)),
]);
const isBackground = (w) => w.url().endsWith('/src/background.js');

/**
 * Find the extension's service worker, waking it if Chrome stopped it for
 * being idle (opening an extension page that messages it starts it again).
 */
async function refreshWorker(env) {
  let sw = env.context.serviceWorkers().find(isBackground);
  if (sw) return sw;
  const waiting = env.context.waitForEvent('serviceworker', { predicate: isBackground, timeout: 15000 });
  const page = await env.context.newPage();
  await page.goto(`chrome-extension://${env.extId}/src/popup/popup.html`).catch(() => {});
  await page.evaluate(() => chrome.runtime.sendMessage({ to: 'ex-changer', type: 'ping' }).catch(() => {})).catch(() => {});
  sw = await waiting;
  await page.close().catch(() => {});
  return sw;
}

/** Evaluate in the service worker with a timeout; reconnects once if the worker went away. */
export async function evalSw(env, fn, arg) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await withTimeout(env.sw.evaluate(fn, arg), 8000, 'service worker evaluate');
    } catch (e) {
      lastError = e;
      env.sw = await refreshWorker(env).catch(() => env.sw);
    }
  }
  throw lastError;
}

export const EXT = path.resolve(new URL('../../extension', import.meta.url).pathname);
const FIX = path.resolve(new URL('../fixtures', import.meta.url).pathname);
const fixture = (n) => fs.readFileSync(path.join(FIX, n));

export function startServer() {
  const log = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    log.push({ path: u.pathname, query: Object.fromEntries(u.searchParams), referer: req.headers.referer || '', host: req.headers.host });
    const send = (type, body, extra = {}) => { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', ...extra }); res.end(body); };
    const p = u.pathname;
    const original = u.searchParams.get('format') === 'original';

    // --- Fandom-like CDN ---------------------------------------------------
    // An uploaded PNG that the CDN serves as WebP unless format=original.
    if (p.startsWith('/wiki/images/a/ab/Character_Art.png/revision/latest')) {
      return original ? send('image/png', fixture('img.png')) : send('image/webp', fixture('img.webp'));
    }
    // An upload that really is WebP.
    if (p.startsWith('/wiki/images/c/cd/Sticker.webp/revision/latest')) return send('image/webp', fixture('img.webp'));
    if (p.startsWith('/wiki/images/e/ef/Main_Theme.ogg/revision/latest')) return send('audio/ogg', fixture('tone.ogg'));
    if (p.startsWith('/wiki/images/1/12/Battle_Song.mp3/revision/latest')) return send('audio/mpeg', fixture('tone.mp3'));

    // --- generic sites -------------------------------------------------------
    if (p === '/files/latest.mpeg') return send('audio/mpeg', fixture('tone-as.mpeg'));
    // Same, but the server insists on the ".mpeg" name (as some CDNs do).
    if (p === '/files/named/sound') return send('audio/mpeg', fixture('tone-as.mpeg'), { 'content-disposition': 'attachment; filename="Fanfare.mpeg"' });
    if (p === '/files/clip.mpeg') return send('video/mpeg', fixture('clip.mpeg'));
    if (p === '/files/photo.webp') return send('image/webp', fixture('img.webp'));
    if (p === '/files/photo.png') return send('image/png', fixture('img.png'));
    // RIFF/WEBP container whose image chunk is garbage: sniffs as WebP, cannot be decoded.
    if (p === '/files/broken.webp') return send('image/webp', Buffer.concat([Buffer.from('RIFF\xde\x00\x00\x00WEBPVP8 \xd2\x00\x00\x00', 'latin1'), Buffer.alloc(210, 7)]));
    if (p === '/files/voice.opus') return send('audio/ogg', fixture('tone.opus'));
    if (p === '/page.html') {
      return send('text/html', `<!doctype html><title>t</title><body>
        <img id="thumb" src="http://static.wikia.nocookie.net/wiki/images/a/ab/Character_Art.png/revision/latest/scale-to-width-down/200?cb=1">
        </body>`);
    }
    res.writeHead(404); res.end('nope');
    return undefined;
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, log })));
}

export async function launch(port) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exc-profile-'));
  const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'exc-dl-'));
  fs.mkdirSync(path.join(userDataDir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'Default', 'Preferences'), JSON.stringify({
    download: { default_directory: downloads, prompt_for_download: false, directory_upgrade: true },
    savefile: { default_directory: downloads },
  }));

  // Chromium is started directly and attached over CDP. Playwright's own
  // download handling (and any DevTools download override) bypasses the
  // chrome.downloads filename hooks this extension relies on.
  const proc = spawn(chromium.executablePath(), [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-field-trial-config',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-dev-shm-usage',
    '--disable-features=HttpsUpgrades,Translate,MediaRouter,DialMediaRouteProvider,LensOverlay',
    '--password-store=basic',
    '--use-mock-keychain',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    `--host-resolver-rules=MAP static.wikia.nocookie.net 127.0.0.1:${port}, MAP files.example.test 127.0.0.1:${port}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsEndpoint = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`Chromium did not start: ${buf}`)), 20000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on('exit', (code) => reject(new Error(`Chromium exited (${code}): ${buf}`)));
  });
  const browser = await chromium.connectOverCDP(wsEndpoint);
  const context = browser.contexts()[0];
  // Undo Playwright's download override so Chrome (and the extension) name files.
  const cdp = await browser.newBrowserCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' });

  let sw = context.serviceWorkers().find(isBackground);
  if (!sw) sw = await context.waitForEvent('serviceworker', { predicate: isBackground, timeout: 20000 });
  const env = { browser, context, sw, extId: new URL(sw.url()).host, downloads, userDataDir };
  // Extension API bindings appear a moment after the worker starts, and
  // onInstalled then writes the default settings.
  for (let i = 0; i < 50; i++) {
    if (await evalSw(env, async () => !!(self.chrome?.downloads && (await chrome.storage.sync.get('settings')).settings)).catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const page = context.pages().find((p) => p.url() === 'about:blank') || await context.newPage();

  const close = async () => {
    await browser.close().catch(() => {});
    proc.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 300));
    try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5 }); } catch { /* best effort */ }
  };
  return Object.assign(env, { page, close });
}

/** Patch settings from inside the extension and wait for the SW to see them. */
export async function setSettings(env, patch) {
  await evalSw(env, async (p) => {
    const { settings } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: { ...settings, ...p, rules: { ...(settings?.rules || {}), ...(p.rules || {}) } } });
  }, patch);
  await new Promise((r) => setTimeout(r, 150));
}

/**
 * Trigger a normal (non-extension) browser download, like "Save link as…".
 * The page is opened on the file's own origin so the download attribute is
 * honoured.
 */
export async function browserDownload(page, url) {
  const origin = new URL(url).origin;
  if (!page.url().startsWith(origin)) await page.goto(`${origin}/page.html`);
  await page.evaluate((href) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = '';
    document.body.append(a);
    a.click();
    a.remove();
  }, url);
}

export const getHistory = (env) => evalSw(env, async () => (await chrome.storage.local.get('history')).history || []);

export async function waitForJob(env, predicate, timeout = 30000) {
  const start = Date.now();
  let job = null;
  for (;;) {
    job = (await getHistory(env).catch(() => [])).find(predicate) || null;
    if (job && ['done', 'failed', 'fallback', 'cancelled'].includes(job.status)) return job;
    if (Date.now() - start > timeout) throw new Error(`Timed out; last state: ${JSON.stringify(job)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

export async function waitForFile(dir, name, timeout = 15000) {
  const start = Date.now();
  const full = path.join(dir, name);
  for (;;) {
    if (fs.existsSync(full) && !fs.existsSync(`${full}.crdownload`) && fs.statSync(full).size > 0) {
      await new Promise((r) => setTimeout(r, 150));
      return full;
    }
    if (Date.now() - start > timeout) throw new Error(`File ${name} not found in ${dir}: ${fs.readdirSync(dir).join(', ')}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}
