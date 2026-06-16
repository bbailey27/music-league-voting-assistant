// Regression tests for HTML renderers — guards dedup refactors in render-final-html
// and render-fit-html (shared CSS, helpers, cli-args).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const execFileP = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const musicJson = join(here, 'fixtures', 'sample-round', 'music.json');

async function renderScript(script, extraArgs = []) {
  const outDir = await mkdtemp(join(tmpdir(), 'ml-render-test-'));
  const outPath = join(outDir, 'out.html');
  try {
    await execFileP(
      process.execPath,
      [join(root, 'scripts', script), musicJson, '--out', outPath, ...extraArgs],
      { cwd: root }
    );
    return await readFile(outPath, 'utf8');
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

test('render-final-html produces stable card output from sample music.json', async () => {
  const html = await renderScript('render-final-html.mjs');
  assert.ok(html.length > 500, 'expected non-empty HTML');
  assert.match(html, /<style>/);
  assert.match(html, /Starlight/);
  assert.match(html, /City Glow/);
  assert.match(html, /Midnight Bus/);
  assert.match(html, /class="tier"/);
  assert.match(html, /draft votes/);
});

test('render-fit-html produces stable card output from sample music.json', async () => {
  const html = await renderScript('render-fit-html.mjs');
  assert.ok(html.length > 500, 'expected non-empty HTML');
  assert.match(html, /<style>/);
  assert.match(html, /Starlight/);
  assert.match(html, /City Glow/);
  assert.match(html, /Midnight Bus/);
  assert.match(html, /fit report/);
});
