// MPEG-1/2 Audio Layer II decoder (the audio codec inside most .mpeg/.mpg
// video files and .mp2 files, which browsers cannot decode natively).
//
// Ported from JSMpeg's mp2.js (MIT, (c) 2017 Dominic Szablewski,
// https://github.com/phoboslab/jsmpeg), itself based on kjmp2 by
// Martin J. Fiedler. Changes: standalone ES module with its own bit reader,
// MPEG-2 LSF streams enabled, resynchronisation on damaged frames.

class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.index = 0; // bit position
  }
  read(count) {
    let value = 0;
    while (count > 0) {
      const byte = this.bytes[this.index >> 3] ?? 0;
      const free = 8 - (this.index & 7);
      const take = Math.min(free, count);
      value = (value << take) | ((byte >> (free - take)) & (0xff >> (8 - take)));
      this.index += take;
      count -= take;
    }
    return value >>> 0;
  }
  skip(count) { this.index += count; }
}

const VERSION_MPEG_2 = 0x2;
const VERSION_MPEG_1 = 0x3;
const LAYER_II = 0x2;
const MODE_JOINT_STEREO = 0x1;
const MODE_MONO = 0x3;

const SAMPLE_RATE = [44100, 48000, 32000, 0, 22050, 24000, 16000, 0];
const BIT_RATE = [
  32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, // MPEG-1
  8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, // MPEG-2
];
const SCALEFACTOR_BASE = [0x02000000, 0x01965fea, 0x01428a30];

