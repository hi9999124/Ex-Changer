import { loadSettings, saveSettings } from '../lib/settings.js';
import { labelOf } from '../lib/formats.js';
import { mountAmbient } from '../ui/ambient.js';
import { ICONS, LOGO } from '../ui/icons.js';
import { $, esc, bytes, timeAgo, send, kindIcon, conversionChip, statusPill, toast } from '../ui/util.js';

const ACTIVE = new Set(['queued', 'fetching', 'converting', 'saving']);

mountAmbient({ spacing: 18, radius: 90 });
$('#logo').innerHTML = LOGO;
$('#open-converter').innerHTML = `${ICONS.convert}<span>Converter</span>`;
$('#open-settings').innerHTML = `${ICONS.settings}<span>Settings</span>`;

function openOptions(hash) {
  const url = chrome.runtime.getURL(`src/options/options.html${hash ? `#${hash}` : ''}`);
  chrome.tabs.create({ url });
  window.close();
}
$('#open-converter').addEventListener('click', () => openOptions('converter'));
$('#open-settings').addEventListener('click', () => openOptions('general'));
$('#edit-rules').addEventListener('click', () => openOptions('rules'));

function renderStatus(s) {
  $('#enabled').checked = s.enabled;
  const pill = $('#status');
  pill.className = `pill ${s.enabled ? 'blue' : ''}`;
  const scope = s.scope === 'fandom' ? 'Fandom only' : s.scope === 'list' ? 'Listed sites' : 'All sites';
  pill.textContent = s.enabled ? `Active · ${scope}` : 'Paused';
  document.body.classList.toggle('paused', !s.enabled);
}

function renderRules(s) {
  const active = Object.entries(s.rules).filter(([, to]) => to && to !== 'keep');
  const host = $('#rule-chips');
  if (!active.length) {
    host.innerHTML = '<span class="empty">No conversion rules — files keep their format.</span>';
    return;
  }
  host.innerHTML = active
    .map(([from, to]) => `<span class="chip">${esc(labelOf(from).split(' ')[0].toUpperCase())}<span class="arrow">→</span>${esc(labelOf(to).toUpperCase())}</span>`)
    .join('');
}

function renderJobs(list) {
  const host = $('#jobs');
  $('#clear').hidden = !list.some((j) => !ACTIVE.has(j.status));
  if (!list.length) {
    host.innerHTML = `
      <li class="empty-state">
        <span class="glyph">${ICONS.sparkle}</span>
        <strong>Nothing converted yet</strong>
        <p>Download a WebP image or an OGG/MPEG sound (from a Fandom wiki, for example) and it will be converted and appear here.</p>
      </li>`;
    return;
  }
  host.innerHTML = list.slice(0, 25).map((j) => {
    const active = ACTIVE.has(j.status);
    const name = j.filename ? j.filename.split('/').pop() : `${j.stem}${j.originalExt ? `.${j.originalExt}` : ''}`;
    const sizes = j.sizeOut && j.sizeIn ? `${bytes(j.sizeIn)} → ${bytes(j.sizeOut)}` : j.sizeIn ? bytes(j.sizeIn) : '';
    const pct = Math.round((j.progress || 0) * 100);
    return `
      <li class="job ${esc(j.status)}" data-id="${esc(j.id)}">
        <span class="kind">${kindIcon(j.target || j.actual || j.hint)}</span>
        <div class="body">
          <div class="name" title="${esc(name)}">${esc(name)}</div>
          <div class="meta">
            ${conversionChip(j.actual || j.hint, j.target, j.action)}
            <span>${active ? esc(j.phase || '') : esc(sizes || timeAgo(j.updatedAt || j.createdAt))}</span>
          </div>
          ${active ? `<div class="progress ${pct ? '' : 'indeterminate'}"><i style="--p:${pct}%"></i></div>` : ''}
          ${j.error && !active ? `<div class="err" title="${esc(j.error)}">${esc(j.error)}</div>` : ''}
        </div>
        <div class="side">
          ${statusPill(j.status)}
          <div class="actions">
            ${j.status === 'done' && j.downloadId != null ? `<button class="btn ghost icon sm" data-act="show" title="Show in folder">${ICONS.folder}</button>` : ''}
            ${!active ? `<button class="btn ghost icon sm" data-act="retry" title="Run again">${ICONS.retry}</button>` : ''}
            ${!active ? `<button class="btn ghost icon sm danger" data-act="remove" title="Remove from list">${ICONS.close}</button>` : ''}
          </div>
        </div>
      </li>`;
  }).join('');
}

$('#jobs').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.job').dataset.id;
  const { history = [] } = await chrome.storage.local.get('history');
  const job = history.find((j) => j.id === id);
  if (!job) return;
  if (btn.dataset.act === 'show') {
    try { chrome.downloads.show(job.downloadId); } catch { toast('File no longer exists', 'bad'); }
  } else if (btn.dataset.act === 'retry') {
    const r = await send({ type: 'retry', id });
    toast(r?.ok ? 'Running again' : r?.error || 'Could not retry', r?.ok ? '' : 'bad');
  } else if (btn.dataset.act === 'remove') {
    await send({ type: 'remove-job', id });
  }
});

$('#clear').addEventListener('click', () => send({ type: 'clear-history' }));

$('#enabled').addEventListener('change', async (e) => {
  const s = await saveSettings({ enabled: e.target.checked });
  renderStatus(s);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.history) renderJobs(changes.history.newValue || []);
  if (area === 'sync' && changes.settings) {
    loadSettings().then((s) => { renderStatus(s); renderRules(s); });
  }
});

(async () => {
  const s = await loadSettings();
  renderStatus(s);
  renderRules(s);
  const { history = [] } = await chrome.storage.local.get('history');
  renderJobs(history);
})();

// Keep relative times fresh while the popup is open.
setInterval(async () => {
  const { history = [] } = await chrome.storage.local.get('history');
  renderJobs(history);
}, 30000);
