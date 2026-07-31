#!/usr/bin/env node
// Copy browser-safe pipeline modules into docs/lib/ for GitHub Pages (/docs only
// publishes that folder — ../scripts/ is not reachable on the deployed site).

import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lib = join(root, 'docs/lib');

await mkdir(lib, { recursive: true });
await cp(join(root, 'scripts/score'), join(lib, 'score'), { recursive: true, force: true });
for (const f of ['score-core.mjs', 'extract-html.mjs', 'parse-text.mjs']) {
  await cp(join(root, 'scripts', f), join(lib, f), { force: true });
}
console.log('Synced browser modules → docs/lib/');
