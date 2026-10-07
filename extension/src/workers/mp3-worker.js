// MP3 encoder worker (LAME via lamejs). Receives Float32 PCM per channel.
import { Mp3Encoder } from '../vendor/lamejs.js';

const FRAME = 1152;
const BLOCK = FRAME * 64;

function toInt16(f32, start, end) {
  const out = new Int16Array(end - start);
  for (let i = start, j = 0; i < end; i++, j++) {
    const s = f32[i] > 1 ? 1 : f32[i] < -1 ? -1 : f32[i];
    out[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

self.onmessage = ({ data }) => {
  try {
    const { channels, sampleRate, kbps } = data;
    const enc = new Mp3Encoder(channels.length, sampleRate, kbps);
    const total = channels[0].length;
    const chunks = [];
    let lastReport = 0;
    for (let i = 0; i < total; i += BLOCK) {
      const end = Math.min(total, i + BLOCK);
      const left = toInt16(channels[0], i, end);
      const mp3 = channels.length > 1
        ? enc.encodeBuffer(left, toInt16(channels[1], i, end))
        : enc.encodeBuffer(left);
      if (mp3.length) chunks.push(new Uint8Array(mp3));
      const now = Date.now();
      if (now - lastReport > 100) {
        lastReport = now;
        self.postMessage({ type: 'progress', value: end / total });
      }
    }
    const tail = enc.flush();
    if (tail.length) chunks.push(new Uint8Array(tail));
    self.postMessage({ type: 'progress', value: 1 });
    self.postMessage({ type: 'done', chunks });
  } catch (e) {
    self.postMessage({ type: 'error', message: e?.message || String(e) });
  }
};
