import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayWidth } from '../scripts/text-width.mjs';
import {
  cliScoreCells,
  cliScoreHeaders,
  cliShowsCombined,
  expandTradeoffRows,
  formatCliComment,
  formatCliCombinedScore,
  formatCliFitScore,
  formatCliMod,
  formatCliScore,
  fmtCliBallotVote,
  fmtCliBallotVoteTotal,
  fmtCliVoteCell,
  isExcludedFromAllocation,
} from '../scripts/parse/cli-table.mjs';

test('formatCliScore marks blank and disqualified rows', () => {
  assert.equal(formatCliScore({ needsUserInput: true }), 'BLANK');
  assert.equal(formatCliScore({ isDisqualified: true, score: null }), '-');
  assert.equal(formatCliScore({ score: 76, plus: true }), '76');
});

test('formatCliCombinedScore and cliShowsCombined', () => {
  assert.equal(formatCliCombinedScore({ combinedScore: 78.5 }), '78.5');
  assert.equal(formatCliCombinedScore({ combinedScore: null }), '-');
  assert.equal(formatCliCombinedScore({ isOwn: true, combinedScore: 80 }), '—');
  assert.equal(formatCliFitScore({ fitScore: 85 }), '85');
  assert.equal(formatCliFitScore({ fitScore: null }), '-');
  assert.equal(cliShowsCombined([{ score: 75 }], []), false);
  assert.equal(cliShowsCombined([{ score: 75, combinedScore: 77 }], []), true);
  assert.deepEqual(cliScoreHeaders(true), ['Music', 'Fit', 'Combined']);
  assert.deepEqual(cliScoreCells({ score: 75, fitScore: 80, combinedScore: 77.5 }, true), [
    '75',
    '80',
    '77.5',
  ]);
});

test('fmtCliBallotVote: signed when both banks, plain otherwise', () => {
  assert.equal(fmtCliBallotVote({ finalVotes: 2 }, true), '+2');
  assert.equal(fmtCliBallotVote({ finalDownvotes: 1 }, true), '-1');
  assert.equal(fmtCliBallotVote({ finalVotes: 2 }, false), '2');
  assert.equal(fmtCliBallotVote({ finalDownvotes: 1 }, false), '1');
  assert.equal(fmtCliBallotVote({ finalVotes: 0, finalDownvotes: 0 }, true), '·');
  assert.equal(fmtCliBallotVoteTotal(8, 4, true), '+8/-4');
  assert.equal(fmtCliBallotVoteTotal(8, 0, false), '8');
});

test('fmtCliVoteCell: plain up counts, minus on down', () => {
  assert.equal(fmtCliVoteCell(2), '2');
  assert.equal(fmtCliVoteCell(0), '·');
  assert.equal(fmtCliVoteCell(1, { down: true }), '-1');
  assert.equal(fmtCliVoteCell(0, { down: true }), '·');
});

test('formatCliMod shows parsed modifiers', () => {
  assert.equal(formatCliMod({ score: 75, plus: true, minusUncertain: true, minus: true }), '+-?');
  assert.equal(formatCliMod({ isDisqualified: true }), 'DQ');
});

test('formatCliComment truncates user comment', () => {
  assert.equal(formatCliComment({ userComment: 'great bridge' }), 'great bridge');
  assert.equal(formatCliComment({}), '·');
  const long = 'x'.repeat(40);
  assert.equal(displayWidth(formatCliComment({ userComment: long }, 28)), 28);
});

test('formatCliComment shows scoring line only (ignores vote prose after newline)', () => {
  assert.equal(
    formatCliComment({ userComment: '9 9\nAlmost did this one' }),
    '9 9'
  );
  assert.equal(
    formatCliComment({ userComment: '76 fit bonus\r\nLove this one' }),
    '76 fit bonus'
  );
});

test('expandTradeoffRows appends missing and disqualified songs', () => {
  const perSong = [
    { rawOrderIndex: 0, title: 'A', score: 80, votes: 3 },
    { rawOrderIndex: 2, title: 'C', score: 70, votes: 0 },
  ];
  const songs = [
    { rawOrderIndex: 0, title: 'A', score: 80 },
    { rawOrderIndex: 1, title: 'B', needsUserInput: true, userComment: 'forgot' },
    { rawOrderIndex: 2, title: 'C', score: 70 },
    { rawOrderIndex: 3, title: 'D', isDisqualified: true, userComment: 'nope' },
  ];
  const rows = expandTradeoffRows(perSong, songs, []);
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((r) => r.rawOrderIndex),
    [0, 2, 1, 3]
  );
  assert.equal(rows[1].excluded, false);
  assert.equal(rows[2].excluded, true);
  assert.equal(formatCliScore(rows[2].song), 'BLANK');
  assert.equal(isExcludedFromAllocation(rows[3].song), true);
});

test('expandTradeoffRows appends gate-fail songs', () => {
  const perSong = [{ rawOrderIndex: 1, title: 'Pass', score: 80, votes: 2 }];
  const songs = [
    { rawOrderIndex: 1, title: 'Pass', score: 80, gate: 'pass' },
    { rawOrderIndex: 6, title: 'Fail', score: 75, gate: 'fail' },
  ];
  const rows = expandTradeoffRows(perSong, songs, []);
  assert.deepEqual(
    rows.map((r) => r.rawOrderIndex),
    [1, 6]
  );
  assert.equal(rows[1].excluded, true);
  assert.equal(isExcludedFromAllocation(rows[1].song), true);
  assert.equal(formatCliCombinedScore({ score: 75, combinedScore: 74, gate: 'fail' }), '-');
  assert.equal(formatCliMod({ gate: 'fail' }), 'fail');
});

test('expandTradeoffRows appends cutoff-fail songs when profile gate is set', () => {
  const perSong = [{ rawOrderIndex: 1, title: 'Pass', score: 80, votes: 2 }];
  const songs = [
    { rawOrderIndex: 1, title: 'Pass', score: 80, fitScore: 75 },
    { rawOrderIndex: 6, title: 'Fail', score: 77, fitScore: 40 },
    { rawOrderIndex: 9, title: 'Bad', score: 65, fitScore: 45 },
  ];
  const profile = { gate: { type: 'cutoff', axis: 'fit', min: 52 }, rankBy: 'combined' };
  const rows = expandTradeoffRows(perSong, songs, [], profile);
  assert.deepEqual(
    rows.map((r) => r.rawOrderIndex),
    [1, 6, 9]
  );
  assert.equal(rows[1].excluded, true);
  assert.equal(rows[2].excluded, true);
  assert.equal(isExcludedFromAllocation(rows[1].song, profile), true);
});
