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
  ckmeans1dWeighted,
  buildJsonPayload,
} from '../scripts/score-core.mjs';
import { parseWeights, parsePins, parseTierCount, parseBucketCount } from '../scripts/parse-round.mjs';

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
  // Explicit fit number alongside a music score (digit-scaled like music).
  const both = scoreComment('78 music, fit 8', 'subjective');
  assert.equal(both.score, 78, 'music score preserved');
  assert.equal(both.fitScore, 80, 'fit 8 -> 80');
  assert.equal(both.fitSource, 'manual');

  // "fit 8" alone is a fit note, not a music score.
  const fitOnly = scoreComment('fit 8', 'subjective');
  assert.equal(fitOnly.score, null, 'no music score leaks from the fit token');
  assert.equal(fitOnly.fitScore, 80);

  // Tier word, but only when armed with the word "fit".
  assert.equal(scoreComment('strong fit', 'subjective').fitTier, 'strong');
  assert.equal(scoreComment('solid track', 'subjective').fitTier, null, 'prose is not a fit grade');

  // Gate flags map straight through.
  assert.equal(scoreComment('pass', 'objective').gate, 'pass');
  assert.equal(scoreComment('borderline, maybe', 'subjective').gate, 'maybe');
  assert.equal(scoreComment('off-theme', 'subjective').gate, 'fail');
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

test('tier-structure surfaces distinct point distributions; each reproduces via --bucket-count', () => {
  const scores = [78, 77, 76, 75, 74, 73, 72, 71, 70, 69];
  const g = mk(scores);
  const { tradeoffs } = allocate(g, 14, 5, { shape: 'auto' });
  const ts = tradeoffs.find((t) => t.kind === 'tier-structure');
  assert.ok(ts, 'an ambiguous field offers a tier-structure choice');
  assert.ok(ts.options.length >= 2, 'at least two options');
  // Each option value is a bucket count (K) — the unambiguous reproduction key,
  // since two different bucket counts can land on the same tier count but a
  // different distribution (a real tradeoff). Values are distinct.
  const ks = ts.options.map((o) => o.value);
  assert.ok(ks.every((n) => Number.isInteger(n) && n >= 1), 'option values are bucket counts');
  assert.equal(new Set(ks).size, ks.length, 'each option is a distinct bucket count');

  // Forcing --bucket-count reproduces that exact (distinct) curve; the surfaced
  // distributions differ from one another.
  const dists = ks.map((k) => {
    const f = mk(scores);
    allocate(f, 14, 5, { shape: 'auto', bucketCount: k });
    assert.equal(sum(f), 14);
    const by = [...f].sort((a, b) => b.score - a.score);
    for (let i = 1; i < by.length; i++) {
      assert.ok(by[i].finalVotes <= by[i - 1].finalVotes, 'monotonic');
    }
    return by.map((s) => s.finalVotes).join(',');
  });
  assert.equal(new Set(dists).size, dists.length, 'each surfaced option is a different distribution');
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
  allocate(songs, 8, 5, { rankBy: 'combined', shape: 'bell' });
  assert.equal(sum(songs), 8);
  assert.ok(
    Math.abs(songs[0].finalVotes - songs[1].finalVotes) <= 1,
    'near-equal fit does not separate equal-music songs'
  );
  assert.ok(songs[0].finalVotes >= songs[2].finalVotes, 'higher fit band ranks at least as high');
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

test('downvote spill spends the bank when caps bind', () => {
  const songs = mk([78, 76, 74, 72, 70, 68]);
  allocate(
    songs,
    6,
    3,
    downProfile({ downvoteBudget: 8, downvoteCap: 1 })
  );
  assert.equal(sum(songs), 6);
  assert.equal(sumDown(songs), 8);
  assert.ok(
    songs.some((s) => (s.finalDownvotes || 0) > 1),
    'per-song cap is relaxed when the downvote bank exceeds slice capacity'
  );
});

test('downvotes disabled leaves behavior unchanged', () => {
  const songs = mk([70, 72, 73, 74, 76, 78]);
  allocate(songs, 10, 3, { shape: 'auto', downvotesEnabled: false, downvoteBudget: 5 });
  assert.equal(sum(songs), 10);
  assert.equal(sumDown(songs), 0);
  assert.ok(songs.every((s) => s.finalDownvotes === 0));
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
  assert.deepEqual(parsePins('2:2,8:2'), { 2: 2, 8: 2 });
  assert.deepEqual(parsePins(['2:2', '8:1']), { 2: 2, 8: 1 });
});

test('parsePins returns undefined when nothing is pinned', () => {
  assert.equal(parsePins([]), undefined);
  assert.equal(parsePins(null), undefined);
});

test('parsePins feeds allocate overrides to flatten a tied top', () => {
  // Two tied leaders would otherwise concentrate; pinning the top four to 2 each
  // yields a flat 2/2/2/2 with the rest spread.
  const songs = mk([93, 93, 92, 85, 76, 74, 73, 72]);
  const overrides = parsePins('0:2,1:2,2:2,3:2');
  allocate(songs, 15, 4, { shape: 'auto', overrides });
  assert.equal(sum(songs), 15);
  for (const i of [0, 1, 2, 3]) assert.equal(songs[i].finalVotes, 2);
});

test('parsePins rejects malformed specs', () => {
  assert.throws(() => parsePins('2'));
  assert.throws(() => parsePins('2:-1'));
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

test('parseBucketCount parses a positive integer and rejects bad specs', () => {
  assert.equal(parseBucketCount('4'), 4);
  assert.equal(parseBucketCount(''), undefined);
  assert.equal(parseBucketCount(null), undefined);
  assert.throws(() => parseBucketCount('0'));
  assert.throws(() => parseBucketCount('2.5'));
  assert.throws(() => parseBucketCount('x'));
});
