import { loadSettings, saveSettings, resetSettings, DEFAULT_RULES } from '../lib/settings.js';
import { FORMATS, labelOf, targetsFor, kindOf, formatFromExt, sniff } from '../lib/formats.js';
import { buildFilename, splitExt } from '../lib/filename.js';
import { convertBlob } from '../lib/convert/index.js';
import { mountAmbient } from '../ui/ambient.js';
import { ICONS, LOGO } from '../ui/icons.js';
import { $, $$, esc, bytes, timeAgo, send, kindIcon, conversionChip, statusPill, toast } from '../ui/util.js';

const ACTIVE = new Set(['queued', 'fetching', 'converting', 'saving']);
let settings = await loadSettings();
let jobs = (await chrome.storage.local.get('history')).history || [];

mountAmbient();
$('#search-icon').innerHTML = ICONS.search;

// ---------------------------------------------------------------------------
// Section definitions
// ---------------------------------------------------------------------------
const opt = (pairs) => pairs.map(([value, label]) => ({ value, label }));

const SECTIONS = [
  {
    nav: 'Settings', id: 'general', icon: ICONS.general, title: 'General',
    desc: 'Ex-Changer takes over matching downloads, converts the actual file data and saves the result — it never just renames a file to a different extension.',
    groups: [
      {
        rows: [
          { key: 'enabled', type: 'toggle', title: 'Convert downloads automatically', desc: 'Watch every download and apply your conversion rules as it happens.' },
        ],
      },
      {
        title: 'Where it works',
        desc: 'These apply to automatic conversion. The right-click menu and the converter always work.',
        rows: [
          { key: 'scope', type: 'select', title: 'Default for all sites', desc: 'Choose which sites Ex-Changer converts downloads from.', options: opt([['all', 'All sites'], ['fandom', 'Fandom wikis only'], ['list', 'Only listed sites']]) },
        ],
        note: () => settings.scope === 'all' ? 'Ex-Changer works everywhere except sites you exclude in Sites.'
          : settings.scope === 'fandom' ? 'Only downloads from fandom.com / wikia.nocookie.net are converted.'
            : 'Only sites on your allow list in Sites are converted.',
      },
      {
        title: 'Behaviour',
        rows: [
          { key: 'fixExtensions', type: 'toggle', title: 'Fix wrong file extensions', desc: 'Detect the real format from the file bytes. “latest.mpeg” that is really MP3 is saved as “.mp3”, a fake “.png” that is WebP gets converted.' },
          { key: 'skipSameFormat', type: 'toggle', title: 'Never re-encode the same format', desc: 'If a file is already in the target format, keep the original bytes (no quality loss).' },
          { key: 'fallbackToOriginal', type: 'toggle', title: 'Save the original if conversion fails', desc: 'You never lose a download — if anything goes wrong the untouched file is saved instead.' },
          { key: 'saveAs', type: 'toggle', title: 'Ask where to save each file', desc: 'Show the Save As dialog for converted files.' },
          { key: 'subfolder', type: 'text', title: 'Save into subfolder', desc: 'Relative to your Downloads folder. Leave empty to save next to other downloads.', placeholder: 'e.g. Ex-Changer' },
          { key: 'underscoresToSpaces', type: 'toggle', title: 'Replace underscores with spaces', desc: 'Wiki file names use “_” for spaces: “Main_Theme.ogg” → “Main Theme.mp3”.' },
          { key: 'conflictAction', type: 'select', title: 'When a file already exists', desc: 'What to do if the folder already has a file with that name.', options: opt([['uniquify', 'Keep both'], ['overwrite', 'Overwrite']]) },
          { key: 'maxSizeMB', type: 'select', title: 'Maximum file size', desc: 'Larger downloads are left alone. Conversion happens in memory.', options: opt([[64, '64 MB'], [128, '128 MB'], [256, '256 MB'], [512, '512 MB'], [1024, '1 GB'], [0, 'No limit']]), number: true },
          { key: 'notify', type: 'toggle', title: 'Desktop notifications', desc: 'Show a notification when a conversion finishes or fails.' },
          { key: 'contextMenu', type: 'toggle', title: 'Right-click menu', desc: 'Adds “Ex-Changer → Save image as PNG / Save audio as MP3 …” to images, audio, video and links.' },
        ],
      },
    ],
  },
  {
    nav: 'Settings', id: 'rules', icon: ICONS.rules, title: 'Conversion rules',
    desc: 'Pick what each format becomes when it is downloaded. Formats set to “Keep” are saved unchanged (but still get a corrected name).',
    keywords: 'rules webp png avif jpeg gif bmp ico svg mp3 ogg opus wav flac aac m4a mpeg mp4 webm mkv ts video audio image target format convert',
    render: renderRulesSection,
  },
  {
    nav: 'Settings', id: 'images', icon: ICONS.image, title: 'Images',
    desc: 'Encoding options for converted images. Decoding uses the browser’s own codecs, so WebP, AVIF, GIF, BMP, ICO and SVG are all supported.',
    groups: [
      {
        rows: [
          { key: 'jpegQuality', type: 'range', min: 40, max: 100, step: 1, unit: '%', title: 'JPEG quality', desc: 'Higher is sharper and larger. 90–95 is visually lossless.' },
          { key: 'webpQuality', type: 'range', min: 40, max: 100, step: 1, unit: '%', title: 'WebP quality', desc: 'Used when converting to WebP. 100 is near-lossless.' },
          { key: 'jpegBackground', type: 'color', title: 'JPEG background', desc: 'JPEG has no transparency; transparent areas are filled with this colour.' },
          { key: 'maxDimension', type: 'select', title: 'Resize large images', desc: 'Scale down so the longest side fits. PNG output is lossless either way.', options: opt([[0, 'Keep original size'], [4096, '4096 px'], [2048, '2048 px'], [1920, '1920 px'], [1280, '1280 px'], [1024, '1024 px'], [512, '512 px']]), number: true },
        ],
        note: () => 'Animated WebP and GIF are converted from their first frame.',
      },
    ],
  },
  {
    nav: 'Settings', id: 'audio', icon: ICONS.audio, title: 'Audio',
    desc: 'Audio is fully decoded and re-encoded with the LAME MP3 encoder. MPEG videos have their audio track extracted — MP3 tracks are copied without re-encoding.',
    groups: [
      {
        rows: [
          { key: 'mp3Bitrate', type: 'select', title: 'MP3 bitrate', desc: '192 kbps is transparent for most music. 320 kbps is the maximum.', options: opt([[96, '96 kbps'], [128, '128 kbps'], [160, '160 kbps'], [192, '192 kbps'], [224, '224 kbps'], [256, '256 kbps'], [320, '320 kbps']]), number: true },
          { key: 'mp3Channels', type: 'select', title: 'Channels', desc: 'Auto keeps mono files mono and down-mixes surround to stereo.', options: opt([['auto', 'Auto'], ['stereo', 'Stereo'], ['mono', 'Mono']]) },
          { key: 'sampleRate', type: 'select', title: 'Sample rate', desc: 'Audio is resampled to this rate.', options: opt([[48000, '48 kHz'], [44100, '44.1 kHz'], [32000, '32 kHz'], [22050, '22.05 kHz']]), number: true },
          { key: 'wavBitDepth', type: 'select', title: 'WAV bit depth', desc: 'Used when converting to WAV.', options: opt([[16, '16-bit PCM'], [24, '24-bit PCM'], [32, '32-bit float']]), number: true },
        ],
      },
    ],
  },
  {
    nav: 'Settings', id: 'fandom', icon: ICONS.fandom, title: 'Fandom wikis',
    desc: 'Fandom’s CDN re-encodes uploads to WebP and serves every file as “latest”. These options fetch the original upload with its real name.',
    groups: [
      {
        title: 'Downloads',
        rows: [
          { key: 'fandomFixNames', type: 'toggle', title: 'Use the real file name', desc: '“latest.webp” becomes “Character_Art.png”, “latest.mpeg” becomes “Main_Theme.mp3”.' },
          { key: 'fandomOriginal', type: 'toggle', title: 'Download the original upload', desc: 'Requests format=original so you get the uploaded PNG/JPEG/OGG instead of a re-compressed WebP.' },
          { key: 'fandomFullSize', type: 'toggle', title: 'Full size from thumbnails', desc: 'Saving a scaled thumbnail downloads the full-resolution file instead.' },
        ],
      },
      {
        title: 'Loading',
        rows: [
          { key: 'fandomLoadOriginals', type: 'toggle', title: 'Load originals while browsing', desc: 'Wiki pages load images in their original format, so drag-and-drop, copy and “Save image as…” also give PNG/JPEG. Pages may load a little slower.' },
        ],
      },
    ],
  },
  {
    nav: 'Settings', id: 'sites', icon: ICONS.globe, title: 'Sites',
    desc: 'Control which websites automatic conversion applies to.',
    keywords: 'sites domains allow list block exclude websites add',
    render: renderSitesSection,
  },
  {
    nav: 'Tools', id: 'converter', icon: ICONS.convert, title: 'Converter',
    desc: 'Convert files from your computer or from a link. Everything runs locally in your browser — nothing is uploaded.',
    keywords: 'converter drop files local url link convert upload drag',
    render: renderConverterSection,
  },
  {
    nav: 'Tools', id: 'activity', icon: ICONS.activity, title: 'Activity',
    desc: 'Recent downloads Ex-Changer handled.',
    keywords: 'activity history recent log downloads jobs',
    render: renderActivitySection,
  },
  {
    nav: 'Tools', id: 'about', icon: ICONS.info, title: 'About',
    desc: 'How Ex-Changer works, supported formats and credits.',
    keywords: 'about version help credits license reset formats supported',
    render: renderAboutSection,
  },
];

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
let current = (location.hash || '#general').slice(1);
if (!SECTIONS.some((s) => s.id === current)) current = 'general';

