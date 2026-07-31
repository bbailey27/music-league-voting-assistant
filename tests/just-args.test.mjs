// just recipes must pass quoted flag values through to ml.mjs (positional-arguments + "$@").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, copyFile, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const execFileP = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const fixtureHtml = join(root, 'tests', 'fixtures', 'sample-round', 'sample-round.html');
const ROUND = '2020-01-01-sample-round';
const REASON = 'Closest alignment with the numeric clumps';

async function justPick(env, ...args) {
  return execFileP('just', ['pick', ...args], { cwd: root, env });
}

test('just pick passes --reason values containing spaces', async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'just-args-'));
  const dataDir = join(tmpRoot, 'data');
  const env = { ...process.env, ML_DATA_DIR: dataDir };
  try {
    await mkdir(join(dataDir, 'rounds'), { recursive: true });
    await copyFile(fixtureHtml, join(dataDir, 'rounds', `${ROUND}.html`));
    const analysisDir = join(dataDir, 'analysis', ROUND);

    await execFileP('just', ['parse', ROUND], { cwd: root, env });
    await justPick(env, ROUND, 'A', '--reason', REASON);

    const music = JSON.parse(await readFile(join(analysisDir, 'music.json'), 'utf8'));
    assert.equal(music.pick.reason, REASON);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});
