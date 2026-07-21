import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionTradeoffsForCli,
  printAppliedAllocationCli,
  printPickCli,
} from '../scripts/parse/cli-print.mjs';

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

// Baseline (option B, no pins): both songs at +2.
const sampleBaseline = new Map([
  [11, { up: 2, down: 0 }],
  [12, { up: 2, down: 0 }],
]);

test('printAppliedAllocationCli lists net diffs under comparison table before Applied', () => {
  const out = captureLog(() =>
    printAppliedAllocationCli(sampleSongs, [], samplePick, { downvoteBankSize: 0 }, {
      hadPins: true,
      baseline: sampleBaseline,
    })
  );
  const pinIdx = out.indexOf('B + pin');
  const diffIdx = out.indexOf('#12 TUNNEL VISION: +2 → +3');
  const appliedIdx = out.indexOf('\nApplied');
  assert.ok(pinIdx >= 0, 'comparison table shown');
  assert.ok(out.includes('Original') && out.includes('Altered'), 'signed baseline/altered columns');
  assert.ok(diffIdx > pinIdx, 'net diffs follow comparison table');
  assert.ok(appliedIdx > diffIdx, 'Applied ballot follows diffs');
});

test('printAppliedAllocationCli warns when pins produce no changes', () => {
  // Baseline matches the applied ballot exactly (both +3) → no net change.
  const baseline = new Map([
    [11, { up: 3, down: 0 }],
    [12, { up: 3, down: 0 }],
  ]);
  const pick = { ...samplePick, tweaks: [] };
  const out = captureLog(() =>
    printAppliedAllocationCli(sampleSongs, [], pick, { downvoteBankSize: 0 }, {
      hadPins: true,
      baseline,
    })
  );
  assert.match(out, /Pins produced no changes/);
  const warnIdx = out.indexOf('Pins produced no changes');
  const appliedIdx = out.indexOf('\nApplied');
  assert.ok(warnIdx > out.indexOf('B + pin'));
  assert.ok(appliedIdx > warnIdx);
});

test('printAppliedAllocationCli renders a shared table for down-only pins', () => {
  // Round with a downvote bank: one song upvoted, two downvoted. A downvote pin
  // moves the down tail; there are no upvote tweaks, but the comparison must still
  // render (down axis) and report the net change — no false "no changes".
  const songs = [
    { rawOrderIndex: 0, title: 'Top Pick', score: 80, combinedScore: 84, gate: 'pass', finalVotes: 3, finalDownvotes: 0 },
    { rawOrderIndex: 1, title: 'Middle', score: 74, combinedScore: 74, gate: 'pass', finalVotes: 0, finalDownvotes: 0 },
    { rawOrderIndex: 2, title: 'Pinned Down', score: 70, combinedScore: 70, gate: 'pass', finalVotes: 0, finalDownvotes: 1 },
    { rawOrderIndex: 3, title: 'Worst', score: 60, combinedScore: 60, gate: 'pass', finalVotes: 0, finalDownvotes: 0 },
  ];
  // Baseline down shape (no pins) put the downvote on the worst song (#3); the pin
  // moved it to #2.
  const baseline = new Map([
    [0, { up: 3, down: 0 }],
    [1, { up: 0, down: 0 }],
    [2, { up: 0, down: 0 }],
    [3, { up: 0, down: 1 }],
  ]);
  const pick = {
    chosen: 'A',
    chosenIndex: 0,
    tweaks: [],
    downTweaks: [{ rawOrderIndex: 2, title: 'Pinned Down', to: -1 }],
    options: [
      {
        letter: 'A',
        isChosen: true,
        perSong: [{ rawOrderIndex: 0, title: 'Top Pick', votes: 3 }],
      },
    ],
  };
  const out = captureLog(() =>
    printAppliedAllocationCli(songs, [], pick, { downvoteBankSize: 1 }, {
      hadPins: true,
      profile: { downShape: 'curved' },
      baseline,
    })
  );
  assert.ok(out.includes('A cv + pin'), 'combo (up + down shape) title');
  assert.doesNotMatch(out, /Pins produced no changes/, 'down change is not "no changes"');
  assert.ok(out.includes('#2 Pinned Down: 0 → -1'), 'gained downvote diff (0, not ·)');
  assert.ok(out.includes('#3 Worst: -1 → 0'), 'lost downvote diff (0, not ·)');
});

test('printPickCli prints per-option labels and the needs-a-tiebreak hint when limited', () => {
  const songs = [
    { rawOrderIndex: 0, title: 'Top', score: 75, finalVotes: 2 },
    { rawOrderIndex: 1, title: 'Mid', score: 75, finalVotes: 2 },
    { rawOrderIndex: 2, title: 'Low', score: 75, finalVotes: 1 },
  ];
  const tradeoffs = [
    {
      kind: 'tier-structure',
      tiebreakLimited: true,
      question: 'Which point split?',
      options: [
        {
          label: '2 tiers (bucket-count 2) — 2×2 / 1×1',
          perSong: [
            { rawOrderIndex: 0, votes: 2 },
            { rawOrderIndex: 1, votes: 2 },
            { rawOrderIndex: 2, votes: 1 },
          ],
        },
        {
          label: '3 tiers (bucket-count 2) — 2×2 / 1×0 · needs a tiebreak (splits 1 tie)',
          separated: true,
          arbitrarySplits: 1,
          perSong: [
            { rawOrderIndex: 0, votes: 3 },
            { rawOrderIndex: 1, votes: 1 },
            { rawOrderIndex: 2, votes: 1 },
          ],
        },
      ],
    },
  ];
  const out = captureLog(() =>
    printPickCli(tradeoffs, 'demo-round', songs, [], { upvoteBankSize: 5, downvoteBankSize: 0 })
  );
  assert.match(out, /A\. 2 tiers \(bucket-count 2\) — 2×2 \/ 1×1/, 'option A label printed');
  assert.match(out, /B\..*needs a tiebreak/, 'option B tiebreak note printed');
  assert.match(out, /Can't add more distinct tiers without a tiebreak/, 'tiebreak hint printed');
  assert.match(out, /just rescore demo-round --score/, 'hint points at rescore --score');
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