function renderNav() {
  let lastGroup = '';
  const active = jobs.filter((j) => ACTIVE.has(j.status)).length;
  $('#nav').innerHTML = SECTIONS.map((s) => {
    const head = s.nav !== lastGroup ? `<div class="nav-group">${esc(s.nav)}</div>` : '';
    lastGroup = s.nav;
    const count = s.id === 'activity' && active ? `<span class="count">${active}</span>` : '';
    return `${head}<button class="nav-item" data-id="${s.id}" ${s.id === current ? 'aria-current="page"' : ''}>${s.icon}<span>${esc(s.title)}</span>${count}</button>`;
  }).join('');
}

$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('.nav-item');
  if (!b) return;
  go(b.dataset.id);
});

function go(id) {
  current = id;
  history.replaceState(null, '', `#${id}`);
  $('#search').value = '';
  renderNav();
  renderSections();
  $('#content').scrollTop = 0;
}

window.addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  if (id !== current && SECTIONS.some((s) => s.id === id)) go(id);
});

// ---------------------------------------------------------------------------
// Generic rows
// ---------------------------------------------------------------------------
function highlight(text, q) {
  const safe = esc(text);
  if (!q) return safe;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return safe;
  return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
}

function controlHtml(r) {
  const v = settings[r.key];
  switch (r.type) {
    case 'toggle':
      return `<input type="checkbox" class="switch" data-key="${r.key}" ${v ? 'checked' : ''} aria-label="${esc(r.title)}">`;
    case 'select':
      return `<select class="select" data-key="${r.key}" ${r.number ? 'data-number' : ''} aria-label="${esc(r.title)}">${r.options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    case 'text':
      return `<input class="input" style="width:220px" data-key="${r.key}" value="${esc(v)}" placeholder="${esc(r.placeholder || '')}" aria-label="${esc(r.title)}">`;
    case 'range': {
      const fill = ((v - r.min) / (r.max - r.min)) * 100;
      return `<input type="range" data-key="${r.key}" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}" style="--fill:${fill}%" aria-label="${esc(r.title)}"><span class="value" data-value-for="${r.key}">${v}${r.unit || ''}</span>`;
    }
    case 'color':
      return `<input type="color" data-key="${r.key}" value="${esc(v)}" aria-label="${esc(r.title)}"><span class="value">${esc(String(v).toUpperCase())}</span>`;
    default:
      return '';
  }
}

