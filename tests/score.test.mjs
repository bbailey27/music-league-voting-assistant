// Tests for the shared scorer + profile-driven allocator in score-core.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreComment,
  allocate,
  estimateCenter,
  rankValue,
  fitTierForScore,
  mergeFit,
  mergeFitJson,
  normalizeCombined,
  ckmeans1dWeighted,
  buildJsonPayload,
  buildPickRecord,
} from '../scripts/score-core.mjs';
import {
  parseWeights,
  parsePins,
  parseTierCount,
  parseBucketCount,
  parseDownShape,
  resolveOptionPick,
  reconcileOptionPins,
  pinCapError,
  pinEligibilityError,
  applyManualFitScoring,
} from '../scripts/parse-round.mjs';
import { applyOptionPick } from '../scripts/round/pick.mjs';
import { buildComboBallot } from '../scripts/render-html-shared.mjs';

// ---------------------------------------------------------------------------
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
// estimateCenter: mode-of-rounded, median fallback
// ---------------------------------------------------------------------------
test('estimateCenter prefers the mode', () => {
  assert.equal(estimateCenter([72, 72, 72, 78, 76, 70]), 72);
  // no repeats -> median
  assert.equal(estimateCenter([70, 74, 80]), 74);
});

// ---------------------------------------------------------------------------
// allocate: budget exactness, cap, DQ exclusion, separation
// ---------------------------------------------------------------------------
const mk = (scores, extra = {}) =>
  scores.map((s, i) => ({ title: 'S' + i, rawOrderIndex: i, score: s, ...extra }));

function sum(songs) {
  return songs.reduce((a, s) => a + (s.finalVotes || 0), 0);
}

test('allocate hits the budget exactly and respects the cap', () => {
  const songs = mk([70, 72, 73, 74, 76, 78]);
  allocate(songs, 10, 3, { shape: 'auto' });
  assert.equal(sum(songs), 10);
  assert.ok(songs.every((s) => s.finalVotes <= 3));
});

test('allocate excludes disqualified and needs-input songs', () => {
  const songs = mk([72, 73, 78]);
  songs.push({ title: 'DQ', rawOrderIndex: 3, score: null, isDisqualified: true });
  songs.push({ title: 'blank', rawOrderIndex: 4, score: null, needsUserInput: true });
  allocate(songs, 6, 5, { shape: 'auto' });
  assert.equal(sum(songs), 6);
  assert.equal(songs[3].finalVotes, 0);
  assert.equal(songs[4].finalVotes, 0);
});

test('auto creates separation at ~1:1 (not flat 1s)', () => {
  const songs = mk([72, 73, 72, 78, 72, 74.5, 78, 76, 70, 78, 73, 76]);
  allocate(songs, 10, 5, { shape: 'auto' });
  assert.equal(sum(songs), 10);
  const max = Math.max(...songs.map((s) => s.finalVotes));
  assert.ok(max >= 2, 'expected at least one song above 1');
  assert.ok(
    songs.some((s) => s.finalVotes === 0),
    'expected at least one song at 0'
  );
});

const zeros = (g) => g.filter((s) => s.finalVotes === 0).length;
const topVote = (g) => Math.max(...g.map((s) => s.finalVotes));
const distinctVotes = (g) => new Set(g.map((s) => s.finalVotes)).size;

// Walk songs in descending score order and assert the two structural invariants
// of the clustering allocator: monotonic (a higher score never earns fewer
// points) and smooth (songs <= 1 score apart are never > 1 point apart).
function assertMonotonicSmooth(g, label = '') {
  const by = [...g].sort((a, b) => b.score - a.score);
  for (let i = 1; i < by.length; i++) {
    assert.ok(
      by[i].finalVotes <= by[i - 1].finalVotes,
      `${label} non-monotonic: ${JSON.stringify(by.map((s) => [s.score, s.finalVotes]))}`
    );
    if (by[i - 1].score - by[i].score <= 1) {
      assert.ok(
        Math.abs(by[i - 1].finalVotes - by[i].finalVotes) <= 1,
        `${label} rough (>1 point jump at <=1 score gap): ${JSON.stringify(
          by.map((s) => [s.score, s.finalVotes])
        )}`
      );
    }
  }
}

// Owner contiguity rule (stronger than score-gap smoothness): the distinct point
// values in the final curve must be sequential integers exactly 1 apart —
// {3,2,1,0} ok, {4,1,0} or {2,0} not.
function assertContiguous(votes, label = '') {
  const distinct = [...new Set(votes)].sort((a, b) => b - a);
  for (let i = 1; i < distinct.length; i++) {
    assert.equal(
      distinct[i - 1] - distinct[i],
      1,
      `${label} non-contiguous point tiers: ${JSON.stringify(distinct)} from ${JSON.stringify(votes)}`
    );
  }
}

test('auto keeps amplitude at ~1:1 — some 2s and some 0s, not all 1s', () => {
  // Owner rule: don't flatten the field into all-1s. With real spread and a ~1:1
  // budget, promote a couple of 2s and leave a few 0s — the curve (not a raised
  // floor) is what separates your vote from everyone else's.
  const scores = [80, 79, 78, 77, 76, 75, 74, 73, 72, 70];
  const g = mk(scores);
  allocate(g, 10, 5, { shape: 'auto' });
  assert.equal(sum(g), 10);
  assert.ok(topVote(g) >= 2, `expected a 2+ tier, got ${JSON.stringify(g.map((s) => s.finalVotes))}`);
  assert.ok(zeros(g) >= 1, `expected a zero band, got ${JSON.stringify(g.map((s) => s.finalVotes))}`);
});

test('clustering keeps the curve smooth: graduated steps, no big jump at a small gap', () => {
  // The hard rule: songs <= 1 score apart never end > 1 point apart. A clustered
  // "all-meh" field with points to spend gets a graduated curve (3/2/2/1/0 style)
  // that keeps close songs close, NOT a 2-tier enforcement that drops 70-72 to 0
  // while 73-74 jump to 3.
  const clustered = mk([74, 74, 73, 73, 72, 72, 71, 71, 70, 70]);
  allocate(clustered, 16, 3, { shape: 'auto' });
  assert.equal(sum(clustered), 16);
  assertMonotonicSmooth(clustered, 'clustered');

  // A wide spread earns more, taller tiers from the same budget than a tight one.
  const wide = mk([95, 90, 85, 80, 75, 70, 65, 60, 55, 50]);
  allocate(wide, 16, 5, { shape: 'auto' });
  assert.equal(sum(wide), 16);
  assertMonotonicSmooth(wide, 'wide');
  assert.ok(
    topVote(wide) >= topVote(clustered),
    'wider spread reaches at least as tall a top tier as a tight cluster'
  );
});

test('ckmeans1dWeighted puts boundaries on the largest gaps (contiguous, optimal)', () => {
  // Two tight clumps separated by a big gap -> the K=2 split lands in the gap.
  const values = [82, 81, 80, 60, 59, 58]; // descending
  const wts = values.map(() => 1);
  const { ranges } = ckmeans1dWeighted(values, wts, 2);
  assert.deepEqual(ranges, [
    [0, 2],
    [3, 5],
  ]);
  // Weights pull the cluster mean: a heavy low point can keep a near value with it.
  const { ranges: r1, wss } = ckmeans1dWeighted(values, wts, 1);
  assert.deepEqual(r1, [[0, 5]]);
  assert.ok(wss > 0, 'single cluster keeps the full spread as within-cluster SS');
  // K = n -> every value its own cluster, zero within-cluster SS.
  const { ranges: rn, wss: wssN } = ckmeans1dWeighted(values, wts, values.length);
  assert.equal(rn.length, values.length);
  assert.ok(wssN < 1e-9, 'one cluster per value has no within-cluster spread');
});

test('allocation stays smooth and monotonic across mixed fields and ratios', () => {
  const fields = [
    [92, 88, 74, 73, 72, 72, 71, 70, 70, 69], // low cluster + 2 high outliers
    [88, 85, 82, 80, 78, 76, 75, 74, 72, 70], // even descent
    [75, 74, 73, 72, 72, 71, 70, 69, 68, 67], // all mediocre
    [95, 90, 85, 80, 75, 70, 65, 60, 55, 50], // wide spread
  ];
  for (const scores of fields) {
    for (const budget of [6, 10, 14, 20]) {
      const g = mk(scores);
      allocate(g, budget, 5, { shape: 'auto' });
      assert.equal(sum(g), budget, `budget ${budget} fully spent`);
      assertMonotonicSmooth(g, `b=${budget}`);
    }
  }
});

test('more points open more tiers when the field has room (keep close songs close)', () => {
  // A tightly-clustered field with a tight budget stays coarse; the SAME field
  // with generous points opens more graduated tiers rather than a single big gap.
  const tight = mk([74, 74, 73, 73, 72, 72, 71, 71, 70, 70]);
  allocate(tight, 10, 3, { shape: 'auto' });
  const rich = mk([74, 74, 73, 73, 72, 72, 71, 71, 70, 70]);
  allocate(rich, 16, 3, { shape: 'auto' });
  assert.equal(sum(tight), 10);
  assert.equal(sum(rich), 16);
  assertMonotonicSmooth(tight, 'tight');
  assertMonotonicSmooth(rich, 'rich');
  assert.ok(
    distinctVotes(rich) >= distinctVotes(tight),
    `more points should not collapse tiers: tight=${distinctVotes(tight)} rich=${distinctVotes(rich)}`
  );
});

test('tier-structure surfaces distinct contiguous point distributions', () => {
  const scores = [78, 77, 76, 75, 74, 73, 72, 71, 70, 69];
  const g = mk(scores);
  const { tradeoffs } = allocate(g, 14, 5, { shape: 'auto' });
  const ts = tradeoffs.find((t) => t.kind === 'tier-structure');
  assert.ok(ts, 'an ambiguous field offers a tier-structure choice');
  assert.ok(ts.options.length >= 2, 'at least two options');
  // Each option carries an integer tier count + bucket count. Under the center-out
  // staircase a single integer knob can't always reproduce one specific split
  // (two staircases can share both counts but differ in size — the 3-3-3 C1/C2/C3
  // case), so the contract is: distinct distributions, each contiguous + monotonic,
  // and --tier-count yields a curve with that many distinct point values.
  for (const o of ts.options) {
    assert.ok(Number.isInteger(o.tierCount) && o.tierCount >= 1, 'tier count');
    assert.ok(Number.isInteger(o.bucketCount) && o.bucketCount >= 1, 'bucket count');
  }
  const dists = ts.options.map((o) => o.tiers.map((t) => `${t.points}x${t.count}`).join('/'));
  assert.equal(new Set(dists).size, dists.length, 'each surfaced option is a different distribution');

  for (const o of ts.options) {
    const f = mk(scores);
    allocate(f, 14, 5, { shape: 'auto', tierCount: o.tierCount });
    assert.equal(sum(f), 14);
    const by = [...f].sort((a, b) => b.score - a.score);
    assert.equal(new Set(by.map((s) => s.finalVotes)).size, o.tierCount, '--tier-count hits the tier count');
    assertContiguous(by.map((s) => s.finalVotes), `tier-count ${o.tierCount}`);
  }
});

test('tier-structure options carry table data (points / count / score range) per tier', () => {
  const scores = [78, 77, 76, 75, 74, 73, 72, 71, 70, 69];
  const g = mk(scores);
  const { tradeoffs } = allocate(g, 14, 5, { shape: 'auto' });
  const ts = tradeoffs.find((t) => t.kind === 'tier-structure');
  assert.ok(ts);
  for (const o of ts.options) {
    assert.ok(Array.isArray(o.tiers) && o.tiers.length === o.tierCount, 'one row per point tier');
    assert.equal(o.bucketCount, o.value, 'bucket count is the reproduction key');
    // Rows are point tiers in descending point order; counts sum to the field size.
    const pts = o.tiers.map((r) => r.points);
    assert.deepEqual(pts, [...pts].sort((a, b) => b - a), 'tiers listed high→low points');
    assert.equal(
      o.tiers.reduce((a, r) => a + r.count, 0),
      scores.length,
      'song counts cover every song'
    );
    for (const r of o.tiers) {
      assert.ok(Number.isInteger(r.points) && r.points >= 0, 'points value');
      assert.ok(Number.isInteger(r.count) && r.count >= 1, 'song count');
      assert.ok(r.scoreHi >= r.scoreLo, 'score range hi >= lo');
    }
  }
});

