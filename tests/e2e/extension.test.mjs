// End-to-end: real Chromium + the unpacked extension + a fake Fandom CDN.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  startServer, launch, setSettings, browserDownload, waitForJob, waitForFile, getHistory,
} from './harness.mjs';

const FIX = path.resolve(new URL('../fixtures', import.meta.url).pathname);
const FANDOM = 'http://static.wikia.nocookie.net/wiki/images';
const SITE = 'http://files.example.test';

let srv;
let env;

before(async () => {
  srv = await startServer();
  env = await launch(srv.port);
});
after(async () => {
  await env?.close();
  srv?.server.close();
});

const magic = (file) => fs.readFileSync(file).subarray(0, 12);
const isPng = (f) => magic(f).subarray(1, 4).toString() === 'PNG';
const isJpeg = (f) => magic(f)[0] === 0xff && magic(f)[1] === 0xd8;
function probe(file) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,channels,sample_rate,width,height:format=duration', '-of', 'json', file]);
    return JSON.parse(out);
  } catch { return null; }
}

test('Fandom: PNG upload served as WebP is saved as the original PNG with its real name', async () => {
  await browserDownload(env.page, `${FANDOM}/a/ab/Character_Art.png/revision/latest/scale-to-width-down/200?cb=1`);
  const job = await waitForJob(env.sw, (j) => j.url.includes('Character_Art'));
  assert.equal(job.status, 'done', job.error);
  assert.notEqual(job.suggested, 'Character_Art.png', 'the browser alone would not get the name right');
  assert.equal(job.action, 'rename', 'original PNG is used as-is, not re-encoded');
  const file = await waitForFile(env.downloads, 'Character_Art.png');
  assert.deepEqual(fs.readFileSync(file), fs.readFileSync(path.join(FIX, 'img.png')));
  const fetched = srv.log.filter((l) => l.path.includes('Character_Art'));
  const refetch = fetched.find((l) => l.query.format === 'original' && !l.path.includes('scale-to-width'));
  assert.ok(refetch, 'full-size original was requested');
  assert.match(refetch.referer, /page\.html$/, 'the original referrer is forwarded');
});

test('Fandom: real WebP upload is converted to PNG', async () => {
  await browserDownload(env.page, `${FANDOM}/c/cd/Sticker.webp/revision/latest?cb=2`);
  const job = await waitForJob(env.sw, (j) => j.url.includes('Sticker.webp'));
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.action, 'convert');
  const file = await waitForFile(env.downloads, 'Sticker.png');
  assert.ok(isPng(file));
  const p = probe(file);
  if (p) assert.deepEqual([p.streams[0].width, p.streams[0].height], [64, 48]);
});

test('Fandom: OGG Vorbis is decoded and re-encoded to a real MP3', async () => {
  await browserDownload(env.page, `${FANDOM}/e/ef/Main_Theme.ogg/revision/latest?cb=3`);
  const job = await waitForJob(env.sw, (j) => j.url.includes('Main_Theme'));
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.actual, 'ogg');
  assert.equal(job.target, 'mp3');
  const file = await waitForFile(env.downloads, 'Main_Theme.mp3');
  const p = probe(file);
  if (p) {
    assert.equal(p.streams[0].codec_name, 'mp3');
    assert.equal(p.streams[0].channels, 2);
    assert.ok(Math.abs(Number(p.format.duration) - 2) < 0.2, `duration ${p.format.duration}`);
  }
});

test('Fandom: MP3 is kept byte-for-byte, only the name is fixed', async () => {
  await browserDownload(env.page, `${FANDOM}/1/12/Battle_Song.mp3/revision/latest?cb=4`);
  const job = await waitForJob(env.sw, (j) => j.url.includes('Battle_Song'));
  assert.equal(job.status, 'done', job.error);
  const file = await waitForFile(env.downloads, 'Battle_Song.mp3');
  assert.deepEqual(fs.readFileSync(file), fs.readFileSync(path.join(FIX, 'tone.mp3')));
});

test('"latest.mpeg" served as audio/mpeg ends up as a playable .mp3', async () => {
  await browserDownload(env.page, `${SITE}/files/latest.mpeg`);
  const file = await waitForFile(env.downloads, 'latest.mp3');
  assert.deepEqual(fs.readFileSync(file), fs.readFileSync(path.join(FIX, 'tone-as.mpeg')));
});

test('a ".mpeg" name forced by the server is corrected to .mp3 without re-encoding', async () => {
  await browserDownload(env.page, `${SITE}/files/named/sound`);
  const job = await waitForJob(env.sw, (j) => j.url.endsWith('/files/named/sound'));
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.suggested.split('/').pop(), 'Fanfare.mpeg');
  assert.equal(job.actual, 'mp3');
  assert.equal(job.action, 'rename');
  const file = await waitForFile(env.downloads, 'Fanfare.mp3');
  assert.deepEqual(fs.readFileSync(file), fs.readFileSync(path.join(FIX, 'tone-as.mpeg')));
});

