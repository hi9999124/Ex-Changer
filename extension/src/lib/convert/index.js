// Conversion pipeline: sniff -> decide -> transcode. Runs in a document
// context (the offscreen document for automatic downloads, or the converter
// page for local files).

import { sniff, kindOf, mimeOf, labelOf } from '../formats.js';
import { resolveOutput } from '../rules.js';
import { convertImage } from './image.js';
import { decodeAudio, remix, pickChannels, encodeWav, encodeMp3, nearestMp3Rate } from './audio.js';
import { extractAudio } from './demux.js';
import { decodeMp2 } from './mp2.js';

/** Build an AudioBuffer from decoded MP2 PCM, resampled to `rate`. */
async function mp2ToAudioBuffer(bytes, rate, onProgress) {
  const pcm = decodeMp2(bytes, onProgress);
  const channels = pcm.channels === 1 ? 1 : 2;
  const buf = new AudioBuffer({ length: pcm.left.length, numberOfChannels: channels, sampleRate: pcm.sampleRate });
  buf.copyToChannel(pcm.left, 0);
  if (channels === 2) buf.copyToChannel(pcm.right, 1);
  if (pcm.sampleRate === rate) return buf;
  const length = Math.ceil(buf.length * rate / pcm.sampleRate);
  const ctx = new OfflineAudioContext({ numberOfChannels: channels, length, sampleRate: rate });
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}

/**
 * @param {Blob} blob
 * @param {object} p
 * @param {object} p.settings
 * @param {string|null} [p.forced] explicit target format
 * @param {string} [p.originalExt] extension of the browser-suggested name
 * @param {string|null} [p.hint] format guessed from name/MIME, used if sniffing fails
 * @param {(phase: string, value?: number) => void} [p.onProgress]
 * @returns {Promise<{blob: Blob, actual: string, target: string, action: string, ext: string, detail?: string}>}
 */
export async function convertBlob(blob, { settings, forced = null, originalExt = '', hint = null, onProgress = () => {} }) {
  const head = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
  const actual = sniff(head) || hint;
  if (!actual) throw new Error('Unrecognised file type — it does not look like an image, audio or video file.');

  const plan = resolveOutput(actual, settings, forced, originalExt);
  if (plan.action !== 'convert') {
    return { blob: new Blob([blob], { type: mimeOf(actual) }), actual, ...plan };
  }

  const srcKind = kindOf(actual);
  const dstKind = kindOf(plan.target);

  if (srcKind === 'image' && dstKind === 'image') {
    onProgress('Decoding image', 0.2);
    const { blob: out, width, height } = await convertImage(blob, actual, plan.target, settings);
    onProgress('Encoded', 1);
    const detail = actual === 'gif' || actual === 'webp' ? `${width}×${height} (first frame if animated)` : `${width}×${height}`;
    return { blob: out, actual, ...plan, detail };
  }

  if ((srcKind === 'audio' || srcKind === 'video') && dstKind === 'audio') {
    const rate = plan.target === 'mp3' ? nearestMp3Rate(settings.sampleRate || 44100) : (settings.sampleRate || 44100);
    let bytes = new Uint8Array(await blob.arrayBuffer());
    let codec = actual;

    if (actual === 'mpeg' || actual === 'ts') {
      onProgress('Extracting audio track', 0.1);
      const { es, format } = extractAudio(bytes, actual);
      bytes = es;
      codec = format;
      // MP3 audio inside an MPEG video: copy the frames, no re-encode.
      if (codec === plan.target && settings.skipSameFormat) {
        return { blob: new Blob([bytes], { type: mimeOf(codec) }), actual, ...plan, detail: `${labelOf(codec)} track copied losslessly` };
      }
    }

    onProgress('Decoding audio', 0.15);
    let audio;
    if (codec === 'mp2') {
      audio = await mp2ToAudioBuffer(bytes, rate, (v) => onProgress('Decoding audio', 0.15 + v * 0.25));
    } else {
      // decodeAudioData detaches the buffer, so hand it a private copy.
      audio = await decodeAudio(bytes.slice().buffer, rate);
    }
    bytes = null;

    const channels = pickChannels(audio, settings.mp3Channels);
    audio = await remix(audio, channels);
    const detail = `${audio.sampleRate / 1000} kHz · ${channels === 1 ? 'mono' : 'stereo'} · ${audio.duration.toFixed(1)} s`;

    if (plan.target === 'wav') {
      onProgress('Writing WAV', 0.7);
      return { blob: encodeWav(audio, settings.wavBitDepth || 16), actual, ...plan, detail };
    }
    onProgress('Encoding MP3', 0.4);
    const out = await encodeMp3(audio, {
      bitrate: settings.mp3Bitrate,
      onProgress: (v) => onProgress('Encoding MP3', 0.4 + v * 0.6),
    });
    return { blob: out, actual, ...plan, detail: `${detail} · ${settings.mp3Bitrate} kbps` };
  }

  throw new Error(`Cannot convert ${labelOf(actual)} to ${labelOf(plan.target)}.`);
}
