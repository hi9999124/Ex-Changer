// Audio decoding (Web Audio) and encoding to WAV (inline) or MP3 (LAME,
// in a module worker so the page stays responsive).

const MP3_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

/**
 * Decode any audio the browser understands (MP3, OGG Vorbis, Opus, FLAC, WAV,
 * AAC/M4A, AIFF, and the audio track of MP4/WebM) and resample it.
 * @param {ArrayBuffer} data
 * @param {number} sampleRate
 * @returns {Promise<AudioBuffer>}
 */
export async function decodeAudio(data, sampleRate = 44100) {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate });
  try {
    return await ctx.decodeAudioData(data);
  } catch {
    throw new Error('The browser could not decode this audio (unsupported codec or corrupt file).');
  }
}

/** Up/down-mix with the Web Audio speaker rules. */
export async function remix(buffer, channels) {
  if (buffer.numberOfChannels === channels) return buffer;
  const ctx = new OfflineAudioContext({ numberOfChannels: channels, length: buffer.length, sampleRate: buffer.sampleRate });
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}

export function pickChannels(buffer, mode) {
  if (mode === 'mono') return 1;
  if (mode === 'stereo') return 2;
  return buffer.numberOfChannels === 1 ? 1 : 2;
}

/**
 * PCM WAV. 16 and 24 bit integer, or 32 bit float.
 * @param {AudioBuffer} buffer
 */
export function encodeWav(buffer, bitDepth = 16) {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const float = bitDepth === 32;
  const bps = bitDepth / 8;
  const dataSize = len * ch * bps;
  const out = new ArrayBuffer(44 + dataSize);
  const v = new DataView(out);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, float ? 3 : 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, buffer.sampleRate, true);
  v.setUint32(28, buffer.sampleRate * ch * bps, true);
  v.setUint16(32, ch * bps, true);
  v.setUint16(34, bitDepth, true);
  str(36, 'data'); v.setUint32(40, dataSize, true);

  const chans = [];
  for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      if (float) { v.setFloat32(o, s, true); o += 4; }
      else if (bitDepth === 24) {
        const x = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
        v.setUint8(o, x & 0xff); v.setUint8(o + 1, (x >> 8) & 0xff); v.setUint8(o + 2, (x >> 16) & 0xff);
        o += 3;
      } else {
        v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
      }
    }
  }
  return new Blob([out], { type: 'audio/wav' });
}

/** Bitrates allowed by the MPEG version that a sample rate implies. */
export function clampBitrate(kbps, sampleRate) {
  const mpeg1 = sampleRate >= 32000;
  const allowed = mpeg1
    ? [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    : [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  return allowed.reduce((best, b) => (Math.abs(b - kbps) < Math.abs(best - kbps) ? b : best), allowed[0]);
}

export function nearestMp3Rate(rate) {
  return MP3_RATES.reduce((best, r) => (Math.abs(r - rate) < Math.abs(best - rate) ? r : best), 44100);
}

/**
 * Encode to MP3 in a worker.
 * @param {AudioBuffer} buffer (1 or 2 channels)
 * @param {{bitrate?: number, onProgress?: (p:number)=>void}} opts
 * @returns {Promise<Blob>}
 */
export function encodeMp3(buffer, { bitrate = 192, onProgress } = {}) {
  const channels = Math.min(2, buffer.numberOfChannels);
  const pcm = [];
  for (let c = 0; c < channels; c++) pcm.push(buffer.getChannelData(c).slice());
  const kbps = clampBitrate(bitrate, buffer.sampleRate);

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/mp3-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') onProgress?.(data.value);
      else if (data.type === 'done') { worker.terminate(); resolve(new Blob(data.chunks, { type: 'audio/mpeg' })); }
      else if (data.type === 'error') { worker.terminate(); reject(new Error(data.message)); }
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'MP3 encoder crashed')); };
    worker.postMessage({ channels: pcm, sampleRate: buffer.sampleRate, kbps }, pcm.map((a) => a.buffer));
  });
}
