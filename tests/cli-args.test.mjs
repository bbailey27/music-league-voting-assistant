import test from 'node:test';
import assert from 'node:assert/strict';
import { matchFlag, matchRestFlag } from '../scripts/cli-args.mjs';

test('matchRestFlag joins words until the next --flag', () => {
  const argv = ['--option', 'A', '--reason', 'flatter', 'spread', 'matches', 'tight', 'scores'];
  let reason;
  const end = matchRestFlag(argv, 2, 'reason', (v) => {
    reason = v;
  });
  assert.equal(end, 7);
  assert.equal(reason, 'flatter spread matches tight scores');
});

test('matchRestFlag accepts --reason=value with spaces', () => {
  const argv = ['--reason=flatter spread matches tight scores'];
  let reason;
  matchRestFlag(argv, 0, 'reason', (v) => {
    reason = v;
  });
  assert.equal(reason, 'flatter spread matches tight scores');
});

test('matchFlag still takes a single token for non-rest flags', () => {
  const argv = ['--option', 'B'];
  let option;
  matchFlag(argv, 0, 'option', (v) => {
    option = v;
  });
  assert.equal(option, 'B');
});
