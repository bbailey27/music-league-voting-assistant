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
import { buildVoteTierMap, voteTierHue, voteTierAttrs, pickHtml, buildComboBallot } from '../scripts/render-html-shared.mjs';

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

test('vote tier map assigns discrete hues by rank among non-zero point values', () => {
  const songs = [
    { draftVotes: 3 },
    { draftVotes: 2 },
    { draftVotes: 2 },
    { draftVotes: 1 },
    { draftVotes: 0 },
  ];
  const map = buildVoteTierMap(songs);
  assert.equal(voteTierHue(3, map), 270);
  assert.equal(voteTierHue(2, map), 220);
  assert.equal(voteTierHue(1, map), 145);
  assert.equal(voteTierHue(0, map), null);
  assert.equal(voteTierHue(2, map), voteTierHue(2, map), 'same point value → same hue');
  assert.match(voteTierAttrs(2, map), /--vote-hue:220/);
  assert.match(voteTierAttrs(0, map), /class="score votes"/);
  assert.doesNotMatch(voteTierAttrs(0, map), /--vote-hue/);
});

test('pickHtml "Your pick" table shows applied votes (post-pin), not the frozen option', () => {
  // Applied allocation on the live songs (what pins/reflow produced).
  const songs = [
    { rawOrderIndex: 0, title: 'Alpha', score: 90, combinedScore: 90, finalVotes: 5 },
    { rawOrderIndex: 1, title: 'Beta', score: 80, combinedScore: 80, finalVotes: 3 },
  ];
  // The recorded option froze the PRE-tweak distribution (4/4).
  const pick = {
    chosen: 'A',
    chosenIndex: 0,
    reason: 'test',
    tweaks: [{ rawOrderIndex: 0, title: 'Alpha', from: 4, to: 5 }],
    options: [
      {
        letter: 'A',
        isChosen: true,
        tierCount: 2,
        shape: '4×2',
        perSong: [
          { rawOrderIndex: 0, title: 'Alpha', score: 90, votes: 4 },
          { rawOrderIndex: 1, title: 'Beta', score: 80, votes: 4 },
        ],
      },
    ],
  };
  const html = pickHtml(pick, songs, [], null);
  const pickTable = html.slice(0, html.indexOf('Options considered'));
  // The focused pick table reflects the applied 5/3, not the frozen 4/4.
  assert.match(pickTable, /Alpha<\/td><td class="num">90<\/td><td class="num votes on">5</);
  assert.match(pickTable, /Beta<\/td><td class="num">80<\/td><td class="num votes on">3</);
  assert.doesNotMatch(pickTable, /votes on">4</);
  // Total sums the applied bank.
  assert.match(html, /Total<\/td><td><\/td><td class="num">8<\/td>/);
  // The frozen option distribution still survives in "Options considered".
  assert.match(html.slice(html.indexOf('Options considered')), /Alpha/);
});

test('buildComboBallot shows the option menu BEFORE a pick', () => {
  const tradeoffs = [
    {
      kind: 'tier-structure',
      options: [
        { perSong: [{ rawOrderIndex: 0, votes: 2 }, { rawOrderIndex: 1, votes: 1 }] },
        { perSong: [{ rawOrderIndex: 0, votes: 3 }, { rawOrderIndex: 1, votes: 0 }] },
      ],
    },
  ];
  const songs = [
    { rawOrderIndex: 0, title: 'Alpha', score: 90, finalVotes: 2 },
    { rawOrderIndex: 1, title: 'Beta', score: 80, finalVotes: 1 },
  ];
  const { combos } = buildComboBallot(tradeoffs, songs, [], null);
  assert.equal(combos.length, 2, 'two distinct option columns before a pick');
});

test('buildComboBallot collapses to the applied ballot AFTER a pick', () => {
  // The tier-structure tradeoff persists in music.json even after the pick…
  const tradeoffs = [
    {
      kind: 'tier-structure',
      options: [
        { perSong: [{ rawOrderIndex: 0, votes: 4 }, { rawOrderIndex: 1, votes: 4 }] },
        { perSong: [{ rawOrderIndex: 0, votes: 5 }, { rawOrderIndex: 1, votes: 3 }] },
      ],
    },
  ];
  // …but the applied allocation (post pin/reflow) lives on the songs.
  const songs = [
    { rawOrderIndex: 0, title: 'Alpha', score: 90, finalVotes: 5 },
    { rawOrderIndex: 1, title: 'Beta', score: 80, finalVotes: 3 },
  ];
  const pick = {
    chosen: 'A',
    chosenIndex: 0,
    options: [{ letter: 'A', perSong: [{ rawOrderIndex: 0, votes: 4 }, { rawOrderIndex: 1, votes: 4 }] }],
  };
  const { combos } = buildComboBallot(tradeoffs, songs, [], pick);
  assert.equal(combos.length, 1, 'single applied column after a pick');
  assert.equal(combos[0].perIndex.get(0), 5, 'Alpha reflects applied finalVotes, not option 4');
  assert.equal(combos[0].perIndex.get(1), 3, 'Beta reflects applied finalVotes');
});
