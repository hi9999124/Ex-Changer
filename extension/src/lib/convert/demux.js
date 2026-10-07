// Pulls the first audio elementary stream out of MPEG Program Streams
// (.mpeg/.mpg/.vob) and MPEG Transport Streams (.ts). The result is raw
// MP3, MP2 or AAC (ADTS) frames.

import { sniff } from '../formats.js';

/** Payload offset inside a PES packet (MPEG-1 and MPEG-2 PES syntax). */
function pesPayloadStart(b, i, end) {
  // i points at the 00 00 01 start code; header is 6 bytes.
  let p = i + 6;
  if ((b[p] & 0xc0) === 0x80) {
    return p + 3 + b[p + 2]; // MPEG-2: flags, flags, header_data_length
  }
  while (p < end && b[p] === 0xff) p++; // MPEG-1 stuffing
  if ((b[p] & 0xc0) === 0x40) p += 2; // STD buffer
  if ((b[p] & 0xf0) === 0x20) p += 5; // PTS
  else if ((b[p] & 0xf0) === 0x30) p += 10; // PTS + DTS
  else p += 1; // 0x0f
  return p;
}

function concat(chunks, total) {
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** @param {Uint8Array} b */
export function demuxProgramStream(b) {
  const chunks = [];
  let total = 0;
  let audioId = -1;
  let i = 0;
  const n = b.length;
  while (i + 4 <= n) {
    if (b[i] !== 0 || b[i + 1] !== 0 || b[i + 2] !== 1) { i++; continue; }
    const id = b[i + 3];
    if (id === 0xba) { // pack header
      if ((b[i + 4] & 0xc0) === 0x40) i += 14 + (b[i + 13] & 0x07); // MPEG-2
      else i += 12; // MPEG-1
      continue;
    }
    if (id === 0xb9) break; // program end
    if (id < 0xbb) { i++; continue; } // video ES start codes etc.
    const len = (b[i + 4] << 8) | b[i + 5];
    const end = Math.min(n, i + 6 + len);
    const isMpegAudio = id >= 0xc0 && id <= 0xdf;
    if (isMpegAudio && (audioId === -1 || audioId === id)) {
      audioId = id;
      const start = pesPayloadStart(b, i, end);
      if (start < end) { chunks.push(b.subarray(start, end)); total += end - start; }
    }
    i = len ? end : i + 6;
  }
  return total ? concat(chunks, total) : null;
}

/** @param {Uint8Array} b */
export function demuxTransportStream(b) {
  const PKT = 188;
  let off = 0;
  while (off < PKT && !(b[off] === 0x47 && b[off + PKT] === 0x47)) off++;
  let pmtPid = -1;
  let audioPid = -1;
  const chunks = [];
  let total = 0;
  let pes = null; // current PES being assembled for the audio PID

  const flush = () => {
    if (!pes) return;
    const data = concat(pes.parts, pes.size);
    if (data[0] === 0 && data[1] === 0 && data[2] === 1) {
      const start = pesPayloadStart(data, 0, data.length);
      if (start < data.length) { chunks.push(data.subarray(start)); total += data.length - start; }
    }
    pes = null;
  };

  for (let i = off; i + PKT <= b.length; i += PKT) {
    if (b[i] !== 0x47) continue;
    const pusi = (b[i + 1] & 0x40) !== 0;
    const pid = ((b[i + 1] & 0x1f) << 8) | b[i + 2];
    const afc = (b[i + 3] >> 4) & 3;
    let p = i + 4;
    if (afc === 2 || afc === 0) continue; // no payload
    if (afc === 3) p += 1 + b[p];
    if (p >= i + PKT) continue;

    if (pid === 0 && pmtPid === -1 && pusi) { // PAT
      p += 1 + b[p];
      const secLen = ((b[p + 1] & 0x0f) << 8) | b[p + 2];
      const end = Math.min(i + PKT, p + 3 + secLen - 4);
      for (let q = p + 8; q + 4 <= end; q += 4) {
        const prog = (b[q] << 8) | b[q + 1];
        if (prog !== 0) { pmtPid = ((b[q + 2] & 0x1f) << 8) | b[q + 3]; break; }
      }
    } else if (pid === pmtPid && audioPid === -1 && pusi) { // PMT
      p += 1 + b[p];
      const secLen = ((b[p + 1] & 0x0f) << 8) | b[p + 2];
      const end = Math.min(i + PKT, p + 3 + secLen - 4);
      const infoLen = ((b[p + 10] & 0x0f) << 8) | b[p + 11];
      for (let q = p + 12 + infoLen; q + 5 <= end;) {
        const type = b[q];
        const epid = ((b[q + 1] & 0x1f) << 8) | b[q + 2];
        const esLen = ((b[q + 3] & 0x0f) << 8) | b[q + 4];
        // 0x03/0x04 MPEG audio, 0x0f AAC ADTS
        if (type === 0x03 || type === 0x04 || type === 0x0f) { audioPid = epid; break; }
        q += 5 + esLen;
      }
    } else if (pid === audioPid) {
      if (pusi) flush();
      if (pusi || pes) {
        if (!pes) pes = { parts: [], size: 0 };
        const part = b.subarray(p, i + PKT);
        pes.parts.push(part);
        pes.size += part.length;
      }
    }
  }
  flush();
  return total ? concat(chunks, total) : null;
}

/**
 * @param {Uint8Array} bytes
 * @param {'mpeg'|'ts'} container
 * @returns {{es: Uint8Array, format: string}}
 */
export function extractAudio(bytes, container) {
  const es = container === 'ts' ? demuxTransportStream(bytes) : demuxProgramStream(bytes);
  if (!es) throw new Error('This video has no MPEG audio track to extract.');
  // Find the first frame so sniffing sees a frame header.
  let start = 0;
  while (start + 4 < es.length && !(es[start] === 0xff && (es[start + 1] & 0xe0) === 0xe0)) start++;
  const trimmed = es.subarray(start);
  return { es: trimmed, format: sniff(trimmed) || 'mp2' };
}
