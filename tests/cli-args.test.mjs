import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchFlag,
  matchRestFlag,
  matchRepeatableFlag,
  expandShortFlags,
  SHORT_FLAGS,
} from '../scripts/cli-args.mjs';

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

test('expandShortFlags rewrites known single-dash flags, leaves others untouched', () => {
  assert.deepEqual(
    expandShortFlags(['r', 'round', '-w', '0.6:0.4', '-c', '70', '-p', '9:2', '12:1']),
    ['r', 'round', '--weights', '0.6:0.4', '--cutoff', '70', '--pin', '9:2', '12:1']
  );
  // unknown single-dash passes through (warnUnknownShortFlags still applies)
  assert.deepEqual(expandShortFlags(['-x', '--pin']), ['-x', '--pin']);
  // every short maps to a double-dash long form
  for (const [short, long] of Object.entries(SHORT_FLAGS)) {
    assert.match(short, /^-[a-z]{1,2}$/);
    assert.match(long, /^--[a-z-]+$/);
  }
});

test('matchRepeatableFlag consumes space-separated pair tokens for pair flags', () => {
  const values = [];
  const end = matchRepeatableFlag(['--pin', '9:2', '12:1', '--reason', 'x'], 0, 'pin', (v) => values.push(v));
  assert.deepEqual(values, ['9:2', '12:1']);
  assert.equal(end, 2);
});

test('matchRepeatableFlag consumes pairs after the = form too', () => {
  const values = [];
  const end = matchRepeatableFlag(['--pin=9:2', '12:1'], 0, 'pin', (v) => values.push(v));
  assert.deepEqual(values, ['9:2', '12:1']);
  // end = last consumed token index: the caller steps past it and continues.
  assert.equal(end, 1);
});

test('matchRepeatableFlag stops at the first non-pair token', () => {
  const values = [];
  const end = matchRepeatableFlag(['--pin', '9:2', 'B', '12:1'], 0, 'pin', (v) => values.push(v));
  assert.deepEqual(values, ['9:2']);
  assert.equal(end, 1);
});

test('matchRepeatableFlag acts like matchFlag for non-pair flags', () => {
  const values = [];
  const end = matchRepeatableFlag(['--cutoff', 'music:65', 'next'], 0, 'cutoff', (v) => values.push(v));
  assert.deepEqual(values, ['music:65']);
  assert.equal(end, 1);
});