test('tier-structure options carry per-song votes, index-aligned across options for the comparison table', () => {
  const scores = [78, 77, 76, 75, 74, 73, 72, 71, 70, 69];
  const g = mk(scores);
  const { tradeoffs } = allocate(g, 14, 5, { shape: 'auto' });
  const ts = tradeoffs.find((t) => t.kind === 'tier-structure');
  assert.ok(ts);
  const ref = ts.options[0].perSong;
  assert.ok(Array.isArray(ref) && ref.length === scores.length, 'one perSong row per song');
  for (const o of ts.options) {
    assert.ok(typeof o.shape === 'string' && o.shape.length, 'option carries a vote-shape signature');
    assert.equal(o.perSong.length, ref.length, 'every option has the same rows');
    // Rows must describe the SAME songs in the SAME order so columns align.
    o.perSong.forEach((row, i) => {
      assert.equal(row.rawOrderIndex, ref[i].rawOrderIndex, 'song identity matches by index');
      assert.ok(Number.isInteger(row.votes) && row.votes >= 0, 'integer votes per song');
    });
    // Rows are in best-first (combined/rank) order: rank values never increase.
    const ranks = o.perSong.map((r) => r.rank);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => b - a), 'rows ordered high→low rank');
    assert.equal(
      o.perSong.reduce((a, r) => a + r.votes, 0),
      o.tiers.reduce((a, r) => a + r.points * r.count, 0),
      'per-song votes total the option budget'
    );
  }
});

test('resolveOptionPick applies a surfaced distribution by letter (music-only path)', () => {
  const scores = [78, 77, 76, 75, 74, 73, 72, 71, 70, 69];
  const g = mk(scores);
  const { tradeoffs } = allocate(g, 14, 5, { shape: 'auto' });
  const ts = tradeoffs.find((t) => t.kind === 'tier-structure');
  assert.ok(ts && ts.options.length >= 2, 'field surfaces at least two options');

  // Pick the non-default option B exactly as the music-only CLI now does: resolve
  // the per-song override map, feed it back through allocate, and confirm the
  // applied distribution reproduces option B song-for-song.
  const { idx, overrides, error } = resolveOptionPick(tradeoffs, 'B');
  assert.equal(error, null);
  assert.equal(idx, 1, 'B resolves to the second option');
  const chosen = ts.options[1];

  const f = mk(scores);
  const res = allocate(f, 14, 5, { shape: 'auto', overrides });
  assert.equal(sum(f), 14, 'applied option still spends the full budget');
  const byIdx = new Map(f.map((s) => [s.rawOrderIndex, s.finalVotes]));
  for (const ps of chosen.perSong) {
    assert.equal(byIdx.get(ps.rawOrderIndex), ps.votes, `song ${ps.rawOrderIndex} matches option B`);
  }
  assert.ok(
    !res.tradeoffs.some((t) => t.kind === 'tier-structure'),
    'a fully-pinned pick is not re-surfaced as a choice'
  );
});

test('reconcileOptionPins reflows a net-positive pin by shedding the bottom (budget stays exact)', () => {
  // Option distribution best-first: 2,2,2,1,1 = budget 8 (mirrors story-5 option A).
  const perSong = [
    { rawOrderIndex: 3, votes: 2 },
    { rawOrderIndex: 10, votes: 2 },
    { rawOrderIndex: 1, votes: 2 },
    { rawOrderIndex: 9, votes: 1 },
    { rawOrderIndex: 12, votes: 1 },
    { rawOrderIndex: 6, votes: 0 },
    { rawOrderIndex: 0, votes: 0 },
  ];
  // Pin the 4th song up to 2 (+1). The surplus is shed from the lowest funded
  // unpinned song (#12, the bottom 1) → 2,2,2,2,0, still summing to 8.
  const ov = reconcileOptionPins(perSong, { 9: 2 });
  assert.equal(Object.values(ov).reduce((a, b) => a + b, 0), 8, 'budget preserved exactly');
  assert.equal(ov[9], 2, 'pin honored');
  assert.equal(ov[12], 0, 'bottom funded song shed the surplus point');
  assert.deepEqual(ov, { 3: 2, 10: 2, 1: 2, 9: 2, 12: 0, 6: 0, 0: 0 });
});

test('reconcileOptionPins reflows a net-negative pin by promoting the next candidate', () => {
  const perSong = [
    { rawOrderIndex: 3, votes: 2 },
    { rawOrderIndex: 10, votes: 2 },
    { rawOrderIndex: 1, votes: 2 },
    { rawOrderIndex: 9, votes: 1 },
    { rawOrderIndex: 12, votes: 1 },
    { rawOrderIndex: 6, votes: 0 },
    { rawOrderIndex: 0, votes: 0 },
  ];
  // Pin the top song down to 0 (−2). The freed points promote the best unfunded
  // unpinned songs first (#6, then #0), keeping the budget at 8.
  const ov = reconcileOptionPins(perSong, { 3: 0 });
  assert.equal(Object.values(ov).reduce((a, b) => a + b, 0), 8, 'budget preserved exactly');
  assert.equal(ov[3], 0, 'pin honored');
  assert.equal(ov[6], 1, 'best unfunded song promoted first');
  assert.equal(ov[0], 1, 'second freed point promotes the next unfunded song');
});

test('reconcileOptionPins respects the per-song cap when promoting', () => {
  const perSong = [
    { rawOrderIndex: 0, votes: 2 },
    { rawOrderIndex: 1, votes: 2 },
    { rawOrderIndex: 2, votes: 0 },
  ];
  // Pin #1 to 0 (−2). With cap 2 and only one other open song (#2), the promotion
  // can lift #2 to the cap (2) but no further — budget stays exact at 4.
  const ov = reconcileOptionPins(perSong, { 1: 0 }, 2);
  assert.equal(Object.values(ov).reduce((a, b) => a + b, 0), 4, 'budget preserved');
  assert.equal(ov[2], 2, 'promotion stops at the cap');
});

test('reconcileOptionPins injects out-of-menu pins (blank-score slots) and reflows', () => {
  const perSong = [
    { rawOrderIndex: 20, votes: 2 },
    { rawOrderIndex: 26, votes: 2 },
    { rawOrderIndex: 22, votes: 2 },
  ];
  const ov = reconcileOptionPins(perSong, { 20: 1, 26: 1, 11: 1 });
  assert.equal(ov[11], 1, 'blank slot pin is kept');
  assert.equal(ov[20], 1);
  assert.equal(ov[26], 1);
  assert.equal(Object.values(ov).reduce((a, b) => a + b, 0), 6, 'budget preserved');
});

test('pinEligibilityError allows pins on blank-score songs', () => {
  const songs = [{ rawOrderIndex: 11, title: 'crystals of time', needsUserInput: true }];
  assert.equal(pinEligibilityError(songs, { 11: 1 }, undefined), null);
});

test('pinEligibilityError still rejects disqualified pins', () => {
  const songs = [{ rawOrderIndex: 3, title: 'nope', isDisqualified: true }];
  assert.match(pinEligibilityError(songs, { 3: 1 }, undefined), /disqualified/i);
});

test('option pick with blank-score pin keeps bank exact without spill-bumping the top', () => {
  const base = [
    { rawOrderIndex: 22, title: 'POSE', score: 78 },
    { rawOrderIndex: 18, title: 'Sym', score: 76.6 },
    { rawOrderIndex: 19, title: 'Acid', score: 75.7 },
    { rawOrderIndex: 20, title: 'Bass', score: 75 },
    { rawOrderIndex: 26, title: 'Points', score: 75 },
    { rawOrderIndex: 5, title: 'Happening', score: 74.5 },
    { rawOrderIndex: 13, title: '1979', score: 74 },
    { rawOrderIndex: 25, title: 'Armed', score: 74 },
    { rawOrderIndex: 10, title: '50mg', score: 69 },
    { rawOrderIndex: 11, title: 'crystals', needsUserInput: true },
  ].map((s) => ({ ...s, finalVotes: 0, finalDownvotes: 0, isDisqualified: false, isOwn: false }));
  const { tradeoffs } = allocate([...base], 13, 5, { shape: 'auto' });
  const ts = tradeoffs.find((t) => t.kind === 'tier-structure');
  assert.ok(ts?.options?.length, 'tier-structure surfaced');
  const { overrides } = resolveOptionPick(tradeoffs, 'A', { 20: 1, 26: 1, 19: 1, 11: 1 }, 5);
  const field = base.map((s) => ({ ...s, finalVotes: 0, finalDownvotes: 0 }));
  allocate(field, 13, 5, { shape: 'auto', overrides });
  assert.equal(field.find((s) => s.rawOrderIndex === 11).finalVotes, 1);
  assert.equal(field.find((s) => s.rawOrderIndex === 22).finalVotes, 2, 'POSE not spill-bumped');
  assert.equal(sum(field), 13);
});

test('resolveOptionPick + option pin stays budget-exact end to end (no overshoot)', () => {
  const scores = [78, 77, 76, 75, 74, 73, 72, 71, 70, 69];
  const { tradeoffs } = allocate(mk(scores), 14, 5, { shape: 'auto' });
  const ts = tradeoffs.find((t) => t.kind === 'tier-structure');
  assert.ok(ts && ts.options.length >= 1);
  // Pin the option's 2nd-ranked song one point above whatever the option gave it.
  const ref = ts.options[0].perSong;
  const target = ref[1];
  const { overrides } = resolveOptionPick(tradeoffs, 'A', { [target.rawOrderIndex]: target.votes + 1 }, 5);
  const f = mk(scores);
  allocate(f, 14, 5, { shape: 'auto', overrides });
  assert.equal(sum(f), 14, 'option + pin still spends the full bank exactly');
});

test('applyOptionPick + pin stays budget-exact on combined-ranked menu', () => {
  const songs = mk([77, 77, 74, 74, 73, 73, 67, 62, 55, 50]).map((s) => ({
    ...s,
    combinedScore: s.score,
    gate: 'pass',
    fitScore: 93,
    finalVotes: 0,
    finalDownvotes: 0,
  }));
  const profile = { shape: 'auto', rankBy: 'combined' };
  const { tradeoffs } = allocate([...songs], 15, 10, profile);
  const optB = tradeoffs.find((t) => t.kind === 'tier-structure')?.options?.[1];
  assert.ok(optB, 'option B surfaced');
  const v0 = optB.perSong.find((p) => p.rawOrderIndex === 0)?.votes ?? 0;
  const v1 = optB.perSong.find((p) => p.rawOrderIndex === 1)?.votes ?? 0;
  const field = songs.map((s) => ({ ...s }));
  const picked = applyOptionPick({
    optionSpec: 'B',
    reallocate: (ov) => allocate(field, 15, 10, { ...profile, overrides: ov }).tradeoffs,
    initialTradeoffs: tradeoffs,
    baseOverrides: { 0: v0 + 1, 1: v1 + 1 },
    songs: field,
    cap: 10,
    exitOnError: false,
  });
  assert.equal(sum(field), 15, 'bank stays exact');
  assert.equal(field[0].finalVotes, v0 + 1);
  assert.equal(field[1].finalVotes, v1 + 1);
  assert.ok(picked.pick?.tweaks?.length, 'records manual tweaks');
});

test('budget-mismatch is flagged when a bare pin overshoots the bank', () => {
  // Pin three songs to the cap (3×3 = 9) against a 6-point bank: the allocator
  // honors the deliberate pins but must loudly flag the over-budget total.
  const songs = mk([78, 76, 74, 72, 70, 68]);
  const { tradeoffs } = allocate(songs, 6, 5, { shape: 'auto', overrides: { 0: 3, 1: 3, 2: 3 } });
  const bm = tradeoffs.find((t) => t.kind === 'budget-mismatch');
  assert.ok(bm, 'over-budget allocation surfaces a budget-mismatch');
  assert.equal(bm.over, true, 'flagged as OVER budget');
  assert.match(bm.question, /upvotes 9\/6/);
});

test('budget-mismatch is flagged when downvote pins underfill the down bank', () => {
  const songs = mk([78, 76, 74, 72, 70, 68]);
  // Down bank is 5 but a single down-pin of 1 is the only downvote committed.
  const { tradeoffs } = allocate(songs, 5, 5, {
    shape: 'auto',
    downvotesEnabled: true,
    downvoteBudget: 5,
    downvoteCap: 1,
    downShape: 'concentrated',
    downOverrides: { 5: 1 },
  });
  // (Concentrated honors the pin; spill fills the rest, so this should still be
  // exact — assert the happy path does NOT false-positive.)
  assert.ok(!tradeoffs.some((t) => t.kind === 'budget-mismatch'), 'a fully-spent down bank is not flagged');
  assert.equal(sumDown(songs), 5);
});

test('a clean allocation never emits a budget-mismatch', () => {
  const songs = mk([78, 76, 74, 72, 70, 68]);
  const { tradeoffs } = allocate(songs, 10, 3, { shape: 'auto' });
  assert.ok(!tradeoffs.some((t) => t.kind === 'budget-mismatch'));
});

