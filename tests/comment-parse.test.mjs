import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scoreComment, applyNumericFitAutoDetect } from '../scripts/score-core.mjs';

function parse(comment, { mode = 'subjective', ...opts } = {}) {
  return scoreComment(comment, mode, opts);
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

test('comment parse: earliest tier word wins, not highest tier', () => {
  const opts = { fitWords: true };

  // "weak" is written first as the grade; "great" later is prose, not the tier.
  const weak = parse("755. weak fit. great if it said 'her' but 'you' just confuses things", opts);
  assert.equal(weak.score, 75.5);
  assert.equal(weak.fitTier, 'weak');
  assert.equal(weak.fitScore, 35);

  // Position beats tier rank in both directions.
  assert.equal(parse('75. weak but great production', opts).fitTier, 'weak');
  assert.equal(parse('75. great, though a weak add-on', opts).fitTier, 'strong');

  // "<tier> negative" mirrors the tier across the scale (a fit that bad).
  assert.equal(parse('75. strong negative', opts).fitTier, 'weak');
  assert.equal(parse('75. excellent negative', opts).fitTier, 'nope');
  assert.equal(parse('75. solid negative', opts).fitTier, 'moderate');
});

test('comment parse: two-number remainder ignored when fitWords off', () => {
  const pair = parse('75 80');
  assert.equal(pair.score, 75);
  assert.equal(pair.fitScore, null);
});

test('comment parse: --fit tier scans tier words only, --fit gate scans gate only', () => {
  // tier mode: tier word resolves, gate word is ignored.
  const tier = parse('75 strong, pass', { tierWords: true });
  assert.equal(tier.fitTier, 'strong');
  assert.equal(tier.gate, null);

  // gate mode: gate word resolves, tier word is ignored.
  const gate = parse('75 strong, pass', { gateWords: true });
  assert.equal(gate.gate, 'pass');
  assert.equal(gate.fitTier, null);
});

test('comment parse: a bare 2nd number is always surfaced as fitNumberCandidate', () => {
  // No flag: candidate exposed, but not committed to fitScore.
  const bare = parse('75. 80');
  assert.equal(bare.score, 75);
  assert.equal(bare.fitScore, null);
  assert.equal(bare.fitNumberCandidate, 80);

  // No 2nd number: candidate null.
  assert.equal(parse('75. strong fit').fitNumberCandidate, null);
});

test('applyNumericFitAutoDetect: activates when ≥75% of scored songs have a 2nd number', () => {
  const songs = [
    parse('75. 80'),
    parse('72. 90'),
    parse('70. 60'),
    parse('73. moderate fit'), // no 2nd number → flagged
  ].map((s, i) => ({ ...s, rawOrderIndex: i, title: `s${i}` }));

  const res = applyNumericFitAutoDetect(songs);
  assert.equal(res.active, true);
  assert.equal(res.applied, 3);
  assert.equal(songs[0].fitScore, 80);
  assert.equal(songs[0].fitSource, 'manual');
  assert.equal(songs[3].needsFitScore, true);
  assert.equal(songs[3].fitScore, null);
});

test('applyNumericFitAutoDetect: stays off below threshold (a lone 2nd number is not fit)', () => {
  const songs = [
    parse('75. 80'),
    parse('72. moderate fit'),
    parse('70'),
    parse('73'),
  ].map((s, i) => ({ ...s, rawOrderIndex: i, title: `s${i}` }));

  const res = applyNumericFitAutoDetect(songs);
  assert.equal(res.active, false);
  assert.equal(songs[0].fitScore, null);
  assert.ok(!songs.some((s) => s.needsFitScore));
});

test('needsFitScore is channel-agnostic: flags an un-graded song in a tier-graded round', () => {
  const songs = [
    parse('75. moderate fit', { tierWords: true }),
    parse('72. strong fit', { tierWords: true }),
    parse('70. weak fit', { tierWords: true }),
    parse('73', { tierWords: true }), // no tier word → flagged
  ].map((s, i) => ({ ...s, rawOrderIndex: i, title: `s${i}` }));

  const res = applyNumericFitAutoDetect(songs);
  assert.equal(res.active, false); // no numeric commit
  assert.equal(res.missing.length, 1);
  assert.equal(songs[3].needsFitScore, true);
  assert.equal(songs[0].needsFitScore, false);
});

test('needsFitScore is channel-agnostic: flags an un-graded song in a gate-graded round', () => {
  const songs = [
    parse('75. pass', { gateWords: true }),
    parse('72. pass', { gateWords: true }),
    parse('70. fail', { gateWords: true }),
    parse('73', { gateWords: true }), // no gate word → flagged
  ].map((s, i) => ({ ...s, rawOrderIndex: i, title: `s${i}` }));

  const res = applyNumericFitAutoDetect(songs);
  assert.equal(res.missing.length, 1);
  assert.equal(songs[3].needsFitScore, true);
});
