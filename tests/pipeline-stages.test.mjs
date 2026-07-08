// Stage isolation: parse / merge / pick ownership and pick preservation invariants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJsonPayload, buildPickRecord } from '../scripts/score-core.mjs';
import { buildComboBallot } from '../scripts/render-html-shared.mjs';
import { resolveOptionPick } from '../scripts/parse-round.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

test('buildJsonPayload omits pick when parse completes without a pick step', () => {
  const payload = buildJsonPayload({
    round: { title: 't' },
    budget: { upvoteBankSize: 6 },
    songs: [{ rawOrderIndex: 0, title: 'A', finalVotes: 3 }],
    totalSongs: 1,
    ownSkipped: 0,
    mode: 'objective',
    tradeoffs: [],
    pick: null,
  });
  assert.equal(payload.pick, undefined);
});

test('buildJsonPayload persists manual fit fields on songs', () => {
  const payload = buildJsonPayload({
    round: {},
    budget: {},
    songs: [
      {
        rawOrderIndex: 0,
        title: 'A',
        score: 78,
        fitScore: 85,
        fitTier: 'strong',
        fitSource: 'manual',
        combinedScore: 81.5,
        finalVotes: 2,
      },
    ],
    totalSongs: 1,
    ownSkipped: 0,
    mode: 'subjective',
    tradeoffs: [],
    combineWeights: { fit: 0.5, music: 0.5 },
  });
  assert.equal(payload.songs[0].fitTier, 'strong');
  assert.equal(payload.songs[0].fitSource, 'manual');
  assert.deepEqual(payload.combineWeights, { fit: 0.5, music: 0.5 });
});

test('pick preserves all tier-structure options in buildPickRecord', () => {
  const tradeoffs = [
    {
      kind: 'tier-structure',
      options: [
        {
          tierCount: 2,
          bucketCount: 2,
          shape: '2×3 / 0×1',
          perSong: [
            { rawOrderIndex: 0, title: 'A', score: 80, votes: 3 },
            { rawOrderIndex: 1, title: 'B', score: 70, votes: 0 },
          ],
        },
        {
          tierCount: 1,
          bucketCount: 1,
          shape: '2×3',
          perSong: [
            { rawOrderIndex: 0, title: 'A', score: 80, votes: 2 },
            { rawOrderIndex: 1, title: 'B', score: 70, votes: 1 },
          ],
        },
      ],
    },
  ];
  const { presented } = resolveOptionPick(tradeoffs, 'A');
  const songs = [
    { rawOrderIndex: 0, title: 'A', finalVotes: 3 },
    { rawOrderIndex: 1, title: 'B', finalVotes: 0 },
  ];
  const pick = buildPickRecord({ options: presented, chosenIndex: 0, songs, reason: 'test' });
  assert.equal(pick.options.length, 2);
  assert.equal(pick.options.filter((o) => !o.isChosen).length, 1);
  assert.notEqual(pick.options[1].shape, pick.options[0].shape);
});

test('buildComboBallot collapses to the applied ballot once a pick is recorded', () => {
  // A recorded pick means the ballot is decided — show the single applied allocation
  // (live finalVotes), not the A/B/C option columns. The multi-column menu is only
  // for BEFORE a pick.
  const songs = [
    { rawOrderIndex: 0, title: 'A', finalVotes: 3 },
    { rawOrderIndex: 1, title: 'B', finalVotes: 0 },
  ];
  const pick = {
    options: [
      {
        letter: 'A',
        perSong: [
          { rawOrderIndex: 0, votes: 3 },
          { rawOrderIndex: 1, votes: 0 },
        ],
      },
      {
        letter: 'B',
        perSong: [
          { rawOrderIndex: 0, votes: 2 },
          { rawOrderIndex: 1, votes: 1 },
        ],
      },
    ],
  };
  const { combos } = buildComboBallot([], songs, [], pick);
  assert.equal(combos.length, 1, 'single applied column after a pick');
  assert.equal(combos[0].perIndex.get(0), 3, 'applied finalVotes for A');
  assert.equal(combos[0].perIndex.get(1), 0, 'applied finalVotes for B');
});

test('pick-round.mjs does not read round HTML', async () => {
  const src = await readFile(join(root, 'scripts', 'pick-round.mjs'), 'utf8');
  assert.doesNotMatch(src, /parseHTML|extract-html|parseRoundHtml/);
  assert.doesNotMatch(src, /ROUNDS_DIR|data\/rounds/);
  assert.doesNotMatch(src, /readFile\([^)]*\.html/);
});

test('merge-scores.mjs does not read round HTML', async () => {
  const src = await readFile(join(root, 'scripts', 'merge-scores.mjs'), 'utf8');
  assert.doesNotMatch(src, /parseHTML|extract-html|parseRoundHtml/);
  assert.doesNotMatch(src, /ROUNDS_DIR|data\/rounds/);
  assert.doesNotMatch(src, /readFile\([^)]*\.html/);
});
