// Image transcoding with the browser's own decoders (WebP, AVIF, PNG, JPEG,
// GIF, BMP, ICO, SVG) and canvas encoders (PNG, JPEG, WebP) plus a small BMP
// writer. Runs in any document context (offscreen document, options page).

import { mimeOf } from '../formats.js';

async function decode(blob, format) {
  if (format !== 'svg' && typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch { /* fall back to <img>, which handles a few more edge cases */ }
  }
  const url = URL.createObjectURL(format === 'svg' ? new Blob([blob], { type: 'image/svg+xml' }) : blob);
  try {
    // load/error events rather than img.decode(): decode() can stay pending
    // forever in a hidden (offscreen) document.
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      const timer = setTimeout(() => reject(new Error('timeout')), 20000);
      el.onload = () => { clearTimeout(timer); resolve(el); };
      el.onerror = () => { clearTimeout(timer); reject(new Error('decode error')); };
      el.src = url;
    });
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (!w || !h) {
      // SVG without intrinsic size: render at a sensible default.
      w = 1024; h = 1024;
    }
    return { image: img, width: w, height: h };
  } catch {
    throw new Error('The browser could not decode this image (unsupported or corrupt file).');
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function fitWithin(w, h, max) {
  if (!max || (w <= max && h <= max)) return [w, h];
  const k = max / Math.max(w, h);
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

function canvasToBlob(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed'))), type, quality);
  });
}

/** 32-bit BGRA BMP (BITMAPV4 header keeps the alpha channel). */
export function encodeBmp(imageData) {
  const { width: w, height: h, data } = imageData;
  const headerSize = 14 + 108;
  const size = headerSize + w * h * 4;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  v.setUint8(0, 0x42); v.setUint8(1, 0x4d);
  v.setUint32(2, size, true);
  v.setUint32(10, headerSize, true);
  v.setUint32(14, 108, true);
  v.setInt32(18, w, true);
  v.setInt32(22, -h, true); // top-down rows
  v.setUint16(26, 1, true);
  v.setUint16(28, 32, true);
  v.setUint32(30, 3, true); // BI_BITFIELDS
  v.setUint32(34, w * h * 4, true);
  v.setInt32(38, 2835, true);
  v.setInt32(42, 2835, true);
  v.setUint32(54, 0x00ff0000, true); // R mask
  v.setUint32(58, 0x0000ff00, true); // G mask
  v.setUint32(62, 0x000000ff, true); // B mask
  v.setUint32(66, 0xff000000, true); // A mask
  v.setUint32(70, 0x73524742, true); // 'sRGB'
  const out = new Uint8Array(buf, headerSize);
  for (let i = 0; i < w * h * 4; i += 4) {
    out[i] = data[i + 2];
    out[i + 1] = data[i + 1];
    out[i + 2] = data[i];
    out[i + 3] = data[i + 3];
  }
  return new Blob([buf], { type: 'image/bmp' });
}

/**
 * @param {Blob} blob source image
 * @param {string} source sniffed source format
 * @param {'png'|'jpeg'|'webp'|'bmp'} target
 * @param {{jpegQuality?: number, webpQuality?: number, jpegBackground?: string, maxDimension?: number}} opts
 * @returns {Promise<{blob: Blob, width: number, height: number}>}
 */
export async function convertImage(blob, source, target, opts = {}) {
  const decoded = await decode(blob, source);
  const srcW = decoded.width;
  const srcH = decoded.height;
  const [w, h] = fitWithin(srcW, srcH, opts.maxDimension);

  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: target === 'bmp' });
  if (target === 'jpeg') {
    ctx.fillStyle = opts.jpegBackground || '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(decoded.image || decoded, 0, 0, w, h);
  if (decoded.close) decoded.close();

  let out;
  if (target === 'bmp') {
    out = encodeBmp(ctx.getImageData(0, 0, w, h));
  } else {
    const type = mimeOf(target);
    const q = target === 'jpeg' ? (opts.jpegQuality ?? 92) / 100
      : target === 'webp' ? (opts.webpQuality ?? 90) / 100 : undefined;
    out = await canvasToBlob(canvas, type, q);
    if (out.type !== type) throw new Error(`This browser cannot encode ${target.toUpperCase()} images.`);
  }
  return { blob: out, width: w, height: h };
}