function rowMatches(r, q) {
  return !q || `${r.title} ${r.desc} ${r.key}`.toLowerCase().includes(q);
}

function renderRowsSection(sec, q) {
  const groups = sec.groups.map((g) => {
    const rows = g.rows.filter((r) => rowMatches(r, q) || (q && `${sec.title} ${g.title || ''}`.toLowerCase().includes(q)));
    if (!rows.length) return '';
    const disabled = (r) => r.key !== 'enabled' && sec.id === 'general' && !settings.enabled && r.key !== 'contextMenu';
    return `
      <div class="group">
        ${g.title ? `<h3 class="group-title">${esc(g.title)}</h3>` : ''}
        ${g.desc ? `<p class="group-desc">${esc(g.desc)}</p>` : ''}
        ${rows.map((r) => `
          <div class="row ${disabled(r) ? 'disabled' : ''}">
            <div class="label"><div class="title">${highlight(r.title, q)}</div><div class="desc">${highlight(r.desc, q)}</div></div>
            <div class="control">${controlHtml(r)}</div>
          </div>`).join('')}
        ${g.note && !q ? `<div class="note">${ICONS.info}<span>${esc(g.note())}</span></div>` : ''}
      </div>`;
  }).join('');
  return groups.trim() ? groups : null;
}

function sectionHeader(sec) {
  const tile = sec.id === 'general' ? `<div class="tile logo">${LOGO}</div>` : `<div class="tile">${sec.icon}</div>`;
  return `<header class="section-header">${tile}<h2>${esc(sec.id === 'general' ? 'Ex-Changer settings' : sec.title)}</h2><p>${esc(sec.desc)}</p></header>`;
}