test('pinCapError rejects a pin above a real per-song cap, ignores unlimited caps', () => {
  assert.match(pinCapError({ 0: 4 }, undefined, 3, Infinity), /exceeds max upvotes per song \(3\)/);
  assert.match(pinCapError(undefined, { 2: 3 }, Infinity, 2), /exceeds max downvotes per song \(2\)/);
  assert.equal(pinCapError({ 0: 3, 1: 2 }, undefined, 3, Infinity), null, 'within cap is fine');
  assert.equal(pinCapError({ 0: 99 }, undefined, Infinity, Infinity), null, 'no cap never trips');
});

test('resolveOptionPick reports an unavailable option without throwing', () => {
  const scores = [78, 77, 76, 75, 74, 73, 72, 71, 70, 69];
  const { tradeoffs } = allocate(mk(scores), 14, 5, { shape: 'auto' });
  const ts = tradeoffs.find((t) => t.kind === 'tier-structure');
  assert.ok(ts);
  const { idx, overrides, error } = resolveOptionPick(tradeoffs, 'Z');
  assert.equal(idx, null);
  assert.equal(overrides, null);
  assert.match(error, /not available/);
});

test('--tier-count forces the number of final point tiers (friendly knob)', () => {
  const scores = [78, 77, 76, 75, 74, 73, 72, 71, 70, 69];
  for (const want of [2, 3, 4]) {
    const forced = mk(scores);
    const res = allocate(forced, 14, 5, { shape: 'auto', tierCount: want });
    assert.equal(sum(forced), 14);
    assert.equal(distinctVotes(forced), want, `--tier-count ${want} produces ${want} point tiers`);
    assert.ok(
      !res.tradeoffs.some((t) => t.kind === 'tier-structure'),
      'pinned count is not re-surfaced'
    );
    // Forcing a count overrides the smoothness-preferring default (a field may
    // not support that many tiers smoothly), so only monotonicity is guaranteed.
    const by = [...forced].sort((a, b) => b.score - a.score);
    for (let i = 1; i < by.length; i++) {
      assert.ok(by[i].finalVotes <= by[i - 1].finalVotes, `tier-count ${want} stays monotonic`);
    }
  }
});

test('--bucket-count forces the score-cluster count K (lower-level knob)', () => {
  const scores = [78, 77, 76, 75, 74, 73, 72, 71, 70, 69];
  const forced = mk(scores);
  const res = allocate(forced, 14, 5, { shape: 'auto', bucketCount: 2 });
  assert.equal(sum(forced), 14);
  assert.ok(!res.tradeoffs.some((t) => t.kind === 'tier-structure'), 'forced bucket count is not re-surfaced');
  // Forcing a coarse bucketing overrides the smoothness-preferring default, so we
  // only require monotonicity (a higher score never earns fewer points), not
  // smoothness — the user opted into the coarser shape.
  const by = [...forced].sort((a, b) => b.score - a.score);
  for (let i = 1; i < by.length; i++) {
    assert.ok(by[i].finalVotes <= by[i - 1].finalVotes, 'bucket-forced stays monotonic');
  }
});

test('allocation is monotonic — a higher score never earns fewer points', () => {
  // The crowded-middle bug: a populous lower tier must never out-earn a sparser
  // higher one (e.g. a 72 beating a 73). Holds across mixed fields and ratios.
  const fields = [
    [92, 88, 74, 73, 72, 72, 71, 70, 70, 69],
    [75, 74, 73, 72, 72, 71, 70, 69, 68, 67],
    [88, 85, 82, 80, 78, 76, 75, 74, 72, 70],
  ];
  for (const scores of fields) {
    for (const budget of [10, 14, 18]) {
      const g = mk(scores);
      allocate(g, budget, 5, { shape: 'auto' });
      assert.equal(sum(g), budget);
      const byScore = [...g].sort((a, b) => b.score - a.score);
      for (let i = 1; i < byScore.length; i++) {
        assert.ok(
          byScore[i].finalVotes <= byScore[i - 1].finalVotes,
          `non-monotonic at budget ${budget}: ${JSON.stringify(byScore.map((s) => [s.score, s.finalVotes]))}`
        );
      }
    }
  }
});

test('more points build taller tiers while a zero band persists', () => {
  // As the ratio grows the top climbs (more, taller tiers) without erasing the
  // zeros at the bottom — expand the curve, don't flatten the extra points in.
  const scores = [88, 85, 82, 80, 78, 76, 75, 74, 72, 70];
  const at = (budget) => {
    const g = mk(scores);
    allocate(g, budget, 5, { shape: 'auto' });
    return g;
  };
  const even = at(10); // ~1:1
  const rich = at(20); // ~2:1
  assert.ok(zeros(even) >= 1, `~1:1 should keep a zero band, got ${zeros(even)}`);
  assert.ok(zeros(rich) >= 1, 'a zero band persists as points open up');
  assert.ok(topVote(rich) > topVote(even), 'top tiers climb as points open up');
});

test('higher ratio opens more tiers', () => {
  const songs = mk([70, 72, 73, 74, 75, 76, 77, 78, 80, 82]);
  allocate(songs, 20, 9, { shape: 'auto' });
  assert.equal(sum(songs), 20);
  const distinct = new Set(songs.map((s) => s.finalVotes));
  assert.ok(distinct.size >= 4, 'expected several distinct point tiers');
});

test('relative shape still allocates the full budget', () => {
  const songs = mk([70, 72, 73, 76, 78]);
  allocate(songs, 7, 5, { shape: 'relative' });
  assert.equal(sum(songs), 7);
});

// ---------------------------------------------------------------------------
// rankBy + gates + same-score-same-tier
// ---------------------------------------------------------------------------
test('rankValue combines fit and music by weights', () => {
  const s = { score: 70, fitScore: 90 };
  assert.equal(rankValue(s, { rankBy: 'combined', weights: { fit: 0.5, music: 0.5 } }), 80);
  assert.equal(rankValue(s, { rankBy: 'fit' }), 90);
  assert.equal(rankValue(s, { rankBy: 'music' }), 70);
});

test('cutoff gate zeroes songs below the fit cutoff (realistic round)', () => {
  // 10-song blended round: 6 qualify (fit >= 68), 4 below cutoff (incl. a
  // musically strong but off-theme song that must still earn nothing).
  const songs = [
    { title: 'q1', rawOrderIndex: 0, score: 75, fitScore: 93 },
    { title: 'q2', rawOrderIndex: 1, score: 72, fitScore: 85 },
    { title: 'q3', rawOrderIndex: 2, score: 73, fitScore: 80 },
    { title: 'q4', rawOrderIndex: 3, score: 70, fitScore: 72 },
    { title: 'q5', rawOrderIndex: 4, score: 78, fitScore: 70 },
    { title: 'q6', rawOrderIndex: 5, score: 74, fitScore: 68 },
    { title: 'b1', rawOrderIndex: 6, score: 90, fitScore: 50 },
    { title: 'b2', rawOrderIndex: 7, score: 80, fitScore: 40 },
    { title: 'b3', rawOrderIndex: 8, score: 76, fitScore: 35 },
    { title: 'b4', rawOrderIndex: 9, score: 72, fitScore: 52 },
  ];
  allocate(songs, 10, 5, { rankBy: 'combined', gate: { type: 'cutoff', axis: 'fit', min: 68 } });
  for (const b of songs.slice(6)) {
    assert.equal(b.finalVotes, 0, 'below-cutoff fit earns nothing regardless of music');
  }
  assert.equal(sum(songs), 10);
});

test('passFail gate: fails earn nothing (realistic round)', () => {
  // 12 songs, 8 pass / 4 fail, ~1:1 budget.
  const songs = [
    { title: 'p1', rawOrderIndex: 0, score: 70, gate: 'pass' },
    { title: 'p2', rawOrderIndex: 1, score: 72, gate: 'pass' },
    { title: 'p3', rawOrderIndex: 2, score: 73, gate: 'pass' },
    { title: 'p4', rawOrderIndex: 3, score: 74, gate: 'pass' },
    { title: 'p5', rawOrderIndex: 4, score: 75, gate: 'pass' },
    { title: 'p6', rawOrderIndex: 5, score: 76, gate: 'pass' },
    { title: 'p7', rawOrderIndex: 6, score: 78, gate: 'pass' },
    { title: 'p8', rawOrderIndex: 7, score: 80, gate: 'pass' },
    { title: 'f1', rawOrderIndex: 8, score: 90, gate: 'fail' },
    { title: 'f2', rawOrderIndex: 9, score: 77, gate: 'fail' },
    { title: 'f3', rawOrderIndex: 10, score: 71, gate: 'fail' },
    { title: 'f4', rawOrderIndex: 11, score: 68, gate: 'fail' },
  ];
  allocate(songs, 12, 5, { gate: { type: 'passFail' } });
  for (const f of songs.slice(8)) assert.equal(f.finalVotes, 0, 'fails earn nothing');
  assert.equal(sum(songs), 12);
});

test('passFailMaybe: questionable band funded only when budget is generous', () => {
  // 5 clear passes, 4 questionable (varying defensibility), 3 fails.
  const base = () => [
    { title: 'p1', rawOrderIndex: 0, score: 78, gate: 'pass' },
    { title: 'p2', rawOrderIndex: 1, score: 75, gate: 'pass' },
    { title: 'p3', rawOrderIndex: 2, score: 73, gate: 'pass' },
    { title: 'p4', rawOrderIndex: 3, score: 72, gate: 'pass' },
    { title: 'p5', rawOrderIndex: 4, score: 70, gate: 'pass' },
    { title: 'm1', rawOrderIndex: 5, score: 74, fitScore: 64, gate: 'maybe' },
    { title: 'm2', rawOrderIndex: 6, score: 72, fitScore: 60, gate: 'maybe' },
    { title: 'm3', rawOrderIndex: 7, score: 71, fitScore: 55, gate: 'maybe' },
    { title: 'm4', rawOrderIndex: 8, score: 70, fitScore: 50, gate: 'maybe' },
    { title: 'f1', rawOrderIndex: 9, score: 80, gate: 'fail' },
    { title: 'f2', rawOrderIndex: 10, score: 69, gate: 'fail' },
    { title: 'f3', rawOrderIndex: 11, score: 66, gate: 'fail' },
  ];
  const maybeVotes = (songs) => songs.slice(5, 9).reduce((a, s) => a + s.finalVotes, 0);

  // Tight (budget == #passes): no spare, questionable band stays at 0.
  let songs = base();
  allocate(songs, 5, 5, { rankBy: 'combined', gate: { type: 'passFailMaybe' } });
  assert.equal(maybeVotes(songs), 0, 'tight budget funds no questionable entries');
  for (const f of songs.slice(9)) assert.equal(f.finalVotes, 0);

  // Generous: spare points reward the most-defensible questionable entries.
  songs = base();
  allocate(songs, 12, 5, { rankBy: 'combined', gate: { type: 'passFailMaybe' } });
  assert.ok(maybeVotes(songs) > 0, 'generous budget funds the questionable band');
  assert.ok(songs[5].finalVotes >= songs[8].finalVotes, 'most-defensible maybe funded first');
  for (const f of songs.slice(9)) assert.equal(f.finalVotes, 0, 'fails still earn nothing');
  assert.equal(sum(songs), 12);
});

// ---------------------------------------------------------------------------
// R1: center-out unit-step staircase (contiguity + no top-heaviness)
// ---------------------------------------------------------------------------
test('R1: kpop-solo-like field gets a contiguous, low-top curve (no {4,1,0})', () => {
  // The reported bug: a tight cluster + modest budget produced {4,1,0} (a tall
  // top over a cliff). The staircase must give contiguous point tiers and keep
  // the top low when no real gap justifies it.
  const scores = [80, 76, 76, 75.5, 75, 75, 74.5, 74, 74, 73.5];
  const g = mk(scores);
  allocate(g, 10, 5, { shape: 'auto' });
  assert.equal(sum(g), 10);
  const votes = [...g].sort((a, b) => b.score - a.score).map((s) => s.finalVotes);
  assertContiguous(votes, 'kpop-like');
  assert.ok(Math.max(...votes) <= 2, `tight cluster should not top-heap, got ${JSON.stringify(votes)}`);
});

