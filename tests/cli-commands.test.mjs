import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPickCmd,
  formatLegacySelector,
  formatPickSpec,
  parsePickSpec,
  pickHintLine,
  pickPromptLine,
  pickSyntaxReminder,
  pickUsageError,
} from '../scripts/cli-commands.mjs';

test('formatPickCmd builds just pick with letter positional arg', () => {
  assert.equal(formatPickCmd('tarot', 'B'), 'just pick tarot B');
  assert.equal(
    formatPickCmd('story-5', 'A', { pin: '9:2', reason: 'pin Two Evils' }),
    'just pick story-5 A --pin 9:2 --reason "pin Two Evils"'
  );
  assert.equal(formatPickCmd('tarot', 'C', { downShape: 'flat', scores: true }), 'just pick tarot C fl --scores');
});

test('parsePickSpec and formatPickSpec', () => {
  assert.deepEqual(parsePickSpec('A cc'), { letter: 'A', downShape: 'concentrated' });
  assert.deepEqual(parsePickSpec('B·fl'), { letter: 'B', downShape: 'flat' });
  assert.deepEqual(parsePickSpec('C'), { letter: 'C', downShape: null });
  assert.equal(formatPickSpec('A', 'concentrated'), 'A cc');
  assert.equal(formatPickSpec('B'), 'B');
});

test('formatLegacySelector converts internal --option flags to just pick', () => {
  assert.equal(formatLegacySelector('kpop', '--option B'), 'just pick kpop B');
  assert.equal(formatLegacySelector('kpop', '--option A --down-shape curved'), 'just pick kpop A cv');
  assert.equal(formatLegacySelector('kpop', '--down-shape flat'), 'just pick kpop A fl');
  assert.equal(formatLegacySelector('kpop', 'default'), 'default allocation');
});

test('pickHintLine is a one-line command hint', () => {
  assert.equal(pickHintLine('tarot', { hasUp: true, hasDown: false }), 'just pick tarot <A|B|C>');
  assert.equal(pickHintLine('story-6', { hasUp: true, hasDown: true }), 'just pick story-6 <A|B|C> <cv|fl|cc>');
  assert.equal(pickPromptLine('story-6', [{ kind: 'down-structure' }]), 'just pick story-6 <A|B|C> <cv|fl|cc>');
});

test('pickSyntaxReminder is round-name-free and shows common flags, not per-letter commands', () => {
  const up = pickSyntaxReminder({ hasDown: false });
  assert.equal(up, 'just pick <a|b|c> [--pin <song>:<v>] [--cutoff music:<n>] [--reason "…"]');
  assert.doesNotMatch(up, /cv\|fl\|cc/, 'no down-shape hint when the round has no downvotes');
  const down = pickSyntaxReminder({ hasDown: true });
  assert.match(down, /just pick <a\|b\|c> \[cv\|fl\|cc\]/, 'down rounds hint the shape codes');
});

test('pickUsageError references just pick example', () => {
  const msg = pickUsageError('tarot', 'Z', 2, ['A', 'B']);
  assert.match(msg, /just pick tarot A/);
  assert.match(msg, /letter as the second argument/);
});