function renderSections() {
  const q = $('#search').value.trim().toLowerCase();
  const host = $('#sections');
  document.body.classList.toggle('searching', !!q);
  const out = [];
  for (const sec of SECTIONS) {
    if (!q && sec.id !== current) continue;
    let body;
    if (sec.groups) body = renderRowsSection(sec, q);
    else if (!q || `${sec.title} ${sec.desc} ${sec.keywords || ''}`.toLowerCase().includes(q)) body = '';
    else body = null;
    if (body === null) continue;
    out.push({ sec, body });
  }
  host.innerHTML = out.map(({ sec, body }) => `<section class="section" data-section="${sec.id}">${sectionHeader(sec)}<div class="section-body">${body}</div></section>`).join('');
  for (const { sec } of out) {
    if (sec.render) sec.render($(`[data-section="${sec.id}"] .section-body`, host));
  }
  $('#no-results').hidden = out.length > 0;
  $('#q').textContent = q;
}

$('#search').addEventListener('input', renderSections);
document.addEventListener('keydown', (e) => {
  if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && document.activeElement?.tagName !== 'INPUT') {
    e.preventDefault();
    $('#search').focus();
  }
  if (e.key === 'Escape' && document.activeElement === $('#search')) {
    $('#search').value = '';
    renderSections();
  }
});

// Settings changes from generic controls
$('#sections').addEventListener('change', async (e) => {
  const el = e.target;
  const key = el.dataset.key;
  if (!key) return;
  let value;
  if (el.type === 'checkbox') value = el.checked;
  else if (el.type === 'range' || el.dataset.number !== undefined) value = Number(el.value);
  else value = el.value;
  settings = await saveSettings({ [key]: value });
  if (['enabled', 'scope'].includes(key)) renderSections();
  toast('Saved');
});

$('#sections').addEventListener('input', (e) => {
  const el = e.target;
  if (el.type === 'range') {
    const fill = ((el.value - el.min) / (el.max - el.min)) * 100;
    el.style.setProperty('--fill', `${fill}%`);
    const out = $(`[data-value-for="${el.dataset.key}"]`);
    if (out) out.textContent = `${el.value}%`;
  } else if (el.type === 'color') {
    el.nextElementSibling.textContent = el.value.toUpperCase();
  }
});

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------
const PRESETS = {
  recommended: { label: 'Recommended', rules: DEFAULT_RULES },
  'all-png-mp3': {
    label: 'Everything → PNG / MP3',
    rules: Object.fromEntries(Object.keys(FORMATS).filter((f) => !FORMATS[f].undecodable).map((f) => {
      const k = kindOf(f);
      if (k === 'image') return [f, f === 'png' || f === 'svg' ? 'keep' : 'png'];
      if (k === 'audio') return [f, f === 'mp3' ? 'keep' : 'mp3'];
      return [f, 'keep'];
    })),
  },
  'video-audio': {
    label: 'Video → MP3 too',
    rules: { ...DEFAULT_RULES, mp4: 'mp3', webm: 'mp3', mkv: 'mp3', ts: 'mp3', ogv: 'mp3' },
  },
  none: { label: 'Keep everything', rules: Object.fromEntries(Object.keys(FORMATS).map((f) => [f, 'keep'])) },
};

// While searching, narrow the rule list to matching formats (if any match).
function visibleFormats(kind, q) {
  const all = Object.keys(FORMATS).filter((f) => !FORMATS[f].undecodable);
  const hits = q ? all.filter((f) => `${f} ${labelOf(f)}`.toLowerCase().includes(q)) : [];
  return (hits.length ? hits : all).filter((f) => FORMATS[f].kind === kind);
}

function renderRulesSection(host) {
  const q = $('#search').value.trim().toLowerCase();
  const cols = [
    ['image', 'Images', ICONS.image],
    ['audio', 'Audio', ICONS.audio],
    ['video', 'Video (audio track)', ICONS.video],
  ];
  host.innerHTML = `
    <div class="rule-toolbar">
      ${Object.entries(PRESETS).map(([id, p]) => `<button class="btn sm" data-preset="${id}">${esc(p.label)}</button>`).join('')}
    </div>
    <div class="rule-cols">
      ${cols.filter(([kind]) => visibleFormats(kind, q).length).map(([kind, title, icon]) => `
        <div class="rule-col glass">
          <h3>${icon}${esc(title)}</h3>
          ${visibleFormats(kind, q).map((f) => {
              const to = settings.rules[f] || 'keep';
              return `
                <div class="rule ${to !== 'keep' ? 'on' : ''}">
                  <span class="src" title="${esc(labelOf(f))}">${highlight(labelOf(f).split(' ')[0].toUpperCase(), q)}</span>
                  <span class="arrow">→</span>
                  <select class="select" data-rule="${f}" aria-label="${esc(labelOf(f))} becomes">
                    <option value="keep" ${to === 'keep' ? 'selected' : ''}>Keep ${esc(labelOf(f).split(' ')[0])}</option>
                    ${targetsFor(f).filter((t) => t !== f).map((t) => `<option value="${t}" ${to === t ? 'selected' : ''}>${esc(labelOf(t))}</option>`).join('')}
                  </select>
                </div>`;
            }).join('')}
        </div>`).join('')}
    </div>
    <div class="note blue">${ICONS.info}<span>MPEG is handled smartly: a “.mpeg” file that already contains MP3 audio is just renamed; real MPEG video has its audio track extracted (MP3 tracks are copied losslessly, MP2 tracks are decoded and encoded to MP3).</span></div>`;

  host.addEventListener('change', async (e) => {
    const f = e.target.dataset.rule;
    if (!f) return;
    settings = await saveSettings({ rules: { [f]: e.target.value } });
    e.target.closest('.rule').classList.toggle('on', e.target.value !== 'keep');
    toast(`${labelOf(f)} → ${e.target.value === 'keep' ? 'kept as is' : labelOf(e.target.value)}`);
  });
  host.addEventListener('click', async (e) => {
    const p = e.target.closest('[data-preset]');
    if (!p) return;
    settings = await saveSettings({ rules: PRESETS[p.dataset.preset].rules });
    renderSections();
    toast(`Preset applied: ${PRESETS[p.dataset.preset].label}`);
  });
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------
function normaliseDomain(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '');
  if (!/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(s)) return '';
  return s;
}

