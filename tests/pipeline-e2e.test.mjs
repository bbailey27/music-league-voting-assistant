// End-to-end pipeline over the sample fixture: parse → pick → final through the
// ml dispatcher, asserting each stage's artifacts land and the recorded pick is
// present. Complements pipeline-stages.test.mjs (which checks in-process
// invariants) by exercising the real spawned scripts against a temp workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, copyFile, readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const execFileP = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const mlScript = join(root, 'scripts', 'ml.mjs');
const fixtureHtml = join(root, 'tests', 'fixtures', 'sample-round', 'sample-round.html');
const ROUND = '2020-01-01-sample-round';

async function ml(env, ...args) {
  return execFileP(process.execPath, [mlScript, ...args], { cwd: root, env });
}

test('parse → pick → final produces artifacts with the recorded pick', async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'ml-e2e-'));
  const dataDir = join(tmpRoot, 'data');
  const env = { ...process.env, ML_DATA_DIR: dataDir };
  try {
    await mkdir(join(dataDir, 'rounds'), { recursive: true });
    await copyFile(fixtureHtml, join(dataDir, 'rounds', `${ROUND}.html`));
    const analysisDir = join(dataDir, 'analysis', ROUND);

    await ml(env, 'parse', ROUND);
    // Parse writes music artifacts but records no pick yet.
    const afterParse = JSON.parse(await readFile(join(analysisDir, 'music.json'), 'utf8'));
    assert.equal(afterParse.pick, undefined, 'parse must not record a pick');
    await stat(join(analysisDir, 'music.md'));

    await ml(env, 'pick', ROUND, 'A', '--reason', 'e2e');
    const afterPick = JSON.parse(await readFile(join(analysisDir, 'music.json'), 'utf8'));
    assert.equal(afterPick.pick.chosen, 'A', 'pick block records the chosen option');
    assert.ok(afterPick.pick.options.length >= 1, 'pick keeps its options');

    await ml(env, 'final', ROUND);
    const html = await readFile(join(analysisDir, 'music.html'), 'utf8');
    assert.match(html, /<html/i);
    assert.ok(html.length > 200, 'rendered music.html is non-trivial');

    // picks.jsonl training log gets one row.
    const log = await readFile(join(dataDir, 'analysis', 'picks.jsonl'), 'utf8');
    assert.match(log, new RegExp(`"round":\\s*"${ROUND}"`));
    assert.match(log, /"chosen":\s*"A"/);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});
