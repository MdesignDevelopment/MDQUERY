/**
 * Copy Monaco's static assets from node_modules into public/ so the editor is
 * served from our own origin — no public CDN dependency, works offline.
 * Runs before `next dev` / `next build` (see package.json scripts); skips the
 * copy when the installed version is already in place.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'monaco-editor', 'min', 'vs');
const dest = join(root, 'public', 'monaco', 'vs');
const marker = join(root, 'public', 'monaco', '.version');

if (!existsSync(src)) {
  console.warn('[copy-monaco] monaco-editor not installed yet — skipping');
  process.exit(0);
}

const version = JSON.parse(readFileSync(join(root, 'node_modules', 'monaco-editor', 'package.json'), 'utf8')).version;
if (existsSync(marker) && readFileSync(marker, 'utf8') === version && existsSync(join(dest, 'loader.js'))) {
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
writeFileSync(marker, version);
console.log(`[copy-monaco] copied monaco-editor ${version} → public/monaco/vs`);
