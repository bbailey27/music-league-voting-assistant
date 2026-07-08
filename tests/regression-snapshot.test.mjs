// The output snapshot regression harness must stay green: regenerating the
// pipeline artifacts for the sample fixture matches the committed baseline.
// If this fails after an intended change, run `just test-regression -- --update`
// (or `node scripts/regression-snapshot.mjs --update`) and commit the baseline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execFileP = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const script = join(root, 'scripts', 'regression-snapshot.mjs');

test('pipeline output matches the committed regression baseline', async () => {
  const { stdout } = await execFileP(process.execPath, [script], { cwd: root });
  assert.match(stdout, /Regression snapshot OK/);
});