test('R1+R2 regression (3 3 3): clear favorites build a graduated top over the 75 anchor band', () => {
  // Two clear favorites (>=80) sit a real gap above the field, then an "actively
  // like" band (>=75) above a long tail. Unlike the tight kpop cluster, the real
  // favorite gap + the 75 anchor justify a taller, graduated top: favorites at the
  // max, a middle band at the 75 line, then a 1-point floor — not a flat max-2.
  const scores = [
    90, 84, 77, 77, 75.5, 75, 74, 73.5, 73.5, 73, 72.5, 72, 71.5, 71, 70.5, 70, 69.5, 69, 68.5, 68, 67.5, 67,
  ];
  const g = mk(scores);
  const { tradeoffs } = allocate(g, 15, 4, { shape: 'auto' });
  assert.equal(sum(g), 15);
  const by = [...g].sort((a, b) => b.score - a.score);
  const votes = by.map((s) => s.finalVotes);
  assertContiguous(votes, '3 3 3');
  // Favorites share the strict top tier; the curve is graduated (>=3 funded tiers),
  // not a flat max-2 — a real favorite gap earns a taller top than the kpop cluster.
  const favVotes = by.filter((s) => s.score >= 80).map((s) => s.finalVotes);
  assert.equal(new Set(favVotes).size, 1, 'favorites share one tier');
  assert.equal(favVotes[0], Math.max(...votes), 'favorites are the top tier');
  assert.equal(Math.max(...votes), 3, 'graduated top reaches 3 (favorites), not a flat 2');
  assert.ok(new Set(votes.filter((v) => v > 0)).size >= 3, 'at least three funded point tiers');
  // The "actively like" 2-band sits on the 75 anchor: every score >= 75 earns >= 2.
  assert.ok(by.filter((s) => s.score >= 75).every((s) => s.finalVotes >= 2), '>=75 forms the middle band');
  // The C1/C2/C3 alternatives are surfaced as a tier-structure choice.
  const ts = tradeoffs.find((t) => t.kind === 'tier-structure');
  assert.ok(ts && ts.options.length >= 2, 'alternative staircases surface as a tradeoff');
});

test('R1: high cap does not inflate the top when a shorter staircase fits (no cap-reach)', () => {
  const scores = [78, 77, 76, 75, 74, 73, 72, 71, 70, 69];
  const lowCap = mk(scores);
  allocate(lowCap, 14, 3, { shape: 'auto' });
  const highCap = mk(scores);
  allocate(highCap, 14, 99, { shape: 'auto' });
  assert.equal(sum(lowCap), 14);
  assert.equal(sum(highCap), 14);
  const top = (g) => Math.max(...g.map((s) => s.finalVotes));
  // A near-infinite cap must not produce a taller top than a tight cap when the
  // same budget is spent — the top comes from promotion steps, not the cap.
  assert.equal(top(highCap), top(lowCap), 'top height is budget-driven, not cap-driven');
  assertContiguous([...highCap].sort((a, b) => b.score - a.score).map((s) => s.finalVotes), 'high-cap');
});

