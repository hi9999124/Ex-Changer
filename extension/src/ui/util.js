// Small UI helpers shared by the popup and the options page.
import { labelOf, kindOf } from '../lib/formats.js';
import { ICONS } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function bytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

export function timeAgo(t) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(t).toLocaleDateString();
}

export const send = (msg) => chrome.runtime.sendMessage({ to: 'ex-changer', ...msg });

export function kindIcon(format) {
  const k = kindOf(format);
  return k === 'audio' ? ICONS.audio : k === 'video' ? ICONS.video : k === 'image' ? ICONS.image : ICONS.file;
}

export function conversionChip(from, to, action) {
  if (!from) return '';
  const a = labelOf(from).split(' ')[0].toUpperCase();
  if (action === 'convert' && to) {
    return `<span class="chip">${esc(a)}<span class="arrow">→</span>${esc(labelOf(to).split(' ')[0].toUpperCase())}</span>`;
  }
  if (action === 'rename') return `<span class="chip" title="Same content, corrected extension">${esc(a)}<span class="arrow">✓</span>name</span>`;
  return `<span class="chip">${esc(a)}</span>`;
}

export const STATUS = {
  queued: ['Queued', 'cream live'],
  fetching: ['Downloading', 'blue live'],
  converting: ['Converting', 'blue live'],
  saving: ['Saving', 'blue live'],
  done: ['Done', 'ok'],
  fallback: ['Original saved', 'warn'],
  failed: ['Failed', 'bad'],
  cancelled: ['Cancelled', ''],
};

export function statusPill(status) {
  const [label, cls] = STATUS[status] || [status, ''];
  return `<span class="pill ${cls}">${esc(label)}</span>`;
}

export function toast(text, kind = '') {
  let host = $('.toast-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    host.setAttribute('role', 'status');
    document.body.append(host);
  }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.innerHTML = `${kind === 'bad' ? ICONS.alert : ICONS.check}<span>${esc(text)}</span>`;
  t.querySelector('svg').style.cssText = `width:15px;height:15px;color:${kind === 'bad' ? 'var(--bad)' : 'var(--ok)'}`;
  host.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2200);
}
