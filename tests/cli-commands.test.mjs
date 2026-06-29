import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPickCmd,
  formatLegacySelector,
  pickPromptLine,
  pickUsageError,
} from '../scripts/cli-commands.mjs';

test('formatPickCmd builds just pick with letter positional arg', () => {
  assert.equal(formatPickCmd('tarot', 'B'), 'just pick tarot B');
  assert.equal(
    formatPickCmd('story-5', 'A', { pin: '9:2', reason: 'pin Two Evils' }),
    'just pick story-5 A --pin 9:2 --reason "pin Two Evils"'
  );
  assert.equal(formatPickCmd('tarot', 'C', { downShape: 'flat', scores: true }), 'just pick tarot C --scores --down-shape flat');
});

test('formatLegacySelector converts internal --option flags to just pick', () => {
  assert.equal(formatLegacySelector('kpop', '--option B'), 'just pick kpop B');
  assert.equal(formatLegacySelector('kpop', '--option A --down-shape curved'), 'just pick kpop A --down-shape curved');
  assert.equal(formatLegacySelector('kpop', '--down-shape flat'), 'just pick kpop A --down-shape flat');
  assert.equal(formatLegacySelector('kpop', 'default'), 'default allocation');
});

test('pickPromptLine uses just pick wording', () => {
  assert.match(pickPromptLine('tarot', 2), /^2 tradeoffs need your call — use just pick tarot/);
});

test('pickUsageError references just pick example', () => {
  const msg = pickUsageError('tarot', 'Z', 2, ['A', 'B']);
  assert.match(msg, /just pick tarot A/);
  assert.match(msg, /letter as the second argument/);
});
