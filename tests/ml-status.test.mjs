// Regression test for `ml status` reporting the optional music.html deliverable
// (ml final writes it for music-only rounds; status used to omit it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, utimes } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const execFileP = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const mlScript = join(root, 'scripts', 'ml.mjs');

const OLDER = new Date(2020, 0, 1);
const NEWER = new Date(2020, 0, 2);

async function makeRound(cwd, name, { jsonNewer = false } = {}) {
  const dir = join(cwd, 'data', 'analysis', name);
  await mkdir(dir, { recursive: true });
  const json = join(dir, 'music.json');
  const html = join(dir, 'music.html');
  await writeFile(json, JSON.stringify({ songs: [] }), 'utf8');
  await writeFile(html, '<!doctype html><title>x</title>', 'utf8');
  // Freshness is mtime(html) >= mtime(json); flip the order to force staleness.
  await utimes(json, jsonNewer ? NEWER : OLDER, jsonNewer ? NEWER : OLDER);
  await utimes(html, jsonNewer ? OLDER : NEWER, jsonNewer ? OLDER : NEWER);
}

async function status(cwd, name) {
  const { stdout } = await execFileP(process.execPath, [mlScript, 'status', name], { cwd });
  return stdout;
}

test('ml status reports a fresh music.html deliverable', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ml-status-test-'));
  try {
    await makeRound(cwd, 'demo-round');
    const out = await status(cwd, 'demo-round');
    assert.match(out, /Music HTML/);
    assert.match(out, /data\/analysis\/demo-round\/music\.html/);
    assert.doesNotMatch(out, /Music HTML.*stale/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('ml status flags a stale music.html', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ml-status-test-'));
  try {
    await makeRound(cwd, 'demo-round', { jsonNewer: true });
    const out = await status(cwd, 'demo-round');
    assert.match(out, /Music HTML.*stale — re-render/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
