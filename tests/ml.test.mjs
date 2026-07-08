// Dispatcher coverage for scripts/ml.mjs: subcommands route to the right stage
// script, prerequisite stage errors surface actionable messages, and deprecated
// parse flags redirect to the new stage command.
//
// Runs ml.mjs from the repo root (so scripts/ + node_modules resolve) but points
// ML_DATA_DIR at a throwaway workspace so real rounds are never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, copyFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const execFileP = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const mlScript = join(root, 'scripts', 'ml.mjs');
const fixtureHtml = join(root, 'tests', 'fixtures', 'sample-round', 'sample-round.html');

// Dated id so parse's date-slugging is a no-op and the analysis dir is stable.
const ROUND = '2020-01-01-sample-round';

/** Temp workspace with the sample round staged under rounds/, plus an env pointing at it. */
async function makeWorkspace() {
  const dataDir = join(await mkdtemp(join(tmpdir(), 'ml-dispatch-')), 'data');
  await mkdir(join(dataDir, 'rounds'), { recursive: true });
  await copyFile(fixtureHtml, join(dataDir, 'rounds', `${ROUND}.html`));
  return { dataDir, env: { ...process.env, ML_DATA_DIR: dataDir } };
}

/** Run ml.mjs; resolve to combined stdout+stderr whether it exits 0 or not. */
async function ml(env, ...args) {
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [mlScript, ...args], { cwd: root, env });
    return { code: 0, out: `${stdout}${stderr}` };
  } catch (err) {
    return { code: err.code ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

test('unknown command reports usage and exits non-zero', async () => {
  const { code, out } = await ml(process.env, 'bogus');
  assert.equal(code, 1);
  assert.match(out, /Unknown command "bogus"/);
});

test('pick before parse routes to pick-round and says to parse first', async () => {
  const { dataDir, env } = await makeWorkspace();
  try {
    const { code, out } = await ml(env, 'pick', ROUND, 'A', '--reason', 'x');
    assert.equal(code, 1);
    assert.match(out, /Run just parse first/);
  } finally {
    await rm(dirname(dataDir), { recursive: true, force: true });
  }
});

test('pick without an option letter shows the pick usage guard', async () => {
  const { dataDir, env } = await makeWorkspace();
  try {
    const { code, out } = await ml(env, 'pick', ROUND);
    assert.equal(code, 1);
    assert.match(out, /Usage: ml pick/);
  } finally {
    await rm(dirname(dataDir), { recursive: true, force: true });
  }
});

test('merge before parse routes to merge-scores and says to parse first', async () => {
  const { dataDir, env } = await makeWorkspace();
  try {
    const { code, out } = await ml(env, 'merge', ROUND);
    assert.equal(code, 1);
    assert.match(out, /Run just parse first/);
  } finally {
    await rm(dirname(dataDir), { recursive: true, force: true });
  }
});

test('deprecated --fit on parse redirects to just merge', async () => {
  const { dataDir, env } = await makeWorkspace();
  try {
    const { code, out } = await ml(env, 'parse', ROUND, '--fit', 'auto');
    assert.equal(code, 1);
    assert.match(out, new RegExp(`Deprecated: --fit on parse\\. Use: just merge ${ROUND}`));
  } finally {
    await rm(dirname(dataDir), { recursive: true, force: true });
  }
});

test('deprecated --reason on parse redirects to just pick', async () => {
  const { dataDir, env } = await makeWorkspace();
  try {
    const { code, out } = await ml(env, 'parse', ROUND, '--reason', 'nope');
    assert.equal(code, 1);
    assert.match(out, /Deprecated: --reason on parse\. Use: just pick/);
  } finally {
    await rm(dirname(dataDir), { recursive: true, force: true });
  }
});
