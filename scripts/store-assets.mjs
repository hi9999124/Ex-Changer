// Renders store listing images into docs/store/: 1280x800 screenshots,
// promo tiles and logos. Real conversions run first so the UI has content.
import fs from 'node:fs';
import path from 'node:path';
import { startServer, launch, browserDownload, waitForJob } from '../tests/e2e/harness.mjs';

const OUT = new URL('../docs/store/', import.meta.url).pathname;
const root = new URL('../', import.meta.url).pathname;
const logoSvg = /export const LOGO = `([\s\S]*?)`;/.exec(fs.readFileSync(path.join(root, 'extension/src/ui/icons.js'), 'utf8'))[1]
  .replace('<svg viewBox="0 0 64 64" aria-hidden="true">', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%">');
const dataUrl = (file) => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;

const BG = `background:#1b1b1a;background-image:radial-gradient(circle at 85% 10%,rgba(44,132,219,.35),transparent 45%),radial-gradient(circle at 10% 95%,rgba(233,224,208,.12),transparent 45%);`;
const FONT = "font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#ecebe6;overflow:hidden;";
const chip = (a, b) => `<span style="display:inline-flex;gap:8px;align-items:center;padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);font:600 SIZEpx ui-monospace,Menlo,monospace;color:#a8a7a1">${a}<span style="color:#4c9bea">→</span>${b}</span>`;

const srv = await startServer();
const env = await launch(srv.port);
try {
  const FANDOM = 'http://static.wikia.nocookie.net/wiki/images';
  for (const u of [
    `${FANDOM}/e/ef/Main_Theme.ogg/revision/latest?cb=1`,
    `${FANDOM}/a/ab/Character_Art.png/revision/latest/scale-to-width-down/200?cb=1`,
    'http://files.example.test/files/named/sound',
    'http://files.example.test/files/clip.mpeg',
    `${FANDOM}/c/cd/Sticker.webp/revision/latest?cb=1`,
  ]) {
    await browserDownload(env.page, u);
    await waitForJob(env.sw, (j) => j.url === u);
  }

  const page = await env.context.newPage();
  const ext = (p) => `chrome-extension://${env.extId}/${p}`;

  async function capture(url, file, { w = 1280, h = 800, before } = {}) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(url);
    if (before) await before(page);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, file) });
    console.log('wrote', file);
  }

  // Popup, framed on a branded 1280x800 canvas with a caption.
  const tmpPopup = path.join(OUT, '.popup.png');
  await capture(ext('src/popup/popup.html'), '.popup.png', { w: 380, h: 580, before: async (p) => { await p.mouse.move(300, 120); } });
  const framed = (caption, sub, img) => `<!doctype html><body style="margin:0;width:1280px;height:800px;${BG}${FONT}display:grid;grid-template-columns:1fr 420px;align-items:center;gap:40px;padding:0 90px;box-sizing:border-box">
    <div><div style="width:84px;height:84px;margin-bottom:28px">${logoSvg}</div>
      <h1 style="margin:0 0 16px;font-size:46px;line-height:1.1;letter-spacing:-.02em">${caption}</h1>
      <p style="margin:0;font-size:21px;line-height:1.5;color:#a8a7a1;max-width:560px">${sub}</p></div>
    <img src="${img}" style="width:380px;border-radius:16px;border:1px solid rgba(255,255,255,.1);box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 60px rgba(44,132,219,.18)"></body>`;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(framed('Downloads, converted<br>as they happen.', 'WebP → PNG, OGG / Opus / MPEG → MP3. Real conversion, not a renamed extension. Everything runs locally in your browser.', dataUrl(tmpPopup)));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'screenshot-1.png') });
  console.log('wrote screenshot-1.png');
  fs.rmSync(tmpPopup);

  await capture(ext('src/options/options.html#fandom'), 'screenshot-2.png');
  await capture(ext('src/options/options.html#rules'), 'screenshot-3.png', { before: async (p) => { await p.mouse.move(700, 420); } });
  await capture(ext('src/options/options.html#converter'), 'screenshot-4.png', {
    before: async (p) => {
      await p.setInputFiles('.drop input[type=file]', ['img.webp', 'tone.ogg', 'clip.mpeg'].map((f) => path.join(root, 'tests/fixtures', f)));
      await p.waitForSelector('.file [data-act="save"]');
      await p.waitForTimeout(1500);
    },
  });
  await capture(ext('src/options/options.html#activity'), 'screenshot-5.png');

  // Promo tiles and logos.
  const tile = (w, h, big) => `<!doctype html><body style="margin:0;width:${w}px;height:${h}px;overflow:hidden;${BG}${FONT}display:flex;align-items:center;gap:${big ? 48 : 22}px;padding:0 ${big ? 110 : 34}px;box-sizing:border-box">
    <div style="flex:none;width:${big ? 200 : 104}px;height:${big ? 200 : 104}px;border-radius:${big ? 44 : 24}px;background:radial-gradient(circle at 30% 20%,#2a2a29,#161615);border:1px solid rgba(233,224,208,.14);display:grid;place-items:center;box-shadow:0 20px 50px rgba(0,0,0,.5)"><div style="width:80%;height:80%">${logoSvg}</div></div>
    <div><div style="font-size:${big ? 64 : 34}px;font-weight:700;letter-spacing:-.02em">Ex-Changer</div>
      <div style="margin:${big ? 10 : 4}px 0 ${big ? 26 : 14}px;font-size:${big ? 26 : 15}px;color:#a8a7a1">${big ? 'Converts your downloads as they happen' : 'Download converter'}</div>
      <div style="display:flex;flex-wrap:wrap;gap:${big ? 12 : 6}px">${[chip('WEBP', 'PNG'), chip('OGG', 'MP3'), chip('MPEG', 'MP3')].slice(0, big ? 3 : 2).join('').replaceAll('SIZE', big ? '20' : '12')}</div></div></body>`;
  for (const [file, w, h, big] of [['promo-small-440x280.png', 440, 280, false], ['promo-marquee-1400x560.png', 1400, 560, true]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(tile(w, h, big));
    await page.screenshot({ path: path.join(OUT, file) });
    console.log('wrote', file);
  }
  await page.setViewportSize({ width: 300, height: 300 });
  await page.setContent(`<!doctype html><body style="margin:0;width:300px;height:300px;background:radial-gradient(circle at 30% 20%,#2a2a29,#161615);display:grid;place-items:center"><div style="width:250px;height:250px">${logoSvg}</div></body>`);
  await page.screenshot({ path: path.join(OUT, 'logo-300.png') });
  console.log('wrote logo-300.png');
  fs.copyFileSync(path.join(root, 'extension/icons/icon-128.png'), path.join(OUT, 'icon-128.png'));
} finally {
  await env.close();
  srv.server.close();
}