function siteTable(key, title, desc, emptyText) {
  const list = settings[key] || [];
  return `
    <div class="group" data-list="${key}">
      <div class="sites-head">
        <div><h3 class="group-title">${esc(title)}</h3><p class="group-desc">${esc(desc)}</p></div>
        <button class="btn light" data-add="${key}">${ICONS.plus}Add websites</button>
      </div>
      <div class="add-row" hidden>
        <input class="input" placeholder="example.com, *.fandom.com — separate several with commas" aria-label="Domains to add">
        <button class="btn primary" data-save="${key}">Add</button>
        <button class="btn ghost" data-cancel>Cancel</button>
      </div>
      <div class="table">
        <div class="th">Domain</div>
        <ul>
          ${list.length ? list.map((d) => `<li><span>${esc(d)}</span><button class="btn ghost icon sm danger" data-remove="${key}" data-domain="${esc(d)}" title="Remove ${esc(d)}">${ICONS.close}</button></li>`).join('')
            : `<li class="empty">${esc(emptyText)}</li>`}
        </ul>
      </div>
    </div>`;
}

function renderSitesSection(host) {
  host.innerHTML = `
    <div class="row">
      <div class="label"><div class="title">Default for all sites</div><div class="desc">Choose whether Ex-Changer converts on all sites by default.</div></div>
      <div class="control">${controlHtml(SECTIONS[0].groups[1].rows[0])}</div>
    </div>
    <div class="note">${ICONS.info}<span>${esc(SECTIONS[0].groups[1].note())}</span></div>
    ${settings.scope === 'list' ? siteTable('siteList', 'Allowed sites', 'Ex-Changer converts downloads from these sites only', 'No sites added yet.') : ''}
    ${siteTable('excludeList', 'Excluded sites', 'Ex-Changer never touches downloads from these sites', 'No sites added yet.')}`;

  host.onclick = async (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      const g = add.closest('.group');
      const row = $('.add-row', g);
      row.hidden = false;
      $('input', row).focus();
      return;
    }
    if (e.target.closest('[data-cancel]')) { e.target.closest('.add-row').hidden = true; return; }
    const save = e.target.closest('[data-save]');
    if (save) return addDomains(save.dataset.save, $('input', save.closest('.add-row')).value);
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const key = rm.dataset.remove;
      settings = await saveSettings({ [key]: (settings[key] || []).filter((d) => d !== rm.dataset.domain) });
      renderSections();
      toast(`Removed ${rm.dataset.domain}`);
    }
    return undefined;
  };
  host.onkeydown = (e) => {
    if (e.key === 'Enter' && e.target.closest('.add-row')) {
      addDomains(e.target.closest('.group').dataset.list, e.target.value);
    }
  };
  host.onchange = async (e) => {
    if (e.target.dataset.key === 'scope') {
      e.stopPropagation();
      settings = await saveSettings({ scope: e.target.value });
      renderSections();
      toast('Saved');
    }
  };
}

async function addDomains(key, raw) {
  const parts = String(raw).split(/[\s,]+/).map(normaliseDomain);
  const bad = String(raw).split(/[\s,]+/).filter((p, i) => p && !parts[i]);
  const add = parts.filter(Boolean);
  if (!add.length) { toast(bad.length ? `Not a valid domain: ${bad[0]}` : 'Enter a domain', 'bad'); return; }
  const next = [...new Set([...(settings[key] || []), ...add])];
  settings = await saveSettings({ [key]: next });
  renderSections();
  toast(`Added ${add.length} site${add.length > 1 ? 's' : ''}`);
}

