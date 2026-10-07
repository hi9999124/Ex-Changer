import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sniff, formatFromExt, formatFromMime } from '../../extension/src/lib/formats.js';
import {
  fandomFileName, fandomOriginalUrl, isFandomMediaUrl, bestStem, buildFilename, sanitize, hostMatches,
} from '../../extension/src/lib/filename.js';
import { shouldIntercept, resolveOutput, inScope } from '../../extension/src/lib/rules.js';
import { DEFAULTS, mergeSettings } from '../../extension/src/lib/settings.js';

const F = new URL('../fixtures/', import.meta.url);
const head = (name) => new Uint8Array(fs.readFileSync(new URL(name, F))).subarray(0, 4096);
const S = (patch = {}) => mergeSettings({ ...DEFAULTS, ...patch });
const SELF = 'self-id';

const FANDOM_IMG = 'https://static.wikia.nocookie.net/minecraft_gamepedia/images/1/17/Grass_Block_JE7_BE6.png/revision/latest/scale-to-width-down/250?cb=20200830204445';
const FANDOM_OGG = 'https://static.wikia.nocookie.net/undertale/images/5/5d/Megalovania.ogg/revision/latest?cb=20160101000000&path-prefix=ru';

test('sniff identifies every fixture by content', () => {
  const expect = {
    'img.png': 'png', 'img.webp': 'webp', 'img.gif': 'gif', 'img.bmp': 'bmp', 'img.avif': 'avif',
    'tone.mp3': 'mp3', 'tone-as.mpeg': 'mp3', 'tone.mp2': 'mp2', 'tone.ogg': 'ogg', 'tone.opus': 'opus',
    'tone.flac': 'flac', 'tone.aac': 'aac', 'clip.mpeg': 'mpeg', 'clip-mp3audio.mpg': 'mpeg',
    'clip.ts': 'ts', 'clip.webm': 'webm', 'clip.mp4': 'mp4',
  };
  for (const [file, fmt] of Object.entries(expect)) assert.equal(sniff(head(file)), fmt, file);
});

test('sniff handles SVG text, JPEG and junk', () => {
  const enc = (s) => new TextEncoder().encode(s);
  assert.equal(sniff(enc('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg');
  assert.equal(sniff(enc('  <svg viewBox="0 0 1 1"/>')), 'svg');
  assert.equal(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])), 'jpeg');
  assert.equal(sniff(enc('<!doctype html><html>')), null);
  assert.equal(sniff(new Uint8Array([1, 2])), null);
});

test('extension and MIME lookups', () => {
  assert.equal(formatFromExt('latest.mpeg'), 'mpeg');
  assert.equal(formatFromExt('a/b/song.MP3?x=1'), 'mp3');
  assert.equal(formatFromExt('noext'), null);
  assert.equal(formatFromMime('audio/mpeg'), 'mp3');
  assert.equal(formatFromMime('image/webp; charset=binary'), 'webp');
});

test('Fandom CDN URLs: real name, original format, full size', () => {
  assert.ok(isFandomMediaUrl(FANDOM_IMG));
  assert.ok(!isFandomMediaUrl('https://minecraft.fandom.com/wiki/Grass_Block'));
  assert.equal(fandomFileName(FANDOM_IMG), 'Grass_Block_JE7_BE6.png');
  assert.equal(fandomFileName(FANDOM_OGG), 'Megalovania.ogg');
  const orig = new URL(fandomOriginalUrl(FANDOM_IMG));
  assert.equal(orig.pathname, '/minecraft_gamepedia/images/1/17/Grass_Block_JE7_BE6.png/revision/latest');
  assert.equal(orig.searchParams.get('format'), 'original');
  assert.equal(orig.searchParams.get('cb'), '20200830204445');
  const thumb = new URL(fandomOriginalUrl(FANDOM_IMG, { fullSize: false }));
  assert.match(thumb.pathname, /scale-to-width-down\/250$/);
  const ogg = new URL(fandomOriginalUrl(FANDOM_OGG));
  assert.equal(ogg.searchParams.get('path-prefix'), 'ru');
  assert.equal(fandomFileName('https://static.wikia.nocookie.net/w/images/a/ab/Caf%C3%A9_Theme.ogg/revision/latest'), 'Café_Theme.ogg');
});

test('best name: Fandom beats "latest", Content-Disposition names are kept', () => {
  assert.equal(bestStem({ suggested: 'latest.webp', url: FANDOM_IMG }), 'Grass_Block_JE7_BE6');
  assert.equal(bestStem({ suggested: 'latest.webp', url: FANDOM_IMG, fandom: false }), 'latest');
  assert.equal(bestStem({ suggested: 'Holiday photo.webp', url: 'https://x.com/dl?id=4' }), 'Holiday photo');
  assert.equal(bestStem({ suggested: 'download.webp', url: 'https://cdn.x.com/pics/cat.webp' }), 'cat');
  assert.equal(bestStem({ suggested: '', url: 'data:image/webp;base64,AAAA' }), 'download');
});