const QUANT_LUT_STEP_1 = [
  [0, 0, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2], // mono
  [0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 2], // stereo (bitrate per channel)
];
const TAB_A = 27 | 64; // Table 3-B.2a: high-rate, sblimit = 27
const TAB_B = 30 | 64; // Table 3-B.2b: high-rate, sblimit = 30
const TAB_C = 8; // Table 3-B.2c: low-rate, sblimit = 8
const TAB_D = 12; // Table 3-B.2d: low-rate, sblimit = 12
const QUANT_LUT_STEP_2 = [
  [TAB_C, TAB_C, TAB_D],
  [TAB_A, TAB_A, TAB_A],
  [TAB_B, TAB_A, TAB_B],
];
const QUANT_LUT_STEP_3 = [
  [0x44, 0x44, 0x34, 0x34, 0x34, 0x34, 0x34, 0x34, 0x34, 0x34, 0x34, 0x34],
  [0x43, 0x43, 0x43, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42,
    0x31, 0x31, 0x31, 0x31, 0x31, 0x31, 0x31, 0x31, 0x31, 0x31, 0x31, 0x31,
    0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20],
  [0x45, 0x45, 0x45, 0x45, 0x34, 0x34, 0x34, 0x34, 0x34, 0x34, 0x34,
    0x24, 0x24, 0x24, 0x24, 0x24, 0x24, 0x24, 0x24, 0x24, 0x24,
    0x24, 0x24, 0x24, 0x24, 0x24, 0x24, 0x24, 0x24, 0x24],
];
const QUANT_LUT_STEP_4 = [
  [0, 1, 2, 17],
  [0, 1, 2, 3, 4, 5, 6, 17],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17],
  [0, 1, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
  [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
];
const QUANT_TAB = [
  { levels: 3, group: 1, bits: 5 },
  { levels: 5, group: 1, bits: 7 },
  { levels: 7, group: 0, bits: 3 },
  { levels: 9, group: 1, bits: 10 },
  { levels: 15, group: 0, bits: 4 },
  { levels: 31, group: 0, bits: 5 },
  { levels: 63, group: 0, bits: 6 },
  { levels: 127, group: 0, bits: 7 },
  { levels: 255, group: 0, bits: 8 },
  { levels: 511, group: 0, bits: 9 },
  { levels: 1023, group: 0, bits: 10 },
  { levels: 2047, group: 0, bits: 11 },
  { levels: 4095, group: 0, bits: 12 },
  { levels: 8191, group: 0, bits: 13 },
  { levels: 16383, group: 0, bits: 14 },
  { levels: 32767, group: 0, bits: 15 },
  { levels: 65535, group: 0, bits: 16 },
];

class Mp2Decoder {
  constructor(bytes) {
    this.bits = new BitReader(bytes);
    this.D = new Float32Array(1024);
    this.D.set(SYNTHESIS_WINDOW, 0);
    this.D.set(SYNTHESIS_WINDOW, 512);
    this.V = [new Float32Array(1024), new Float32Array(1024)];
    this.U = new Float64Array(32);
    this.VPos = 0;
    this.allocation = [new Array(32), new Array(32)];
    this.scaleFactorInfo = [new Uint8Array(32), new Uint8Array(32)];
    this.scaleFactor = [[], []];
    this.sample = [[], []];
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 32; i++) {
        this.scaleFactor[j][i] = [0, 0, 0];
        this.sample[j][i] = [0, 0, 0];
      }
    }
    this.sampleRate = 0;
    this.channels = 0;
  }

  /** Decode one frame at the current byte position; returns its size or 0. */
  decodeFrame(left, right) {
    const bits = this.bits;
    const sync = bits.read(11);
    const version = bits.read(2);
    const layer = bits.read(2);
    const hasCRC = !bits.read(1);
    if (sync !== 0x7ff || (version !== VERSION_MPEG_1 && version !== VERSION_MPEG_2) || layer !== LAYER_II) return 0;

    let bitrateIndex = bits.read(4) - 1;
    if (bitrateIndex < 0 || bitrateIndex > 13) return 0;
    let sampleRateIndex = bits.read(2);
    if (sampleRateIndex === 3) return 0;
    if (version === VERSION_MPEG_2) {
      sampleRateIndex += 4;
      bitrateIndex += 14;
    }
    const padding = bits.read(1);
    bits.skip(1); // private bit
    const mode = bits.read(2);

    let bound;
    if (mode === MODE_JOINT_STEREO) bound = (bits.read(2) + 1) << 2;
    else { bits.skip(2); bound = mode === MODE_MONO ? 0 : 32; }
    bits.skip(4);
    if (hasCRC) bits.skip(16);

    const bitrate = BIT_RATE[bitrateIndex];
    const sampleRate = SAMPLE_RATE[sampleRateIndex];
    const frameSize = ((144000 * bitrate / sampleRate) + padding) | 0;

    let tab3;
    let sblimit;
    if (version === VERSION_MPEG_2) {
      tab3 = 2;
      sblimit = 30;
    } else {
      const tab1 = mode === MODE_MONO ? 0 : 1;
      const tab2 = QUANT_LUT_STEP_1[tab1][bitrateIndex];
      tab3 = QUANT_LUT_STEP_2[tab2][sampleRateIndex];
      sblimit = tab3 & 63;
      tab3 >>= 6;
    }
    if (bound > sblimit) bound = sblimit;

    for (let sb = 0; sb < bound; sb++) {
      this.allocation[0][sb] = this.readAllocation(sb, tab3);
      this.allocation[1][sb] = this.readAllocation(sb, tab3);
    }
    for (let sb = bound; sb < sblimit; sb++) {
      this.allocation[0][sb] = this.allocation[1][sb] = this.readAllocation(sb, tab3);
    }

    const channels = mode === MODE_MONO ? 1 : 2;
    for (let sb = 0; sb < sblimit; sb++) {
      for (let ch = 0; ch < channels; ch++) {
        if (this.allocation[ch][sb]) this.scaleFactorInfo[ch][sb] = bits.read(2);
      }
      if (mode === MODE_MONO) this.scaleFactorInfo[1][sb] = this.scaleFactorInfo[0][sb];
    }

    for (let sb = 0; sb < sblimit; sb++) {
      for (let ch = 0; ch < channels; ch++) {
        if (!this.allocation[ch][sb]) continue;
        const sf = this.scaleFactor[ch][sb];
        switch (this.scaleFactorInfo[ch][sb]) {
          case 0: sf[0] = bits.read(6); sf[1] = bits.read(6); sf[2] = bits.read(6); break;
          case 1: sf[0] = sf[1] = bits.read(6); sf[2] = bits.read(6); break;
          case 2: sf[0] = sf[1] = sf[2] = bits.read(6); break;
          case 3: sf[0] = bits.read(6); sf[1] = sf[2] = bits.read(6); break;
        }
      }
      if (mode === MODE_MONO) {
        const a = this.scaleFactor[0][sb];
        const b = this.scaleFactor[1][sb];
        b[0] = a[0]; b[1] = a[1]; b[2] = a[2];
      }
    }

    let outPos = 0;
    for (let part = 0; part < 3; part++) {
      for (let granule = 0; granule < 4; granule++) {
        for (let sb = 0; sb < bound; sb++) {
          this.readSamples(0, sb, part);
          this.readSamples(1, sb, part);
        }
        for (let sb = bound; sb < sblimit; sb++) {
          this.readSamples(0, sb, part);
          const a = this.sample[0][sb];
          const b = this.sample[1][sb];
          b[0] = a[0]; b[1] = a[1]; b[2] = a[2];
        }
        for (let sb = sblimit; sb < 32; sb++) {
          this.sample[0][sb].fill(0);
          this.sample[1][sb].fill(0);
        }

        for (let p = 0; p < 3; p++) {
          this.VPos = (this.VPos - 64) & 1023;
          for (let ch = 0; ch < 2; ch++) {
            matrixTransform(this.sample[ch], p, this.V[ch], this.VPos);
            const U = this.U;
            const V = this.V[ch];
            const D = this.D;
            U.fill(0);
            let dIndex = 512 - (this.VPos >> 1);
            let vIndex = (this.VPos % 128) >> 1;
            while (vIndex < 1024) {
              for (let i = 0; i < 32; ++i) U[i] += D[dIndex++] * V[vIndex++];
              vIndex += 128 - 32;
              dIndex += 64 - 32;
            }
            vIndex = (128 - 32 + 1024) - vIndex;
            dIndex -= (512 - 32);
            while (vIndex < 1024) {
              for (let i = 0; i < 32; ++i) U[i] += D[dIndex++] * V[vIndex++];
              vIndex += 128 - 32;
              dIndex += 64 - 32;
            }
            const out = ch === 0 ? left : right;
            for (let j = 0; j < 32; j++) out[outPos + j] = U[j] / 1073709056; // full scale (JSMpeg output is -6 dB)
          }
          outPos += 32;
        }
      }
    }

    this.sampleRate = sampleRate;
    this.channels = Math.max(this.channels, channels);
    return frameSize;
  }

  readAllocation(sb, tab3) {
    const tab4 = QUANT_LUT_STEP_3[tab3][sb];
    const qtab = QUANT_LUT_STEP_4[tab4 & 15][this.bits.read(tab4 >> 4)];
    return qtab ? QUANT_TAB[qtab - 1] : 0;
  }

  readSamples(ch, sb, part) {
    const q = this.allocation[ch][sb];
    let sf = this.scaleFactor[ch][sb][part];
    const sample = this.sample[ch][sb];
    if (!q) { sample[0] = sample[1] = sample[2] = 0; return; }

    if (sf === 63) sf = 0;
    else {
      const shift = (sf / 3) | 0;
      sf = (SCALEFACTOR_BASE[sf % 3] + ((1 << shift) >> 1)) >> shift;
    }

    let adj = q.levels;
    if (q.group) {
      let val = this.bits.read(q.bits);
      sample[0] = val % adj;
      val = (val / adj) | 0;
      sample[1] = val % adj;
      sample[2] = (val / adj) | 0;
    } else {
      sample[0] = this.bits.read(q.bits);
      sample[1] = this.bits.read(q.bits);
      sample[2] = this.bits.read(q.bits);
    }

    const scale = (65536 / (adj + 1)) | 0;
    adj = ((adj + 1) >> 1) - 1;
    for (let i = 0; i < 3; i++) {
      const val = (adj - sample[i]) * scale;
      sample[i] = (val * (sf >> 12) + ((val * (sf & 4095) + 2048) >> 12)) >> 12;
    }
  }
}