// ---------------------------------------------------------------------------
// Converter (local files and URLs)
// ---------------------------------------------------------------------------
const localFiles = []; // {id, file, status, phase, progress, result, error, url, previewUrl}
let convTarget = 'auto';
let converting = false;

function renderConverterSection(host) {
  host.innerHTML = `
    <div class="drop" tabindex="0" role="button" aria-label="Choose files to convert">
      <span class="glyph">${ICONS.convert}</span>
      <strong>Drop files here or click to browse</strong>
      <span>WebP, AVIF, GIF, BMP, ICO, SVG, JPEG, PNG · MP3, MPEG, OGG, Opus, FLAC, WAV, M4A · MP4, WebM, MPG, TS</span>
      <input type="file" multiple hidden accept="image/*,audio/*,video/*,.mpeg,.mpg,.ts,.opus,.ogg,.oga,.flac,.mka,.mkv">
    </div>
    <div class="conv-bar">
      <label for="conv-target">Convert to</label>
      <select class="select" id="conv-target">
        <option value="auto">Use my rules</option>
        <optgroup label="Image"><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option><option value="bmp">BMP</option></optgroup>
        <optgroup label="Audio"><option value="mp3">MP3</option><option value="wav">WAV</option></optgroup>
      </select>
      <input class="input grow" id="conv-url" placeholder="…or paste a link to an image, sound or video" aria-label="File URL">
      <button class="btn primary" id="conv-url-go">${ICONS.link}Convert link</button>
    </div>
    <ul class="files" id="files"></ul>`;

  $('#conv-target', host).value = convTarget;
  $('#conv-target', host).onchange = (e) => { convTarget = e.target.value; };
  const drop = $('.drop', host);
  const input = $('input[type=file]', host);
  drop.onclick = () => input.click();
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
  input.onchange = () => { addFiles([...input.files]); input.value = ''; };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    addFiles([...e.dataTransfer.files]);
  };
  $('#conv-url-go', host).onclick = convertUrl;
  $('#conv-url', host).onkeydown = (e) => { if (e.key === 'Enter') convertUrl(); };
  $('#files', host).onclick = onFileAction;
  renderFiles();
}

