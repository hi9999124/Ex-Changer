# Ex-Changer privacy policy

_Last updated: 7 October 2026_

Ex-Changer is a browser extension that converts files you download. It does not collect, store, sell, or transmit any personal data.

**What the extension processes:** When a download matches your conversion rules, Ex-Changer downloads that same file again from the same address and converts it inside your browser. Files you add to the Converter page are processed the same way. File contents never leave your computer, and nothing is sent to the developer or any third party.

**What is stored, and where:**
- Your settings are kept in your browser's extension storage (`chrome.storage.sync`). If browser sync is enabled, your browser syncs them between your own devices.
- The Activity list (file names, source addresses, and sizes of the last 60 conversions) is kept locally (`chrome.storage.local`). You can clear it at any time from the popup or the Activity page.

**Network requests:** The extension only makes requests to the address a download came from. For Fandom wikis it requests the original version of the same file. It has no analytics, telemetry, advertising, or remote code.

**Permissions:**
- `downloads`: detect downloads and save the converted file.
- `offscreen`: run the converter (image/audio codecs) in a hidden extension page.
- `storage`: save your settings and activity list.
- `contextMenus`: the right-click "Save image as PNG / Save audio as MP3" menu.
- `notifications`: optional desktop notifications when a conversion finishes.
- `declarativeNetRequestWithHostAccess` and host access to all sites: fetch the file again from whichever site it was downloaded from (with its original referrer), and optionally load Fandom images in their original format.

**Contact:** open an issue at https://github.com/hi9999124/Ex-Changer/issues
