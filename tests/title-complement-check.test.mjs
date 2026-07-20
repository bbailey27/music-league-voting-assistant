import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyComplement,
  classifyCopularComplement,
  classifyCloserComplement,
} from '../scripts/title-complement-check.mjs';

test('copular slot: NP openers and infinitives pass, embedded clauses fail', () => {
  assert.equal(classifyCopularComplement('One Day').fit, 'ok-np');
  assert.equal(classifyCopularComplement('To Be Alone').fit, 'ok-inf');
  assert.equal(classifyCopularComplement('For The Love Of A Princess').fit, 'ok-fragment');
  assert.equal(classifyCopularComplement('All I Want').fit, 'bad-clause');
  assert.equal(classifyCopularComplement('This Is Not Over').fit, 'bad-clause');
});

test('closer slot: complete clauses close the sentence', () => {
  const clauses = [
    'You Won',
    'I Give Up',
    "I Can't Go On",
    'You Make Me Sick',
    'You Got Me Now',
    "You Knew You'd Win",
    'You Were Right All Along',
    'This Is the End',
    'This Was a Mistake',
    'This Is Not Over',
    'Love Is Not Enough',
    'The Truth Hurts',
    'The Winner Takes It All',
    'Nobody Wins',
    "You're the Winner",
    "It's Over",
    'Here I Stand',
    'Now We Are Free',
    'There She Goes',
  ];
  for (const title of clauses) {
    assert.equal(classifyCloserComplement(title).fit, 'ok-clause', title);
  }
});

test('closer slot: imperatives and exclamatives close the sentence', () => {
  assert.equal(classifyCloserComplement('Take Me Now').fit, 'ok-imperative');
  assert.equal(classifyCloserComplement('Spare Me').fit, 'ok-imperative');
  assert.equal(classifyCloserComplement('What a Shame').fit, 'ok-excl');
  assert.equal(classifyCloserComplement('What a Mistake').fit, 'ok-excl');
  assert.equal(classifyCloserComplement('Such a Disaster').fit, 'ok-excl');
});

test('closer slot: questions are grammatically complete', () => {
  assert.equal(classifyCloserComplement('What Do I Do Now').fit, 'ok-question');
  assert.equal(classifyCloserComplement('How Will I Survive').fit, 'ok-question');
  assert.equal(classifyCloserComplement('Where Do I Begin').fit, 'ok-question');
  assert.equal(classifyCloserComplement('Where Do I Go From Here').fit, 'ok-question');
});

test('closer slot: open fragments leave the prompt open (bad)', () => {
  const fragments = ['The Winner', 'The End', 'A Mistake', 'Without You', 'Kudos to You'];
  for (const title of fragments) {
    assert.equal(classifyCloserComplement(title).fit, 'bad-fragment', title);
  }
});

test('classifyComplement dispatches by slot and flags unknown slots', () => {
  assert.equal(classifyComplement('You Won', 'closer').fit, 'ok-clause');
  assert.equal(classifyComplement('One Day', 'copular').fit, 'ok-np');
  assert.equal(classifyComplement('You Won', 'nope').fit, 'bad-unknown');
});
