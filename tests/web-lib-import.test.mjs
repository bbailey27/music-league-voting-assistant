import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const lib = join(import.meta.dirname, '..', 'docs', 'lib');

/** Keep in sync with scripts/sync-web-lib.mjs ROOT_FILES */
const ROOT_FILES = [
  'score-core.mjs',
  'extract-html.mjs',
  'parse-text.mjs',
  'cli-commands.mjs',
  'cli-table.mjs',
  'tradeoff-rows.mjs',
  'text-width.mjs',
  'web-table.mjs',
  'web-pick-core.mjs',
  'web-explore.mjs',
  'web-profile.mjs',
  'cli-flags.mjs',
];

test('docs/lib has browser transitive deps', () => {
  for (const f of ROOT_FILES) {
    assert.ok(existsSync(join(lib, f)), `missing docs/lib/${f} — run just sync-web`);
  }
  assert.ok(existsSync(join(lib, 'score', 'render.mjs')));
});

test('docs/lib/score-core.mjs loads in Node (same graph as browser)', async () => {
  const mod = await import('../docs/lib/score-core.mjs');
  assert.equal(typeof mod.allocate, 'function');
  assert.equal(typeof mod.scoreComment, 'function');
  assert.equal(typeof mod.buildJsonPayload, 'function');
});

test('docs/lib/web-table.mjs loads and builds pick tables', async () => {
  const { buildPickTables } = await import('../docs/lib/web-table.mjs');
  assert.equal(typeof buildPickTables, 'function');
});
