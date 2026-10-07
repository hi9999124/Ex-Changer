// Renders the toolbar/store icons from the logo SVG with headless Chromium.
import { chromium } from 'playwright';
import fs from 'node:fs';

const root = new URL('../extension/', import.meta.url);
const src = fs.readFileSync(new URL('src/ui/icons.js', root), 'utf8');
const logo = /export const LOGO = `([\s\S]*?)`;/.exec(src)[1]
  .replace('<svg viewBox="0 0 64 64" aria-hidden="true">', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">');

// Small sizes get a tighter crop and a dark rounded tile so the glyph reads
// on both light and dark toolbars.
const tile = (size) => `<!doctype html><html><body style="margin:0;background:transparent">
  <div style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.22)}px;background:radial-gradient(circle at 30% 20%,#2a2a29,#161615);display:grid;place-items:center;overflow:hidden">
    <div style="width:${Math.round(size * 0.86)}px;height:${Math.round(size * 0.86)}px">${logo.replace('<svg ', '<svg width="100%" height="100%" ')}</div>
  </div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(tile(size));
  const out = new URL(`icons/icon-${size}.png`, root);
  await page.screenshot({ path: out.pathname, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', out.pathname);
}
await browser.close();
