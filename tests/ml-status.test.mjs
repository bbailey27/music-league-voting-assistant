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

test('ml status shows pick row and next final step after pick', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ml-status-test-'));
  try {
    const name = 'picked-round';
    const dir = join(cwd, 'data', 'analysis', name);
    await mkdir(join(cwd, 'data', 'rounds'), { recursive: true });
    await mkdir(dir, { recursive: true });
    await writeFile(join(cwd, 'data', 'rounds', `${name}.html`), '<!doctype html>', 'utf8');
    await writeFile(join(dir, 'music.md'), '# music', 'utf8');
    await writeFile(
      join(dir, 'music.json'),
      JSON.stringify({
        songs: [],
        pick: { chosen: 'B', options: [{ letter: 'A' }, { letter: 'B' }, { letter: 'C' }] },
      }),
      'utf8'
    );
    const out = await status(cwd, name);
    assert.match(out, /Pick recorded.*B \(3 options kept\)/);
    assert.match(out, /Next:.*render music report.*music\.html/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('ml help documents stage commands', async () => {
  const { stdout: overview } = await execFileP(process.execPath, [mlScript, 'help'], { cwd: root });
  assert.match(overview, /parse.*merge.*pick/s);
  assert.match(overview, /\.current-round/);
  assert.match(overview, /pin, flags, tidy, config/);
  const { stdout: pick } = await execFileP(process.execPath, [mlScript, 'help', 'pick'], { cwd: root });
  assert.match(pick, /JSON-only/);
  assert.match(pick, /just pick/);
  assert.match(pick, /--rank combined\|fit\|music/);
  const { stdout: merge } = await execFileP(process.execPath, [mlScript, 'help', 'merge'], { cwd: root });
  assert.match(merge, /--rank combined\|fit\|music/);
  const { stdout: flags } = await execFileP(process.execPath, [mlScript, 'help', 'flags'], { cwd: root });
  assert.match(flags, /--rank combined\|fit\|music\s+✓\s+✓\s+✓/);
});

test('ml parse --fit-words does not treat the flag as a round name', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ml-current-test-'));
  try {
    await execFileP(process.execPath, [mlScript, 'parse', '--fit-words'], { cwd }).catch((err) => {
      assert.match(String(err.stderr), /No round name/);
      assert.doesNotMatch(String(err.stderr), /--fit-words/);
      return null;
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('ml stores and reuses current round', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ml-current-test-'));
  try {
    const name = '2026-06-01-demo';
    await mkdir(join(cwd, 'data', 'rounds'), { recursive: true });
    await writeFile(join(cwd, 'data', 'rounds', `${name}.html`), '<!doctype html>', 'utf8');

    await execFileP(process.execPath, [mlScript, 'status', name], { cwd });

    const { readFile } = await import('node:fs/promises');
    const stored = await readFile(join(cwd, 'data', '.current-round'), 'utf8');
    assert.equal(stored.trim(), name);

    await execFileP(process.execPath, [mlScript, 'merge'], { cwd }).catch((err) => {
      const combined = `${err.stdout ?? ''}${err.stderr ?? ''}`;
      assert.match(combined, /\(current round: 2026-06-01-demo\)/);
      return null;
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
