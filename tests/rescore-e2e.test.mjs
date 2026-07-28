// End-to-end for `ml rescore`: parse --fit → pick → rescore over the sample
// fixture in a throwaway ML_DATA_DIR. Asserts rescore re-blends combinedScore from
// stored score/fitScore under new weights, resets the committed pick to draft, and
// never reads HTML or writes picks.jsonl.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
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

const songByIndex = (data, i) => data.songs.find((s) => s.rawOrderIndex === i);

test('rescore re-blends combinedScore under new weights and resets the pick to draft', async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'ml-rescore-'));
  const dataDir = join(tmpRoot, 'data');
  const env = { ...process.env, ML_DATA_DIR: dataDir };
  try {
    await mkdir(join(dataDir, 'rounds'), { recursive: true });
    await copyFile(fixtureHtml, join(dataDir, 'rounds', `${ROUND}.html`));
    const analysisDir = join(dataDir, 'analysis', ROUND);
    const musicJson = join(analysisDir, 'music.json');

    await ml(env, 'parse', ROUND, '--fit');
    const afterParse = JSON.parse(await readFile(musicJson, 'utf8'));
    // song-0 "78 strong fit" resolves a strong tier under the manual-fit default blend.
    assert.equal(songByIndex(afterParse, 0).fitScore, 85);
    assert.deepEqual(afterParse.combineWeights, { fit: 0.5, music: 0.5 });
    const combBefore = songByIndex(afterParse, 0).combinedScore;

    await ml(env, 'pick', ROUND, 'A', '--reason', 'e2e');
    const afterPick = JSON.parse(await readFile(musicJson, 'utf8'));
    assert.equal(afterPick.pick.chosen, 'A', 'pick recorded');

    await ml(env, 'rescore', ROUND, '--weights', '7:3');
    const afterRescore = JSON.parse(await readFile(musicJson, 'utf8'));
    // Re-blended from the stored score/fitScore under the new fit-heavier weights.
    assert.deepEqual(afterRescore.combineWeights, { fit: 0.7, music: 0.3 });
    assert.notEqual(
      songByIndex(afterRescore, 0).combinedScore,
      combBefore,
      're-weighting changed the blended combinedScore'
    );
    assert.equal(afterRescore.pick, undefined, 'committed pick reset to draft');
    assert.ok(afterRescore.tradeoffs.length, 'menu tradeoffs are present again');

    // rescore must not touch the training log (pick wrote one row; rescore adds none).
    const log = await readFile(join(dataDir, 'analysis', 'picks.jsonl'), 'utf8');
    assert.equal(log.trim().split('\n').length, 1, 'rescore writes no picks.jsonl row');
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test('rescore --score overrides the music score + modifier and re-allocates', async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'ml-rescore-score-'));
  const dataDir = join(tmpRoot, 'data');
  const env = { ...process.env, ML_DATA_DIR: dataDir };
  try {
    await mkdir(join(dataDir, 'rounds'), { recursive: true });
    await copyFile(fixtureHtml, join(dataDir, 'rounds', `${ROUND}.html`));
    const musicJson = join(dataDir, 'analysis', ROUND, 'music.json');

    await ml(env, 'parse', ROUND);
    const before = JSON.parse(await readFile(musicJson, 'utf8'));
    // Midnight Bus (index 2) parses at 65 — the bottom of the field.
    assert.equal(songByIndex(before, 2).score, 65);

    // Promote it to the top with a + modifier; no HTML re-parse.
    await ml(env, 'rescore', ROUND, '--score', '2:78+');
    const after = JSON.parse(await readFile(musicJson, 'utf8'));
    const s2 = songByIndex(after, 2);
    assert.equal(s2.score, 78, '--score wrote the new music score');
    assert.equal(s2.plus, true, '--score wrote the + modifier');
    assert.equal(after.songs.reduce((a, s) => a + (s.finalVotes || 0), 0), before.budget.upvoteBankSize);
    assert.ok(after.tradeoffs.length, 're-allocated menu is present');
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test('rescore --score --dry-run does not write music.json', async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'ml-rescore-score-dry-'));
  const dataDir = join(tmpRoot, 'data');
  const env = { ...process.env, ML_DATA_DIR: dataDir };
  try {
    await mkdir(join(dataDir, 'rounds'), { recursive: true });
    await copyFile(fixtureHtml, join(dataDir, 'rounds', `${ROUND}.html`));
    const musicJson = join(dataDir, 'analysis', ROUND, 'music.json');

    await ml(env, 'parse', ROUND);
    const before = await readFile(musicJson, 'utf8');

    const { stdout } = await ml(env, 'rescore', ROUND, '--score', '2:78+', '--dry-run');
    assert.match(stdout, /--score applied/);
    assert.equal(before, await readFile(musicJson, 'utf8'), 'dry-run leaves music.json untouched');
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test('rescore --dry-run does not write and reports the reset', async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'ml-rescore-dry-'));
  const dataDir = join(tmpRoot, 'data');
  const env = { ...process.env, ML_DATA_DIR: dataDir };
  try {
    await mkdir(join(dataDir, 'rounds'), { recursive: true });
    await copyFile(fixtureHtml, join(dataDir, 'rounds', `${ROUND}.html`));
    const analysisDir = join(dataDir, 'analysis', ROUND);

    await ml(env, 'parse', ROUND, '--fit');
    const before = await readFile(join(analysisDir, 'music.json'), 'utf8');

    const { stdout } = await ml(env, 'rescore', ROUND, '--weights', '7:3', '--dry-run');
    assert.match(stdout, /Would rescore/);

    const after = await readFile(join(analysisDir, 'music.json'), 'utf8');
    assert.equal(before, after, 'dry-run leaves music.json untouched');
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test('rescore --pin reflows every option column and persists overrides on profile', async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'ml-rescore-pin-'));
  const dataDir = join(tmpRoot, 'data');
  const env = { ...process.env, ML_DATA_DIR: dataDir };
  try {
    await mkdir(join(dataDir, 'rounds'), { recursive: true });
    await copyFile(fixtureHtml, join(dataDir, 'rounds', `${ROUND}.html`));
    const musicJson = join(dataDir, 'analysis', ROUND, 'music.json');

    await ml(env, 'parse', ROUND);
    const { stdout } = await ml(env, 'rescore', ROUND, '--pin', '2:1,4:1');
    assert.match(stdout, /\nUp\n/, 'rescore --pin prints the Up option table');

    const after = JSON.parse(await readFile(musicJson, 'utf8'));
    assert.deepEqual(after.profile.overrides, { 2: 1, 4: 1 });
    assert.ok(after.menuTradeoffs?.length, 'rescore --pin persists menuTradeoffs');
    const ts = after.tradeoffs.find((t) => t.kind === 'tier-structure');
    assert.ok(ts?.options?.length, 'tier-structure menu present');
    for (const opt of ts.options) {
      const byIdx = Object.fromEntries(opt.perSong.map((p) => [p.rawOrderIndex, p.votes]));
      assert.equal(byIdx[2], 1);
      assert.equal(byIdx[4], 1);
    }
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test('pick without menu flags uses stored tradeoffs from the last explore write', async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'ml-pick-stored-menu-'));
  const dataDir = join(tmpRoot, 'data');
  const env = { ...process.env, ML_DATA_DIR: dataDir };
  try {
    await mkdir(join(dataDir, 'rounds'), { recursive: true });
    await copyFile(fixtureHtml, join(dataDir, 'rounds', `${ROUND}.html`));
    const musicJson = join(dataDir, 'analysis', ROUND, 'music.json');

    await ml(env, 'parse', ROUND);
    const afterParse = JSON.parse(await readFile(musicJson, 'utf8'));
    const ts = afterParse.tradeoffs.find((t) => t.kind === 'tier-structure');
    assert.ok(ts?.options?.length >= 2, 'parse wrote a multi-option menu');

    const storedShape = '9×9 / 0×0';
    ts.options[0].shape = storedShape;
    ts.options[0].label = ts.options[0].label.replace(/^[^—]+—\s*/, `marker — ${storedShape}`);
    for (const p of ts.options[0].perSong) p.votes = 9;
    afterParse.menuTradeoffs = JSON.parse(JSON.stringify(afterParse.tradeoffs));
    await writeFile(musicJson, `${JSON.stringify(afterParse, null, 2)}\n`, 'utf8');

    const { stdout } = await ml(env, 'pick', ROUND, 'A', '--dry-run');
    assert.match(stdout, new RegExp(storedShape.replace(/×/g, '×')));
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test('pick --pin merges with stored pins on the stored unpinned menu', async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'ml-pick-merge-pins-'));
  const dataDir = join(tmpRoot, 'data');
  const env = { ...process.env, ML_DATA_DIR: dataDir };
  try {
    await mkdir(join(dataDir, 'rounds'), { recursive: true });
    await copyFile(fixtureHtml, join(dataDir, 'rounds', `${ROUND}.html`));
    const musicJson = join(dataDir, 'analysis', ROUND, 'music.json');

    await ml(env, 'parse', ROUND);
    const afterParse = JSON.parse(await readFile(musicJson, 'utf8'));
    assert.ok(afterParse.menuTradeoffs?.length, 'parse persists menuTradeoffs');

    const storedShape = afterParse.menuTradeoffs.find((t) => t.kind === 'tier-structure')?.options?.[0]?.shape;
    assert.ok(storedShape, 'stored unpinned option A shape');

    await ml(env, 'rescore', ROUND, '--pin', '2:1');
    const afterRescore = JSON.parse(await readFile(musicJson, 'utf8'));
    assert.deepEqual(afterRescore.profile.overrides, { 2: 1 });
    assert.equal(
      afterRescore.menuTradeoffs.find((t) => t.kind === 'tier-structure')?.options?.[0]?.shape,
      storedShape,
      'rescore --pin keeps the same unpinned option A staircase'
    );

    const { stdout } = await ml(env, 'pick', ROUND, 'A', '--pin', '0:1', '--dry-run');
    assert.match(stdout, new RegExp(storedShape.replace(/[×/]/g, (c) => `\\${c}`)));
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test('pick --cutoff re-allocates instead of reusing a stale stored menu', async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'ml-pick-cutoff-realloc-'));
  const dataDir = join(tmpRoot, 'data');
  const env = { ...process.env, ML_DATA_DIR: dataDir };
  try {
    await mkdir(join(dataDir, 'rounds'), { recursive: true });
    await copyFile(fixtureHtml, join(dataDir, 'rounds', `${ROUND}.html`));
    const musicJson = join(dataDir, 'analysis', ROUND, 'music.json');

    await ml(env, 'parse', ROUND);
    const afterParse = JSON.parse(await readFile(musicJson, 'utf8'));
    const ts = afterParse.tradeoffs.find((t) => t.kind === 'tier-structure');
    const storedShape = '9×9 / 0×0';
    ts.options[0].shape = storedShape;
    for (const p of ts.options[0].perSong) p.votes = 9;
    await writeFile(musicJson, `${JSON.stringify(afterParse, null, 2)}\n`, 'utf8');

    const { stdout } = await ml(env, 'pick', ROUND, 'A', '--cutoff', 'music:90', '--dry-run');
    assert.doesNotMatch(stdout, new RegExp(storedShape.replace(/×/g, '×')));
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test('pick rejects --weights and points to rescore', async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'ml-pick-weights-'));
  const dataDir = join(tmpRoot, 'data');
  const env = { ...process.env, ML_DATA_DIR: dataDir };
  try {
    await mkdir(join(dataDir, 'rounds'), { recursive: true });
    await copyFile(fixtureHtml, join(dataDir, 'rounds', `${ROUND}.html`));
    await ml(env, 'parse', ROUND, '--fit');

    await assert.rejects(
      ml(env, 'pick', ROUND, 'A', '--weights', '7:3'),
      (err) => {
        assert.match(err.stderr, /Deprecated: --weights on pick is inert/);
        assert.match(err.stderr, /just rescore/);
        return true;
      }
    );
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});
