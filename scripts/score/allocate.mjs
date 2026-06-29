// Allocation profile + ranking helpers and vote distribution.

import { cell, formatScore } from './format.mjs';
import { tiebreakRank, formatMusicModifierFlags } from './comment.mjs';
import {
  FIT_TIER_SCORES,
  DEFAULT_COMBINED_WEIGHTS,
  fitTierForScore,
} from './fit-signal.mjs';
import { combinedScore, effectiveMusic } from './merge.mjs';

// The single number a song is ranked + tiered by, per the profile's rankBy.
// music (default): the music score; fit: the fit score; combined: the blend.
export function rankValue(s, profile = {}) {
  const music = s.score;
  const fit = s.fitScore;
  switch (profile.rankBy) {
    case 'fit':
      return fit ?? music ?? null;
    case 'combined': {
      // Prefer the per-round normalized blend mergeFit stores on `combinedScore`
      // (each axis z-scored over the contenders, then remapped onto a 75-centered,
      // music-anchored scale so the staircase's gap / 75-80 anchor / favorite-band
      // machinery still applies). Fall back to the raw weighted blend for direct
      // allocate() calls that skip the merge/normalization pass.
      if (s.combinedScore != null) return s.combinedScore;
      return combinedScore(s, profile.weights || DEFAULT_COMBINED_WEIGHTS);
    }
    default:
      return music ?? fit ?? null;
  }
}