test('MPEG-1 video: MP2 audio track is extracted, decoded and encoded to MP3', async () => {
  await browserDownload(env.page, `${SITE}/files/clip.mpeg`);
  const job = await waitForJob(env.sw, (j) => j.url.endsWith('/files/clip.mpeg'));
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.actual, 'mpeg');
  const file = await waitForFile(env.downloads, 'clip.mp3');
  const p = probe(file);
  if (p) {
    assert.equal(p.streams[0].codec_name, 'mp3');
    assert.ok(Math.abs(Number(p.format.duration) - 2) < 0.25, `duration ${p.format.duration}`);
  }
});

test('Opus is converted to MP3', async () => {
  await browserDownload(env.page, `${SITE}/files/voice.opus`);
  const job = await waitForJob(env.sw, (j) => j.url.endsWith('/files/voice.opus'));
  assert.equal(job.status, 'done', job.error);
  const file = await waitForFile(env.downloads, 'voice.mp3');
  const p = probe(file);
  if (p) assert.equal(p.streams[0].codec_name, 'mp3');
});

test('a PNG with no rule is left alone (browser saves it normally)', async () => {
  await browserDownload(env.page, `${SITE}/files/photo.png`);
  const file = await waitForFile(env.downloads, 'photo.png');
  assert.deepEqual(fs.readFileSync(file), fs.readFileSync(path.join(FIX, 'img.png')));
  const jobs = await getHistory(env.sw);
  assert.ok(!jobs.some((j) => j.url.endsWith('/files/photo.png')), 'no job created');
});

test('a corrupt WebP falls back to saving the original file', async () => {
  await browserDownload(env.page, `${SITE}/files/broken.webp`);
  const job = await waitForJob(env.sw, (j) => j.url.endsWith('/files/broken.webp'));
  assert.equal(job.status, 'fallback');
  assert.match(job.error, /decode/i);
  const file = await waitForFile(env.downloads, 'broken.webp');
  assert.equal(fs.statSync(file).size, 230);
});

test('paused: downloads pass through untouched', async () => {
  await setSettings(env.sw, { enabled: false });
  try {
    await browserDownload(env.page, `${SITE}/files/photo.webp`);
    const file = await waitForFile(env.downloads, 'photo.webp');
    assert.deepEqual(fs.readFileSync(file), fs.readFileSync(path.join(FIX, 'img.webp')));
  } finally {
    await setSettings(env.sw, { enabled: true });
  }
});

test('convert-from-link with an explicit target (JPEG), as the context menu does', async () => {
  const page = await env.context.newPage();
  await page.goto(`chrome-extension://${env.extId}/src/options/options.html#converter`);
  await page.fill('#conv-url', `${SITE}/files/photo.webp?for=jpeg`);
  await page.selectOption('#conv-target', 'jpeg');
  await page.click('#conv-url-go');
  const job = await waitForJob(env.sw, (j) => j.url.endsWith('for=jpeg'));
  assert.equal(job.status, 'done', job.error);
  const file = await waitForFile(env.downloads, 'photo.jpg');
  assert.ok(isJpeg(file));
  await page.close();
});

test('converter page: local file drop → convert → save', async () => {
  const page = await env.context.newPage();
  await page.goto(`chrome-extension://${env.extId}/src/options/options.html#converter`);
  await page.selectOption('#conv-target', 'png');
  await page.setInputFiles('.drop input[type=file]', path.join(FIX, 'img.avif'));
  await page.waitForSelector('.file [data-act="save"]', { timeout: 15000 });
  assert.match(await page.textContent('.file .name'), /img\.png/);
  await page.click('.file [data-act="save"]');
  const file = await waitForFile(env.downloads, 'img.png');
  assert.ok(isPng(file));
  await page.close();
});

test('loading: Fandom images load as originals while browsing when enabled', async () => {
  await setSettings(env.sw, { fandomLoadOriginals: true });
  try {
    const before = srv.log.length;
    const page = await env.context.newPage();
    await page.goto(`${SITE}/page.html?load=1`);
    await page.waitForFunction(() => document.getElementById('thumb').complete);
    const hits = srv.log.slice(before).filter((l) => l.path.includes('Character_Art'));
    assert.ok(hits.length, 'image requested');
    assert.ok(hits.every((l) => l.query.format === 'original'), JSON.stringify(hits));
    // the thumbnail itself still loads at its scaled size
    assert.ok(hits.some((l) => l.path.includes('scale-to-width-down')));
    await page.close();
  } finally {
    await setSettings(env.sw, { fandomLoadOriginals: false });
  }
});

test('the extension pages render without errors', async () => {
  for (const url of ['src/popup/popup.html', 'src/options/options.html#rules', 'src/options/options.html#sites', 'src/options/options.html#activity', 'src/options/options.html#about']) {
    const page = await env.context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`chrome-extension://${env.extId}/${url}`);
    await page.waitForTimeout(400);
    assert.deepEqual(errors, [], url);
    await page.close();
  }
});