function isLayer2Header(b, i) {
  if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return false;
  const version = (b[i + 1] >> 3) & 3;
  const layer = (b[i + 1] >> 1) & 3;
  const br = b[i + 2] >> 4;
  const sr = (b[i + 2] >> 2) & 3;
  return (version === 3 || version === 2) && layer === 2 && br !== 0 && br !== 15 && sr !== 3;
}

/**
 * Decode a whole MP2 elementary stream.
 * @param {Uint8Array} bytes
 * @param {(p:number)=>void} [onProgress]
 * @returns {{sampleRate: number, channels: number, left: Float32Array, right: Float32Array}}
 */
export function decodeMp2(bytes, onProgress) {
  const dec = new Mp2Decoder(bytes);
  const left = new Float32Array(1152);
  const right = new Float32Array(1152);
  const outL = [];
  const outR = [];
  let pos = 0;
  let frames = 0;
  let lastReport = 0;
  // Skip an ID3v2 tag if present.
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    pos = 10 + (((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f));
  }
  while (pos + 4 <= bytes.length) {
    if (!isLayer2Header(bytes, pos)) { pos++; continue; }
    dec.bits.index = pos << 3;
    let size = 0;
    try { size = dec.decodeFrame(left, right); } catch { size = 0; }
    if (!size || pos + size > bytes.length + 1) { pos++; continue; }
    outL.push(left.slice());
    outR.push(right.slice());
    frames++;
    pos += size;
    if (onProgress && pos - lastReport > 262144) { lastReport = pos; onProgress(pos / bytes.length); }
  }
  if (!frames) throw new Error('No MPEG audio Layer II frames found.');
  const total = frames * 1152;
  const L = new Float32Array(total);
  const R = new Float32Array(total);
  for (let i = 0; i < frames; i++) { L.set(outL[i], i * 1152); R.set(outR[i], i * 1152); }
  return { sampleRate: dec.sampleRate, channels: dec.channels, left: L, right: R };
}

