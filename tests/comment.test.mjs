// Comment parsing + manual fit scoring tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreComment,
  allocate,
  fitTierForScore,
  buildJsonPayload,
} from '../scripts/score-core.mjs';
import { applyManualFitScoring } from '../scripts/parse-round.mjs';
import { mk, sum } from './score-helpers.mjs';

// scoreComment: digit scaling, modifiers, disqualification, fit tokens
// ---------------------------------------------------------------------------
test('scoreComment digit scaling', () => {
  assert.equal(scoreComment('755', 'objective').score, 75.5);
  assert.equal(scoreComment('73', 'objective').score, 73);
  assert.equal(scoreComment('7', 'objective').score, 70);
  assert.equal(scoreComment('74 soft punk', 'objective').score, 74);
});

test('scoreComment modifiers', () => {
  const plus = scoreComment('73+', 'objective');
  assert.equal(plus.score, 73);
  assert.equal(plus.plus, true);
  assert.equal(scoreComment('73=', 'objective').plus, true); // typo for +
  assert.equal(scoreComment('7-', 'objective').minus, true);
  const q = scoreComment('74?', 'objective');
  assert.equal(q.uncertain, true);
  assert.equal(q.score, 74);
  assert.equal(q.plusUncertain, false);

  const plusQ = scoreComment('75+?', 'objective');
  assert.equal(plusQ.score, 75);
  assert.equal(plusQ.plus, true);
  assert.equal(plusQ.plusUncertain, true);
  assert.equal(plusQ.uncertain, false);

  const minusQ = scoreComment('7-?', 'objective');
  assert.equal(minusQ.score, 70);
  assert.equal(minusQ.minus, true);
  assert.equal(minusQ.minusUncertain, true);
  assert.equal(minusQ.uncertain, false);

  const playQ = scoreComment('78 music play?', 'objective');
  assert.equal(playQ.playlistAdd, true);
  assert.equal(playQ.playlistUncertain, true);
  assert.equal(playQ.uncertain, false);

  assert.equal(scoreComment('78 music play', 'objective').playlistAdd, true);
});

test('scoreComment disqualification + needs-input', () => {
  assert.equal(scoreComment('-', 'objective').isDisqualified, true);
  assert.equal(scoreComment('no', 'objective').isDisqualified, true);
  assert.equal(scoreComment('great song', 'objective').isDisqualified, true);
  assert.equal(scoreComment('great song', 'subjective').needsReview, true);
  assert.equal(scoreComment('', 'objective').needsUserInput, true);
  // All-caps TODO marker -> needs input, even with a placeholder score next to it.
  assert.equal(scoreComment('TODO', 'objective').needsUserInput, true);
  assert.equal(scoreComment('TODO score this later', 'subjective').needsUserInput, true);
  assert.equal(scoreComment('TODO 80', 'objective').needsUserInput, true);
  assert.equal(scoreComment('TODO 80', 'objective').score, null, 'placeholder score is not trusted');
  // Lowercase "todo" inside prose is not a marker.
  assert.equal(scoreComment('78 todo list vibes', 'objective').needsUserInput, false);
});

test('scoreComment manual fit notation', () => {
  const both = scoreComment('78 music, 8 fit', 'subjective');
  assert.equal(both.score, 78, 'music score preserved');
  assert.equal(both.fitScore, 80, '8 fit -> 80');
  assert.equal(both.fitSource, 'manual');
  const reversed = scoreComment('78 music, fit 8', 'subjective');
  assert.equal(reversed.score, 78, 'reverse ordering: music score preserved');
  assert.equal(reversed.fitScore, 80, 'reverse ordering: fit 8 -> 80');

  const loneEightFit = scoreComment('8 fit', 'subjective');
  assert.equal(loneEightFit.score, 80, 'first number is music');
  assert.equal(loneEightFit.fitScore, null);

  assert.equal(scoreComment('strong fit', 'subjective').fitTier, null, 'tier words off by default');
  assert.equal(scoreComment('strong fit', 'subjective', { fitWords: true }).fitTier, 'strong');
  assert.equal(scoreComment('solid track', 'subjective').fitTier, null, 'prose is not a fit grade');

  assert.equal(scoreComment('pass', 'objective', { fitWords: true }).gate, 'pass');
  assert.equal(scoreComment('borderline, maybe', 'subjective', { fitWords: true }).gate, 'maybe');
  assert.equal(scoreComment('off-theme', 'subjective', { fitWords: true }).gate, 'fail');
  assert.equal(scoreComment('pass', 'objective').gate, null, 'gate words off by default');
});

