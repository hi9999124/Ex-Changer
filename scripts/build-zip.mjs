// Packs extension/ into dist/ex-changer-<version>.zip for the Chrome Web
// Store or for sharing. Uses the system `zip` tool.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url).pathname;
const { version } = JSON.parse(fs.readFileSync(`${root}extension/manifest.json`, 'utf8'));
fs.mkdirSync(`${root}dist`, { recursive: true });
const out = `${root}dist/ex-changer-${version}.zip`;
fs.rmSync(out, { force: true });
execFileSync('zip', ['-r', '-q', '-X', out, '.', '-x', '.*'], { cwd: `${root}extension`, stdio: 'inherit' });
console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