// Approximate center of a score distribution: the mode of the rounded values
// (a bell's peak), falling back to the median when nothing repeats. We anchor
// on the center — not the lowest number — because genuinely-bad songs are
// written as '-'/words, so the lowest *number* present is really mid-ish.
export function estimateCenter(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const counts = new Map();
  for (const v of values) {
    const k = Math.round(v);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const maxCount = Math.max(...counts.values());
  if (maxCount >= 2) {
    const modes = [...counts.entries()]
      .filter(([, c]) => c === maxCount)
      .map(([k]) => k)
      .sort((a, b) => a - b);
    return modes[Math.floor((modes.length - 1) / 2)]; // median of the modal values
  }
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Bell shape parameters: width = overall spread, skew = upward bias (>0).
const SHAPE_PRESETS = {
  bell: { width: 1, skew: 0 },
  compressed: { width: 0.6, skew: 0 },
  'top-heavy': { width: 1.15, skew: 0.4 },
};
SHAPE_PRESETS.balanced = SHAPE_PRESETS.bell; // CLI alias (--shape balanced)

// Resolve bell params for a shape, auto-picking from the round's own numbers.
function shapeParams(shape, { ratio, spread }) {
  if (SHAPE_PRESETS[shape]) return SHAPE_PRESETS[shape];
  // auto shapes the bell that allocateBell then samples into a graduated, monotonic
  // curve (see point-allocation.md). The goal is the CURVE, not any one tier: at
  // typical (low) ratios that naturally leaves zeros, and the point is to avoid
  // flattening into all-1s — promote a couple of 2s and leave some 0s instead.
  // Width GROWS with the points-to-songs ratio so more points build taller tiers;
  // a small downward skew near/below ~1:1 keeps the top flat and carves zeros when
  // points are tight, tapering off as the ratio opens up. How many tiers actually
  // appear is then gated by the score spread inside allocateBell (a tight, all-meh
  // field collapses to a couple of levels; a wide spread earns more).
  const width = Math.max(
    0.9,
    Math.min(1.8, 1 + 0.35 * Math.max(0, ratio - 1) + 0.2 * Math.max(0, 1 - ratio) + (spread > 8 ? 0.1 : 0))
  );
  const skew = -Math.min(0.25, 0.71 * Math.max(0, 1.5 - ratio));
  return { width, skew };
}

// Center-anchored two-sided weights: a song at the center weighs 1 (≈ the
// average points/song once normalized), better songs weigh more, worse weigh
// less toward 0. Because most scores cluster near the center, most songs land
// on the average tier — "mostly 1s, a few 2s and 0s" at a 1:1 ratio.
function bellWeights(values, center, { width, skew }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const up = Math.max(max - center, 1e-9);
  const down = Math.max(center - min, 1e-9);
  return values.map((v) => {
    const t =
      v >= center
        ? 1 + ((v - center) / up) * (1 + skew) * width
        : 1 - ((center - v) / down) * (1 - skew) * width;
    return Math.max(t, 0);
  });
}

// Classify a song against the profile's gate/cutoff: 'pass' | 'maybe' | 'fail'.
// A song's gate flag, from the explicit gate field or a gate word that arrived
// in fitTier (LLM gate rounds often label the tier itself pass/maybe/fail).
function songGate(s) {
  if (s.gate) return s.gate;
  const t = String(s.fitTier || '').toLowerCase();
  return t === 'pass' || t === 'maybe' || t === 'fail' ? t : null;
}

function gateClass(s, profile) {
  const g = profile.gate;
  if (!g) return 'pass';
  if (g.type === 'cutoff') {
    const v = g.axis === 'fit' ? s.fitScore : rankValue(s, profile);
    return v != null && v >= g.min ? 'pass' : 'fail';
  }
  const gate = songGate(s);
  if (g.type === 'passFail') return gate === 'fail' ? 'fail' : 'pass';
  if (g.type === 'passFailMaybe') {
    if (gate === 'fail') return 'fail';
    if (gate === 'maybe') return 'maybe';
    return 'pass';
  }
  return 'pass';
}

// Snap a song's fit signal to a coarse band. Made-up AI fit numbers aren't
// precise enough to differentiate song-by-song, so we collapse them to the
// graded tier (or gate word) for same-tier comparisons.
function coarseFit(s) {
  const t = String(s.fitTier || '').toLowerCase();
  if (FIT_TIER_SCORES[t] != null) return t; // graded tier word
  if (t === 'pass' || t === 'maybe' || t === 'fail') return t; // gate word
  if (s.fitScore != null) return fitTierForScore(s.fitScore);
  return '';
}

// The same-tier key: songs sharing it are treated as equal opinion and must
// get equal final points (subject to an indivisible-split tradeoff). It is
// scoring-type aware per the "same score = same tier" rule:
//   - music (default, incl. music-primary gate rounds): identical music score.
//     Equal music -> equal points; +/- only break an indivisible split.
//   - fit: the same coarse fit band.
//   - combined: identical music AND the same coarse fit band — exact on the
//     real axis (music), fuzzy on the made-up one (fit).
function tierKey(s, profile) {
  const music = s.score ?? '';
  switch (profile.rankBy) {
    case 'fit':
      return `f:${coarseFit(s)}`;
    case 'combined':
      // Modifier-folded music (effectiveMusic) is the exact axis here: a `74+` and a
      // plain `74` are now different tiers (the fold-in earned it), while the made-up
      // fit number is fuzzed to its coarse band so tiny fit gaps never split a tier.
      return `c:${effectiveMusic(s) ?? ''}|${coarseFit(s)}`;
    default:
      return `m:${music}`;
  }
}

// Order songs for ranking/tiering, highest first.
function rankSort(profile) {
  return (a, b) =>
    (rankValue(b, profile) ?? -Infinity) - (rankValue(a, profile) ?? -Infinity) ||
    tiebreakRank(b) - tiebreakRank(a) ||
    String(a.title).localeCompare(String(b.title));
}

// Lowest-ranked first — the downvote tail of the continuous tier spectrum.
function rankSortAsc(profile) {
  return (a, b) =>
    (rankValue(a, profile) ?? -Infinity) - (rankValue(b, profile) ?? -Infinity) ||
    tiebreakRank(a) - tiebreakRank(b) ||
    String(a.title).localeCompare(String(b.title));
}

// Attach downvote-bank fields from a round budget onto an allocation profile.
export function enrichProfileWithBudget(profile, budget) {
  if (!budget) return profile;
  return {
    ...profile,
    downvotesEnabled: !!budget.downvotesEnabled,
    downvoteBudget: budget.downvoteBankSize ?? 0,
    downvoteCap: budget.maxDownvotesPerSong ?? Infinity,
  };
}

// Opinion-curve center shared by upvote tiers (above) and downvote tiers (below).
function opinionCenter(songs, profile) {
  const vals = songs
    .filter((s) => !s.needsUserInput)
    .map((s) => rankValue(s, profile))
    .filter((v) => v != null);
  return vals.length ? estimateCenter(vals) : 0;
}

// Up pool for a sequenced (upvotes-first) allocation: the whole eligible field
// minus a minimal downvote reserve at the bottom. The reserve is the fewest bottom
// songs needed to physically hold the down bank at its per-song cap (uncapped => 1:
// all downvotes may validly land on the single worst/invalid song; it grows only
// when a tight down cap binds). Excluding the reserve from the up pool guarantees at
// least that many zero-upvote songs survive, so a finite down cap can always be
// honored. The up bell then decides how far down upvotes actually reach and zeroes
// the rest; the downvote pass later targets EVERY zero-upvote song (the reserve plus
// whatever the curve left at zero, plus any disqualified song), not just this slice.
function upvotePool(songs, profile, upBudget, downBudget, downCap) {
  const eligible = songs.filter((s) => !s.needsUserInput).sort(rankSort(profile));
  const n = eligible.length;
  if (!n || !(downBudget > 0)) return new Set(eligible);

  let downCount = Math.min(n, Math.max(1, Math.ceil(downBudget / Math.max(1, downCap))));
  while (downCount < n && downCount * downCap < downBudget) downCount++;
  // Always leave at least one song for the up bank to spend on.
  if (upBudget > 0 && downCount >= n) downCount = n - 1;

  const upCount = Math.max(0, n - downCount);
  return new Set(eligible.slice(0, upCount));
}

// Surface a loud `budget-mismatch` tradeoff whenever an allocation does not spend a
// bank EXACTLY. Both banks must be spent exactly (Music League requires every point
// be cast, and over-spending a bank is never a valid ballot); the deterministic
// curve always does. A mismatch therefore means a manual pin over- or under-filled a
// bank, so it is flagged rather than silently emitted. Pushed onto `tradeoffs` so
// every consumer (CLI, markdown, web) can surface it uniformly. Returns nothing.
function flagBudgetMismatch(songs, upBudget, profile, tradeoffs) {
  const up = songs.reduce((a, s) => a + (s.finalVotes || 0), 0);
  const downEnabled = !!profile.downvotesEnabled && (profile.downvoteBudget || 0) > 0;
  const downBudget = downEnabled ? profile.downvoteBudget : 0;
  const down = songs.reduce((a, s) => a + (s.finalDownvotes || 0), 0);
  const parts = [];
  if (upBudget > 0 && up !== upBudget) parts.push(`upvotes ${up}/${upBudget}`);
  if (downEnabled && down !== downBudget) parts.push(`downvotes ${down}/${downBudget}`);
  if (!parts.length) return;
  const over = (upBudget > 0 && up > upBudget) || (downEnabled && down > downBudget);
  tradeoffs.push({
    kind: 'budget-mismatch',
    over,
    question:
      `${over ? '⛔ OVER BUDGET' : '⚠️ Bank not fully spent'}: ${parts.join(', ')}. ` +
      `${over ? 'Exceeding a bank is never a valid ballot — ' : ''}` +
      `rebalance so each bank totals exactly (pins, or caps × eligible slots, may block full spend).`,
    options: [],
  });
}

// ---------------------------------------------------------------------------
// Allocation: profile-driven. Default shape is the mode-centered bell ('auto').
// Returns { candidates, tradeoffs }; songs are mutated with finalVotes /
// finalDownvotes (positive counts; downvotes are the negative tail of one tier
// spectrum — never mixed with upvotes on the same song).
// ---------------------------------------------------------------------------
export function allocate(songs, budget, cap = Infinity, profile = {}) {
  // Normalize an absent per-song cap (null when a round has no maxUpvotesPerSong)
  // to Infinity; a default parameter only covers `undefined`, so a literal null
  // would otherwise wedge the waterfill (no level could ever be raised).
  if (cap == null) cap = Infinity;
  for (const s of songs) {
    s.finalVotes = 0;
    s.finalDownvotes = 0;
  }
  const tradeoffs = [];
  const shape = profile.shape || 'auto';
  const totalBudget = budget;
  const downBudget = profile.downvotesEnabled ? profile.downvoteBudget ?? 0 : 0;
  const downCap = profile.downvoteCap ?? Infinity;
  const upSet = upvotePool(songs, profile, budget, downBudget, downCap);

  // Downvote pins force a song onto the down axis: it must earn zero upvotes, so drop
  // it from the upvote pool (and from any leftover-spill targets) up front.
  const downOverrides = profile.downOverrides || {};
  const downPinnedIdx = new Set(
    Object.entries(downOverrides)
      .filter(([, v]) => Number.isFinite(v) && v > 0)
      .map(([k]) => Number(k))
  );
  if (downPinnedIdx.size) for (const s of songs) if (downPinnedIdx.has(s.rawOrderIndex)) upSet.delete(s);

  const scored = songs.filter(
    (s) =>
      upSet.has(s) &&
      rankValue(s, profile) != null &&
      !s.isDisqualified &&
      !s.needsUserInput
  );
  if (!scored.length || budget <= 0) {
    finishDownvotes(songs, profile, tradeoffs);
    flagBudgetMismatch(songs, totalBudget, profile, tradeoffs);
    return { candidates: [], tradeoffs };
  }

  // Manual overrides pin a song's votes; the remaining budget is shaped around
  // them. Blank-score songs can receive an explicit --pin (manual ballot slot).
  const overrides = profile.overrides || {};
  const pinned = songs.filter((s) => {
    if (s.isDisqualified || s.isOwn) return false;
    if (!Number.isFinite(overrides[s.rawOrderIndex])) return false;
    if (s.needsUserInput) return overrides[s.rawOrderIndex] > 0;
    return scored.includes(s);
  });
  for (const s of pinned) s.finalVotes = Math.max(0, Math.min(overrides[s.rawOrderIndex], cap));
  const pinnedTotal = pinned.reduce((a, s) => a + s.finalVotes, 0);
  budget = Math.max(0, budget - pinnedTotal);
  const open = pinned.length ? scored.filter((s) => !pinned.includes(s)) : scored;
  if (!open.length || budget <= 0) {
    spillRemainder(songs, totalBudget, cap, profile, tradeoffs, new Set(scored), upSet);
    flagUncertainBoundaries(scored, profile);
    finishDownvotes(songs, profile, tradeoffs);
    flagBudgetMismatch(songs, totalBudget, profile, tradeoffs);
    return { candidates: scored, tradeoffs };
  }

  // Gate -> pass / maybe / fail. Fails earn nothing.
  const classed = open.map((s) => ({ s, k: gateClass(s, profile) }));
  const passes = classed.filter((c) => c.k === 'pass').map((c) => c.s);
  const maybes = classed
    .filter((c) => c.k === 'maybe')
    .map((c) => c.s)
    .sort(
      (a, b) =>
        (b.fitScore ?? -Infinity) - (a.fitScore ?? -Infinity) ||
        (b.score ?? -Infinity) - (a.score ?? -Infinity) ||
        tiebreakRank(b) - tiebreakRank(a)
    );

  // Passes first, always. The governing rule is max(maybe) <= min(funded pass):
  // a maybe never earns more points than the lowest-funded pass. By default funded
  // maybes take the 1-point floor (ordered by defensibility, fitScore); how many
  // are funded is the largest count that still keeps every pass >= 1 after shaping
  // the reduced budget, capped by the leniency dial when set. In a LOW-PASS round
  // (few passes, many maybes) the maybe band may instead take its own graduated
  // staircase capped at the lowest pass (Step 1b). Surfaced as a maybe-band
  // tradeoff (0 / 1 / graduated).
  const shapePrimary = (prim, primBudget, tr) => {
    if (!prim.length) return;
    if (shape === 'relative') allocateRelative(prim, primBudget, cap);
    else allocateBell(prim, primBudget, cap, shape, profile, tr);
  };

  let includedMaybes = [];
  if (!passes.length) {
    // No passes: the maybe band is the whole allocation (unchanged fallback).
    includedMaybes = maybes;
    shapePrimary(includedMaybes, budget, tradeoffs);
  } else if (!maybes.length) {
    // All-pass: no maybe logic runs.
    shapePrimary(passes, budget, tradeoffs);
  } else {
    // Shape passes on a scratch budget and report their floor/top.
    const shapePassesScratch = (passBudget) => {
      for (const p of passes) p.finalVotes = 0;
      shapePrimary(passes, passBudget, []);
      const vs = passes.map((p) => p.finalVotes || 0);
      return { floor: Math.min(...vs), max: Math.max(...vs) };
    };

    // 1-point floor (Step 1a): passFloor is non-decreasing in passBudget, so the
    // largest feasible count is the first that keeps every pass >= 1.
    const ceiling = Math.max(0, Math.min(maybes.length, budget - passes.length));
    let maxFeasible = 0;
    for (let c = ceiling; c >= 1; c--) {
      if (shapePassesScratch(budget - c).floor >= 1) {
        maxFeasible = c;
        break;
      }
    }
    const len = profile.gate?.leniency;
    const flatTarget =
      typeof len === 'number'
        ? Math.round(Math.max(0, Math.min(1, len)) * maybes.length)
        : maxFeasible; // auto: fund the most that still stays at/below the passes
    const flatCount = Math.min(maxFeasible, flatTarget);

    // Graduated band (Step 1b): in a low-pass round, find the smallest passBudget
    // that lets the passes graduate (a strict top above their floor >= 2), leaving
    // budget for a maybe staircase capped at the lowest pass. The leniency dial
    // keeps the flat 1-point semantics.
    const lowPass = maybes.length > passes.length && typeof len !== 'number';
    let grad = null;
    if (lowPass) {
      for (let pb = passes.length; pb <= budget - 1; pb++) {
        const { floor, max } = shapePassesScratch(pb);
        if (floor >= 2 && max > floor) {
          grad = { passBudget: pb, passFloor: floor };
          break;
        }
      }
    }

    if (grad) {
      // Commit: passes graduate at the top; the maybe band takes its own staircase
      // capped at the lowest pass, so max(maybe) <= passFloor < max(pass).
      for (const p of passes) p.finalVotes = 0;
      shapePrimary(passes, grad.passBudget, tradeoffs);
      const maybeBudget = budget - grad.passBudget;
      if (shape === 'relative') allocateRelative(maybes, maybeBudget, grad.passFloor);
      else allocateBell(maybes, maybeBudget, grad.passFloor, shape, profile, []);
      includedMaybes = maybes.filter((m) => (m.finalVotes || 0) > 0);
    } else {
      includedMaybes = maybes.slice(0, flatCount);
      for (const p of passes) p.finalVotes = 0;
      shapePrimary(passes, budget - flatCount, tradeoffs);
      for (const m of includedMaybes) m.finalVotes = Math.min(1, cap);
    }

    const options = [{ label: 'Reward none (passes only)', value: 0 }];
    if (maxFeasible > 0) {
      options.push({
        label: `${grad ? 'Flat' : 'Keep'} ${flatCount} maybe(s) at 1 (capped below passes)${
          grad ? '' : ' — default'
        }`,
        value: flatCount,
      });
    }
    if (grad) {
      options.push({
        label: `Graduated maybe band capped at the lowest pass (${grad.passFloor}) — default`,
        value: includedMaybes.length,
      });
    }
    tradeoffs.push({
      kind: 'maybe-band',
      question: `Reward how many of the ${maybes.length} questionable (maybe) entries? A maybe never outranks a pass.`,
      options,
    });
  }

  const candidates = [...pinned, ...(passes.length ? [...passes, ...includedMaybes] : includedMaybes)];

  // The vote budget must be spent exactly; spill any cap-blocked remainder.
  spillRemainder(songs, totalBudget, cap, profile, tradeoffs, new Set(candidates), upSet);
  flagUncertainBoundaries(candidates, profile);
  finishDownvotes(songs, profile, tradeoffs);
  flagBudgetMismatch(songs, totalBudget, profile, tradeoffs);
  return { candidates, tradeoffs };
}

// Downvote tail: same tier machinery as upvotes, inverted rank, disjoint targets.
function finishDownvotes(songs, profile, tradeoffs, downSet = null) {
  if (!profile.downvotesEnabled || !(profile.downvoteBudget > 0)) return;
  allocateDownvotes(
    songs,
    profile.downvoteBudget,
    profile.downvoteCap ?? Infinity,
    profile,
    tradeoffs,
    downSet ?? new Set(songs.filter(downEligible))
  );
}

function downEligible(s) {
  return !s.needsUserInput && !(s.finalVotes || 0);
}

const DOWN_SHAPES = ['curved', 'flat', 'concentrated'];
const DOWN_SHAPE_LABEL = {
  curved: 'Curved (bell)',
  flat: 'Flat (even)',
  concentrated: 'Concentrated (worst-first)',
};

// The downvote curve is its own axis, independent of the upvote tier structure
// (A/B/C). `downShape` picks it: `concentrated` (pile worst-first to cap; uncapped
// => the whole bank on the single worst/invalid song), `flat` (even 1-each spread
// across the worst songs), or `curved` (the graduated bell — default). `relative`
// upvote mode keeps its proportional down pass unless a downShape is pinned.
function normalizeDownShape(v) {
  if (v == null) return null;
  const s = String(v).toLowerCase().trim();
  if (s === 'concentrated' || s === 'concentrate' || s === 'worst') return 'concentrated';
  if (s === 'flat' || s === 'even') return 'flat';
  if (s === 'curved' || s === 'curve' || s === 'bell') return 'curved';
  return null;
}

function allocateDownvotes(songs, budget, cap, profile, tradeoffs, downSet) {
  const totalBudget = budget;

  // Downvote pins fix a song's downvotes: committed up front, excluded from the
  // shaped pool AND from spill (so they're never topped up past the pin), with the
  // rest of the bank shaped around them. `downSet`/`budget` below are the residual.
  const downOverrides = profile.downOverrides || {};
  const isPinned = (s) => Number.isFinite(downOverrides[s.rawOrderIndex]) && downOverrides[s.rawOrderIndex] > 0;
  const pinAmount = (s) => Math.max(0, Math.min(downOverrides[s.rawOrderIndex], cap));
  const pinnedDown = songs.filter((s) => downSet.has(s) && isPinned(s));
  const applyPins = () => {
    for (const s of pinnedDown) s.finalDownvotes = pinAmount(s);
  };
  const downPool = pinnedDown.length ? new Set([...downSet].filter((s) => !isPinned(s))) : downSet;
  const shapedBudget = Math.max(0, totalBudget - pinnedDown.reduce((a, s) => a + pinAmount(s), 0));

  const pool = songs.filter((s) => downPool.has(s) && downEligible(s));
  if (!pool.length || shapedBudget <= 0) {
    for (const s of songs) s.finalDownvotes = 0;
    applyPins();
    spillDownRemainder(songs, totalBudget, cap, profile, tradeoffs, new Set(pinnedDown), downPool);
    return;
  }

  const shape = profile.shape || 'auto';
  const pin = normalizeDownShape(profile.downShape);
  if (shape === 'relative' && !pin) {
    for (const s of songs) s.finalDownvotes = 0;
    applyPins();
    allocateRelativeDown(pool, shapedBudget, cap, profile);
    spillDownRemainder(songs, totalBudget, cap, profile, tradeoffs, new Set(pool), downPool);
    return;
  }

  const resetDown = () => {
    for (const s of songs) s.finalDownvotes = 0;
    applyPins();
  };
  const applyShape = (which, trSink) => {
    if (which === 'concentrated') allocateConcentratedDown(pool, shapedBudget, cap, profile);
    else if (which === 'flat') allocateFlatDown(pool, shapedBudget, cap, profile);
    else allocateBellDown(pool, shapedBudget, cap, shape, profile, trSink, songs);
  };
  // Full distribution (allocation + spill) for a shape, captured best-first over the
  // pool (pinned songs included, at their fixed magnitude); resets the down state so
  // each candidate is computed cleanly.
  const distFor = (which) => {
    resetDown();
    const tr = [];
    applyShape(which, tr);
    spillDownRemainder(songs, totalBudget, cap, profile, tr, new Set(pool), downPool);
    const ordered = [...pool, ...pinnedDown].sort(rankSort(profile));
    const perSong = ordered.map((s) => ({
      rawOrderIndex: s.rawOrderIndex,
      title: s.title,
      score: s.combinedScore ?? s.score ?? null,
      votes: s.finalDownvotes || 0,
    }));
    return { shape: which, perSong, sig: perSong.map((p) => p.votes).join(',') };
  };

  const chosen = pin || 'curved';

  // Propose the alternatives (deduped on the resulting distribution) when the owner
  // hasn't pinned a shape — mirrors the upvote tier-structure fork.
  if (!pin) {
    const seen = new Set();
    const distinct = [];
    for (const which of DOWN_SHAPES) {
      const c = distFor(which);
      if (seen.has(c.sig)) continue;
      seen.add(c.sig);
      distinct.push(c);
    }
    if (distinct.length >= 2) {
      tradeoffs.push({
        kind: 'down-structure',
        question: `Which downvote shape? Default is ${DOWN_SHAPE_LABEL[chosen]}; record with just pick <round> <A|B|C> --down-shape <concentrated|flat|curved>.`,
        options: distinct.map((c) => ({
          label: `${DOWN_SHAPE_LABEL[c.shape]} — ${summarizeDownPerSong(c.perSong)}`,
          value: c.shape,
          downShape: c.shape,
          shape: DOWN_SHAPE_LABEL[c.shape],
          perSong: c.perSong,
        })),
      });
    }
  }

  // Commit the chosen shape for real (its bell tier-split-down tradeoffs, if any,
  // land on the live list). resetDown re-applies the pins.
  resetDown();
  applyShape(chosen, tradeoffs);
  spillDownRemainder(songs, totalBudget, cap, profile, tradeoffs, new Set(pool), downPool);
}

// Pile downvotes worst-first up to the per-song cap; uncapped => the whole bank on
// the single worst song. Any cap-blocked remainder is handled by spillDownRemainder.
function allocateConcentratedDown(pool, budget, cap, profile) {
  const ranked = [...pool].sort(rankSortAsc(profile));
  for (const s of ranked) s.finalDownvotes = 0;
  let remaining = budget;
  for (const s of ranked) {
    if (remaining <= 0) break;
    const take = Math.min(cap, remaining);
    s.finalDownvotes = take;
    remaining -= take;
  }
}

// Spread downvotes as evenly as possible, worst-first round-robin: the worst songs
// take the first 1 each, then a second pass, etc. (ties broken toward worst).
function allocateFlatDown(pool, budget, cap, profile) {
  const ranked = [...pool].sort(rankSortAsc(profile));
  for (const s of ranked) s.finalDownvotes = 0;
  let remaining = budget;
  let progress = true;
  while (remaining > 0 && progress) {
    progress = false;
    for (const s of ranked) {
      if ((s.finalDownvotes || 0) >= cap) continue;
      s.finalDownvotes = (s.finalDownvotes || 0) + 1;
      remaining--;
      progress = true;
      if (remaining <= 0) break;
    }
  }
}

// "-N×count" signature for a downvote distribution (worst tiers first, trailing 0s
// summarized), e.g. "-5×1 / 0×7" (concentrated) vs "-1×5 / 0×3" (flat).
function summarizeDownPerSong(perSong) {
  const byLevel = new Map();
  for (const p of perSong) byLevel.set(p.votes, (byLevel.get(p.votes) || 0) + 1);
  const levels = [...byLevel.keys()].sort((a, b) => b - a);
  return levels
    .map((lv) => `${lv > 0 ? `-${lv}` : '0'}×${byLevel.get(lv)}`)
    .join(' / ');
}

// Weights below the shared opinion center — mirrors bellWeights above center.
function downBellWeights(values, center, params) {
  const { width, skew } = params;
  const below = values.map((v) => Math.max(0, center - v));
  const maxBelow = Math.max(...below, 1e-9);
  return below.map((b) => {
    if (b <= 0) return 0;
    return 1 + (b / maxBelow) * (1 + skew) * width;
  });
}

function allocateRelativeDown(cands, budget, cap, profile) {
  const vals = cands.map((c) => rankValue(c, profile) ?? -Infinity);
  const hi = Math.max(...vals);
  let weights = vals.map((v) => hi - v);
  let total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    weights = cands.map(() => 1);
    total = cands.length;
  }
  cands.forEach((c, i) => {
    c._downExact = (weights[i] / total) * budget;
    c.finalDownvotes = Math.min(Math.floor(c._downExact), cap);
  });
  let remaining = budget - cands.reduce((a, c) => a + (c.finalDownvotes || 0), 0);
  while (remaining > 0) {
    const eligible = cands.filter((c) => (c.finalDownvotes || 0) < cap);
    if (!eligible.length) break;
    eligible.sort(
      (a, b) =>
        b._downExact - (b.finalDownvotes || 0) - (a._downExact - (a.finalDownvotes || 0)) ||
        (rankValue(a, profile) ?? -Infinity) - (rankValue(b, profile) ?? -Infinity) ||
        tiebreakRank(a) - tiebreakRank(b)
    );
    eligible[0].finalDownvotes = (eligible[0].finalDownvotes || 0) + 1;
    remaining--;
  }
}

function allocateBellDown(cands, budget, cap, shape, profile, tradeoffs, allSongs) {
  const ranked = [...cands].sort(rankSortAsc(profile));
  // Unrankable songs (a disqualified entry with no score) must be the strongest
  // downvote magnet, but a literal -Infinity poisons the bell math (Inf/Inf => NaN
  // weights, runaway spill). Map them to a finite floor a full spread below the
  // lowest real score so they sort worst and pull the most weight, cleanly.
  const finite = ranked.map((c) => rankValue(c, profile)).filter((v) => Number.isFinite(v));
  const minFinite = finite.length ? Math.min(...finite) : 0;
  const maxFinite = finite.length ? Math.max(...finite) : 0;
  const floor = minFinite - (Math.max(1, maxFinite - minFinite));
  const values = ranked.map((c) => {
    const v = rankValue(c, profile);
    return Number.isFinite(v) ? v : floor;
  });
  const center = opinionCenter(allSongs, profile);
  const spread = Math.max(...values) - Math.min(...values);
  const ratio = budget / ranked.length;
  let weights = downBellWeights(values, center, shapeParams(shape, { ratio, spread }));
  if (weights.every((w) => w === 0)) weights = ranked.map(() => 1);

  const tierMap = new Map();
  const tiers = [];
  ranked.forEach((song, i) => {
    const key = tierKey(song, profile);
    let t = tierMap.get(key);
    if (!t) {
      t = { value: 0, members: [], weight: 0, n: 0 };
      tierMap.set(key, t);
      tiers.push(t);
    }
    t.members.push(song);
    t.weight += weights[i];
    t.value = (t.value * t.n + values[i]) / (t.n + 1);
    t.n++;
  });

  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  tiers.forEach((t) => {
    t.exact = (t.weight / totalW) * budget;
    t.points = Math.min(Math.floor(t.exact), t.members.length * cap);
  });
  let remaining = budget - tiers.reduce((a, t) => a + t.points, 0);
  const refillable = () => tiers.filter((t) => t.points < t.members.length * cap);
  while (remaining > 0) {
    const pool = refillable();
    if (!pool.length) break;
    pool.sort((a, b) => b.exact - b.points - (a.exact - a.points) || a.value - b.value);
    pool[0].points++;
    remaining--;
  }

  for (const t of tiers) {
    const ordered = [...t.members].sort(
      (a, b) =>
        tiebreakRank(a) - tiebreakRank(b) || String(a.title).localeCompare(String(b.title))
    );
    const base = Math.min(Math.floor(t.points / t.members.length), cap);
    const extra0 = t.points - base * t.members.length;
    let extra = extra0;
    for (const m of ordered) {
      m.finalDownvotes = base;
      if (extra > 0 && m.finalDownvotes < cap) {
        m.finalDownvotes++;
        extra--;
      }
    }
    const ambiguous =
      extra0 > 0 &&
      ordered[extra0 - 1] &&
      ordered[extra0] &&
      tiebreakRank(ordered[extra0 - 1]) === tiebreakRank(ordered[extra0]);
    if (t.members.length > 1 && ambiguous) {
      tradeoffs.push({
        kind: 'tier-split-down',
        question: `Tied low score ${formatScore(t.value)} can't split ${t.points} downvote(s) evenly across ${t.members.length} songs, and no +/− breaks the tie.`,
        options: ordered.map((m) => ({
          label: `${cell(m.title)} — -${m.finalDownvotes}`,
          value: m.rawOrderIndex,
        })),
      });
    }
  }
}

function spillDownRemainder(songs, totalBudget, cap, profile, tradeoffs, chosen, downSet) {
  const allocated = () => songs.reduce((a, s) => a + (s.finalDownvotes || 0), 0);
  let remaining = totalBudget - allocated();
  if (remaining <= 0) return;

  const rank = (s) => rankValue(s, profile) ?? -Infinity;
  const byWorst = (a, b) => rank(a) - rank(b) || tiebreakRank(a) - tiebreakRank(b);
  const inDownSet = (s) => downSet.has(s) && downEligible(s);
  const pools = [
    [...chosen].filter((s) => inDownSet(s) && (s.finalDownvotes || 0) < cap).sort(byWorst),
    songs.filter((s) => inDownSet(s) && !chosen.has(s)).sort(byWorst),
  ];

  let spilledOutside = 0;
  for (let i = 0; i < pools.length && remaining > 0; i++) {
    let progress = true;
    while (remaining > 0 && progress) {
      progress = false;
      for (const s of pools[i]) {
        if ((s.finalDownvotes || 0) >= cap) continue;
        s.finalDownvotes = (s.finalDownvotes || 0) + 1;
        remaining--;
        progress = true;
        if (i > 0) spilledOutside++;
        if (remaining <= 0) break;
      }
    }
  }

  if (spilledOutside > 0) {
    tradeoffs.push({
      kind: 'forced-spill-down',
      question: `Awarded ${spilledOutside} leftover downvote(s) outside the primary down-tier pool so downvotes total the budget (${totalBudget}). Reassign if you'd rather place them elsewhere.`,
      options: [],
    });
  }
}

// Budget must be spent exactly. Leftover points promote bell-style: fund the best
// zero first, then step up the weakest funded tier — never pile onto the top song
// while lower tiers still have room to grow.
function promoteOneSpill(eligible, cap, byRank) {
  const list = eligible.filter((s) => (s.finalVotes || 0) < cap).sort(byRank);
  if (!list.length) return false;
  const zeros = list.filter((s) => !(s.finalVotes || 0));
  if (zeros.length) {
    zeros[0].finalVotes = (zeros[0].finalVotes || 0) + 1;
    return true;
  }
  const vMin = Math.min(...list.map((s) => s.finalVotes || 0));
  const tier = list.filter((s) => (s.finalVotes || 0) === vMin);
  tier[0].finalVotes = (tier[0].finalVotes || 0) + 1;
  return true;
}

function spillRemainder(songs, totalBudget, cap, profile, tradeoffs, chosen, upSet = null) {
  const allocated = () => songs.reduce((a, s) => a + (s.finalVotes || 0), 0);
  let remaining = totalBudget - allocated();
  if (remaining <= 0) return;

  const rank = (s) => rankValue(s, profile) ?? -Infinity;
  const byRank = (a, b) => rank(b) - rank(a) || tiebreakRank(b) - tiebreakRank(a);
  const inUpPool = (s) => (upSet ? upSet.has(s) : true) && (s.finalDownvotes || 0) === 0;
  const spillEligible = (s) => {
    if (s.isOwn || s.isDisqualified) return false;
    if (!inUpPool(s)) return false;
    if ((s.finalVotes || 0) >= cap) return false;
    if (s.needsUserInput) return (s.finalVotes || 0) > 0;
    return rankValue(s, profile) != null;
  };

  const pools = [
    [...chosen].filter(spillEligible),
    songs.filter((s) => spillEligible(s) && !chosen.has(s)),
  ];
  if (upSet && profile.downvotesEnabled) {
    pools.push(songs.filter((s) => upSet.has(s) && spillEligible(s) && !chosen.has(s)));
  } else {
    pools.push(
      songs.filter(
        (s) =>
          !chosen.has(s) &&
          !s.isDisqualified &&
          !s.isOwn &&
          !s.needsUserInput &&
          rankValue(s, profile) != null &&
          inUpPool(s) &&
          (s.finalVotes || 0) < cap
      )
    );
  }

  let spilledOutside = 0;
  for (let i = 0; i < pools.length && remaining > 0; i++) {
    while (remaining > 0 && promoteOneSpill(pools[i], cap, byRank)) {
      remaining--;
      if (i > 0) spilledOutside++;
    }
  }

  // Last resort (still capped, never own): blank-score slots, then DQ. These run
  // even when downvotes are enabled — the normal pools above skip them.
  const forcedSpill = (filter) => {
    const pool = songs.filter(filter);
    while (remaining > 0 && promoteOneSpill(pool, cap, byRank)) {
      remaining--;
      spilledOutside++;
    }
  };
  forcedSpill(
    (s) =>
      s.needsUserInput &&
      !s.isOwn &&
      !s.isDisqualified &&
      (s.finalDownvotes || 0) === 0 &&
      (s.finalVotes || 0) < cap
  );
  forcedSpill(
    (s) =>
      s.isDisqualified &&
      !s.isOwn &&
      (s.finalDownvotes || 0) === 0 &&
      (s.finalVotes || 0) < cap
  );

  if (spilledOutside > 0) {
    tradeoffs.push({
      kind: 'forced-spill',
      question: `Awarded ${spilledOutside} leftover point(s) to gated-out, blank-score, or disqualified songs so the votes total the budget (${totalBudget}). Reassign if you'd rather place them elsewhere.`,
      options: [],
    });
  }

  if (remaining > 0 && upSet) {
    const tail = songs.filter(
      (s) =>
        upSet.has(s) &&
        (s.finalDownvotes || 0) === 0 &&
        !s.isDisqualified &&
        !s.isOwn &&
        !s.needsUserInput &&
        rankValue(s, profile) != null &&
        (s.finalVotes || 0) < cap
    );
    while (remaining > 0 && promoteOneSpill(tail, cap, byRank)) remaining--;
  }
}

// Legacy relative draft: weight = value - lowest value present. Kept selectable.
function allocateRelative(cands, budget, cap) {
  const vals = cands.map((c) => rankValue(c));
  const lo = Math.min(...vals);
  let weights = vals.map((v) => v - lo);
  let total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    weights = cands.map(() => 1);
    total = cands.length;
  }
  cands.forEach((c, i) => {
    c._exact = (weights[i] / total) * budget;
    c.finalVotes = Math.min(Math.floor(c._exact), cap);
  });
  let remaining = budget - cands.reduce((a, c) => a + c.finalVotes, 0);
  while (remaining > 0) {
    const eligible = cands.filter((c) => c.finalVotes < cap);
    if (!eligible.length) break;
    eligible.sort(
      (a, b) =>
        b._exact - b.finalVotes - (a._exact - a.finalVotes) ||
        rankValue(b) - rankValue(a) ||
        tiebreakRank(b) - tiebreakRank(a)
    );
    eligible[0].finalVotes++;
    remaining--;
  }
}