test('applyManualFitScoring: explicit --rank combined still sets combinedScore', () => {
  const songs = [
    { rawOrderIndex: 0, title: 'a', score: 76, fitScore: 95, fitSource: 'manual' },
    { rawOrderIndex: 1, title: 'b', score: 90, fitScore: 80, fitSource: 'manual' },
    { rawOrderIndex: 2, title: 'c', score: 70, fitScore: 70, fitSource: 'manual' },
    { rawOrderIndex: 3, title: 'd', score: 72, fitScore: 65, fitSource: 'manual' },
    { rawOrderIndex: 4, title: 'e', score: 68, fitScore: 60, fitSource: 'manual' },
    { rawOrderIndex: 5, title: 'f', score: 74, fitScore: 75, fitSource: 'manual' },
  ];
  const profile = { rankBy: 'music' };

  const weights = applyManualFitScoring(profile, songs, { explicitRank: 'combined' });
  assert.deepEqual(weights, { fit: 0.5, music: 0.5 });
  assert.equal(profile.fitTrust, 'manual');
  assert.ok(songs[0].combinedScore != null);
  assert.ok(songs[0].fitNorm != null && songs[0].musicNorm != null, 'uses normalizeCombined');
  assert.equal(profile.rankBy, 'music', 'explicit rank applied after manual-fit setup');

  profile.rankBy = 'combined';
  assert.ok(songs[0].combinedScore != null);
});

test('applyManualFitScoring: defaults rankBy to combined when rank omitted', () => {
  const songs = [
    { rawOrderIndex: 0, title: 'a', score: 76, fitScore: 95, fitSource: 'manual' },
    { rawOrderIndex: 1, title: 'b', score: 70, fitScore: 70, fitSource: 'manual' },
    { rawOrderIndex: 2, title: 'c', score: 72, fitScore: 65, fitSource: 'manual' },
    { rawOrderIndex: 3, title: 'd', score: 68, fitScore: 60, fitSource: 'manual' },
  ];
  const profile = {};
  applyManualFitScoring(profile, songs, {});
  assert.equal(profile.rankBy, 'combined');
  assert.equal(profile.fitTrust, 'manual');
  assert.ok(songs[0].combinedScore != null);
});

test('applyManualFitScoring: no-op without manual fit', () => {
  const songs = [{ score: 76, fitScore: null, fitSource: null }];
  const profile = { rankBy: 'music' };
  assert.equal(applyManualFitScoring(profile, songs, {}), null);
  assert.equal(songs[0].combinedScore, undefined);
});

test('applyManualFitScoring: auto-activates passFailMaybe when a maybe gate word is present', () => {
  const songs = [
    { rawOrderIndex: 0, title: 'a', score: 80, gate: 'maybe', fitSource: 'manual' },
    { rawOrderIndex: 1, title: 'b', score: 77, gate: 'pass', fitSource: 'manual' },
    { rawOrderIndex: 2, title: 'c', score: 73, gate: 'pass', fitSource: 'manual' },
  ];
  const profile = {};
  applyManualFitScoring(profile, songs, {});
  assert.deepEqual(profile.gate, { type: 'passFailMaybe' }, 'a maybe present -> three-state gate');
  assert.equal(profile.rankBy, 'combined');
});

test('applyManualFitScoring: auto-activates binary passFail when no maybe present', () => {
  const songs = [
    { rawOrderIndex: 0, title: 'a', score: 80, gate: 'pass', fitSource: 'manual' },
    { rawOrderIndex: 1, title: 'b', score: 77, gate: 'fail', fitSource: 'manual' },
  ];
  const profile = {};
  applyManualFitScoring(profile, songs, {});
  assert.deepEqual(profile.gate, { type: 'passFail' }, 'only pass/fail -> binary gate');
});