async function convertUrl() {
  const el = $('#conv-url');
  const url = el.value.trim();
  if (!/^https?:\/\//i.test(url)) { toast('Enter a full http(s) link', 'bad'); return; }
  const r = await send({ type: 'convert-url', url, forced: convTarget === 'auto' ? null : convTarget });
  if (r?.ok) { el.value = ''; toast('Converting — see Activity'); } else toast(r?.error || 'Could not start', 'bad');
}

function addFiles(files) {
  for (const file of files) {
    localFiles.unshift({ id: Math.random().toString(36).slice(2), file, status: 'queued', phase: 'Queued', progress: 0, target: convTarget });
  }
  renderFiles();
  pumpLocal();
}

async function pumpLocal() {
  if (converting) return;
  converting = true;
  try {
    for (;;) {
      const item = [...localFiles].reverse().find((f) => f.status === 'queued');
      if (!item) break;
      item.status = 'converting';
      item.phase = 'Reading';
      renderFiles();
      try {
        const { stem, ext } = splitExt(item.file.name);
        const head = new Uint8Array(await item.file.slice(0, 4096).arrayBuffer());
        const result = await convertBlob(item.file, {
          settings,
          forced: item.target === 'auto' ? null : item.target,
          originalExt: ext,
          hint: sniff(head) || formatFromExt(item.file.name),
          onProgress: (phase, v) => { item.phase = phase; item.progress = v || 0; renderFilesThrottled(); },
        });
        item.result = result;
        item.stem = stem;
        item.url = URL.createObjectURL(result.blob);
        if (kindOf(result.actual) === 'image') item.previewUrl = URL.createObjectURL(item.file);
        item.status = 'done';
      } catch (e) {
        item.status = 'failed';
        item.error = e?.message || String(e);
      }
      renderFiles();
    }
  } finally {
    converting = false;
  }
}

let rfTimer = 0;
function renderFilesThrottled() {
  if (rfTimer) return;
  rfTimer = setTimeout(() => { rfTimer = 0; renderFiles(); }, 120);
}

function renderFiles() {
  const host = $('#files');
  if (!host) return;
  if (!localFiles.length) { host.innerHTML = ''; return; }
  host.innerHTML = localFiles.map((f) => {
    const r = f.result;
    const pct = Math.round((f.progress || 0) * 100);
    const outName = r ? buildFilename(f.stem, r.action === 'keep' ? (r.ext || r.actual) : r.target, { underscoresToSpaces: settings.underscoresToSpaces }) : '';
    const thumb = f.previewUrl ? `<img src="${f.previewUrl}" alt="">` : kindIcon(r?.actual || formatFromExt(f.file.name));
    return `
      <li class="file glass" data-id="${f.id}">
        <div class="thumb">${thumb}</div>
        <div class="body" style="min-width:0">
          <div class="name" title="${esc(f.file.name)}">${esc(r ? outName : f.file.name)}</div>
          <div class="meta">
            ${r ? conversionChip(r.actual, r.target, r.action) : ''}
            <span>${f.status === 'converting' ? esc(f.phase) : r ? `${bytes(f.file.size)} → ${bytes(r.blob.size)}` : bytes(f.file.size)}</span>
            ${r?.detail ? `<span>· ${esc(r.detail)}</span>` : ''}
            ${r && r.action === 'keep' ? '<span>· no rule for this format, kept as is</span>' : ''}
          </div>
          ${f.status === 'converting' ? `<div class="progress ${pct ? '' : 'indeterminate'}"><i style="--p:${pct}%"></i></div>` : ''}
          ${f.status === 'failed' ? `<div class="err">${esc(f.error)}</div>` : ''}
          ${r && kindOf(r.target) === 'audio' ? `<audio controls preload="none" src="${f.url}"></audio>` : ''}
        </div>
        <div class="side">
          ${f.status === 'converting' ? '<span class="spinner" aria-label="Converting"></span>' : ''}
          ${f.status === 'queued' ? statusPill('queued') : ''}
          ${f.status === 'failed' ? statusPill('failed') : ''}
          ${f.status === 'done' ? `<button class="btn primary sm" data-act="save">${ICONS.download}Save</button>` : ''}
          ${f.status !== 'converting' ? `<button class="btn ghost icon sm danger" data-act="remove" title="Remove">${ICONS.close}</button>` : ''}
        </div>
      </li>`;
  }).join('');
}

async function onFileAction(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.file').dataset.id;
  const i = localFiles.findIndex((f) => f.id === id);
  const f = localFiles[i];
  if (!f) return;
  if (btn.dataset.act === 'save') {
    const r = f.result;
    const filename = buildFilename(f.stem, r.action === 'keep' ? (r.ext || r.actual) : r.target, {
      subfolder: settings.subfolder, underscoresToSpaces: settings.underscoresToSpaces,
    });
    const res = await send({ type: 'save-file', url: f.url, filename }).catch((err) => ({ ok: false, error: err?.message }));
    if (res?.ok) toast(`Saved ${filename.split('/').pop()}`);
    else toast(res?.error || 'Could not save', 'bad');
  } else if (btn.dataset.act === 'remove') {
    if (f.url) URL.revokeObjectURL(f.url);
    if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    localFiles.splice(i, 1);
    renderFiles();
  }
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------
function renderActivitySection(host) {
  const clearBtn = jobs.some((j) => !ACTIVE.has(j.status)) ? `<button class="btn sm" id="act-clear">${ICONS.trash}Clear finished</button>` : '';
  if (!jobs.length) {
    host.innerHTML = `<div class="empty-block"><span class="spinner" style="animation:none;border-color:rgba(var(--accent-rgb),.3)"></span><strong>No activity yet</strong><span>Downloads that Ex-Changer converts or renames will show up here.</span></div>`;
    return;
  }
  host.innerHTML = `
    <div class="rule-toolbar">${clearBtn}</div>
    <ul class="activity-list">
      ${jobs.map((j) => {
        const active = ACTIVE.has(j.status);
        const name = j.filename ? j.filename.split('/').pop() : `${j.stem}${j.originalExt ? `.${j.originalExt}` : ''}`;
        const pct = Math.round((j.progress || 0) * 100);
        return `
          <li class="act glass" data-id="${esc(j.id)}">
            <span class="kind">${kindIcon(j.target || j.actual || j.hint)}</span>
            <div style="min-width:0">
              <div class="name" title="${esc(name)}">${esc(name)}</div>
              <div class="meta">
                ${conversionChip(j.actual || j.hint, j.target, j.action)}
                ${j.sizeIn ? `<span>${bytes(j.sizeIn)}${j.sizeOut ? ` → ${bytes(j.sizeOut)}` : ''}</span>` : ''}
                ${j.detail ? `<span>· ${esc(j.detail)}</span>` : ''}
                <span>· ${esc(j.source === 'auto' ? 'automatic' : j.source === 'menu' ? 'right-click' : j.source)}</span>
                <span>· ${timeAgo(j.createdAt)}</span>
              </div>
              <div class="meta"><span class="url" title="${esc(j.url)}">${esc(j.url)}</span></div>
              ${j.error ? `<div class="meta err">${esc(j.error)}</div>` : ''}
              ${active ? `<div class="progress ${pct ? '' : 'indeterminate'}"><i style="--p:${pct}%"></i></div>` : ''}
            </div>
            <div class="side">
              ${statusPill(j.status)}
              ${j.status === 'done' && j.downloadId != null ? `<button class="btn ghost icon sm" data-act="show" title="Show in folder">${ICONS.folder}</button>` : ''}
              ${!active ? `<button class="btn ghost icon sm" data-act="retry" title="Run again">${ICONS.retry}</button>` : ''}
              ${!active ? `<button class="btn ghost icon sm danger" data-act="remove" title="Remove">${ICONS.close}</button>` : ''}
            </div>
          </li>`;
      }).join('')}
    </ul>`;
  host.onclick = async (e) => {
    if (e.target.closest('#act-clear')) { await send({ type: 'clear-history' }); return; }
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('.act').dataset.id;
    const job = jobs.find((j) => j.id === id);
    if (btn.dataset.act === 'show') {
      try { chrome.downloads.show(job.downloadId); } catch { toast('File no longer exists', 'bad'); }
    } else if (btn.dataset.act === 'retry') {
      const r = await send({ type: 'retry', id });
      toast(r?.ok ? 'Running again' : r?.error || 'Could not retry', r?.ok ? '' : 'bad');
    } else if (btn.dataset.act === 'remove') {
      await send({ type: 'remove-job', id });
    }
  };
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------
function renderAboutSection(host) {
  const m = chrome.runtime.getManifest();
  const imgs = Object.keys(FORMATS).filter((f) => FORMATS[f].kind === 'image' && !FORMATS[f].undecodable).map((f) => labelOf(f)).join(', ');
  const auds = Object.keys(FORMATS).filter((f) => FORMATS[f].kind !== 'image').map((f) => labelOf(f)).join(', ');
  host.innerHTML = `
    <div class="group">
      <h3 class="group-title">How it works</h3>
      <ol class="steps">
        <li><b>Intercept.</b> When a download matches a rule (or comes from Fandom), the browser’s copy is cancelled before it is written.</li>
        <li><b>Fetch.</b> The file is fetched again — for Fandom with <code>format=original</code>, so you get the uploaded file, not a WebP re-encode.</li>
        <li><b>Detect.</b> The real format is read from the file’s bytes, not its name or the server’s headers.</li>
        <li><b>Convert.</b> Images are decoded and re-encoded with canvas; audio is decoded with Web Audio (MP2 with a built-in decoder) and encoded with LAME.</li>
        <li><b>Save.</b> The new file is saved with the real name and the correct extension. If anything fails, the original is saved instead.</li>
      </ol>
    </div>
    <div class="group">
      <h3 class="group-title">Supported formats</h3>
      <dl class="kv">
        <dt>Read images</dt><dd>${esc(imgs)}</dd>
        <dt>Write images</dt><dd>PNG, JPEG, WebP, BMP</dd>
        <dt>Read audio / video</dt><dd>${esc(auds)}</dd>
        <dt>Write audio</dt><dd>MP3 (LAME), WAV (16/24-bit PCM, 32-bit float)</dd>
      </dl>
      <div class="note">${ICONS.info}<span>Video files can be turned into MP3/WAV (their audio track). Re-encoding video to another video format is not supported.</span></div>
    </div>
    <div class="group">
      <h3 class="group-title">Extension</h3>
      <dl class="kv">
        <dt>Version</dt><dd>${esc(m.version)}</dd>
        <dt>MP3 encoder</dt><dd>lamejs (LGPL-3.0)</dd>
        <dt>MP2 decoder</dt><dd>Port of JSMpeg / kjmp2 (MIT)</dd>
      </dl>
    </div>
    <div class="group">
      <div class="row">
        <div class="label"><div class="title">Reset all settings</div><div class="desc">Restore the recommended rules and defaults. Your activity list is kept.</div></div>
        <div class="control"><button class="btn danger" id="reset">${ICONS.retry}Reset</button></div>
      </div>
    </div>`;
  $('#reset', host).onclick = async () => {
    if (!confirm('Reset all Ex-Changer settings to their defaults?')) return;
    settings = await resetSettings();
    renderSections();
    toast('Settings reset');
  };
}

// ---------------------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------------------
function renderEngine() {
  const active = jobs.filter((j) => ACTIVE.has(j.status)).length;
  const pill = $('#engine');
  if (!settings.enabled) { pill.className = 'pill'; pill.textContent = 'Paused'; }
  else if (active) { pill.className = 'pill blue live'; pill.textContent = `Converting ${active}`; }
  else { pill.className = 'pill ok'; pill.textContent = 'Watching downloads'; }
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && changes.history) {
    jobs = changes.history.newValue || [];
    renderNav();
    renderEngine();
    if (current === 'activity' && !$('#search').value) {
      renderActivitySection($('[data-section="activity"] .section-body'));
    }
  }
  if (area === 'sync' && changes.settings) {
    settings = await loadSettings();
    renderEngine();
  }
});

renderNav();
renderSections();
renderEngine();
