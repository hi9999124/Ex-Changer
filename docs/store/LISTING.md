# Store listing kit (Microsoft Edge Add-ons and Chrome Web Store)

Upload package: `ex-changer-<version>.zip` from the GitHub release (`manifest.json` sits at the zip root).
Images: this folder (`docs/store/`). Regenerate them with `npm run store-assets`.

## Name
Ex-Changer — Download Converter

## Short description (max 132 characters)
Auto-converts downloads: WebP/AVIF to PNG, OGG/Opus/MPEG to MP3. Fixes Fandom wiki 'latest.webp' and 'latest.mpeg' files.

## Category
Productivity (Edge) / Tools (Chrome)

## Detailed description
Ex-Changer converts files while you download them, and it converts the actual file data. Renaming `image.webp` to `image.png` doesn't make it a PNG; Ex-Changer decodes the file and re-encodes it, so the result works everywhere.

WHAT IT CONVERTS
• Images: WebP, AVIF, BMP, ICO, GIF, SVG → PNG, JPEG, WebP or BMP
• Audio: OGG Vorbis, Opus, MP2, FLAC, WAV, AAC/M4A → MP3 (LAME encoder, 96–320 kbps) or WAV
• Video: MPEG, MPEG-TS, MP4, WebM → MP3 (audio track). MP3 tracks are copied without quality loss.

FANDOM WIKIS
Fandom serves its files as "latest", and its CDN replaces uploads with WebP copies. Ex-Changer:
• saves files under their real name ("Main_Theme.mp3", not "latest.mpeg")
• downloads the original upload instead of the re-compressed WebP
• saves full-size images even when you save a thumbnail
• can load original images while you browse, so copy and drag-and-drop give PNG/JPEG too

SMART, SAFE
• Detects the real format from the file's bytes, so files with a wrong extension get fixed
• Never re-encodes a file that is already in the target format
• If a conversion fails, the original file is saved, so you never lose a download
• Runs locally in your browser: no uploads, no tracking, no ads

ALSO INCLUDED
• Right-click: Save image as PNG/JPEG/WebP/BMP, Save audio as MP3/WAV
• Converter page: drop files from your computer or paste a link
• Activity log with sizes, "show in folder" and "retry"
• Per-format rules, quality and bitrate settings, site allow/block lists, subfolder, Save As dialog

## Single purpose (Chrome)
Convert downloaded media files (images and audio) into the formats the user chooses, with correct file names.

## Permission justifications (Chrome "Privacy practices" tab)
- downloads: Detects downloads that match the user's conversion rules, cancels the unconverted copy and saves the converted file.
- offscreen: The image and audio codecs (canvas, Web Audio, MP3 encoder worker) need a DOM context, which the service worker lacks.
- storage: Stores the user's settings and the local activity list.
- contextMenus: Adds "Save image as PNG / Save audio as MP3" to the right-click menu.
- notifications: Optional notification when a conversion finishes or fails (off by default).
- declarativeNetRequestWithHostAccess: Forwards the original referrer when re-fetching a file, and (optional, off by default) rewrites Fandom image requests to load the original format.
- Host permission <all_urls>: Downloads can come from any site; the extension must fetch the same file from that site to convert it.
- Remote code: No. All code is in the package.

## Data usage (Chrome) / privacy (Edge)
Collects no user data. Privacy policy URL:
https://github.com/hi9999124/Ex-Changer/blob/claude/epic-fermi-x3bpe3/PRIVACY.md
(If you later move the code to a `main` branch, update this link.)

## Notes for certification (Edge) / test instructions (Chrome)
No login needed. To test:
1. Open any Fandom wiki page with an image, right-click the image → Save image as… (or use the Ex-Changer → Save image as PNG menu). The file is saved as a PNG with its real name.
2. Open a Fandom sound file (any .ogg on a wiki "File:" page) and download it. It is saved as an .mp3.
3. Settings: click the toolbar icon → Settings.

## Images in this folder
| File | Size | Use |
|---|---|---|
| logo-300.png | 300×300 | Edge logo (required) |
| icon-128.png | 128×128 | Chrome store icon |
| promo-small-440x280.png | 440×280 | Small promo tile (Edge required, Chrome) |
| promo-marquee-1400x560.png | 1400×560 | Marquee promo tile (optional) |
| screenshot-1…5.png | 1280×800 | Screenshots |