function matrixTransform(s, ss, d, dp) {
  var t01, t02, t03, t04, t05, t06, t07, t08, t09, t10, t11, t12,
    t13, t14, t15, t16, t17, t18, t19, t20, t21, t22, t23, t24,
    t25, t26, t27, t28, t29, t30, t31, t32, t33;

  t01 = s[ 0][ss] + s[31][ss]; t02 = (s[ 0][ss] - s[31][ss]) * 0.500602998235;
  t03 = s[ 1][ss] + s[30][ss]; t04 = (s[ 1][ss] - s[30][ss]) * 0.505470959898;
  t05 = s[ 2][ss] + s[29][ss]; t06 = (s[ 2][ss] - s[29][ss]) * 0.515447309923;
  t07 = s[ 3][ss] + s[28][ss]; t08 = (s[ 3][ss] - s[28][ss]) * 0.53104259109;
  t09 = s[ 4][ss] + s[27][ss]; t10 = (s[ 4][ss] - s[27][ss]) * 0.553103896034;
  t11 = s[ 5][ss] + s[26][ss]; t12 = (s[ 5][ss] - s[26][ss]) * 0.582934968206;
  t13 = s[ 6][ss] + s[25][ss]; t14 = (s[ 6][ss] - s[25][ss]) * 0.622504123036;
  t15 = s[ 7][ss] + s[24][ss]; t16 = (s[ 7][ss] - s[24][ss]) * 0.674808341455;
  t17 = s[ 8][ss] + s[23][ss]; t18 = (s[ 8][ss] - s[23][ss]) * 0.744536271002;
  t19 = s[ 9][ss] + s[22][ss]; t20 = (s[ 9][ss] - s[22][ss]) * 0.839349645416;
  t21 = s[10][ss] + s[21][ss]; t22 = (s[10][ss] - s[21][ss]) * 0.972568237862;
  t23 = s[11][ss] + s[20][ss]; t24 = (s[11][ss] - s[20][ss]) * 1.16943993343;
  t25 = s[12][ss] + s[19][ss]; t26 = (s[12][ss] - s[19][ss]) * 1.48416461631;
  t27 = s[13][ss] + s[18][ss]; t28 = (s[13][ss] - s[18][ss]) * 2.05778100995;
  t29 = s[14][ss] + s[17][ss]; t30 = (s[14][ss] - s[17][ss]) * 3.40760841847;
  t31 = s[15][ss] + s[16][ss]; t32 = (s[15][ss] - s[16][ss]) * 10.1900081235;

  t33 = t01 + t31; t31 = (t01 - t31) * 0.502419286188;
  t01 = t03 + t29; t29 = (t03 - t29) * 0.52249861494;
  t03 = t05 + t27; t27 = (t05 - t27) * 0.566944034816;
  t05 = t07 + t25; t25 = (t07 - t25) * 0.64682178336;
  t07 = t09 + t23; t23 = (t09 - t23) * 0.788154623451;
  t09 = t11 + t21; t21 = (t11 - t21) * 1.06067768599;
  t11 = t13 + t19; t19 = (t13 - t19) * 1.72244709824;
  t13 = t15 + t17; t17 = (t15 - t17) * 5.10114861869;
  t15 = t33 + t13; t13 = (t33 - t13) * 0.509795579104;
  t33 = t01 + t11; t01 = (t01 - t11) * 0.601344886935;
  t11 = t03 + t09; t09 = (t03 - t09) * 0.899976223136;
  t03 = t05 + t07; t07 = (t05 - t07) * 2.56291544774;
  t05 = t15 + t03; t15 = (t15 - t03) * 0.541196100146;
  t03 = t33 + t11; t11 = (t33 - t11) * 1.30656296488;
  t33 = t05 + t03; t05 = (t05 - t03) * 0.707106781187;
  t03 = t15 + t11; t15 = (t15 - t11) * 0.707106781187;
  t03 += t15;
  t11 = t13 + t07; t13 = (t13 - t07) * 0.541196100146;
  t07 = t01 + t09; t09 = (t01 - t09) * 1.30656296488;
  t01 = t11 + t07; t07 = (t11 - t07) * 0.707106781187;
  t11 = t13 + t09; t13 = (t13 - t09) * 0.707106781187;
  t11 += t13; t01 += t11; 
  t11 += t07; t07 += t13;
  t09 = t31 + t17; t31 = (t31 - t17) * 0.509795579104;
  t17 = t29 + t19; t29 = (t29 - t19) * 0.601344886935;
  t19 = t27 + t21; t21 = (t27 - t21) * 0.899976223136;
  t27 = t25 + t23; t23 = (t25 - t23) * 2.56291544774;
  t25 = t09 + t27; t09 = (t09 - t27) * 0.541196100146;
  t27 = t17 + t19; t19 = (t17 - t19) * 1.30656296488;
  t17 = t25 + t27; t27 = (t25 - t27) * 0.707106781187;
  t25 = t09 + t19; t19 = (t09 - t19) * 0.707106781187;
  t25 += t19;
  t09 = t31 + t23; t31 = (t31 - t23) * 0.541196100146;
  t23 = t29 + t21; t21 = (t29 - t21) * 1.30656296488;
  t29 = t09 + t23; t23 = (t09 - t23) * 0.707106781187;
  t09 = t31 + t21; t31 = (t31 - t21) * 0.707106781187;
  t09 += t31;  t29 += t09;  t09 += t23;  t23 += t31;
  t17 += t29;  t29 += t25;  t25 += t09;  t09 += t27;
  t27 += t23;  t23 += t19; t19 += t31;  
  t21 = t02 + t32; t02 = (t02 - t32) * 0.502419286188;
  t32 = t04 + t30; t04 = (t04 - t30) * 0.52249861494;
  t30 = t06 + t28; t28 = (t06 - t28) * 0.566944034816;
  t06 = t08 + t26; t08 = (t08 - t26) * 0.64682178336;
  t26 = t10 + t24; t10 = (t10 - t24) * 0.788154623451;
  t24 = t12 + t22; t22 = (t12 - t22) * 1.06067768599;
  t12 = t14 + t20; t20 = (t14 - t20) * 1.72244709824;
  t14 = t16 + t18; t16 = (t16 - t18) * 5.10114861869;
  t18 = t21 + t14; t14 = (t21 - t14) * 0.509795579104;
  t21 = t32 + t12; t32 = (t32 - t12) * 0.601344886935;
  t12 = t30 + t24; t24 = (t30 - t24) * 0.899976223136;
  t30 = t06 + t26; t26 = (t06 - t26) * 2.56291544774;
  t06 = t18 + t30; t18 = (t18 - t30) * 0.541196100146;
  t30 = t21 + t12; t12 = (t21 - t12) * 1.30656296488;
  t21 = t06 + t30; t30 = (t06 - t30) * 0.707106781187;
  t06 = t18 + t12; t12 = (t18 - t12) * 0.707106781187;
  t06 += t12;
  t18 = t14 + t26; t26 = (t14 - t26) * 0.541196100146;
  t14 = t32 + t24; t24 = (t32 - t24) * 1.30656296488;
  t32 = t18 + t14; t14 = (t18 - t14) * 0.707106781187;
  t18 = t26 + t24; t24 = (t26 - t24) * 0.707106781187;
  t18 += t24; t32 += t18; 
  t18 += t14; t26 = t14 + t24;
  t14 = t02 + t16; t02 = (t02 - t16) * 0.509795579104;
  t16 = t04 + t20; t04 = (t04 - t20) * 0.601344886935;
  t20 = t28 + t22; t22 = (t28 - t22) * 0.899976223136;
  t28 = t08 + t10; t10 = (t08 - t10) * 2.56291544774;
  t08 = t14 + t28; t14 = (t14 - t28) * 0.541196100146;
  t28 = t16 + t20; t20 = (t16 - t20) * 1.30656296488;
  t16 = t08 + t28; t28 = (t08 - t28) * 0.707106781187;
  t08 = t14 + t20; t20 = (t14 - t20) * 0.707106781187;
  t08 += t20;
  t14 = t02 + t10; t02 = (t02 - t10) * 0.541196100146;
  t10 = t04 + t22; t22 = (t04 - t22) * 1.30656296488;
  t04 = t14 + t10; t10 = (t14 - t10) * 0.707106781187;
  t14 = t02 + t22; t02 = (t02 - t22) * 0.707106781187;
  t14 += t02;  t04 += t14;  t14 += t10;  t10 += t02;
  t16 += t04;  t04 += t08;  t08 += t14;  t14 += t28;
  t28 += t10;  t10 += t20;  t20 += t02;  t21 += t16;
  t16 += t32;  t32 += t04;  t04 += t06;  t06 += t08;
  t08 += t18;  t18 += t14;  t14 += t30;  t30 += t28;
  t28 += t26;  t26 += t10;  t10 += t12;  t12 += t20;
  t20 += t24;  t24 += t02;

  d[dp + 48] = -t33;
  d[dp + 49] = d[dp + 47] = -t21;
  d[dp + 50] = d[dp + 46] = -t17;
  d[dp + 51] = d[dp + 45] = -t16;
  d[dp + 52] = d[dp + 44] = -t01;
  d[dp + 53] = d[dp + 43] = -t32;
  d[dp + 54] = d[dp + 42] = -t29;
  d[dp + 55] = d[dp + 41] = -t04;
  d[dp + 56] = d[dp + 40] = -t03;
  d[dp + 57] = d[dp + 39] = -t06;
  d[dp + 58] = d[dp + 38] = -t25;
  d[dp + 59] = d[dp + 37] = -t08;
  d[dp + 60] = d[dp + 36] = -t11;
  d[dp + 61] = d[dp + 35] = -t18;
  d[dp + 62] = d[dp + 34] = -t09;
  d[dp + 63] = d[dp + 33] = -t14;
  d[dp + 32] = -t05;
  d[dp +  0] = t05; d[dp + 31] = -t30;
  d[dp +  1] = t30; d[dp + 30] = -t27;
  d[dp +  2] = t27; d[dp + 29] = -t28;
  d[dp +  3] = t28; d[dp + 28] = -t07;
  d[dp +  4] = t07; d[dp + 27] = -t26;
  d[dp +  5] = t26; d[dp + 26] = -t23;
  d[dp +  6] = t23; d[dp + 25] = -t10;
  d[dp +  7] = t10; d[dp + 24] = -t15;
  d[dp +  8] = t15; d[dp + 23] = -t12;
  d[dp +  9] = t12; d[dp + 22] = -t19;
  d[dp + 10] = t19; d[dp + 21] = -t20;
  d[dp + 11] = t20; d[dp + 20] = -t13;
  d[dp + 12] = t13; d[dp + 19] = -t24;
  d[dp + 13] = t24; d[dp + 18] = -t31;
  d[dp + 14] = t31; d[dp + 17] = -t02;
  d[dp + 15] = t02; d[dp + 16] =  0.0;
}