// Optimal 1-D clustering by dynamic programming (Ckmeans.1d.dp; Wang & Song,
// 2011) — the provably-optimal successor to Jenks natural breaks. Partitions the
// (descending-sorted) weighted values into K contiguous clusters minimizing the
// within-cluster sum of squares, so boundaries fall on the largest gaps. Weights
// are the member counts of each atomic unit. Returns contiguous index ranges
// [lo, hi] (top to bottom) plus the achieved within-cluster SS. O(K·n²), n ≤ ~30.
export function ckmeans1dWeighted(values, weights, K) {
  const n = values.length;
  const W = [0];
  const Sx = [0];
  const Sx2 = [0];
  for (let i = 0; i < n; i++) {
    W[i + 1] = W[i] + weights[i];
    Sx[i + 1] = Sx[i] + weights[i] * values[i];
    Sx2[i + 1] = Sx2[i] + weights[i] * values[i] * values[i];
  }
  // Weighted SSQ of the block of original indices i..j (inclusive).
  const ssq = (i, j) => {
    const w = W[j + 1] - W[i];
    if (w <= 0) return 0;
    const sx = Sx[j + 1] - Sx[i];
    const sx2 = Sx2[j + 1] - Sx2[i];
    return Math.max(0, sx2 - (sx * sx) / w);
  };
  const D = Array.from({ length: K + 1 }, () => new Array(n + 1).fill(Infinity));
  const B = Array.from({ length: K + 1 }, () => new Array(n + 1).fill(0));
  D[0][0] = 0;
  for (let k = 1; k <= K; k++) {
    for (let j = k; j <= n; j++) {
      for (let i = k - 1; i <= j - 1; i++) {
        const cost = D[k - 1][i] + ssq(i, j - 1);
        if (cost < D[k][j]) {
          D[k][j] = cost;
          B[k][j] = i;
        }
      }
    }
  }
  const ranges = [];
  let j = n;
  for (let k = K; k >= 1; k--) {
    const i = B[k][j];
    ranges.unshift([i, j - 1]);
    j = i;
  }
  return { ranges, wss: D[K][n] };
}