test('R1: every auto curve is contiguous and budget-exact across fields/ratios', () => {
  const fields = [
    [92, 88, 74, 73, 72, 72, 71, 70, 70, 69],
    [88, 85, 82, 80, 78, 76, 75, 74, 72, 70],
    [75, 74, 73, 72, 72, 71, 70, 69, 68, 67],
    [80, 76, 76, 75.5, 75, 75, 74.5, 74, 74, 73.5, 73, 72],
  ];
  for (const scores of fields) {
    for (const budget of [6, 10, 14, 20]) {
      const g = mk(scores);
      allocate(g, budget, 5, { shape: 'auto' });
      assert.equal(sum(g), budget, `budget ${budget} fully spent`);
      assertContiguous(
        [...g].sort((a, b) => b.score - a.score).map((s) => s.finalVotes),
        `field/${budget}`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// R2: favorite top-band merge (scores >= 80 share the top tier)
// ---------------------------------------------------------------------------
test('R2: scores >= 80 merge into one shared top tier by default', () => {
  const scores = [90, 84, 82, 81, 77, 75.5, 74, 73.5, 73, 72.5, 72, 71, 70, 69, 68, 67];
  const g = mk(scores);
  const { tradeoffs } = allocate(g, 15, 4, { shape: 'auto' });
  assert.equal(sum(g), 15);
  const top = [...g].filter((s) => s.score >= 80).map((s) => s.finalVotes);
  assert.equal(new Set(top).size, 1, 'all >=80 favorites share one point value');
  assert.equal(Math.max(...g.map((s) => s.finalVotes)), top[0], 'the favorites are the top tier');
  assert.ok(tradeoffs.some((t) => t.kind === 'top-band-split'), 'a significant merged band surfaces a split tradeoff');
  assertContiguous([...g].sort((a, b) => b.score - a.score).map((s) => s.finalVotes), 'R2 merged');
});

test('R2: --no-favorite-band splits the favorites onto their own gaps', () => {
  const scores = [90, 84, 82, 81, 77, 75.5, 74, 73.5, 73, 72.5, 72, 71, 70, 69, 68, 67];
  const g = mk(scores);
  allocate(g, 15, 4, { shape: 'auto', favoriteBand: false });
  assert.equal(sum(g), 15);
  const top = [...g].filter((s) => s.score >= 80).map((s) => s.finalVotes);
  assert.ok(new Set(top).size > 1, 'disabling the merge lets the favorites separate');
  assertContiguous([...g].sort((a, b) => b.score - a.score).map((s) => s.finalVotes), 'R2 split');
});

test('R2: favorite-band default is OFF for combined rounds (the 80 floor is a raw-music anchor)', () => {
  // Combined scores near/above 80 are a z-remap artifact (above-average in a weak
  // field), not real raw 8+ favorites — so the merge must not fire by default when
  // ranking by combined. Raw blends here put a/b/c/d >= 80 with no normalization.
  const rows = () => [
    { title: 'a', rawOrderIndex: 0, score: 77, fitScore: 93 },
    { title: 'b', rawOrderIndex: 1, score: 76, fitScore: 85 },
    { title: 'c', rawOrderIndex: 2, score: 74, fitScore: 90 },
    { title: 'd', rawOrderIndex: 3, score: 75, fitScore: 84 },
    { title: 'e', rawOrderIndex: 4, score: 73, fitScore: 72 },
    { title: 'f', rawOrderIndex: 5, score: 72, fitScore: 70 },
  ];
  const dflt = rows();
  const { tradeoffs: tDflt } = allocate(dflt, 10, 5, { rankBy: 'combined' });
  assert.ok(
    !tDflt.some((t) => t.kind === 'top-band-split'),
    'no favorite-band merge surfaces by default in combined mode'
  );

  // An explicit floor is still honored even in combined mode (owner opts in).
  const forced = rows();
  const { tradeoffs: tForced } = allocate(forced, 10, 5, {
    rankBy: 'combined',
    favoriteBand: { min: 80 },
  });
  const fav = [...forced].filter((s) => rankValue(s, { rankBy: 'combined' }) >= 80);
  const favVotes = new Set(fav.map((s) => s.finalVotes));
  assert.equal(favVotes.size, 1, 'an explicit floor merges the >=80 band into one tier');
  assert.ok(
    tForced.some((t) => t.kind === 'top-band-split'),
    'the explicit merge surfaces the split tradeoff'
  );
});

// ---------------------------------------------------------------------------
// Bug 2: passes shaped first; a maybe never outranks a pass
// ---------------------------------------------------------------------------
const maybeNeverOutranksPass = (songs, passN) => {
  const passes = songs.slice(0, passN).map((s) => s.finalVotes);
  const maybes = songs.slice(passN).filter((s) => s.gate === 'maybe').map((s) => s.finalVotes);
  const minPass = Math.min(...passes);
  const maxMaybe = maybes.length ? Math.max(...maybes) : 0;
  assert.ok(maxMaybe <= minPass, `max(maybe)=${maxMaybe} must be <= min(pass)=${minPass}`);
};

test('Bug 2: a maybe never outranks a pass (repro: 7 passes, 2 maybes, budget 10)', () => {
  const songs = [
    { title: 'p1', rawOrderIndex: 0, score: 76, gate: 'pass' },
    { title: 'p2', rawOrderIndex: 1, score: 75, gate: 'pass' },
    { title: 'p3', rawOrderIndex: 2, score: 74, gate: 'pass' },
    { title: 'p4', rawOrderIndex: 3, score: 73, gate: 'pass' },
    { title: 'p5', rawOrderIndex: 4, score: 72, gate: 'pass' },
    { title: 'p6', rawOrderIndex: 5, score: 71, gate: 'pass' },
    { title: 'p7', rawOrderIndex: 6, score: 69, gate: 'pass' },
    { title: 'm1', rawOrderIndex: 7, score: 76, fitScore: 64, gate: 'maybe' },
    { title: 'm2', rawOrderIndex: 8, score: 70, fitScore: 55, gate: 'maybe' },
  ];
  allocate(songs, 10, 5, { rankBy: 'combined', gate: { type: 'passFailMaybe' } });
  assert.equal(sum(songs), 10);
  maybeNeverOutranksPass(songs, 7);
  // No pass sits at 0 while a maybe is funded.
  const fundedMaybe = songs.slice(7).some((s) => s.finalVotes > 0);
  if (fundedMaybe) assert.ok(songs.slice(0, 7).every((s) => s.finalVotes >= 1), 'no 0 pass beside a funded maybe');
});

test('Bug 2: generous surplus funds maybes at the 1-point floor (3 passes, 2 maybes, budget 10)', () => {
  const songs = [
    { title: 'p1', rawOrderIndex: 0, score: 78, gate: 'pass' },
    { title: 'p2', rawOrderIndex: 1, score: 75, gate: 'pass' },
    { title: 'p3', rawOrderIndex: 2, score: 73, gate: 'pass' },
    { title: 'm1', rawOrderIndex: 3, score: 74, fitScore: 64, gate: 'maybe' },
    { title: 'm2', rawOrderIndex: 4, score: 72, fitScore: 58, gate: 'maybe' },
  ];
  allocate(songs, 10, 5, { rankBy: 'combined', gate: { type: 'passFailMaybe' } });
  assert.equal(sum(songs), 10);
  assert.ok(songs.slice(0, 3).every((s) => s.finalVotes >= 1), 'all passes funded');
  // Not a low-pass round (passes >= maybes) -> maybes stay at the 1-point floor.
  assert.ok(songs[3].finalVotes <= 1 && songs[4].finalVotes <= 1, 'maybes capped at 1 (Q4 default)');
  maybeNeverOutranksPass(songs, 3);
});

test('Bug 2: leniency reaches further down the maybe list at the floor', () => {
  const base = () => [
    { title: 'p1', rawOrderIndex: 0, score: 80, gate: 'pass' },
    { title: 'p2', rawOrderIndex: 1, score: 78, gate: 'pass' },
    { title: 'p3', rawOrderIndex: 2, score: 76, gate: 'pass' },
    { title: 'p4', rawOrderIndex: 3, score: 74, gate: 'pass' },
    { title: 'p5', rawOrderIndex: 4, score: 73, gate: 'pass' },
    { title: 'p6', rawOrderIndex: 5, score: 72, gate: 'pass' },
    { title: 'm1', rawOrderIndex: 6, score: 75, fitScore: 66, gate: 'maybe' },
    { title: 'm2', rawOrderIndex: 7, score: 73, fitScore: 60, gate: 'maybe' },
    { title: 'm3', rawOrderIndex: 8, score: 71, fitScore: 55, gate: 'maybe' },
    { title: 'm4', rawOrderIndex: 9, score: 70, fitScore: 50, gate: 'maybe' },
  ];
  const stingy = base();
  allocate(stingy, 14, 5, { rankBy: 'combined', gate: { type: 'passFailMaybe', leniency: 0 } });
  const lenient = base();
  allocate(lenient, 14, 5, { rankBy: 'combined', gate: { type: 'passFailMaybe', leniency: 1 } });
  assert.equal(sum(stingy), 14);
  assert.equal(sum(lenient), 14);
  const fundedMaybes = (g) => g.slice(6).filter((s) => s.finalVotes > 0).length;
  assert.ok(fundedMaybes(lenient) >= fundedMaybes(stingy), 'leniency funds at least as many maybes');
  maybeNeverOutranksPass(lenient, 6);
  // Funded maybes are the most-defensible (highest fitScore) ones, in order.
  const funded = lenient.slice(6).filter((s) => s.finalVotes > 0).map((s) => s.fitScore);
  assert.deepEqual(funded, [...funded].sort((a, b) => b - a), 'maybes funded by defensibility, not music');
});

test('Bug 2 (Step 1b): low-pass round gives the maybe band its own graduated staircase', () => {
  // Few clear passes, mostly maybes: passes take a strict top; the maybe band
  // graduates below them, capped at the lowest pass.
  const songs = [
    { title: 'p1', rawOrderIndex: 0, score: 80, gate: 'pass' },
    { title: 'p2', rawOrderIndex: 1, score: 74, gate: 'pass' },
    { title: 'm1', rawOrderIndex: 2, score: 78, fitScore: 66, gate: 'maybe' },
    { title: 'm2', rawOrderIndex: 3, score: 76, fitScore: 62, gate: 'maybe' },
    { title: 'm3', rawOrderIndex: 4, score: 73, fitScore: 60, gate: 'maybe' },
    { title: 'm4', rawOrderIndex: 5, score: 72, fitScore: 58, gate: 'maybe' },
    { title: 'm5', rawOrderIndex: 6, score: 71, fitScore: 55, gate: 'maybe' },
    { title: 'm6', rawOrderIndex: 7, score: 70, fitScore: 52, gate: 'maybe' },
    { title: 'm7', rawOrderIndex: 8, score: 69, fitScore: 50, gate: 'maybe' },
    { title: 'm8', rawOrderIndex: 9, score: 68, fitScore: 48, gate: 'maybe' },
  ];
  const { tradeoffs } = allocate(songs, 10, 5, { rankBy: 'combined', gate: { type: 'passFailMaybe' } });
  assert.equal(sum(songs), 10);
  const passes = songs.slice(0, 2).map((s) => s.finalVotes);
  const maybes = songs.slice(2).map((s) => s.finalVotes);
  const passFloor = Math.min(...passes);
  assert.ok(Math.max(...maybes) <= passFloor, 'every maybe <= the lowest pass');
  assert.ok(Math.max(...passes) > Math.max(...maybes), 'top pass strictly highest');
  assert.ok(new Set(maybes.filter((v) => v > 0)).size >= 2, 'the maybe band is graduated, not flat');
  const mb = tradeoffs.find((t) => t.kind === 'maybe-band');
  assert.ok(mb && mb.options.some((o) => /graduated/i.test(o.label)), 'maybe-band tradeoff offers a graduated option');
});

test('tied scores stay in one tier (votes differ by at most 1) at ~1:1', () => {
  // 15-song round, ~1:1 budget, several tied score groups.
  const scores = [70, 71, 72, 72, 72, 73, 73, 73, 74, 74, 75, 76, 76, 78, 80];
  const songs = mk(scores);
  const { tradeoffs } = allocate(songs, 15, 5, { shape: 'auto' });
  assert.equal(sum(songs), 15);
  const groups = new Map();
  for (const s of songs) {
    const g = groups.get(s.score) || [];
    g.push(s.finalVotes);
    groups.set(s.score, g);
  }
  for (const [score, votes] of groups) {
    const spread = Math.max(...votes) - Math.min(...votes);
    assert.ok(spread <= 1, `tied score ${score} split too far: ${JSON.stringify(votes)}`);
    if (spread === 1) {
      assert.ok(
        tradeoffs.some((t) => t.kind === 'tier-split'),
        `unequal split at ${score} should surface a tier-split tradeoff`
      );
    }
  }
});

test('music tie: a +/- modifier takes the indivisible extra (no tradeoff)', () => {
  // One tier of three equal music scores; 4 points can't split evenly, but the
  // + resolves who gets the 2 — so it's decided, not surfaced.
  const songs = [
    { title: 'A', rawOrderIndex: 0, score: 75, plus: true },
    { title: 'B', rawOrderIndex: 1, score: 75 },
    { title: 'C', rawOrderIndex: 2, score: 75 },
  ];
  const { tradeoffs } = allocate(songs, 4, 5, { rankBy: 'music', shape: 'bell' });
  assert.equal(sum(songs), 4);
  assert.equal(songs[0].finalVotes, 2, '+ song takes the extra point');
  assert.equal(songs[1].finalVotes, 1);
  assert.equal(songs[2].finalVotes, 1);
  assert.ok(!tradeoffs.some((t) => t.kind === 'tier-split'), 'modifier resolves the split');
});

test('music tie: no modifier to break the split surfaces a tradeoff', () => {
  const songs = mk([75, 75, 75]);
  const { tradeoffs } = allocate(songs, 4, 5, { rankBy: 'music', shape: 'bell' });
  assert.equal(sum(songs), 4);
  assert.ok(tradeoffs.some((t) => t.kind === 'tier-split'), 'ambiguous split needs your call');
});

test('combined: equal music + same coarse fit band share a tier', () => {
  // A and B have identical music and both land in the "excellent" fit band
  // (90 vs 88 is made-up AI precision) -> same tier. C shares the music but
  // sits in a lower fit band, so it is free to land in a different tier.
  const songs = [
    { title: 'A', rawOrderIndex: 0, score: 75, fitScore: 90 },
    { title: 'B', rawOrderIndex: 1, score: 75, fitScore: 88 },
    { title: 'C', rawOrderIndex: 2, score: 75, fitScore: 45 },
    { title: 'D', rawOrderIndex: 3, score: 60, fitScore: 30 },
  ];
  normalizeCombined(songs, undefined, null, { fitTrust: 'llm' });
  allocate(songs, 8, 5, { rankBy: 'combined', fitTrust: 'llm', shape: 'bell' });
  assert.equal(sum(songs), 8);
  assert.ok(
    Math.abs(songs[0].finalVotes - songs[1].finalVotes) <= 1,
    'near-equal fit does not separate equal-music songs'
  );
  assert.ok(songs[0].finalVotes >= songs[2].finalVotes, 'higher fit band ranks at least as high');
});

test('manual fitTrust: symmetric raw combined ties tier and votes (KARMA/Stone)', () => {
  const songs = [
    { rawOrderIndex: 0, title: 'KARMA', score: 90, fitScore: 77, fitSource: 'manual' },
    { rawOrderIndex: 1, title: 'Stone', score: 77, fitScore: 90, fitSource: 'manual' },
    { rawOrderIndex: 2, title: 'f1', score: 70, fitScore: 60, fitSource: 'manual' },
    { rawOrderIndex: 3, title: 'f2', score: 72, fitScore: 65, fitSource: 'manual' },
    { rawOrderIndex: 4, title: 'f3', score: 74, fitScore: 70, fitSource: 'manual' },
    { rawOrderIndex: 5, title: 'f4', score: 68, fitScore: 55, fitSource: 'manual' },
    { rawOrderIndex: 6, title: 'f5', score: 65, fitScore: 50, fitSource: 'manual' },
  ];
  normalizeCombined(songs, { fit: 0.5, music: 0.5 }, null, { fitTrust: 'manual' });
  assert.equal(0.5 * 77 + 0.5 * 90, 0.5 * 90 + 0.5 * 77, 'raw combined ties');
  allocate(songs, 14, 5, {
    rankBy: 'combined',
    fitTrust: 'manual',
    weights: { fit: 0.5, music: 0.5 },
    shape: 'bell',
  });
  assert.equal(songs[0].finalVotes, songs[1].finalVotes, 'equal raw Combined ⇒ equal votes');
});

test('normalizeCombined manual: wide fit field differentiates scores', () => {
  const songs = [
    { rawOrderIndex: 0, title: 'hi', score: 80, fitScore: 95, fitSource: 'manual' },
    { rawOrderIndex: 1, title: 'lo', score: 80, fitScore: 40, fitSource: 'manual' },
    { rawOrderIndex: 2, title: 'm1', score: 75, fitScore: 70, fitSource: 'manual' },
    { rawOrderIndex: 3, title: 'm2', score: 72, fitScore: 65, fitSource: 'manual' },
    { rawOrderIndex: 4, title: 'm3', score: 70, fitScore: 55, fitSource: 'manual' },
  ];
  normalizeCombined(songs, { fit: 0.5, music: 0.5 }, null, { fitTrust: 'manual' });
  assert.ok(songs[0].combinedScore > songs[1].combinedScore, 'wide fit spread separates songs');
});

// ---------------------------------------------------------------------------
// Combined-score normalization (per-axis z-score + asymmetric std floors)
// ---------------------------------------------------------------------------
const combinedById = (songs) => Object.fromEntries(songs.map((s) => [s.rawOrderIndex, s.combinedScore]));

test('normalization: a real music edge overcomes a small fit edge (the rebalance)', () => {
  // Raw 0.7·fit + 0.3·music makes the higher-fit song win; normalization (which
  // dampens fit's wide spread and lets the tighter music distribution speak)
  // flips them, because the 8-point music gap is decisive and the 5-point fit gap
  // barely is. Six contenders so the per-round std (not the small-n fallback) runs.
  const songs = [
    { rawOrderIndex: 0, title: 'loFit-hiMusic', score: 78, fitScore: 85 },
    { rawOrderIndex: 1, title: 'hiFit-loMusic', score: 70, fitScore: 90 },
    { rawOrderIndex: 2, title: 'c', score: 74, fitScore: 80 },
    { rawOrderIndex: 3, title: 'd', score: 73, fitScore: 75 },
    { rawOrderIndex: 4, title: 'e', score: 76, fitScore: 72 },
    { rawOrderIndex: 5, title: 'f', score: 72, fitScore: 70 },
  ];
  // Raw blend: hiFit-loMusic (84) > loFit-hiMusic (82.9).
  assert.ok(0.7 * 90 + 0.3 * 70 > 0.7 * 85 + 0.3 * 78, 'raw blend favors the higher-fit song');
  normalizeCombined(songs);
  const c = combinedById(songs);
  assert.ok(c[0] > c[1], 'normalized blend flips them: the music edge wins');
});

test('normalization: high fit floor dampens a tight fit cluster (no amplification)', () => {
  // Same music, fit 85 vs 93 (different bands but a small, fuzzy AI gap). The high
  // fit floor (14) keeps the combined gap modest instead of letting a tight cluster's
  // std blow an 8-point fit gap up into a large swing. Still monotonic in fit.
  const songs = [
    { rawOrderIndex: 0, title: 'a', score: 74, fitScore: 93 },
    { rawOrderIndex: 1, title: 'b', score: 74, fitScore: 85 },
    { rawOrderIndex: 2, title: 'c', score: 74, fitScore: 88 },
    { rawOrderIndex: 3, title: 'd', score: 74, fitScore: 90 },
  ];
  normalizeCombined(songs);
  const c = combinedById(songs);
  assert.ok(c[0] >= c[1], 'higher fit ranks at least as high (monotonic)');
  assert.ok(c[0] - c[1] <= 6, `8-point fit gap stays dampened, got ${(c[0] - c[1]).toFixed(2)}`);
});

test('normalization: tight music amplifies a 1-point gap more than a wide field', () => {
  // The asymmetric design: music adapts to the round, so the same 1-point music gap
  // is worth more combined points when the field is tightly clustered than when it
  // is widely spread. Fit is held identical so only music moves the blend.
  const tight = [
    { rawOrderIndex: 0, score: 75, fitScore: 80 },
    { rawOrderIndex: 1, score: 74, fitScore: 80 },
    { rawOrderIndex: 2, score: 75, fitScore: 80 },
    { rawOrderIndex: 3, score: 74, fitScore: 80 },
    { rawOrderIndex: 4, score: 75, fitScore: 80 },
    { rawOrderIndex: 5, score: 74, fitScore: 80 },
  ];
  const wide = [
    { rawOrderIndex: 0, score: 75, fitScore: 80 },
    { rawOrderIndex: 1, score: 74, fitScore: 80 },
    { rawOrderIndex: 2, score: 85, fitScore: 80 },
    { rawOrderIndex: 3, score: 64, fitScore: 80 },
    { rawOrderIndex: 4, score: 90, fitScore: 80 },
    { rawOrderIndex: 5, score: 60, fitScore: 80 },
  ];
  normalizeCombined(tight);
  normalizeCombined(wide);
  const gapTight = combinedById(tight)[0] - combinedById(tight)[1];
  const gapWide = combinedById(wide)[0] - combinedById(wide)[1];
  assert.ok(gapTight > gapWide, `tight music amplifies the 1-pt gap (${gapTight.toFixed(2)} > ${gapWide.toFixed(2)})`);
});

test('normalization: +/- folds into music so 74+ outranks a plain 74 (same fit)', () => {
  const songs = [
    { rawOrderIndex: 0, title: 'plus', score: 74, fitScore: 80, plus: true },
    { rawOrderIndex: 1, title: 'plain', score: 74, fitScore: 80 },
    { rawOrderIndex: 2, title: 'minus', score: 74, fitScore: 80, minus: true },
    { rawOrderIndex: 3, title: 'c', score: 76, fitScore: 80 },
    { rawOrderIndex: 4, title: 'd', score: 72, fitScore: 80 },
  ];
  normalizeCombined(songs);
  const c = combinedById(songs);
  assert.ok(c[0] > c[1], '74+ outranks plain 74');
  assert.ok(c[1] > c[2], 'plain 74 outranks 74-');
});

test('normalization: small contender field falls back to fixed refs (stable, finite)', () => {
  const songs = [
    { rawOrderIndex: 0, score: 75, fitScore: 90 },
    { rawOrderIndex: 1, score: 70, fitScore: 60 },
  ];
  normalizeCombined(songs);
  for (const s of songs) {
    assert.ok(Number.isFinite(s.combinedScore), 'combined is finite under the small-n fallback');
  }
  assert.ok(songs[0].combinedScore > songs[1].combinedScore, 'still ranks the stronger song higher');
});

test('normalization: contenders exclude gated-out fit so the std reflects real candidates', () => {
  // A terrible-fit outlier below the cutoff must not widen the fit std (the fit-side
  // analogue of the owner dropping music outliers with `-`). Its presence should not
  // change the combined scores of the contenders.
  const base = () => [
    { rawOrderIndex: 0, score: 75, fitScore: 90 },
    { rawOrderIndex: 1, score: 74, fitScore: 85 },
    { rawOrderIndex: 2, score: 73, fitScore: 80 },
    { rawOrderIndex: 3, score: 72, fitScore: 72 },
    { rawOrderIndex: 4, score: 76, fitScore: 70 },
  ];
  const gate = { type: 'cutoff', axis: 'fit', min: 68 };
  const without = base();
  normalizeCombined(without, undefined, gate);
  const withOutlier = [...base(), { rawOrderIndex: 5, score: 71, fitScore: 15 }];
  normalizeCombined(withOutlier, undefined, gate);
  for (const i of [0, 1, 2, 3, 4]) {
    assert.ok(
      Math.abs(combinedById(without)[i] - combinedById(withOutlier)[i]) < 1e-9,
      `contender ${i} combined is unaffected by the gated-out outlier`
    );
  }
});

test('combined cutoff gates allocation without rescaling the combined scores', () => {
  // Regression: a `combined` cutoff must NOT shrink the normalization contender
  // set (that is circular — combinedScore is what normalization produces — and
  // collapsed the field to a couple songs, blowing the z-scores up). Combined
  // scores must be identical with and without the cutoff.
  const base = () => [
    { rawOrderIndex: 0, score: 76, fitScore: 90 },
    { rawOrderIndex: 1, score: 73, fitScore: 90 },
    { rawOrderIndex: 2, score: 72, fitScore: 75 },
    { rawOrderIndex: 3, score: 71, fitScore: 78 },
    { rawOrderIndex: 4, score: 72, fitScore: 60 },
    { rawOrderIndex: 5, score: 55, fitScore: 40 },
  ];
  const w = { fit: 0.5, music: 0.5 };
  const ungated = base();
  normalizeCombined(ungated, w, null, { fitTrust: 'manual' });
  const gated = base();
  normalizeCombined(gated, w, { type: 'cutoff', axis: 'combined', min: 76 }, { fitTrust: 'manual' });
  for (const i of [0, 1, 2, 3, 4, 5]) {
    assert.ok(
      Math.abs(combinedById(ungated)[i] - combinedById(gated)[i]) < 1e-9,
      `combined cutoff leaves combined score ${i} unchanged`
    );
  }
});

test('combined cutoff zeroes below-line songs and reflows the bank upward', () => {
  const songs = [
    { title: 'a', rawOrderIndex: 0, score: 76, fitScore: 90 },
    { title: 'b', rawOrderIndex: 1, score: 73, fitScore: 90 },
    { title: 'c', rawOrderIndex: 2, score: 72, fitScore: 75 },
    { title: 'd', rawOrderIndex: 3, score: 71, fitScore: 78 },
    { title: 'e', rawOrderIndex: 4, score: 72, fitScore: 60 },
    { title: 'f', rawOrderIndex: 5, score: 55, fitScore: 40 },
  ];
  const w = { fit: 0.5, music: 0.5 };
  const gate = { type: 'cutoff', axis: 'combined', min: 76 };
  normalizeCombined(songs, w, gate, { fitTrust: 'manual' });
  allocate(songs, 10, 5, { rankBy: 'combined', weights: w, gate });
  const below = songs.filter((s) => s.combinedScore < 76);
  const above = songs.filter((s) => s.combinedScore >= 76);
  assert.ok(below.length > 0 && above.length > 0, 'test round splits across the line');
  for (const s of below) {
    assert.equal(s.finalVotes, 0, `${s.title} below the combined line earns nothing`);
  }
  assert.equal(sum(songs), 10, 'the full bank reflows onto songs above the line');
});

test('normalization: average contender sits near 75 and a clear standout reaches the 80 anchor', () => {
  const songs = [
    { rawOrderIndex: 0, score: 80, fitScore: 95 }, // clear standout on both axes
    { rawOrderIndex: 1, score: 74, fitScore: 78 },
    { rawOrderIndex: 2, score: 73, fitScore: 75 },
    { rawOrderIndex: 3, score: 72, fitScore: 72 },
    { rawOrderIndex: 4, score: 75, fitScore: 70 },
  ];
  normalizeCombined(songs);
  const c = combinedById(songs);
  assert.ok(Math.abs(c[2] - 75) < 6, 'a middling contender lands near the 75 anchor');
  assert.ok(c[0] >= 80, 'a both-axes standout reaches the 80 favorite anchor');
});

test('forced spill lands on DQ before budget-mismatch', () => {
  const songs = [
    { title: 'a', rawOrderIndex: 0, score: 78, finalVotes: 0, finalDownvotes: 0 },
    { title: 'b', rawOrderIndex: 1, score: 75, finalVotes: 0, finalDownvotes: 0 },
    {
      title: 'dq',
      rawOrderIndex: 2,
      score: null,
      isDisqualified: true,
      finalVotes: 0,
      finalDownvotes: 0,
    },
  ];
  const { tradeoffs } = allocate(songs, 6, 2, { shape: 'auto' });
  assert.equal(sum(songs), 6);
  assert.equal(songs[2].finalVotes, 2, 'overflow reaches DQ at cap before giving up');
  assert.ok(tradeoffs.some((t) => t.kind === 'forced-spill'));
});

test('forced spill lands on DQ when downvotes enabled', () => {
  const songs = [
    { title: 'a', rawOrderIndex: 0, score: 78, finalVotes: 0, finalDownvotes: 0 },
    { title: 'b', rawOrderIndex: 1, score: 75, finalVotes: 0, finalDownvotes: 0 },
    {
      title: 'dq',
      rawOrderIndex: 2,
      score: null,
      isDisqualified: true,
      finalVotes: 0,
      finalDownvotes: 0,
    },
  ];
  const { tradeoffs } = allocate(songs, 6, 2, {
    shape: 'auto',
    downvotesEnabled: true,
    downvoteBudget: 1,
    downvoteCap: 1,
  });
  assert.equal(sum(songs), 6);
  assert.equal(songs[2].finalVotes, 2);
  assert.ok(tradeoffs.some((t) => t.kind === 'forced-spill'));
});

test('forced spill can land on blank-score songs when the bank overflows', () => {
  const songs = [
    { title: 'a', rawOrderIndex: 0, score: 78, finalVotes: 0, finalDownvotes: 0 },
    { title: 'b', rawOrderIndex: 1, score: 75, finalVotes: 0, finalDownvotes: 0 },
    { title: 'blank', rawOrderIndex: 2, needsUserInput: true, finalVotes: 0, finalDownvotes: 0 },
  ];
  const { tradeoffs } = allocate(songs, 6, 2, { shape: 'auto' });
  assert.equal(sum(songs), 6);
  assert.equal(songs[2].finalVotes, 2);
  assert.ok(tradeoffs.some((t) => t.kind === 'forced-spill'));
});

test('forced spill fills blank-score slots before DQ', () => {
  const songs = [
    { title: 'a', rawOrderIndex: 0, score: 78, finalVotes: 0, finalDownvotes: 0 },
    { title: 'blank', rawOrderIndex: 1, needsUserInput: true, finalVotes: 0, finalDownvotes: 0 },
    {
      title: 'dq',
      rawOrderIndex: 2,
      score: null,
      isDisqualified: true,
      finalVotes: 0,
      finalDownvotes: 0,
    },
  ];
  allocate(songs, 5, 2, { shape: 'auto' });
  assert.equal(songs[0].finalVotes, 2);
  assert.equal(songs[1].finalVotes, 2, 'blank absorbs overflow before DQ');
  assert.equal(songs[2].finalVotes, 1, 'DQ only after blank is capped');
  assert.equal(sum(songs), 5);
});

test('budget is always fully spent, spilling onto invalid as a last resort', () => {
  // Thematic round where only a few songs pass the gate and a low per-song cap
  // forces the leftover onto gated-out songs (you still must cast every vote).
  const songs = [
    { title: 'p1', rawOrderIndex: 0, score: 78, gate: 'pass' },
    { title: 'p2', rawOrderIndex: 1, score: 75, gate: 'pass' },
    { title: 'p3', rawOrderIndex: 2, score: 72, gate: 'pass' },
    { title: 'f1', rawOrderIndex: 3, score: 80, gate: 'fail' },
    { title: 'f2', rawOrderIndex: 4, score: 74, gate: 'fail' },
    { title: 'f3', rawOrderIndex: 5, score: 70, gate: 'fail' },
  ];
  const { tradeoffs } = allocate(songs, 10, 2, { gate: { type: 'passFail' } });
  assert.equal(sum(songs), 10, 'every point is placed even when qualifiers are capped');
  assert.ok(tradeoffs.some((t) => t.kind === 'forced-spill'), 'spill is surfaced');
  assert.ok(
    songs.slice(3).reduce((a, s) => a + s.finalVotes, 0) > 0,
    'overflow lands on the gated-out songs'
  );
});

test('mergeFit: LLM fills fit-silent songs, manual wins, combined is set', () => {
  const songs = [
    // Manually fit-scored: LLM must not override it.
    { rawOrderIndex: 0, title: 'Manual', score: 75, fitScore: 85, fitTier: 'strong', fitSource: 'manual' },
    // Fit-silent: LLM fills it.
    { rawOrderIndex: 1, title: 'Silent', score: 70 },
  ];
  const fitSongs = [
    { rawOrderIndex: 0, title: 'Manual', fitScore: 20, fitTier: 'nope' },
    { rawOrderIndex: 1, title: 'Silent', fitScore: 90, fitTier: 'excellent', rationale: 'on theme' },
  ];
  mergeFit(songs, fitSongs);
  assert.equal(songs[0].fitScore, 85, 'manual fit survives the LLM file');
  assert.equal(songs[0].fitSource, 'manual');
  assert.equal(songs[1].fitScore, 90, 'LLM fills the fit-silent song');
  assert.equal(songs[1].fitSource, 'llm');
  assert.equal(songs[1].rationale, 'on theme', 'context fields carried for rendering');
  assert.ok(songs[0].combinedScore != null && songs[1].combinedScore != null, 'combined scores set');
  // Manual fit on the field → adaptive fit floor (not LLM dampening).
  assert.ok(songs[0].fitNorm != null);
});

test('mergeFitJson: gate words in fitTier drive a passFail allocation + writeback', () => {
  const parsed = {
    budget: { upvoteBankSize: 10, maxUpvotesPerSong: 5 },
    songs: [
      { rawOrderIndex: 0, title: 'P1', score: 78 },
      { rawOrderIndex: 1, title: 'P2', score: 74 },
      { rawOrderIndex: 2, title: 'F1', score: 90 },
    ],
  };
  const fitData = {
    songs: [
      { rawOrderIndex: 0, title: 'P1', fitTier: 'pass' },
      { rawOrderIndex: 1, title: 'P2', fitTier: 'pass' },
      { rawOrderIndex: 2, title: 'F1', fitTier: 'fail' },
    ],
  };
  const { tradeoffs } = mergeFitJson(parsed, fitData, { rankBy: 'music', gate: { type: 'passFail' } });
  assert.equal(parsed.songs[2].finalVotes, 0, 'failed song earns nothing despite top music');
  assert.equal(parsed.songs[0].finalVotes + parsed.songs[1].finalVotes, 10, 'budget spent on passes');
  // Writeback into the fit JSON for render-fit-html.
  assert.equal(fitData.songs[0].draftVotes, parsed.songs[0].finalVotes);
  assert.equal(fitData.songs[0].musicScore, 78);
  assert.ok(fitData.combineWeights, 'combine weights recorded');
  assert.ok(Array.isArray(tradeoffs));
});

test('manual overrides pin votes and rebalance the rest', () => {
  const songs = mk([70, 71, 72, 73, 74, 76, 78]);
  allocate(songs, 10, 5, { shape: 'auto', overrides: { 0: 3 } });
  assert.equal(songs[0].finalVotes, 3, 'pinned song keeps its override');
  assert.equal(sum(songs), 10, 'remaining budget is distributed around the pin');
});

// ---------------------------------------------------------------------------
// Downvotes: continuous tier tail below zero
// ---------------------------------------------------------------------------
function sumDown(songs) {
  return songs.reduce((a, s) => a + (s.finalDownvotes || 0), 0);
}

function downProfile(extra = {}) {
  return {
    shape: 'auto',
    downvotesEnabled: true,
    downvoteBudget: 5,
    downvoteCap: 2,
    ...extra,
  };
}

test('downvotes spend the full downvote bank and respect per-song cap', () => {
  const songs = mk([70, 72, 73, 74, 76, 78, 80, 82]);
  allocate(songs, 10, 3, downProfile({ downvoteBudget: 5, downvoteCap: 2 }));
  assert.equal(sum(songs), 10);
  assert.equal(sumDown(songs), 5);
  assert.ok(songs.every((s) => (s.finalDownvotes || 0) <= 2));
});

test('downvotes never mix with upvotes on the same song', () => {
  const songs = mk([70, 72, 73, 74, 76, 78, 80, 82]);
  allocate(songs, 10, 3, downProfile());
  for (const s of songs) {
    assert.ok(!(s.finalVotes && s.finalDownvotes), `${s.title} has both up and down`);
  }
});

test('downvotes target the lowest-ranked eligible songs without upvotes', () => {
  const songs = mk([90, 85, 80, 75, 70, 65, 60, 55]);
  allocate(songs, 8, 4, downProfile({ downvoteBudget: 4, downvoteCap: 2 }));
  const worst = songs.find((s) => s.score === 55);
  const best = songs.find((s) => s.score === 90);
  assert.ok((worst.finalDownvotes || 0) > 0, 'worst song receives downvotes');
  assert.equal(best.finalDownvotes || 0, 0, 'top song is not downvoted');
});

test('caps are hard: budget-mismatch when cap × slots cannot hold the bank', () => {
  const songs = mk([78, 76, 74, 72, 70, 68]);
  const { tradeoffs } = allocate(
    songs,
    6,
    3,
    downProfile({ downvoteBudget: 8, downvoteCap: 1 })
  );
  assert.ok(songs.every((s) => s.finalVotes <= 3));
  assert.ok(songs.every((s) => (s.finalDownvotes || 0) <= 1));
  assert.equal(sum(songs), 3);
  assert.equal(sumDown(songs), 5);
  const bm = tradeoffs.find((t) => t.kind === 'budget-mismatch');
  assert.ok(bm && !bm.over, 'under-spent banks are flagged, never cap-busted');
  assert.match(bm.question, /upvotes 3\/6/);
  assert.match(bm.question, /downvotes 5\/8/);
});

test('downvotes disabled leaves behavior unchanged', () => {
  const songs = mk([70, 72, 73, 74, 76, 78]);
  allocate(songs, 10, 3, { shape: 'auto', downvotesEnabled: false, downvoteBudget: 5 });
  assert.equal(sum(songs), 10);
  assert.equal(sumDown(songs), 0);
  assert.ok(songs.every((s) => s.finalDownvotes === 0));
});

// --- Downvote curve shapes (concentrated / flat / curved) ---

test('downShape concentrated piles the whole bank on the single worst song (uncapped)', () => {
  const songs = mk([90, 85, 80, 75, 70, 65, 60, 55]);
  allocate(songs, 3, 3, downProfile({ downvoteBudget: 5, downvoteCap: Infinity, downShape: 'concentrated' }));
  assert.equal(sumDown(songs), 5);
  const worst = songs.find((s) => s.score === 55);
  assert.equal(worst.finalDownvotes, 5, 'all downvotes land on the worst song');
  assert.equal(songs.filter((s) => (s.finalDownvotes || 0) > 0).length, 1, 'only one song downvoted');
});

test('downShape flat spreads one downvote each across the worst songs (uncapped)', () => {
  const songs = mk([90, 85, 80, 75, 70, 65, 60, 55]);
  allocate(songs, 3, 3, downProfile({ downvoteBudget: 5, downvoteCap: Infinity, downShape: 'flat' }));
  assert.equal(sumDown(songs), 5);
  const downed = songs.filter((s) => (s.finalDownvotes || 0) > 0);
  assert.equal(downed.length, 5, 'five songs share the bank');
  assert.ok(downed.every((s) => s.finalDownvotes === 1), 'flat = one each');
});

test('downShape curved graduates downvotes toward the worst (uncapped, wide spread)', () => {
  const songs = mk([90, 85, 80, 75, 70, 65, 60, 55]);
  allocate(songs, 3, 3, downProfile({ downvoteBudget: 6, downvoteCap: Infinity, downShape: 'curved' }));
  assert.equal(sumDown(songs), 6);
  const worst = songs.find((s) => s.score === 55);
  const otherDowned = songs.filter((s) => (s.finalDownvotes || 0) > 0 && s !== worst);
  assert.ok(
    otherDowned.every((s) => worst.finalDownvotes >= s.finalDownvotes),
    'worst song gets at least as many downvotes as any other'
  );
});

test('a disqualified (unscored) song is the strongest downvote target, no NaN overspend', () => {
  const songs = mk([85, 80, 75, 70, 65]);
  songs.push({ title: 'DQ', rawOrderIndex: 5, score: null, isDisqualified: true });
  allocate(songs, 3, 3, downProfile({ downvoteBudget: 5, downvoteCap: Infinity, downShape: 'concentrated' }));
  const dq = songs.find((s) => s.title === 'DQ');
  assert.equal(sumDown(songs), 5, 'bank spent exactly (regression: -Infinity → NaN overspend)');
  assert.equal(dq.finalDownvotes, 5, 'all downvotes land on the disqualified song');
  assert.ok(songs.every((s) => Number.isFinite(s.finalDownvotes || 0)), 'no NaN counts');
});

test('default (auto) downvotes never overspend the bank with a disqualified song', () => {
  const songs = mk([85, 80, 75, 70, 65]);
  songs.push({ title: 'DQ', rawOrderIndex: 5, score: null, isDisqualified: true });
  allocate(songs, 3, 3, downProfile({ downvoteBudget: 5, downvoteCap: Infinity }));
  assert.equal(sumDown(songs), 5);
});

test('down-structure tradeoff is surfaced (auto) and suppressed when --down-shape is pinned', () => {
  const songs = mk([90, 85, 80, 75, 70, 65, 60, 55]);
  const { tradeoffs } = allocate(songs, 3, 3, downProfile({ downvoteBudget: 5, downvoteCap: Infinity }));
  const ds = tradeoffs.find((t) => t.kind === 'down-structure');
  assert.ok(ds, 'auto surfaces the downvote-shape choice');
  assert.ok(ds.options.length >= 2, 'at least two distinct shapes offered');
  assert.equal(ds.options[0].downShape, 'curved', 'curved is the default (first) option');
  assert.ok(
    ds.options.every((o) => o.perSong.reduce((a, p) => a + (p.votes || 0), 0) === 5),
    'every proposed shape spends the full down bank'
  );

  const songs2 = mk([90, 85, 80, 75, 70, 65, 60, 55]);
  const { tradeoffs: t2 } = allocate(
    songs2,
    3,
    3,
    downProfile({ downvoteBudget: 5, downvoteCap: Infinity, downShape: 'concentrated' })
  );
  assert.ok(!t2.find((t) => t.kind === 'down-structure'), 'a pinned shape suppresses the proposal');
});

test('downvote pin fixes a song\'s downvotes and forces it off the upvote axis', () => {
  const songs = mk([90, 85, 80, 75, 70, 65, 60, 55]);
  // Pin the top song (index 0) to 2 downvotes — normally it would be top-upvoted.
  allocate(
    songs,
    10,
    3,
    downProfile({ downvoteBudget: 5, downvoteCap: 2, downShape: 'concentrated', downOverrides: { 0: 2 } })
  );
  const pinned = songs.find((s) => s.rawOrderIndex === 0);
  assert.equal(pinned.finalDownvotes, 2, 'pinned downvotes honored exactly');
  assert.equal(pinned.finalVotes || 0, 0, 'pinned-down song earns zero upvotes');
  assert.equal(sum(songs), 10, 'upvote bank still fully spent over the rest');
  assert.equal(sumDown(songs), 5, 'down bank still fully spent');
  for (const s of songs) assert.ok(!(s.finalVotes && s.finalDownvotes), `${s.title} not both up and down`);
});

test('a :0 pin removes a song from the down pool so the bank flows to the tie partner', () => {
  // Bottom two tied at 60 (idx 6, 7) sit firmly in the downvote zone (small up bank).
  // A flat down bank would land a downvote on both; pinning idx 7 to 0 forces it out
  // of the down pool, so its downvote shifts to the tie partner (idx 6).
  const songs = mk([90, 85, 80, 75, 70, 65, 60, 60]);
  allocate(
    songs,
    3,
    3,
    downProfile({ downvoteBudget: 3, downvoteCap: 2, downShape: 'flat', downOverrides: { 7: 0 }, overrides: { 7: 0 } })
  );
  const pinned = songs.find((s) => s.rawOrderIndex === 7);
  const partner = songs.find((s) => s.rawOrderIndex === 6);
  assert.equal(pinned.finalDownvotes || 0, 0, ':0 song gets no downvote');
  assert.equal(pinned.finalVotes || 0, 0, ':0 song gets no upvote');
  assert.ok((partner.finalDownvotes || 0) > 0, 'tie partner absorbs the freed downvote');
  assert.equal(sumDown(songs), 3, 'down bank still fully spent on the rest');
  assert.equal(sum(songs), 3, 'up bank still fully spent');
});

test('downvote pin is never topped up past its magnitude by spill', () => {
  const songs = mk([90, 85, 80, 75, 70, 65, 60, 55]);
  allocate(
    songs,
    2,
    3,
    downProfile({ downvoteBudget: 8, downvoteCap: 2, downShape: 'concentrated', downOverrides: { 7: 1 } })
  );
  const pinned = songs.find((s) => s.rawOrderIndex === 7);
  assert.equal(pinned.finalDownvotes, 1, 'spill respects the pin instead of topping it up');
  assert.ok(songs.every((s) => (s.finalDownvotes || 0) <= 2), 'down cap is never exceeded');
  assert.equal(sumDown(songs), 8, 'remaining bank shaped/spilled onto other zero-up songs');
});

test('downvote pin appears in every surfaced down-structure option', () => {
  const songs = mk([90, 85, 80, 75, 70, 65, 60, 55]);
  const { tradeoffs } = allocate(
    songs,
    10,
    3,
    downProfile({ downvoteBudget: 5, downvoteCap: 2, downOverrides: { 0: 2 } })
  );
  const ds = tradeoffs.find((t) => t.kind === 'down-structure');
  assert.ok(ds, 'down-structure still surfaced alongside a pin');
  for (const opt of ds.options) {
    const row = opt.perSong.find((p) => p.rawOrderIndex === 0);
    assert.ok(row && row.votes === 2, 'pinned song shows its fixed downvotes in every option');
  }
});

// ---------------------------------------------------------------------------
// parseWeights: CLI --weights <fit>:<music>, normalized to sum 1
// ---------------------------------------------------------------------------
test('parseWeights normalizes a fit:music blend to sum 1', () => {
  const w = parseWeights('0.6:0.4');
  assert.equal(w.fit, 0.6);
  assert.equal(w.music, 0.4);
});

test('parseWeights normalizes non-unit ratios (e.g. 3:2 -> 0.6/0.4)', () => {
  const w = parseWeights('3:2');
  assert.ok(Math.abs(w.fit - 0.6) < 1e-9);
  assert.ok(Math.abs(w.music - 0.4) < 1e-9);
});

test('parseWeights returns undefined for empty input (use default blend)', () => {
  assert.equal(parseWeights(null), undefined);
  assert.equal(parseWeights(''), undefined);
});

test('parseWeights rejects malformed or degenerate input', () => {
  assert.throws(() => parseWeights('0.6'));
  assert.throws(() => parseWeights('0.6:0.2:0.2'));
  assert.throws(() => parseWeights('a:b'));
  assert.throws(() => parseWeights('0:0'));
  assert.throws(() => parseWeights('-1:2'));
});

// ---------------------------------------------------------------------------
// parsePins: CLI --pin <rawOrderIndex>:<votes> -> overrides map
// ---------------------------------------------------------------------------
test('parsePins parses comma-separated and repeated specs', () => {
  assert.deepEqual(parsePins('2:2,8:2'), { overrides: { 2: 2, 8: 2 }, downOverrides: undefined });
  assert.deepEqual(parsePins(['2:2', '8:1']), { overrides: { 2: 2, 8: 1 }, downOverrides: undefined });
});

test('parsePins splits negative values into downvote pins', () => {
  assert.deepEqual(parsePins('1:2,6:-2,8:-1'), {
    overrides: { 1: 2 },
    downOverrides: { 6: 2, 8: 1 },
  });
  // Down-only pins leave overrides undefined.
  assert.deepEqual(parsePins('6:-2'), { overrides: undefined, downOverrides: { 6: 2 } });
});

test('parsePins routes a :0 pin to zero on both axes', () => {
  // 0 means "no vote of any kind" — pinned to 0 up AND 0 down (out of both pools).
  assert.deepEqual(parsePins('6:0'), { overrides: { 6: 0 }, downOverrides: { 6: 0 } });
  assert.deepEqual(parsePins('0:-1,6:0'), {
    overrides: { 6: 0 },
    downOverrides: { 0: 1, 6: 0 },
  });
});

test('parsePins returns undefined when nothing is pinned', () => {
  assert.equal(parsePins([]), undefined);
  assert.equal(parsePins(null), undefined);
});

test('parsePins feeds allocate overrides to flatten a tied top', () => {
  // Two tied leaders would otherwise concentrate; pinning the top four to 2 each
  // yields a flat 2/2/2/2 with the rest spread.
  const songs = mk([93, 93, 92, 85, 76, 74, 73, 72]);
  const { overrides } = parsePins('0:2,1:2,2:2,3:2');
  allocate(songs, 15, 4, { shape: 'auto', overrides });
  assert.equal(sum(songs), 15);
  for (const i of [0, 1, 2, 3]) assert.equal(songs[i].finalVotes, 2);
});

test('parsePins rejects malformed specs', () => {
  assert.throws(() => parsePins('2'));
  assert.throws(() => parsePins('2:1.5'));
  assert.throws(() => parsePins('x:2'));
});

test('parseTierCount parses a positive integer and ignores empty input', () => {
  assert.equal(parseTierCount('3'), 3);
  assert.equal(parseTierCount(2), 2);
  assert.equal(parseTierCount(''), undefined);
  assert.equal(parseTierCount(null), undefined);
});

test('parseTierCount rejects non-positive or non-integer specs', () => {
  assert.throws(() => parseTierCount('0'));
  assert.throws(() => parseTierCount('-1'));
  assert.throws(() => parseTierCount('2.5'));
  assert.throws(() => parseTierCount('x'));
});

test('parseDownShape canonicalizes shape names and rejects unknown specs', () => {
  assert.equal(parseDownShape('concentrated'), 'concentrated');
  assert.equal(parseDownShape('worst'), 'concentrated');
  assert.equal(parseDownShape('FLAT'), 'flat');
  assert.equal(parseDownShape('even'), 'flat');
  assert.equal(parseDownShape('bell'), 'curved');
  assert.equal(parseDownShape(''), undefined);
  assert.equal(parseDownShape(null), undefined);
  assert.throws(() => parseDownShape('sideways'));
});

test('parseBucketCount parses a positive integer and rejects bad specs', () => {
  assert.equal(parseBucketCount('4'), 4);
  assert.equal(parseBucketCount(''), undefined);
  assert.equal(parseBucketCount(null), undefined);
  assert.throws(() => parseBucketCount('0'));
  assert.throws(() => parseBucketCount('2.5'));
  assert.throws(() => parseBucketCount('x'));
});

const PICK_OPTIONS = [
  {
    tierCount: 2,
    bucketCount: 2,
    shape: '1×4 / 0×3',
    perSong: [
      { rawOrderIndex: 3, title: 'Alpha', score: 88, votes: 4 },
      { rawOrderIndex: 1, title: 'Bravo', score: 80, votes: 0 },
    ],
  },
  {
    tierCount: 3,
    bucketCount: 3,
    shape: '2×4 / 1×2 / 0×5',
    perSong: [
      { rawOrderIndex: 3, title: 'Alpha', score: 88, votes: 4 },
      { rawOrderIndex: 1, title: 'Bravo', score: 80, votes: 2 },
    ],
  },
];

test('buildPickRecord captures chosen option letter, shape, reason, and all options', () => {
  const songs = [
    { rawOrderIndex: 3, finalVotes: 4 },
    { rawOrderIndex: 1, finalVotes: 2 },
  ];
  const pick = buildPickRecord({ options: PICK_OPTIONS, chosenIndex: 1, songs, reason: 'tight round' });
  assert.equal(pick.chosen, 'B');
  assert.equal(pick.chosenIndex, 1);
  assert.equal(pick.tierCount, 3);
  assert.equal(pick.shape, '2×4 / 1×2 / 0×5');
  assert.equal(pick.reason, 'tight round');
  assert.equal(pick.options.length, 2);
  assert.equal(pick.options[0].letter, 'A');
  assert.equal(pick.options[1].letter, 'B');
  assert.equal(pick.options[1].isChosen, true);
  assert.equal(pick.options[0].isChosen, false);
  assert.deepEqual(pick.options[1].perSong[1], { rawOrderIndex: 1, title: 'Bravo', score: 80, votes: 2 });
});

test('buildPickRecord records manual tweaks where final votes deviate from the chosen option', () => {
  const songs = [
    { rawOrderIndex: 3, finalVotes: 4 },
    { rawOrderIndex: 1, finalVotes: 3 },
  ];
  const pick = buildPickRecord({ options: PICK_OPTIONS, chosenIndex: 1, songs });
  assert.equal(pick.reason, null);
  assert.deepEqual(pick.tweaks, [{ rawOrderIndex: 1, title: 'Bravo', from: 2, to: 3 }]);
});

test('buildPickRecord reports no tweaks when final matches the chosen distribution', () => {
  const songs = [
    { rawOrderIndex: 3, finalVotes: 4 },
    { rawOrderIndex: 1, finalVotes: 2 },
  ];
  const pick = buildPickRecord({ options: PICK_OPTIONS, chosenIndex: 1, songs });
  assert.deepEqual(pick.tweaks, []);
});

test('buildPickRecord returns null for an out-of-range chosenIndex', () => {
  assert.equal(buildPickRecord({ options: PICK_OPTIONS, chosenIndex: 5, songs: [] }), null);
});

// ---------------------------------------------------------------------------
// buildComboBallot: one column per up-option × down-shape combo
// ---------------------------------------------------------------------------
const BALLOT_TRADEOFFS = [
  {
    kind: 'tier-structure',
    options: [
      // Option A: upvote song 1 (+2) and song 4 (+1); songs 2,3 left at zero.
      {
        tierCount: 2,
        perSong: [
          { rawOrderIndex: 1, title: 'Alpha', score: 90, votes: 2 },
          { rawOrderIndex: 4, title: 'Delta', score: 80, votes: 1 },
          { rawOrderIndex: 2, title: 'Bravo', score: 70, votes: 0 },
          { rawOrderIndex: 3, title: 'Charlie', score: 60, votes: 0 },
        ],
      },
      // Option B: also upvote song 2 (+1) — which the down shapes target → conflict.
      {
        tierCount: 3,
        perSong: [
          { rawOrderIndex: 1, title: 'Alpha', score: 90, votes: 2 },
          { rawOrderIndex: 4, title: 'Delta', score: 80, votes: 1 },
          { rawOrderIndex: 2, title: 'Bravo', score: 70, votes: 1 },
          { rawOrderIndex: 3, title: 'Charlie', score: 60, votes: 0 },
        ],
      },
    ],
  },
  {
    kind: 'down-structure',
    options: [
      // curved: -1 on songs 2 and 3.
      {
        downShape: 'curved',
        shape: 'Curved (bell)',
        perSong: [
          { rawOrderIndex: 2, title: 'Bravo', score: 70, votes: 1 },
          { rawOrderIndex: 3, title: 'Charlie', score: 60, votes: 1 },
        ],
      },
      // concentrated: -2 on song 3 only.
      {
        downShape: 'concentrated',
        shape: 'Concentrated',
        perSong: [
          { rawOrderIndex: 3, title: 'Charlie', score: 60, votes: 2 },
        ],
      },
    ],
  },
];

const BALLOT_SONGS = [
  { rawOrderIndex: 1, title: 'Alpha', artist: 'a' },
  { rawOrderIndex: 2, title: 'Bravo', artist: 'b' },
  { rawOrderIndex: 3, title: 'Charlie', artist: 'c' },
  { rawOrderIndex: 4, title: 'Delta', artist: 'd' },
];
const BALLOT_OWN = [{ rawOrderIndex: 0, title: 'Mine', artist: 'me' }];

test('buildComboBallot enumerates up×down combos and signs cells', () => {
  const { combos, rows } = buildComboBallot(BALLOT_TRADEOFFS, BALLOT_SONGS, BALLOT_OWN);
  // 2 up × 2 down = 4 distinct combos (none collapse here).
  assert.equal(combos.length, 4);
  assert.deepEqual(
    combos.map((c) => c.members[0].code),
    ['A·cv', 'A·cc', 'B·cv', 'B·cc']
  );
  // Own song interleaved at its raw index, marked own.
  assert.deepEqual(
    rows.map((r) => r.rawOrderIndex),
    [0, 1, 2, 3, 4]
  );
  const aCv = combos[0];
  assert.equal(aCv.perIndex.get(0), 'own');
  assert.equal(aCv.perIndex.get(1), 2); // +2 upvote
  assert.equal(aCv.perIndex.get(2), -1); // downvoted (curved)
  assert.equal(aCv.perIndex.get(3), -1);
  assert.equal(aCv.perIndex.get(4), 1);
  assert.deepEqual(aCv.totals, { up: 3, down: 2, conflicts: 0 });
});

test('buildComboBallot flags a cell where the up option and down shape disagree', () => {
  const { combos } = buildComboBallot(BALLOT_TRADEOFFS, BALLOT_SONGS, BALLOT_OWN);
  // B·cv: option B upvotes song 2 (+1) while curved downvotes it → conflict.
  const bCv = combos.find((c) => c.members[0].code === 'B·cv');
  assert.equal(bCv.perIndex.get(2), 'conflict');
  assert.equal(bCv.totals.conflicts, 1);
  // The intended budgets are still reported (no silent shrink): up counts song 2's
  // +1, down counts its -1.
  assert.equal(bCv.totals.up, 4);
  assert.equal(bCv.totals.down, 2);
  // B·cc: concentrated targets only song 3, so option B has no conflict.
  const bCc = combos.find((c) => c.members[0].code === 'B·cc');
  assert.equal(bCc.totals.conflicts, 0);
  assert.equal(bCc.perIndex.get(2), 1);
  assert.equal(bCc.perIndex.get(3), -2);
});

test('buildComboBallot dedups identical full-ballot columns and merges selectors', () => {
  // Single up option + two down shapes that produce the SAME ballot → one column
  // listing both selectors.
  const tradeoffs = [
    {
      kind: 'down-structure',
      options: [
        { downShape: 'curved', perSong: [{ rawOrderIndex: 2, votes: 1 }] },
        { downShape: 'flat', perSong: [{ rawOrderIndex: 2, votes: 1 }] },
      ],
    },
  ];
  const songs = [
    { rawOrderIndex: 1, title: 'Alpha', artist: 'a', draftVotes: 3 },
    { rawOrderIndex: 2, title: 'Bravo', artist: 'b', draftVotes: 0 },
  ];
  const { combos } = buildComboBallot(tradeoffs, songs, []);
  assert.equal(combos.length, 1);
  assert.equal(combos[0].members.length, 2);
  assert.deepEqual(
    combos[0].members.map((m) => m.selector),
    ['--down-shape curved', '--down-shape flat']
  );
  // Up comes from the live draftVotes fallback (no tier-structure tradeoff).
  assert.equal(combos[0].perIndex.get(1), 3);
  assert.equal(combos[0].perIndex.get(2), -1);
});

test('buildComboBallot falls back to a single live-allocation column with no tradeoffs', () => {
  const songs = [
    { rawOrderIndex: 1, title: 'Alpha', artist: 'a', finalVotes: 2, finalDownvotes: 0 },
    { rawOrderIndex: 2, title: 'Bravo', artist: 'b', finalVotes: 0, finalDownvotes: 1 },
  ];
  const { combos } = buildComboBallot([], songs, []);
  assert.equal(combos.length, 1);
  assert.equal(combos[0].perIndex.get(1), 2);
  assert.equal(combos[0].perIndex.get(2), -1);
  assert.deepEqual(combos[0].totals, { up: 2, down: 1, conflicts: 0 });
});