const SYNTHESIS_WINDOW = new Float32Array([
       0.0,     -0.5,     -0.5,     -0.5,     -0.5,     -0.5,
      -0.5,     -1.0,     -1.0,     -1.0,     -1.0,     -1.5,
      -1.5,     -2.0,     -2.0,     -2.5,     -2.5,     -3.0,
      -3.5,     -3.5,     -4.0,     -4.5,     -5.0,     -5.5,
      -6.5,     -7.0,     -8.0,     -8.5,     -9.5,    -10.5,
     -12.0,    -13.0,    -14.5,    -15.5,    -17.5,    -19.0,
     -20.5,    -22.5,    -24.5,    -26.5,    -29.0,    -31.5,
     -34.0,    -36.5,    -39.5,    -42.5,    -45.5,    -48.5,
     -52.0,    -55.5,    -58.5,    -62.5,    -66.0,    -69.5,
     -73.5,    -77.0,    -80.5,    -84.5,    -88.0,    -91.5,
     -95.0,    -98.0,   -101.0,   -104.0,    106.5,    109.0,
     111.0,    112.5,    113.5,    114.0,    114.0,    113.5,
     112.0,    110.5,    107.5,    104.0,    100.0,     94.5,
      88.5,     81.5,     73.0,     63.5,     53.0,     41.5,
      28.5,     14.5,     -1.0,    -18.0,    -36.0,    -55.5,
     -76.5,    -98.5,   -122.0,   -147.0,   -173.5,   -200.5,
    -229.5,   -259.5,   -290.5,   -322.5,   -355.5,   -389.5,
    -424.0,   -459.5,   -495.5,   -532.0,   -568.5,   -605.0,
    -641.5,   -678.0,   -714.0,   -749.0,   -783.5,   -817.0,
    -849.0,   -879.5,   -908.5,   -935.0,   -959.5,   -981.0,
   -1000.5,  -1016.0,  -1028.5,  -1037.5,  -1042.5,  -1043.5,
   -1040.0,  -1031.5,   1018.5,   1000.0,    976.0,    946.5,
     911.0,    869.5,    822.0,    767.5,    707.0,    640.0,
     565.5,    485.0,    397.0,    302.5,    201.0,     92.5,
     -22.5,   -144.0,   -272.5,   -407.0,   -547.5,   -694.0,
    -846.0,  -1003.0,  -1165.0,  -1331.5,  -1502.0,  -1675.5,
   -1852.5,  -2031.5,  -2212.5,  -2394.0,  -2576.5,  -2758.5,
   -2939.5,  -3118.5,  -3294.5,  -3467.5,  -3635.5,  -3798.5,
   -3955.0,  -4104.5,  -4245.5,  -4377.5,  -4499.0,  -4609.5,
   -4708.0,  -4792.5,  -4863.5,  -4919.0,  -4958.0,  -4979.5,
   -4983.0,  -4967.5,  -4931.5,  -4875.0,  -4796.0,  -4694.5,
   -4569.5,  -4420.0,  -4246.0,  -4046.0,  -3820.0,  -3567.0,
    3287.0,   2979.5,   2644.0,   2280.5,   1888.0,   1467.5,
    1018.5,    541.0,     35.0,   -499.0,  -1061.0,  -1650.0,
   -2266.5,  -2909.0,  -3577.0,  -4270.0,  -4987.5,  -5727.5,
   -6490.0,  -7274.0,  -8077.5,  -8899.5,  -9739.0, -10594.5,
  -11464.5, -12347.0, -13241.0, -14144.5, -15056.0, -15973.5,
  -16895.5, -17820.0, -18744.5, -19668.0, -20588.0, -21503.0,
  -22410.5, -23308.5, -24195.0, -25068.5, -25926.5, -26767.0,
  -27589.0, -28389.0, -29166.5, -29919.0, -30644.5, -31342.0,
  -32009.5, -32645.0, -33247.0, -33814.5, -34346.0, -34839.5,
  -35295.0, -35710.0, -36084.5, -36417.5, -36707.5, -36954.0,
  -37156.5, -37315.0, -37428.0, -37496.0,  37519.0,  37496.0,
   37428.0,  37315.0,  37156.5,  36954.0,  36707.5,  36417.5,
   36084.5,  35710.0,  35295.0,  34839.5,  34346.0,  33814.5,
   33247.0,  32645.0,  32009.5,  31342.0,  30644.5,  29919.0,
   29166.5,  28389.0,  27589.0,  26767.0,  25926.5,  25068.5,
   24195.0,  23308.5,  22410.5,  21503.0,  20588.0,  19668.0,
   18744.5,  17820.0,  16895.5,  15973.5,  15056.0,  14144.5,
   13241.0,  12347.0,  11464.5,  10594.5,   9739.0,   8899.5,
    8077.5,   7274.0,   6490.0,   5727.5,   4987.5,   4270.0,
    3577.0,   2909.0,   2266.5,   1650.0,   1061.0,    499.0,
     -35.0,   -541.0,  -1018.5,  -1467.5,  -1888.0,  -2280.5,
   -2644.0,  -2979.5,   3287.0,   3567.0,   3820.0,   4046.0,
    4246.0,   4420.0,   4569.5,   4694.5,   4796.0,   4875.0,
    4931.5,   4967.5,   4983.0,   4979.5,   4958.0,   4919.0,
    4863.5,   4792.5,   4708.0,   4609.5,   4499.0,   4377.5,
    4245.5,   4104.5,   3955.0,   3798.5,   3635.5,   3467.5,
    3294.5,   3118.5,   2939.5,   2758.5,   2576.5,   2394.0,
    2212.5,   2031.5,   1852.5,   1675.5,   1502.0,   1331.5,
    1165.0,   1003.0,    846.0,    694.0,    547.5,    407.0,
     272.5,    144.0,     22.5,    -92.5,   -201.0,   -302.5,
    -397.0,   -485.0,   -565.5,   -640.0,   -707.0,   -767.5,
    -822.0,   -869.5,   -911.0,   -946.5,   -976.0,  -1000.0,
    1018.5,   1031.5,   1040.0,   1043.5,   1042.5,   1037.5,
    1028.5,   1016.0,   1000.5,    981.0,    959.5,    935.0,
     908.5,    879.5,    849.0,    817.0,    783.5,    749.0,
     714.0,    678.0,    641.5,    605.0,    568.5,    532.0,
     495.5,    459.5,    424.0,    389.5,    355.5,    322.5,
     290.5,    259.5,    229.5,    200.5,    173.5,    147.0,
     122.0,     98.5,     76.5,     55.5,     36.0,     18.0,
    1.0,    -14.5,    -28.5,    -41.5,    -53.0,    -63.5,
     -73.0,    -81.5,    -88.5,    -94.5,   -100.0,   -104.0,
    -107.5,   -110.5,   -112.0,   -113.5,   -114.0,   -114.0,
    -113.5,   -112.5,   -111.0,   -109.0,    106.5,    104.0,
     101.0,     98.0,     95.0,     91.5,     88.0,     84.5,
      80.5,     77.0,     73.5,     69.5,     66.0,     62.5,
      58.5,     55.5,     52.0,     48.5,     45.5,     42.5,
      39.5,     36.5,     34.0,     31.5,     29.0,     26.5,
      24.5,     22.5,     20.5,     19.0,     17.5,     15.5,
      14.5,     13.0,     12.0,     10.5,      9.5,      8.5,
       8.0,      7.0,      6.5,      5.5,      5.0,      4.5,
       4.0,      3.5,      3.5,      3.0,      2.5,      2.5,
       2.0,      2.0,      1.5,      1.5,      1.0,      1.0,
       1.0,      1.0,      0.5,      0.5,      0.5,      0.5,
       0.5,      0.5
]);