// Tiers come from optimal 1-D clustering of the rank axis (natural breaks), each
// given a budget-exact monotonic point value. Equal-opinion songs share a tier
// (and points); genuine forks (an indivisible split inside a tier, an ambiguous
// tier count, pre-allocations over budget) are surfaced as tradeoffs.
function allocateBell(cands, budget, cap, shape, profile, tradeoffs) {
  const ranked = [...cands].sort(rankSort(profile));
  const values = ranked.map((c) => rankValue(c, profile));
  const center = estimateCenter(values);
  const spread = Math.max(...values) - Math.min(...values);
  const ratio = budget / ranked.length;
  const weights = bellWeights(values, center, shapeParams(shape, { ratio, spread }));

  // Atomic units: songs of equal opinion (tierKey) never split across a tier
  // boundary. Each unit carries its rank value, member count and summed bell
  // weight (used to shape point targets). Grouping is by key, not adjacency, so
  // equal-music songs merge even if a different song's blend sorts between them.
  const unitMap = new Map();
  const units = [];
  ranked.forEach((song, i) => {
    const key = tierKey(song, profile);
    let u = unitMap.get(key);
    if (!u) {
      u = { value: 0, members: [], weightSum: 0, n: 0 };
      unitMap.set(key, u);
      units.push(u);
    }
    u.members.push(song);
    u.weightSum += weights[i];
    u.value = (u.value * u.n + values[i]) / (u.n + 1);
    u.n++;
  });
  units.sort((a, b) => b.value - a.value); // best first

  // R2: collapse the favorite top band into one shared tier. Scores at/above the
  // favorite-band floor (default 80 — "8+ = favorite") are not meaningfully
  // differentiated (90 vs 84 is not a real difference), so by default they merge
  // into a single atomic top unit and share the top tier. `profile.favoriteBand`
  // overrides the floor; `false` disables the merge.
  //
  // The 80 default is a RAW-MUSIC anchor ("8+"). It is meaningless against the
  // normalized combined score, where the 75-centered z-remap shoves above-average
  // songs over 80 regardless of their raw fit/music (a music-7.5 song can land at
  // 80.9). So the default is OFF for combined rounds; an explicit --favorite-band
  // floor is still honored if the owner sets one knowingly.
  const favBand = profile.favoriteBand;
  const favMin =
    favBand === false
      ? Infinity
      : favBand?.min != null
        ? favBand.min
        : profile.rankBy === 'combined'
          ? Infinity
          : 80;
  let favBandCount = 0;
  if (Number.isFinite(favMin)) {
    const topIdx = [];
    for (let i = 0; i < units.length; i++) if (units[i].value >= favMin) topIdx.push(i);
    if (topIdx.length > 1) {
      const top = topIdx.map((i) => units[i]);
      const merged = {
        value: top[0].value, // keep the highest value for ranking/labels
        members: top.flatMap((u) => u.members),
        weightSum: top.reduce((a, u) => a + u.weightSum, 0),
        n: top.reduce((a, u) => a + u.n, 0),
      };
      favBandCount = merged.n;
      const rest = units.filter((u) => !top.includes(u));
      units.length = 0;
      units.push(merged, ...rest);
    }
  }
  const unitVals = units.map((u) => u.value);
  const unitWts = units.map((u) => u.n);
  const U = units.length;
  // Two forces shape the top height:
  //  - PROMO_PENALTY: each promotion step (a taller top) costs this much boundary
  //    worth, so a uniform field doesn't cap-reach — a shorter staircase that spends
  //    the budget wins over a taller one the high cap merely allows.
  //  - JUNK_GAP: a promotion that lands on neither an owner anchor (80/75) nor a
  //    real score gap (>= JUNK_GAP) is JUNK top-heaviness (the {4,1,0} / lone-3 bug
  //    on a tight cluster). Junk promotions are minimized before anything else, so a
  //    fuzzy cluster stays low-topped even when an on-anchor cutoff would otherwise
  //    make the taller curve score higher.
  const PROMO_PENALTY = 2.5;
  const JUNK_GAP = 1;

  // Build a tier list from contiguous unit index ranges [lo, hi] (top to bottom).
  const tiersFor = (ranges) =>
    ranges.map(([lo, hi]) => {
      const members = [];
      let weight = 0;
      let vsum = 0;
      let count = 0;
      for (let u = lo; u <= hi; u++) {
        members.push(...units[u].members);
        weight += units[u].weightSum;
        vsum += units[u].value * units[u].n;
        count += units[u].n;
      }
      return { members, weight, value: vsum / count, count, hi };
    });

  // The score axis IS a bell, so allocation = drawing vertical lines at the
  // natural gaps (Ckmeans.1d.dp tiers) and giving each tier a point value with
  // Σ(size×points) = budget. Clustering decides WHERE the boundaries fall (on
  // real gaps); the budget (via the monotonic waterfill) decides how many
  // distinct levels appear; and the smoothness rule forbids a >1-point jump
  // between songs less than a point apart. Tier count is therefore a soft,
  // opinion/points-aware choice — not a hard cap — with alternatives surfaced.
  const SMOOTH_GAP = 1;
  const tss = ckmeans1dWeighted(unitVals, unitWts, 1).wss || 1;
  // Per-song rank value, in best-first order (units expanded by member count).
  // Used to evaluate the finalized curve honestly: smoothness is "songs ≤1 apart
  // never >1 point apart", so we check it on the realized per-song votes.
  const posValue = units.flatMap((u) => Array(u.n).fill(u.value));
  // Same best-first order as posValue, but the actual songs — so a candidate can
  // report the precise raw score (with any +/−/? modifier) sitting in each tier.
  const membersFlat = units.flatMap((u) => u.members);
  const rawToken = (m) => `${formatScore(m.score)}${formatMusicModifierFlags(m)}`;
  // Per-song unit index and +/− modifier rank, used to tell an *arbitrary*
  // tie-split (equal-score, equal-modifier songs forced to different points — a
  // coin flip) from a *resolvable* one (a +/− picks who takes the extra).
  const unitOf = [];
  units.forEach((u, ui) => u.members.forEach(() => unitOf.push(ui)));
  const tbRank = membersFlat.map((m) => tiebreakRank(m));
  // Within-cluster sum of squares for a set of unit-index ranges (for GVF, the
  // final cleanliness tiebreaker). Mirrors ckmeans1dWeighted's block cost.
  const wssFor = (ranges) => {
    let w = 0;
    for (const [lo, hi] of ranges) {
      let sw = 0;
      let sx = 0;
      let sx2 = 0;
      for (let u = lo; u <= hi; u++) {
        const c = unitWts[u];
        const v = unitVals[u];
        sw += c;
        sx += c * v;
        sx2 += c * v * v;
      }
      if (sw > 0) w += Math.max(0, sx2 - (sx * sx) / sw);
    }
    return w;
  };

  // Boundary quality: reward a boundary that lands on a large real score gap and
  // on the 80 (favorite) / 75 (actively-like) anchors, so steps fall where the
  // owner's scoring is meaningful rather than in a fuzzy mid-band.
  const gapAt = (b) => (b > 0 && b < U ? unitVals[b - 1] - unitVals[b] : 0);
  const anchorBonus = (b) => {
    if (b < 1 || b > U) return 0;
    const above = unitVals[b - 1];
    const below = b < U ? unitVals[b] : -Infinity;
    let bonus = 0;
    if (above >= 80 && below < 80) bonus += 6;
    if (above >= 75 && below < 75) bonus += 3;
    return bonus;
  };
  // Boundary worth = its real gap + any anchor bonus (plan preference #2: land on
  // the largest gaps and the 75/80 anchors).
  const qualityOf = (boundaries) =>
    [...new Set(boundaries)].reduce((a, b) => a + gapAt(b) + anchorBonus(b), 0);
  // A promotion is junk when it lands on neither an anchor nor a real gap.
  const isJunkPromo = (b) => anchorBonus(b) === 0 && gapAt(b) < JUNK_GAP;

  // Evaluate a (ranges, levels) curve into the candidate shape the selector,
  // tradeoff surfacing and renderer expect. `left` is any unspent budget (only
  // the rare non-exact exception); `boundaries` are the cutoff + promotion
  // positions used, scored for the boundary-quality preference.
  const evalCandidate = (ranges, levels, left, boundaries) => {
    const tiers = tiersFor(ranges);
    const votes = [];
    ranges.forEach(([lo, hi], ci) => {
      for (let u = lo; u <= hi; u++) for (let k = 0; k < units[u].n; k++) votes.push(levels[ci]);
    });
    // Spread any leftover (the rare exception path) top-down, capped, the way
    // phase 3 will, so runs/smoothness report the realized curve.
    let leftover = left;
    let placed = true;
    while (leftover > 0 && placed) {
      placed = false;
      for (let i = 0; i < votes.length && leftover > 0; i++) {
        if (votes[i] >= cap) continue;
        votes[i]++;
        leftover--;
        placed = true;
      }
    }
    let violations = 0;
    for (let i = 0; i < votes.length - 1; i++) {
      if (posValue[i] - posValue[i + 1] <= SMOOTH_GAP && Math.abs(votes[i] - votes[i + 1]) > 1) {
        violations++;
      }
    }
    const runs = [];
    votes.forEach((v, i) => {
      const tok = rawToken(membersFlat[i]);
      const last = runs[runs.length - 1];
      if (last && last.level === v) {
        last.count++;
        last.lo = posValue[i];
        if (!last.tokens.includes(tok)) last.tokens.push(tok);
      } else {
        runs.push({ level: v, count: 1, hi: posValue[i], lo: posValue[i], tokens: [tok] });
      }
    });
    const byUnit = new Map();
    for (let i = 0; i < votes.length; i++) {
      const ui = unitOf[i];
      let g = byUnit.get(ui);
      if (!g) byUnit.set(ui, (g = []));
      g.push(i);
    }
    let tieSplits = 0;
    let arbitrarySplits = 0;
    for (const idxs of byUnit.values()) {
      if (idxs.length < 2) continue;
      const lv = idxs.map((i) => votes[i]);
      if (new Set(lv).size < 2) continue;
      tieSplits++;
      const ranks = idxs.map((i) => tbRank[i]).sort((a, b) => b - a);
      const lvDesc = [...lv].sort((a, b) => b - a);
      for (let k = 1; k < ranks.length; k++) {
        if (ranks[k] === ranks[k - 1] && lvDesc[k] !== lvDesc[k - 1]) {
          arbitrarySplits++;
          break;
        }
      }
    }
    const K = Math.max(1, levels.filter((l) => l > 0).length); // funded point tiers
    // boundaries = [cutoff, ...promotions]; only promotions add height, so junk
    // top-heaviness is counted over the promotions alone.
    const promos = [...new Set(boundaries.slice(1))];
    const junkPromos = promos.filter(isJunkPromo).length;
    // Per-song votes for this curve, in best-first (= rank/combined) order, so a
    // tier-structure tradeoff can be rendered as a song×option comparison table
    // instead of opaque per-option blocks. `votes`/`posValue`/`membersFlat` are all
    // index-aligned and the unit set is identical across candidates, so option
    // columns line up row-for-row.
    const perSong = membersFlat.map((m, i) => ({
      rawOrderIndex: m.rawOrderIndex,
      title: m.title,
      // `rank` is the ranking key the curve actually used (a favorite-band unit
      // shares one averaged value across its members); `score` is each song's OWN
      // combined/music score, so the comparison table shows the real number per row
      // instead of the merged-unit average.
      rank: posValue[i],
      score: m.combinedScore ?? m.score ?? posValue[i],
      token: rawToken(m),
      votes: votes[i],
    }));
    return {
      K,
      tiers,
      levels,
      perSong,
      left,
      violations,
      tieSplits,
      arbitrarySplits,
      runs,
      distinct: runs.length,
      gvf: 1 - wssFor(ranges) / tss,
      // Unjustified extra steps (taller top with no gap/anchor under it). Minimized
      // first so a tight cluster stays low-topped (no lone 3 / {4,1,0}).
      junkPromos,
      // Net worth of the curve: total boundary worth (gaps + 75/80 anchors) less the
      // per-promotion height cost. A real favorite gap or anchor band pays for a
      // taller top; uniform filler steps don't, so the curve stays as short as the
      // budget needs (no cap-reach).
      score: qualityOf(boundaries) - PROMO_PENALTY * (K - 1),
      voteKey: runs.map((r) => `${r.count}:${r.level}`).join('|'),
    };
  };

  // A staircase = a 0/1 cutoff at position c plus distinct promotion positions.
  // unit i's points = [i < c] + #{p : i < p}; positions index the gaps between
  // best-first units (cum[b] = songs in units[0..b-1]). Adjacent point tiers
  // therefore differ by exactly 1 by construction. Convert to (ranges, levels).
  const cum = [0];
  for (let b = 0; b < U; b++) cum[b + 1] = cum[b] + units[b].n;
  const buildCurve = (c, promos) => {
    const lvl = new Array(U);
    for (let i = 0; i < U; i++) {
      let v = i < c ? 1 : 0;
      for (const p of promos) if (i < p) v++;
      lvl[i] = v;
    }
    const ranges = [];
    let start = 0;
    for (let i = 1; i <= U; i++) {
      if (i === U || lvl[i] !== lvl[start]) {
        ranges.push([start, i - 1]);
        start = i;
      }
    }
    return { ranges, levels: ranges.map(([lo]) => lvl[lo]) };
  };

  const candidates = [];
  const byVoteKey = new Set();
  const addCurve = (c, promos, left) => {
    const { ranges, levels } = buildCurve(c, promos);
    const cand = evalCandidate(ranges, levels, left, [c, ...promos]);
    if (byVoteKey.has(cand.voteKey)) return;
    byVoteKey.add(cand.voteKey);
    candidates.push(cand);
  };

  // Enumerate every staircase that spends the budget EXACTLY: for each cutoff c
  // (baseline 1 funds cum[c] songs), the promotion budget T = budget − cum[c]
  // must be formed by a distinct subset of {cum[1..c]} of size ≤ cap−1. Choosing
  // boundaries IS the fill — no separate waterfill phase.
  const maxPromos = Number.isFinite(cap) ? Math.max(0, cap - 1) : U;
  let nodes = 0;
  const NODE_CAP = 400000;
  for (let c = 1; c <= U && cum[c] <= budget; c++) {
    const T = budget - cum[c];
    if (T === 0) {
      addCurve(c, [], 0);
      continue;
    }
    const solve = (pos, remaining, chosen) => {
      if (nodes++ > NODE_CAP) return;
      if (remaining === 0) {
        addCurve(c, chosen.slice(), 0);
        return;
      }
      if (pos < 1 || chosen.length >= maxPromos || cum[1] > remaining) return;
      if (cum[pos] <= remaining) {
        chosen.push(pos);
        solve(pos - 1, remaining - cum[pos], chosen);
        chosen.pop();
      }
      solve(pos - 1, remaining, chosen);
    };
    // A promotion at position c lifts every funded unit, dropping the level-1
    // floor; that is only contiguity-safe with no zero tier (c === U). When zeros
    // exist (c < U) the lowest funded unit must stay at 1, so cap promotions at
    // c − 1.
    solve(c < U ? c - 1 : c, T, []);
  }

  // Exception path: no staircase spends the budget exactly (e.g. the budget
  // exceeds total capacity, or is smaller than the top tie group). Build the
  // tallest curve under budget and let phase 3 spill the remainder.
  if (!candidates.length) {
    let c = U;
    while (c >= 1 && cum[c] > budget) c--;
    if (c < 1) {
      addCurve(0, [], budget); // can't fund even the top unit whole
    } else {
      let remaining = budget - cum[c];
      const promos = [];
      for (let p = c < U ? c - 1 : c; p >= 1 && promos.length < maxPromos; p--) {
        if (cum[p] <= remaining) {
          promos.push(p);
          remaining -= cum[p];
        }
      }
      addCurve(c, promos, remaining);
    }
  }

  // Staircases are contiguous + monotonic by construction (violations/splits are
  // 0 for any exact one), so the real preference is: exact over the spill
  // exception; then no arbitrary/forced tie-split; then the FEWEST junk promotions
  // (top-heaviness cap — a tight cluster stays low-topped); then the highest net
  // score (gaps + 80/75 anchors, less the per-promotion height cost); then the
  // SHORTER top (fewer promotion steps) when those tie; then the cleanest break.
  const ordered = [...candidates].sort(
    (a, b) =>
      a.violations - b.violations ||
      a.left - b.left ||
      a.arbitrarySplits - b.arbitrarySplits ||
      a.tieSplits - b.tieSplits ||
      a.junkPromos - b.junkPromos ||
      b.score - a.score ||
      a.K - b.K ||
      b.gvf - a.gvf
  );
  // Two knobs (most specific wins): `bucketCount` forces the number of funded
  // point tiers (promotion steps + 1); `tierCount` forces the number of distinct
  // final point values (including a 0 tier). Pick the best-preference candidate
  // matching the target, nearest achievable if none.
  let chosen = ordered[0];
  if (profile.bucketCount) {
    const want = profile.bucketCount;
    chosen =
      ordered.find((c) => c.K === want) ||
      [...ordered].sort((a, b) => Math.abs(a.K - want) - Math.abs(b.K - want))[0];
  } else if (profile.tierCount) {
    const want = profile.tierCount;
    chosen =
      ordered.find((c) => c.distinct === want) ||
      [...ordered].sort((a, b) => Math.abs(a.distinct - want) - Math.abs(b.distinct - want))[0];
  }

  // When the split is genuinely ambiguous (and not pinned), surface the
  // alternatives as a "needs your call" choice; call out a small range. Dedup on
  // the FINAL point distribution, not the tier count — two clusterings (different
  // bucket counts) that land on the same number of tiers but a different
  // distribution are a real tradeoff and both shown. The value is the bucket count
  // (K) that uniquely reproduces the curve (`--bucket-count`); the label names the
  // tier count and bucket count separately so the two aren't conflated.
  if (!profile.tierCount && !profile.bucketCount) {
    const seen = new Set();
    const distinctCands = [];
    for (const c of [chosen, ...ordered]) {
      if (seen.has(c.voteKey)) continue;
      seen.add(c.voteKey);
      distinctCands.push(c);
    }
    if (distinctCands.length >= 2) {
      const small = spread <= 6;
      const summarize = (c) => c.runs.map((r) => `${r.level}×${r.count}`).join(' / ');
      tradeoffs.push({
        kind: 'tier-structure',
        question: `Which point split?${
          small ? ' Scores are tightly clustered (small range), so this is a judgment call.' : ''
        } Default is ${chosen.distinct} tier${chosen.distinct > 1 ? 's' : ''} (option A); record with just pick <round> <A|B|C> --reason "…" (or just pick <round> A --tier-count <n> / --bucket-count <n> to force a curve).`,
        options: distinctCands.slice(0, 3).map((c) => ({
          label: `${c.distinct} tier${c.distinct > 1 ? 's' : ''} (bucket-count ${c.K}) — ${summarize(c)}`,
          value: c.K,
          tierCount: c.distinct,
          bucketCount: c.K,
          // Vote-count signature (e.g. "2×4 / 1×2 / 0×5") — the part that actually
          // distinguishes two options that share a tier/bucket count, so legends and
          // labels never look identical.
          shape: summarize(c),
          // Per-song votes (best-first / combined order) for the side-by-side
          // comparison table; index-aligned across every option.
          perSong: c.perSong,
          // Structured rows for a points / songs / score-range table (renderer).
          // `scores` lists the precise raw scores (with +/−/? modifiers) in the
          // tier, shown when any are modified.
          tiers: c.runs.map((r) => ({
            points: r.level,
            count: r.count,
            scoreHi: r.hi,
            scoreLo: r.lo,
            scores: r.tokens,
          })),
        })),
      });
    }
  }

  // R2: when the merged ≥80 favorite band is a meaningful share of the funded
  // field, the merge is a real call — surface a top-band-split tradeoff so the
  // owner can break the favorites onto their own gaps (`--no-favorite-band`).
  if (favBandCount > 1) {
    const fundedSongs = chosen.runs.reduce((a, r) => a + (r.level > 0 ? r.count : 0), 0);
    const significant = Math.min(Math.ceil(fundedSongs / 3), 4);
    if (favBandCount >= significant) {
      tradeoffs.push({
        kind: 'top-band-split',
        question: `${favBandCount} favorites (score ≥ ${favMin}) share the top tier. Keep them merged, or split them onto their own score gaps?`,
        options: [
          { label: `Keep the ${favBandCount} favorites together (default)`, value: 0 },
          { label: 'Split the favorites on their own gaps (--no-favorite-band)', value: 1 },
        ],
      });
    }
  }

  const tiers = chosen.tiers;
  let left = chosen.left;
  tiers.forEach((t, ci) => {
    for (const m of t.members) m.finalVotes = chosen.levels[ci];
  });

  // Phase 3 (rare, forced): the bank still has points but no whole-tier step fits
  // (very high points vs. low cap, or an indivisible remainder inside a tie).
  // Spend 1 at a time, best songs first by rank (so the spill stays monotonic) and
  // — within an equal-score unit — by modifier rank, up to the cap. This is the
  // only place an equal-score unit can split, and only because the budget must be
  // spent exactly.
  const orderedMembers = (members) =>
    [...members].sort(
      (a, b) =>
        rankValue(b, profile) - rankValue(a, profile) ||
        tiebreakRank(b) - tiebreakRank(a) ||
        String(a.title).localeCompare(String(b.title))
    );
  if (left > 0) {
    const order = orderedMembers(tiers.flatMap((t) => t.members));
    let placed = true;
    while (left > 0 && placed) {
      placed = false;
      for (const m of order) {
        if (m.finalVotes >= cap) continue;
        m.finalVotes++;
        left--;
        placed = true;
        if (left <= 0) break;
      }
    }
  }

  // An equal-score unit (same tierKey) that ended up split — only possible via the
  // forced phase-3 spill — needs your call when no +/− modifier decides who takes
  // the extra. Splits BETWEEN different scores are legitimate and not surfaced.
  for (const u of units) {
    if (u.members.length < 2) continue;
    const ordered = [...u.members].sort(
      (a, b) => tiebreakRank(b) - tiebreakRank(a) || String(a.title).localeCompare(String(b.title))
    );
    const votes = ordered.map((m) => m.finalVotes);
    const hi = Math.max(...votes);
    const lo = Math.min(...votes);
    if (hi === lo) continue;
    const atHi = votes.filter((v) => v === hi).length;
    const ambiguous =
      ordered[atHi - 1] &&
      ordered[atHi] &&
      tiebreakRank(ordered[atHi - 1]) === tiebreakRank(ordered[atHi]);
    if (ambiguous) {
      tradeoffs.push({
        kind: 'tier-split',
        question: `Tied score ${formatScore(u.value)} can't split its points evenly across ${u.members.length} songs, and no +/− breaks the tie.`,
        options: ordered.map((m) => ({
          label: `${cell(m.title)} — ${m.finalVotes}`,
          value: m.rawOrderIndex,
        })),
      });
    }
  }

  // Pre-allocation floors (the user's own data-weight). If floors exceed
  // budget, surface a tradeoff rather than silently rebalancing.
  const floored = cands.filter((c) => (c.userAllocatedVotes ?? 0) > 0);
  if (floored.length) {
    const floorSum = floored.reduce((a, c) => a + Math.min(c.userAllocatedVotes, cap), 0);
    if (floorSum > budget) {
      tradeoffs.push({
        kind: 'preallocation-overflow',
        question: `Pre-allocated votes (${floorSum}) exceed the budget (${budget}). Lower one of:`,
        options: floored.map((c) => ({
          label: `${cell(c.title)} — pre-allocated ${c.userAllocatedVotes}`,
          value: c.rawOrderIndex,
        })),
      });
    } else {
      for (const c of floored) {
        c.finalVotes = Math.max(c.finalVotes, Math.min(c.userAllocatedVotes, cap));
      }
    }
  }
}

// Flag uncertain (?) songs that sit at a point boundary for review.
function flagUncertainBoundaries(cands, profile) {
  for (const c of cands) {
    if (!c.uncertain || c.needsReview) continue;
    const cv = rankValue(c, profile);
    const atBoundary = cands.some(
      (d) =>
        d !== c && Math.abs(rankValue(d, profile) - cv) <= 0.5 && d.finalVotes !== c.finalVotes
    );
    if (atBoundary) {
      c.needsReview = true;
      c.reviewReason = 'uncertain (?) near a point boundary';
    }
  }
}
