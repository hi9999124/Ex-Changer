import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extractAudio } from '../../extension/src/lib/convert/demux.js';
import { decodeMp2 } from '../../extension/src/lib/convert/mp2.js';
import { sniff } from '../../extension/src/lib/formats.js';

const F = new URL('../fixtures/', import.meta.url);
const read = (name) => new Uint8Array(fs.readFileSync(new URL(name, F)));

function dominantFrequency(samples, rate) {
  // count rising zero crossings in the steady middle part
  const a = Math.floor(samples.length * 0.2);
  const b = Math.floor(samples.length * 0.8);
  let zc = 0;
  for (let i = a + 1; i < b; i++) if (samples[i - 1] < 0 && samples[i] >= 0) zc++;
  return zc / ((b - a) / rate);
}

const peak = (s) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

test('MP2 decoder reproduces a 440 Hz tone at the right level', () => {
  const r = decodeMp2(read('tone.mp2'));
  assert.equal(r.sampleRate, 44100);
  assert.equal(r.channels, 2);
  assert.ok(Math.abs(r.left.length / r.sampleRate - 2) < 0.05, 'about 2 seconds long');
  assert.ok(Math.abs(dominantFrequency(r.left, r.sampleRate) - 440) < 3);
  // ffmpeg's sine source is -18 dBFS (0.125); the MP2 encoder lands ~0.09.
  const p = peak(r.left);
  assert.ok(p > 0.07 && p < 0.14, `peak ${p}`);
});

test('MP2 decoder output matches ffmpeg sample-for-sample (after alignment)', { skip: !hasFfmpeg() }, () => {
  const ref = new Float32Array(execFileSync('ffmpeg', ['-v', 'error', '-i', new URL('tone.mp2', F).pathname, '-f', 'f32le', '-ac', '1', '-'], { maxBuffer: 1 << 26 }).buffer.slice(0));
  const ours = decodeMp2(read('tone.mp2')).left;
  let best = -1;
  for (let lag = 0; lag <= 1200; lag++) {
    let dot = 0; let a = 0; let b = 0;
    for (let i = 4000; i < 40000; i++) { const x = ours[i + lag] || 0; const y = ref[i]; dot += x * y; a += x * x; b += y * y; }
    best = Math.max(best, dot / Math.sqrt(a * b));
  }
  assert.ok(best > 0.999, `correlation ${best}`);
});

test('MPEG-1 program stream: MP2 track is extracted and decodable', () => {
  const b = read('clip.mpeg');
  assert.equal(sniff(b), 'mpeg');
  const { es, format } = extractAudio(b, 'mpeg');
  assert.equal(format, 'mp2');
  const r = decodeMp2(es);
  assert.ok(Math.abs(r.left.length / r.sampleRate - 2) < 0.1);
  assert.ok(Math.abs(dominantFrequency(r.left, r.sampleRate) - 440) < 3);
});

test('MPEG-2 program stream with MP3 audio yields a raw MP3 stream', () => {
  const b = read('clip-mp3audio.mpg');
  const { es, format } = extractAudio(b, 'mpeg');
  assert.equal(format, 'mp3');
  assert.equal(es[0], 0xff);
  assert.equal(es[1] & 0xe0, 0xe0);
});

test('MPEG transport stream: audio PID is found through PAT/PMT', () => {
  const b = read('clip.ts');
  assert.equal(sniff(b), 'ts');
  const { es, format } = extractAudio(b, 'ts');
  assert.equal(format, 'mp2');
  const r = decodeMp2(es);
  assert.ok(Math.abs(dominantFrequency(r.left, r.sampleRate) - 440) < 3);
});

function hasFfmpeg() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
