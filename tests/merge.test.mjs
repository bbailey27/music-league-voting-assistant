// Fit merge + mergeFitJson writeback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeFit, mergeFitJson, allocate } from '../scripts/score-core.mjs';
import { mk, sum } from './score-helpers.mjs';

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
