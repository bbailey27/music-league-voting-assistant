#!/usr/bin/env node
// Output snapshot regression harness.
//
// Runs the full deterministic pipeline (parse → pick → final) on the committed
// sample-round fixture in a throwaway ML_DATA_DIR, then compares the generated
// artifacts (music.md / music.json / music.html) plus the score-core public
// export list against a committed baseline. Any unexpected diff means behavior
// drift that unit tests didn't catch — the safety net for the score-core module
// split (renderer dedup) and other refactors.
//
// Usage:
//   node scripts/regression-snapshot.mjs            # check against baseline (exit 1 on drift)
//   node scripts/regression-snapshot.mjs --update    # regenerate the baseline after an intended change
//
// A dated fixture id (2020-01-01-…) is used so parse's date-slugging is a no-op
// and the analysis dir name is stable across days.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const FIXTURE_HTML = join(ROOT, 'tests', 'fixtures', 'sample-round', 'sample-round.html');
const SNAP_DIR = join(ROOT, 'tests', 'fixtures', 'sample-round', 'snapshot');
const ROUND_ID = '2020-01-01-sample-round';
const ARTIFACTS = ['music.md', 'music.json', 'music.html'];
const EXPORTS_FILE = 'score-core-exports.txt';

/** Normalize volatile fields so the snapshot only reflects real behavior. */
function normalize(name, text, tmpData) {
  let out = text.split(tmpData).join('DATA');
  if (name.endsWith('.json')) {
    // pickedAt is Date.now() at pick time — replace with a stable sentinel.
    out = out.replace(/("pickedAt":\s*)"[^"]*"/g, '$1"SNAPSHOT"');
  }
  return out;
}

function run(scriptRelPath, args, env) {
  const res = spawnSync('node', [join(ROOT, scriptRelPath), ...args], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    process.stderr.write(res.stdout || '');
    process.stderr.write(res.stderr || '');
    throw new Error(`${scriptRelPath} exited ${res.status}`);
  }
  return res;
}

/** Regenerate artifacts in a temp workspace; return { files: {name: text}, exports }. */
async function generate() {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'ml-regress-'));
  const tmpData = join(tmpRoot, 'data');
  const env = { ...process.env, ML_DATA_DIR: tmpData };
  try {
    mkdirSync(join(tmpData, 'rounds'), { recursive: true });
    const inputPath = join(tmpData, 'rounds', `${ROUND_ID}.html`);
    copyFileSync(FIXTURE_HTML, inputPath);

    run('scripts/parse-round.mjs', [inputPath], env);
    run('scripts/pick-round.mjs', [ROUND_ID, 'A', '--reason', 'regression'], env);

    const analysisDir = join(tmpData, 'analysis', ROUND_ID);
    run('scripts/render-final-html.mjs', [
      join(analysisDir, 'music.json'),
      '--out',
      join(analysisDir, 'music.html'),
    ], env);

    const files = {};
    for (const name of ARTIFACTS) {
      files[name] = normalize(name, readFileSync(join(analysisDir, name), 'utf8'), tmpData);
    }

    const mod = await import(join(ROOT, 'scripts', 'score-core.mjs'));
    const exports = Object.keys(mod).sort().join('\n') + '\n';

    return { files, exports };
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function firstDiff(expected, actual) {
  const e = expected.split('\n');
  const a = actual.split('\n');
  const n = Math.max(e.length, a.length);
  for (let i = 0; i < n; i++) {
    if (e[i] !== a[i]) {
      return `  line ${i + 1}:\n    baseline: ${JSON.stringify(e[i])}\n    current:  ${JSON.stringify(a[i])}`;
    }
  }
  return '  (files differ only in length)';
}

async function main() {
  const update = process.argv.includes('--update');
  const { files, exports } = await generate();
  const entries = [...ARTIFACTS.map((n) => [n, files[n]]), [EXPORTS_FILE, exports]];

  if (update) {
    mkdirSync(SNAP_DIR, { recursive: true });
    for (const [name, text] of entries) writeFileSync(join(SNAP_DIR, name), text, 'utf8');
    console.log(`Updated baseline (${entries.length} files) in ${SNAP_DIR.replace(ROOT + '/', '')}`);
    return;
  }

  const drift = [];
  for (const [name, text] of entries) {
    const baselinePath = join(SNAP_DIR, name);
    if (!existsSync(baselinePath)) {
      drift.push(`${name}: no baseline (run --update to create it)`);
      continue;
    }
    const baseline = readFileSync(baselinePath, 'utf8');
    if (baseline !== text) drift.push(`${name}: differs from baseline\n${firstDiff(baseline, text)}`);
  }

  if (drift.length) {
    console.error('Regression snapshot DRIFT:\n');
    for (const d of drift) console.error(`- ${d}\n`);
    console.error('If intended, re-run with --update and commit the new baseline.');
    process.exit(1);
  }
  console.log(`Regression snapshot OK — ${entries.length} artifacts match baseline.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