test('applyManualFitScoring: respects an explicit --gate over auto-activation', () => {
  const songs = [
    { rawOrderIndex: 0, title: 'a', score: 80, gate: 'maybe', fitSource: 'manual' },
    { rawOrderIndex: 1, title: 'b', score: 77, gate: 'pass', fitSource: 'manual' },
  ];
  const profile = { gate: { type: 'passFail' } };
  applyManualFitScoring(profile, songs, {});
  assert.deepEqual(profile.gate, { type: 'passFail' }, 'explicit gate is not overwritten');
});

test('applyManualFitScoring: no gate when manual fit is numbers only (no gate words)', () => {
  const songs = [
    { rawOrderIndex: 0, title: 'a', score: 76, fitScore: 95, fitSource: 'manual' },
    { rawOrderIndex: 1, title: 'b', score: 70, fitScore: 70, fitSource: 'manual' },
  ];
  const profile = {};
  applyManualFitScoring(profile, songs, {});
  assert.equal(profile.gate, undefined, 'numeric-only manual fit does not gate');
});

test('auto-gated maybe never outranks a pass end-to-end (repro: 80 maybe over pass field)', () => {
  // The reported bug: --fit-words parsed gates but nothing activated them, so an
  // 80-music "maybe" sat at the top of a pass field. With auto-activation the maybe
  // is capped below every funded pass.
  const songs = [
    { rawOrderIndex: 0, title: 'boompala', score: 80, gate: 'maybe', fitSource: 'manual' },
    { rawOrderIndex: 1, title: 'bad', score: 75, gate: 'maybe', fitSource: 'manual' },
    { rawOrderIndex: 2, title: 'stranger', score: 77, gate: 'pass', fitSource: 'manual' },
    { rawOrderIndex: 3, title: 'ping', score: 76.5, gate: 'pass', fitSource: 'manual' },
    { rawOrderIndex: 4, title: 'jopping', score: 76, gate: 'pass', fitSource: 'manual' },
    { rawOrderIndex: 5, title: 'meme', score: 74.5, gate: 'pass', fitSource: 'manual' },
    { rawOrderIndex: 6, title: 'shanghai', score: 74, gate: 'pass', fitSource: 'manual' },
    { rawOrderIndex: 7, title: 'weon', score: 73, gate: 'pass', fitSource: 'manual' },
    { rawOrderIndex: 8, title: 'cherry', score: 72, gate: 'pass', fitSource: 'manual' },
    { rawOrderIndex: 9, title: 'gnarly', score: 65, gate: 'pass', fitSource: 'manual' },
  ];
  const profile = { shape: 'auto' };
  applyManualFitScoring(profile, songs, {});
  assert.deepEqual(profile.gate, { type: 'passFailMaybe' });
  allocate(songs, 15, 10, profile);
  assert.equal(sum(songs), 15);
  const passVotes = songs.filter((s) => s.gate === 'pass').map((s) => s.finalVotes);
  const maybeVotes = songs.filter((s) => s.gate === 'maybe').map((s) => s.finalVotes);
  const minFundedPass = Math.min(...passVotes.filter((v) => v > 0));
  assert.ok(Math.max(...maybeVotes) <= minFundedPass, 'no maybe outranks a funded pass');
  assert.ok(songs[0].finalVotes <= minFundedPass, 'the 80 "maybe" is not lifted above passes');
});

test('buildJsonPayload persists needsResearch per song', () => {
  // A thematic round flags music-known/fit-unknown songs for the research loop;
  // that flag must survive the write to music.json so agents can filter on it.
  const flagged = scoreComment('76 music', 'thematic');
  assert.equal(flagged.needsResearch, true, 'thematic music-only comment needs research');
  const songs = [
    { rawOrderIndex: 0, title: 'A', artist: 'x', needsResearch: true },
    { rawOrderIndex: 1, title: 'B', artist: 'y', needsResearch: false },
  ];
  const payload = buildJsonPayload({
    round: {},
    budget: {},
    songs,
    totalSongs: 2,
    ownSkipped: 0,
    mode: 'thematic',
    tradeoffs: [],
  });
  assert.equal(payload.songs[0].needsResearch, true);
  assert.equal(payload.songs[1].needsResearch, false);
});

test('fitTierForScore snaps to the nearest tier', () => {
  assert.equal(fitTierForScore(92), 'excellent');
  assert.equal(fitTierForScore(70), 'solid');
  assert.equal(fitTierForScore(34), 'weak');
  assert.equal(fitTierForScore(null), null);
});

// ---------------------------------------------------------------------------
