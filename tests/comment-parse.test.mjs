import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scoreComment } from '../scripts/score-core.mjs';

function parse(comment, { fitWords = false, mode = 'subjective' } = {}) {
  return scoreComment(comment, mode, { fitWords });
}

test('comment parse: peel-first music (fitWords off)', () => {
  assert.equal(parse('75').score, 75);
  assert.equal(parse('75?').score, 75);
  assert.equal(parse('75?').uncertain, true);

  const both = parse('78 music, 8 fit');
  assert.equal(both.score, 78);
  assert.equal(both.fitScore, 80);

  const eightFit = parse('8 fit');
  assert.equal(eightFit.score, 80);
  assert.equal(eightFit.fitScore, null);

  const fitEight = parse('fit 8');
  assert.equal(fitEight.score, 80);
  assert.equal(fitEight.fitScore, null);

  const bonus = parse('76 fit bonus');
  assert.equal(bonus.score, 76);
  assert.equal(bonus.fitTier, 'strong');
  assert.equal(bonus.fitScore, 85);

  const bonusOnly = parse('fit bonus');
  assert.equal(bonusOnly.score, null);
  assert.equal(bonusOnly.fitTier, null);
  assert.equal(bonusOnly.needsReview, true);

  assert.equal(parse('maybe great song 75').score, 75);
  assert.equal(parse('maybe great song 75').gate, null);

  assert.equal(parse('off-theme 80').score, 80);
  assert.equal(parse('off-theme 80').gate, null);

  assert.equal(parse('strong fit').fitTier, null);

  assert.equal(parse('solid track 72').score, 72);
  assert.equal(parse('solid track 72').fitTier, null);

  assert.equal(parse('74 soft punk').score, 74);

  const tail = parse('75?\nGreat song, maybe fits');
  assert.equal(tail.score, 75);
  assert.equal(tail.gate, null);
});

test('comment parse: peel-first + remainder fit (fitWords on)', () => {
  const opts = { fitWords: true };

  assert.equal(parse('75 80', opts).score, 75);
  assert.equal(parse('75 80', opts).fitScore, 80);
  assert.equal(parse('75. 80', opts).score, 75);
  assert.equal(parse('75. 80', opts).fitScore, 80);

  assert.equal(parse('80 fit 75', opts).score, 80);
  assert.equal(parse('80 fit 75', opts).fitScore, 75);
  assert.equal(parse('80. fit 75', opts).score, 80);
  assert.equal(parse('80. fit 75', opts).fitScore, 75);

  assert.equal(parse('75 playlist 80', opts).score, 75);
  assert.equal(parse('75 playlist 80', opts).fitScore, 80);
  assert.equal(parse('75. playlist 80', opts).score, 75);
  assert.equal(parse('75. playlist 80', opts).fitScore, 80);

  assert.equal(parse('music 75 fit 80', opts).score, 75);
  assert.equal(parse('music 75 fit 80', opts).fitScore, 80);

  const tier = parse('75 strong', opts);
  assert.equal(tier.score, 75);
  assert.equal(tier.fitTier, 'strong');

  const tierTail = parse('75 strong\nGreat song', opts);
  assert.equal(tierTail.score, 75);
  assert.equal(tierTail.fitTier, 'strong');
  assert.equal(tierTail.gate, null);

  const tailGate = parse('75?\n…off-theme joke…', opts);
  assert.equal(tailGate.score, 75);
  assert.equal(tailGate.gate, null);

  assert.equal(parse('strong', opts).fitTier, 'strong');
  assert.equal(parse('pass', opts).gate, 'pass');

  assert.equal(parse('maybe a 70?', opts).score, 70);
  assert.equal(parse('maybe a 70?', opts).gate, 'maybe');

  assert.equal(parse('maybe great song 75', opts).score, 75);
  assert.equal(parse('maybe great song 75', opts).gate, 'maybe');

  const bonusNl = parse('76 fit bonus\npublic comment', opts);
  assert.equal(bonusNl.score, 76);
  assert.equal(bonusNl.fitTier, 'strong');
});

test('comment parse: two-number remainder ignored when fitWords off', () => {
  const pair = parse('75 80');
  assert.equal(pair.score, 75);
  assert.equal(pair.fitScore, null);
});