test('file names are sanitised and placed in the subfolder', () => {
  assert.equal(buildFilename('Main_Theme', 'mp3'), 'Main_Theme.mp3');
  assert.equal(buildFilename('Main_Theme', 'mp3', { underscoresToSpaces: true }), 'Main Theme.mp3');
  assert.equal(buildFilename('a:b*c?', 'jpeg', { subfolder: '../Ex-Changer//Wiki/' }), 'Ex-Changer/Wiki/a_b_c_.jpg');
  assert.equal(sanitize('CON'), '_CON');
  assert.equal(sanitize('  ..dots..  '), 'dots');
});

test('host patterns', () => {
  assert.ok(hostMatches('minecraft.fandom.com', '*.fandom.com'));
  assert.ok(hostMatches('fandom.com', '*.fandom.com'));
  assert.ok(hostMatches('static.wikia.nocookie.net', 'https://wikia.nocookie.net/'));
  assert.ok(!hostMatches('notfandom.com', 'fandom.com'));
});

test('scope: all / fandom / list / excluded', () => {
  const u = ['https://example.com/a.webp'];
  assert.ok(inScope(S(), u));
  assert.ok(!inScope(S({ scope: 'fandom' }), u));
  assert.ok(inScope(S({ scope: 'fandom' }), [FANDOM_IMG]));
  assert.ok(inScope(S({ scope: 'fandom' }), ['https://cdn.x.com/a.webp', 'https://minecraft.fandom.com/wiki/A']), 'referrer counts');
  assert.ok(inScope(S({ scope: 'list', siteList: ['example.com'] }), u));
  assert.ok(!inScope(S({ excludeList: ['example.com'] }), u));
});

const item = (p) => ({ id: 1, url: 'https://example.com/x', filename: '', mime: '', fileSize: 1000, ...p });

test('interception decisions', () => {
  const s = S();
  assert.equal(shouldIntercept(item({ filename: 'pic.webp', mime: 'image/webp' }), s, SELF).intercept, true);
  assert.equal(shouldIntercept(item({ filename: 'song.ogg', mime: 'audio/ogg' }), s, SELF).intercept, true);
  assert.equal(shouldIntercept(item({ filename: 'photo.jpg', mime: 'image/jpeg' }), s, SELF).intercept, false);
  assert.equal(shouldIntercept(item({ filename: 'setup.exe', mime: 'application/octet-stream' }), s, SELF).intercept, false);
  // "latest.mpeg" with audio/mpeg: the MPEG rule catches it, sniffing will find MP3
  assert.equal(shouldIntercept(item({ filename: 'latest.mpeg', mime: 'audio/mpeg' }), s, SELF).intercept, true);
  // "photo.png" served as WebP
  assert.equal(shouldIntercept(item({ filename: 'photo.png', mime: 'image/webp' }), s, SELF).intercept, true);
  // Fandom media always (for name + original format)
  assert.equal(shouldIntercept(item({ url: FANDOM_IMG, filename: 'latest.png', mime: 'image/png' }), s, SELF).intercept, true);
  // own downloads, paused, blob:, too big
  assert.equal(shouldIntercept(item({ filename: 'a.webp', byExtensionId: SELF }), s, SELF).intercept, false);
  assert.equal(shouldIntercept(item({ filename: 'a.webp' }), S({ enabled: false }), SELF).intercept, false);
  assert.equal(shouldIntercept(item({ url: 'blob:https://x.com/1', filename: 'a.webp' }), s, SELF).intercept, false);
  assert.equal(shouldIntercept(item({ filename: 'a.webp', fileSize: 600 * 1048576 }), s, SELF).intercept, false);
  // data: URLs are fine
  assert.equal(shouldIntercept(item({ url: 'data:image/webp;base64,AA', filename: 'download.webp', mime: 'image/webp' }), s, SELF).intercept, true);
});

test('output resolution', () => {
  const s = S();
  assert.deepEqual(resolveOutput('webp', s, null, 'webp'), { action: 'convert', target: 'png', ext: 'png' });
  assert.deepEqual(resolveOutput('mp3', s, null, 'mpeg'), { action: 'rename', target: 'mp3', ext: 'mp3' });
  assert.deepEqual(resolveOutput('mp3', s, null, 'mp3'), { action: 'keep', target: 'mp3', ext: 'mp3' });
  assert.deepEqual(resolveOutput('png', s, null, 'webp'), { action: 'rename', target: 'png', ext: 'png' });
  assert.deepEqual(resolveOutput('mpeg', s, null, 'mpg'), { action: 'convert', target: 'mp3', ext: 'mp3' });
  assert.deepEqual(resolveOutput('png', s, 'jpeg', 'png'), { action: 'convert', target: 'jpeg', ext: 'jpg' });
  assert.deepEqual(resolveOutput('mp3', s, 'mp3', 'mp3'), { action: 'keep', target: 'mp3', ext: 'mp3' });
  assert.deepEqual(resolveOutput('webp', s, 'keep', 'png'), { action: 'rename', target: 'webp', ext: 'webp' });
  assert.equal(resolveOutput('webp', S({ fixExtensions: false }), 'keep', 'png').ext, 'png');
});
