Ex-Changer converts downloads while they happen: **WebP/AVIF → PNG**, **OGG/Opus/MPEG → MP3**, and more. The file data is converted, not just renamed. It also fixes Fandom wiki downloads that arrive as `latest.webp` / `latest.mpeg`: you get the original upload under its real name.

## Install (Chrome, Edge, Brave, Opera, Vivaldi — version 116+)

1. Download **`ex-changer-*.zip`** below and extract it to a folder you will keep (for example `Documents\Ex-Changer`).
2. Open `chrome://extensions` (Edge: `edge://extensions`).
3. Turn on **Developer mode** (Edge: the toggle is in the left sidebar).
4. Click **Load unpacked** and select the extracted folder (the one that contains `manifest.json`).
5. Pin Ex-Changer to the toolbar. The settings page opens on first install.

> Browsers only allow one-click installs from their official stores. Until Ex-Changer is published there, use the steps above. To update, extract the new zip over the same folder and press ⟳ on the extension's card.

## What's inside
- Automatic conversion with per-format rules, image quality settings, MP3 bitrate (96–320 kbps), channel and sample-rate settings
- Fandom: real file names, `format=original` downloads, full size from thumbnails, optional "load originals while browsing"
- MPEG video → MP3 (MP3 tracks are copied losslessly; MP2 tracks are decoded and re-encoded), `.mpeg` files that already contain MP3 are just renamed
- Falls back to the original file if a conversion fails
- Right-click "Save image as PNG / Save audio as MP3", a local and URL converter, and an activity log
