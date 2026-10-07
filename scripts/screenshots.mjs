// Captures the popup and settings pages (used for docs and visual review).
// Runs a few real conversions first so the activity lists have content.
import path from 'node:path';
import { startServer, launch, browserDownload, waitForJob } from '../tests/e2e/harness.mjs';

const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
const srv = await startServer();
const env = await launch(srv.port);
try {
  const FANDOM = 'http://static.wikia.nocookie.net/wiki/images';
  for (const u of [
    `${FANDOM}/e/ef/Main_Theme.ogg/revision/latest?cb=1`,
    `${FANDOM}/a/ab/Character_Art.png/revision/latest?cb=1`,
    'http://files.example.test/files/named/sound',
    'http://files.example.test/files/clip.mpeg',
    `${FANDOM}/c/cd/Sticker.webp/revision/latest?cb=1`,
  ]) {
    await browserDownload(env.page, u);
    await waitForJob(env, (j) => j.url === u);
  }

  const shot = async (url, file, { width = 1280, height = 860, before } = {}) => {
    const page = await env.context.newPage();
    await page.setViewportSize({ width, height });
    await page.goto(`chrome-extension://${env.extId}/${url}`);
    if (before) await before(page);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, file) });
    await page.close();
    console.log('wrote', file);
  };
  const hover = (x, y) => async (p) => { await p.mouse.move(x, y); await p.waitForTimeout(300); await p.mouse.move(x + 4, y + 2); };

  await shot('src/popup/popup.html', 'popup.png', { width: 380, height: 580, before: hover(300, 120) });
  await shot('src/options/options.html#general', 'settings-general.png', { before: hover(900, 300) });
  await shot('src/options/options.html#rules', 'settings-rules.png', { before: hover(700, 420) });
  await shot('src/options/options.html#fandom', 'settings-fandom.png');
  await shot('src/options/options.html#sites', 'settings-sites.png');
  await shot('src/options/options.html#converter', 'converter.png', {
    before: async (p) => {
      await p.setInputFiles('.drop input[type=file]', [
        path.resolve('tests/fixtures/img.webp'), path.resolve('tests/fixtures/tone.ogg'), path.resolve('tests/fixtures/clip.mpeg'),
      ]);
      await p.waitForSelector('.file [data-act="save"]');
      await p.waitForTimeout(1500);
      await hover(640, 260)(p);
    },
  });
  await shot('src/options/options.html#activity', 'activity.png');
  await shot('src/options/options.html#general', 'search.png', { before: async (p) => { await p.fill('#search', 'mp3'); } });
} finally {
  await env.close();
  srv.server.close();
}
