import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expandTradeoffRows,
  formatCliComment,
  formatCliMod,
  formatCliScore,
  isExcludedFromAllocation,
} from '../scripts/parse/cli-table.mjs';

test('formatCliScore marks blank and disqualified rows', () => {
  assert.equal(formatCliScore({ needsUserInput: true }), 'BLANK');
  assert.equal(formatCliScore({ isDisqualified: true, score: null }), '-');
  assert.equal(formatCliScore({ score: 76, plus: true }), '76');
});

test('formatCliMod shows parsed modifiers', () => {
  assert.equal(formatCliMod({ score: 75, plus: true, minusUncertain: true, minus: true }), '+-?');
  assert.equal(formatCliMod({ isDisqualified: true }), 'DQ');
});

test('formatCliComment truncates user comment', () => {
  assert.equal(formatCliComment({ userComment: 'great bridge' }), 'great bridge');
  assert.equal(formatCliComment({}), '·');
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
