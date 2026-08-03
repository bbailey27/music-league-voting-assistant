#!/usr/bin/env node
// Copy browser-safe pipeline modules into docs/lib/ for GitHub Pages (/docs only
// publishes that folder — ../scripts/ is not reachable on the deployed site).

import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lib = join(root, 'docs/lib');

const ROOT_FILES = [
  'score-core.mjs',
  'extract-html.mjs',
  'parse-text.mjs',
  'cli-commands.mjs',
  'tradeoff-rows.mjs',
  'text-width.mjs',
  'web-table.mjs',
  'web-pick-core.mjs',
  'web-explore.mjs',
  'web-profile.mjs',
];

await mkdir(lib, { recursive: true });
await cp(join(root, 'scripts/score'), join(lib, 'score'), { recursive: true, force: true });
await cp(join(root, 'scripts/parse/cli-table.mjs'), join(lib, 'cli-table.mjs'), { force: true });
await cp(join(root, 'scripts/parse/cli-flags.mjs'), join(lib, 'cli-flags.mjs'), { force: true });
for (const f of ['cli-table.mjs', 'cli-flags.mjs']) {
  let src = await readFile(join(lib, f), 'utf8');
  src = src.replace(/from '\.\.\//g, "from './");
  await writeFile(join(lib, f), src);
}
for (const f of ROOT_FILES) {
  await cp(join(root, 'scripts', f), join(lib, f), { force: true });
}
console.log('Synced browser modules → docs/lib/');
