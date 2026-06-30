import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionTradeoffsForCli, printAppliedAllocationCli } from '../scripts/parse/cli-print.mjs';

function captureLog(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = orig;
  }
  return lines.join('\n');
}

const sampleSongs = [
  {
    rawOrderIndex: 11,
    title: 'You Problem',
    score: 77,
    combinedScore: 79.6,
    fitScore: 93,
    gate: 'pass',
    finalVotes: 3,
  },
  {
    rawOrderIndex: 12,
    title: 'TUNNEL VISION',
    score: 77,
    combinedScore: 79.6,
    fitScore: 93,
    gate: 'pass',
    finalVotes: 3,
  },
];

const samplePick = {
  chosen: 'B',
  chosenIndex: 1,
  tweaks: [
    { rawOrderIndex: 12, title: 'TUNNEL VISION', from: 2, to: 3 },
    { rawOrderIndex: 11, title: 'You Problem', from: 2, to: 3 },
  ],
  options: [
    { letter: 'A', isChosen: false, perSong: [] },
    {
      letter: 'B',
      isChosen: true,
      perSong: [
        { rawOrderIndex: 12, title: 'TUNNEL VISION', votes: 2 },
        { rawOrderIndex: 11, title: 'You Problem', votes: 2 },
      ],
    },
  ],
};

test('printAppliedAllocationCli lists tweaks under comparison table before Applied', () => {
  const out = captureLog(() =>
    printAppliedAllocationCli(sampleSongs, [], samplePick, { downvoteBankSize: 0 })
  );
  const pinIdx = out.indexOf('B + pin');
  const tweakIdx = out.indexOf('#12 TUNNEL VISION: 2 → 3');
  const appliedIdx = out.indexOf('\nApplied');
  assert.ok(pinIdx >= 0, 'comparison table shown');
  assert.ok(tweakIdx > pinIdx, 'tweaks follow comparison table');
  assert.ok(appliedIdx > tweakIdx, 'Applied ballot follows tweaks');
});

test('printAppliedAllocationCli warns when pins produce no changes', () => {
  const pick = {
    ...samplePick,
    tweaks: [],
  };
  const out = captureLog(() =>
    printAppliedAllocationCli(sampleSongs, [], pick, { downvoteBankSize: 0 }, { hadPins: true })
  );
  assert.match(out, /Pins produced no changes/);
  const warnIdx = out.indexOf('Pins produced no changes');
  const appliedIdx = out.indexOf('\nApplied');
  assert.ok(warnIdx > out.indexOf('B + pin'));
  assert.ok(appliedIdx > warnIdx);
});

test('actionTradeoffsForCli keeps ties and drops pick tables', () => {
  const tradeoffs = [
    { kind: 'tier-structure', question: 'Which point split?' },
    { kind: 'tier-split', question: 'Tied score 64.3', options: [{ label: 'Song A — 1' }] },
    { kind: 'down-structure', question: 'Which downvote shape?' },
    { kind: 'forced-spill', question: 'Leftover points on blank songs' },
    { kind: 'budget-mismatch', question: 'Bank not fully spent' },
  ];
  const notes = actionTradeoffsForCli(tradeoffs);
  assert.deepEqual(
    notes.map((t) => t.kind),
    ['tier-split', 'forced-spill', 'budget-mismatch']
  );
});
