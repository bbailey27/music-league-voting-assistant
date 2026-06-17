// Shared scoring, allocation, and reporting core for all input parsers.

// ---------------------------------------------------------------------------
// Small text helpers
// ---------------------------------------------------------------------------

// Collapse whitespace and escape markdown table cells.
export function cell(s, max = 0) {
  let t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (max && t.length > max) t = t.slice(0, max - 1).trimEnd() + '…';
  return t.replace(/\|/g, '\\|');
}

export function formatScore(n) {
  if (n == null) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ---------------------------------------------------------------------------
// Scoring: derive signals from the USER comment only
// ---------------------------------------------------------------------------
export function scoreComment(rawComment, mode) {
  const out = {
    score: null,
    plus: false,
    minus: false,
    uncertain: false,
    playlistAdd: false,
    isDisqualified: false,
    needsUserInput: false,
    needsReview: false,
    reviewReason: '',
    fitScore: null,
    fitTier: null,
    gate: null,
    fitSource: null,
    needsResearch: false,
  };

  const comment = (rawComment ?? '').trim();

  if (comment === '') {
    out.needsUserInput = true; // empty box = accidental skip, prompt for a score
    return out;
  }

  // An all-caps "TODO" marker (usually leading) is a self-reminder that the user
  // hasn't really decided yet, so treat it like a blank box: prompt for a score
  // and don't trust any placeholder number sitting next to it.
  if (/\bTODO\b/.test(comment)) {
    out.needsUserInput = true;
    return out;
  }

  const fit = parseFitTokens(comment);
  const applyFit = () => {
    if (fit.fitScore != null) {
      out.fitScore = fit.fitScore;
      out.fitTier = fit.fitTier;
      out.fitSource = 'manual';
    }
    if (fit.gate) {
      out.gate = fit.gate;
      out.fitSource = out.fitSource || 'manual';
    }
  };

  // First numeric token (optional single decimal) plus any trailing modifiers.
  // Strip explicit fit-number tokens first so "8 fit" isn't read as music 80.
  const musicText = comment
    .replace(/\bfit\s*\d{1,3}(\.\d)?\b/i, ' ')
    .replace(/\b\d{1,3}(\.\d)?\s*fit\b/i, ' ');
  const m = musicText.match(/(\d{1,3})(\.\d)?([+\-?=]*)/);

  if (!m) {
    // No number at all.
    if (/^-+$/.test(comment)) {
      // Bare dash: no real score. Ambiguous on purpose — it can mean a true
      // disqualification, or just "low/unspecified, won't place". Either way it
      // earns no points, so we group it under disqualified.
      out.isDisqualified = true;
    } else if (/\b(invalid|no|nope)\b/i.test(comment)) {
      out.isDisqualified = true; // explicit disqualifying keyword
    } else if (fit.fitScore != null || fit.gate) {
      applyFit(); // words-only but a real manual fit note (e.g. "pass", "strong fit")
    } else if (mode === 'objective') {
      out.isDisqualified = true; // words-only -> disqualified in objective rounds
    } else {
      out.needsReview = true; // subjective: words may carry fit meaning, don't auto-decide
      out.reviewReason = 'words-only comment (subjective mode)';
    }
    return out;
  }

  const intPart = m[1];
  const decPart = m[2]; // e.g. ".5"
  const mods = m[3] || '';

  out.score = scaleScoreToken(intPart, decPart);

  if (mods.includes('+') || mods.includes('=')) out.plus = true; // '=' is a typo for '+'
  if (mods.includes('-')) out.minus = true;
  if (mods.includes('?')) out.uncertain = true;

  // Playlist add: a standalone "play"/"playlist" keyword alongside a score.
  if (/\bplay(list)?\b/i.test(comment)) out.playlistAdd = true;

  applyFit();
  // Thematic rounds: a music score with no fit signal yet means "music known,
  // fit still needs research" — flag it so the LLM prompt picks it up.
  if (mode === 'thematic' && out.fitScore == null && out.gate == null) out.needsResearch = true;

  return out;
}

// Turn a digit token (with optional decimal part) into a 0–100-ish score.
function scaleScoreToken(intPart, decPart) {
  if (decPart) return parseFloat(intPart + decPart); // literal decimal, no scaling
  if (intPart.length === 1) return Number(intPart) * 10; // 7 -> 70
  if (intPart.length === 2) return Number(intPart); // 73 -> 73
  return Number(intPart) / 10; // 755 -> 75.5
}

// Tiebreak rank: playlistAdd >= '+' > plain > '-'. Higher wins.
export function tiebreakRank(s) {
  if (s.playlistAdd) return 3;
  if (s.plus) return 2;
  if (s.minus) return 0;
  return 1;
}

// ---------------------------------------------------------------------------
// Allocation profile + ranking helpers
// ---------------------------------------------------------------------------

// Representative fit score per graded tier. Used to derive a numeric fitScore
// from a bare tier word, and to label a fitScore back into a tier.
export const FIT_TIER_SCORES = {
  excellent: 93,
  strong: 85,
  solid: 72,
  moderate: 52,
  weak: 35,
  nope: 15,
};

const DEFAULT_COMBINED_WEIGHTS = { fit: 0.7, music: 0.3 };

// Graded tiers from best to worst, used to label a fit score back into a word.
export const FIT_TIER_ORDER = ['excellent', 'strong', 'solid', 'moderate', 'weak', 'nope'];

// Snap a numeric fit score to its nearest graded tier word.
export function fitTierForScore(score) {
  if (score == null) return null;
  let best = null;
  for (const tier of FIT_TIER_ORDER) {
    if (best == null || Math.abs(score - FIT_TIER_SCORES[tier]) < Math.abs(score - FIT_TIER_SCORES[best])) {
      best = tier;
    }
  }
  return best;
}

// Controlled vocabulary for manual fit notation. Tier words are only honored
// when the comment is "armed" with the literal word `fit`, so ordinary prose
// like "solid track" is never mistaken for a fit grade.
const FIT_TIER_SYNONYMS = [
  ['excellent', /\b(excellent|perfect|ideal|on the nose|spot[- ]?on)\b/i],
  ['strong', /\b(strong|great)\b/i],
  ['solid', /\b(solid|good|clearly|on[- ]?theme)\b/i],
  ['moderate', /\b(moderate|okay|ok|loose|partial)\b/i],
  ['weak', /\b(weak|single keyword|tenuous|barely)\b/i],
];

// Pass / maybe / fail flags, checked independently of the tier. fail > maybe >
// pass when more than one is present.
const GATE_WORDS = [
  ['fail', /\b(fail|fails|off[- ]?theme|invalid)\b/i],
  ['maybe', /\b(maybe|questionable|borderline|iffy|stretch)\b/i],
  ['pass', /\b(pass|passes|qualifies|valid|fits|on[- ]?theme)\b/i],
];

// Extract a manual fit signal from a comment: an explicit fit score
// ("8 fit", "85 fit", or reverse "fit 8"), a tier word, and/or a gate flag.
function parseFitTokens(comment) {
  const out = { fitScore: null, fitTier: null, gate: null };
  if (!comment) return out;

  const num =
    comment.match(/\bfit\s*(\d{1,3})(\.\d)?\b/i) ||
    comment.match(/\b(\d{1,3})(\.\d)?\s*fit\b/i);
  if (num) {
    const int = num[1];
    const dec = num[2];
    out.fitScore = scaleScoreToken(int, dec);
  }

  const armed = /\bfit\b/i.test(comment) || /\bfit\d/i.test(comment);
  if (out.fitScore == null && armed) {
    for (const [tier, re] of FIT_TIER_SYNONYMS) {
      if (re.test(comment)) {
        out.fitTier = tier;
        out.fitScore = FIT_TIER_SCORES[tier];
        break;
      }
    }
  }
  if (out.fitScore != null && out.fitTier == null) out.fitTier = fitTierForScore(out.fitScore);

  for (const [gate, re] of GATE_WORDS) {
    if (re.test(comment)) {
      out.gate = gate;
      break;
    }
  }
  return out;
}

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

// One continuous rank order: top slice → upvote tiers, bottom slice → downvote
// tiers, middle → neither. Disjoint by construction.
function spectrumTargets(songs, profile, upBudget, upCap, downBudget, downCap) {
  const eligible = songs.filter((s) => !s.needsUserInput).sort(rankSort(profile));
  const n = eligible.length;
  const allUp = new Set(eligible);
  if (!n || !(downBudget > 0)) return { upSet: allUp, downSet: new Set() };

  let downCount = Math.min(n, Math.max(1, Math.ceil(downBudget / Math.max(1, downCap))));
  let upCount = Math.min(
    n - downCount,
    Math.max(1, Math.ceil(upBudget / Math.max(1, upCap)))
  );
  while (upCount + downCount > n) {
    if (upCount >= downCount) upCount--;
    else downCount--;
  }
  while (upCount * upCap < upBudget && upCount + downCount < n) upCount++;
  while (downCount * downCap < downBudget && upCount + downCount < n) downCount++;
  while (upCount + downCount > n) {
    if (upCount >= downCount) upCount--;
    else downCount--;
  }
  if (upCount < 1 && upBudget > 0) upCount = 1;
  if (downCount < 1 && downBudget > 0) downCount = 1;
  while (upCount + downCount > n) {
    if (upCount >= downCount) upCount--;
    else downCount--;
  }

  const upSlice = eligible.slice(0, upCount);
  const downSlice = eligible.slice(n - downCount);
  const upSet = new Set(upSlice);
  const downSet = new Set(downSlice.filter((s) => !upSet.has(s)));
  return { upSet, downSet };
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
  const { upSet, downSet } = spectrumTargets(songs, profile, budget, cap, downBudget, downCap);

  const scored = songs.filter(
    (s) =>
      upSet.has(s) &&
      rankValue(s, profile) != null &&
      !s.isDisqualified &&
      !s.needsUserInput
  );
  if (!scored.length || budget <= 0) {
    finishDownvotes(songs, profile, tradeoffs, downSet);
    return { candidates: [], tradeoffs };
  }

  // Manual overrides pin a song's votes; the remaining budget is shaped around
  // them. This is also how the web re-runs allocation after a tradeoff pick.
  const overrides = profile.overrides || {};
  const pinned = scored.filter((s) => Number.isFinite(overrides[s.rawOrderIndex]));
  for (const s of pinned) s.finalVotes = Math.max(0, Math.min(overrides[s.rawOrderIndex], cap));
  const pinnedTotal = pinned.reduce((a, s) => a + s.finalVotes, 0);
  budget = Math.max(0, budget - pinnedTotal);
  const open = pinned.length ? scored.filter((s) => !pinned.includes(s)) : scored;
  if (!open.length || budget <= 0) {
    spillRemainder(songs, totalBudget, cap, profile, tradeoffs, new Set(scored), upSet);
    flagUncertainBoundaries(scored, profile);
    finishDownvotes(songs, profile, tradeoffs, downSet);
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
  finishDownvotes(songs, profile, tradeoffs, downSet);
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

function allocateDownvotes(songs, budget, cap, profile, tradeoffs, downSet) {
  const totalBudget = budget;
  const pool = songs.filter((s) => downSet.has(s) && downEligible(s));
  if (!pool.length || budget <= 0) {
    spillDownRemainder(songs, totalBudget, cap, profile, tradeoffs, new Set(), downSet);
    return;
  }

  const shape = profile.shape || 'auto';
  if (shape === 'relative') {
    allocateRelativeDown(pool, budget, cap, profile);
  } else {
    allocateBellDown(pool, budget, cap, shape, profile, tradeoffs, songs);
  }
  spillDownRemainder(songs, totalBudget, cap, profile, tradeoffs, new Set(pool), downSet);
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
  const values = ranked.map((c) => rankValue(c, profile) ?? -Infinity);
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
          label: `${cell(m.title)} — ${m.finalDownvotes}`,
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

  // Cap-bound: relax cap on worst songs in the down slice (still disjoint from upvotes).
  if (remaining > 0) {
    const order = [...downSet].filter(downEligible).sort(byWorst);
    let j = 0;
    while (remaining > 0 && order.length) {
      order[j % order.length].finalDownvotes = (order[j % order.length].finalDownvotes || 0) + 1;
      remaining--;
      j++;
      if (j > order.length * cap * 4) break;
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

// Budget must be spent exactly. If per-song caps left points unspent among the
// chosen songs, spill the remainder onto the next-best songs as a last resort —
// the best chosen songs first, then gated-out/below-cutoff, disqualified last —
// so the votes always total the budget, and flag when we had to dip into the
// gated/invalid pool. Round-robin within each pool keeps tied songs ≤1 apart.
function spillRemainder(songs, totalBudget, cap, profile, tradeoffs, chosen, upSet = null) {
  const allocated = () => songs.reduce((a, s) => a + (s.finalVotes || 0), 0);
  let remaining = totalBudget - allocated();
  if (remaining <= 0) return;

  const rank = (s) => rankValue(s, profile) ?? -Infinity;
  const byRank = (a, b) => rank(b) - rank(a) || tiebreakRank(b) - tiebreakRank(a);
  const inUpPool = (s) => (upSet ? upSet.has(s) : true) && (s.finalDownvotes || 0) === 0;
  const pools = [
    [...chosen].filter((s) => inUpPool(s) && s.finalVotes < cap).sort(byRank),
    songs
      .filter(
        (s) =>
          inUpPool(s) &&
          !chosen.has(s) &&
          !s.isDisqualified &&
          !s.needsUserInput &&
          rankValue(s, profile) != null
      )
      .sort(byRank),
  ];
  // Last resort when downvotes reserve the bottom slice: spill only within upSet.
  if (upSet && profile.downvotesEnabled) {
    pools.push(
      songs
        .filter(
          (s) =>
            upSet.has(s) &&
            inUpPool(s) &&
            !s.needsUserInput &&
            rankValue(s, profile) != null
        )
        .sort(byRank)
    );
  } else {
    pools.push(
      songs
        .filter(
          (s) =>
            !chosen.has(s) &&
            !s.isDisqualified &&
            !s.needsUserInput &&
            rankValue(s, profile) != null
        )
        .sort(byRank),
      songs.filter((s) => s.isDisqualified).sort(byRank)
    );
  }

  let spilledOutside = 0;
  for (let i = 0; i < pools.length && remaining > 0; i++) {
    let progress = true;
    while (remaining > 0 && progress) {
      progress = false;
      for (const s of pools[i]) {
        if (s.finalVotes >= cap) continue;
        s.finalVotes++;
        remaining--;
        progress = true;
        if (i > 0) spilledOutside++;
        if (remaining <= 0) break;
      }
    }
  }

  if (spilledOutside > 0) {
    tradeoffs.push({
      kind: 'forced-spill',
      question: `Awarded ${spilledOutside} leftover point(s) to gated-out/invalid songs so the votes total the budget (${totalBudget}). Reassign if you'd rather place them elsewhere.`,
      options: [],
    });
  }

  // Cap-bound: relax cap on best songs in the up slice so the bank is spent exactly.
  if (remaining > 0 && upSet) {
    const order = [...upSet]
      .filter((s) => (s.finalDownvotes || 0) === 0 && !s.needsUserInput)
      .sort(byRank);
    let j = 0;
    while (remaining > 0 && order.length) {
      order[j % order.length].finalVotes++;
      remaining--;
      j++;
      if (j > order.length * cap * 4) break;
    }
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
  const rawToken = (m) =>
    `${formatScore(m.score)}${m.plus ? '+' : ''}${m.minus ? '-' : ''}${m.uncertain ? '?' : ''}`;
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
        } Default is ${chosen.distinct} tier${chosen.distinct > 1 ? 's' : ''} (option A); pick another with --option <A|B|C> (or --tier-count <n> / --bucket-count <n>).`,
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

// ---------------------------------------------------------------------------
// Fit + music merge
// ---------------------------------------------------------------------------

// The weighted music+fit blend for a song (null when neither axis exists).
export function combinedScore(s, weights = DEFAULT_COMBINED_WEIGHTS) {
  if (s.fitScore == null && s.score == null) return null;
  if (s.fitScore == null) return s.score;
  if (s.score == null) return s.fitScore;
  return weights.fit * s.fitScore + weights.music * s.score;
}

const normTitle = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
const GATE_WORD_SET = new Set(['pass', 'maybe', 'fail']);

// ---------------------------------------------------------------------------
// Per-round combined-score normalization
//
// Problem: fit and music live on different *spreads*, not just different weights.
// Fit (a made-up 0–100 AI number) ranges far wider than music, so the raw blend
// `0.7·fit + 0.3·music` lets a barely-meaningful 8-point fit gap dwarf a decisive
// 1-point music gap — the opposite of what the weights imply.
//
// Fix: z-score each axis over the *contenders* (the songs eligible for points —
// not DQ'd, not blank, not gated out), so the weights act on comparable scales,
// then remap the blend back onto a 75-centered, music-like display scale.
//
// The trick is asymmetric trust, expressed as different std FLOORS:
//   - music floor LOW  → music adapts to the round; a tight music field amplifies
//     half-points and +/- exactly as the owner wants.
//   - fit floor HIGH   → fit rides an effectively FIXED, dampened scale; a tight
//     good-fit cluster stays ~equal (never amplified), since the AI fit numbers
//     aren't precise enough to earn a wide spread. Fit only "adapts" when its real
//     spread exceeds the floor (a genuinely excellent-to-weak field).
// ---------------------------------------------------------------------------

// A `+`/`-` modifier folded into the numeric music value *before* normalizing, so
// in a tight round (small music std) it becomes a real fraction of a std — and in a
// wide round it stays negligible. Kept below 0.5 so `74+` never collides with a
// real `74.5`.
const MODIFIER_MUSIC_DELTA = 0.34;
// Std floors per the asymmetric-trust design above.
const MUSIC_STD_FLOOR = 2;
const FIT_STD_FLOOR = 14;
// Display remap: average contender → COMBINED_DISPLAY_CENTER (75, the "actively
// like" anchor), and 1 blended std → COMBINED_DISPLAY_SD points, so a clearly
// above-average song lands near/over the 80 favorite anchor. This keeps the
// allocator's gap/75-80-anchor/favorite-band machinery valid unchanged.
const COMBINED_DISPLAY_CENTER = 75;
const COMBINED_DISPLAY_SD = 10;
// Below this many contenders a per-round mean/std is noise; fall back to fixed
// reference anchors (still floored) so a tiny field gets stable, dampened blending
// rather than a curve fit to 2–3 points.
const MIN_NORM_CONTENDERS = 4;
const FIT_REF_MEAN = 72; // ~solid tier
const MUSIC_REF_MEAN = 73;

// Music score with the +/- modifier folded in (combined-mode ranking/tiering only;
// music-only rounds keep +/- as pure tiebreaks). Null when there is no music score.
function effectiveMusic(s) {
  if (s.score == null) return null;
  let v = s.score;
  if (s.plus) v += MODIFIER_MUSIC_DELTA;
  if (s.minus) v -= MODIFIER_MUSIC_DELTA;
  return v;
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stddev(xs, mu) {
  if (xs.length < 2) return 0;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mu) * (b - mu), 0) / xs.length);
}

// A contender = a song eligible to earn points, whose scores should shape the
// curve. Mirrors the allocator's exclusions: DQ'd (`-`) and blank songs are out,
// and the gate's terrible-fit/fail outliers are out (a fit cutoff is the fit-side
// analogue of the owner's `-` music DQ — it removes the bad ones so the std
// represents variation among the real contenders).
function isContender(s, gate) {
  if (s.isDisqualified || s.needsUserInput) return false;
  if (!gate) return true;
  if (gate.type === 'cutoff') {
    const v = gate.axis === 'fit' ? s.fitScore : s.score;
    return v != null && v >= gate.min;
  }
  const g = s.gate || (GATE_WORD_SET.has(String(s.fitTier || '').toLowerCase()) ? String(s.fitTier).toLowerCase() : null);
  return g !== 'fail';
}

// Set `combinedScore` on every song to the normalized, remapped blend. Songs with
// only one axis fall back to that axis's raw score (kept clean for display).
export function normalizeCombined(songs, weights = DEFAULT_COMBINED_WEIGHTS, gate = null) {
  const contenders = songs.filter((s) => isContender(s, gate));
  const fitVals = contenders.map((s) => s.fitScore).filter((v) => v != null);
  const musicVals = contenders.map((s) => effectiveMusic(s)).filter((v) => v != null);
  const smallN = contenders.length < MIN_NORM_CONTENDERS;

  const fitMean = smallN || !fitVals.length ? FIT_REF_MEAN : mean(fitVals);
  const musicMean = smallN || !musicVals.length ? MUSIC_REF_MEAN : mean(musicVals);
  const fitDenom = Math.max(FIT_STD_FLOOR, smallN || !fitVals.length ? 0 : stddev(fitVals, fitMean));
  const musicDenom = Math.max(MUSIC_STD_FLOOR, smallN || !musicVals.length ? 0 : stddev(musicVals, musicMean));

  for (const s of songs) {
    const fit = s.fitScore;
    const music = effectiveMusic(s);
    // fitNorm / musicNorm are each axis z-scored over the contenders and remapped
    // onto the SAME 75-centered display scale as combinedScore. Because the weights
    // sum to 1, combinedScore === w.fit·fitNorm + w.music·musicNorm exactly — so
    // these two numbers explain every jump (a low-fit / high-music song shows a low
    // fitNorm and a high musicNorm). Null when that axis is absent.
    s.fitNorm = null;
    s.musicNorm = null;
    if (fit == null && music == null) {
      s.combinedScore = null;
    } else if (fit == null) {
      s.combinedScore = s.score; // music-only: clean raw score (no modifier delta)
    } else if (music == null) {
      s.combinedScore = fit;
    } else {
      const zFit = (fit - fitMean) / fitDenom;
      const zMusic = (music - musicMean) / musicDenom;
      s.fitNorm = COMBINED_DISPLAY_CENTER + zFit * COMBINED_DISPLAY_SD;
      s.musicNorm = COMBINED_DISPLAY_CENTER + zMusic * COMBINED_DISPLAY_SD;
      const blend = weights.fit * zFit + weights.music * zMusic;
      s.combinedScore = COMBINED_DISPLAY_CENTER + blend * COMBINED_DISPLAY_SD;
    }
  }
  return songs;
}

// Merge an LLM fit JSON's songs into the parsed round songs, joining by
// rawOrderIndex (then title). Manual fit signals win; the LLM fills only
// fit-silent songs. Context fields (themes/rationale/…) are carried for
// rendering but never override scoring. Sets combinedScore on every song.
export function mergeFit(songs, fitSongs, { weights = DEFAULT_COMBINED_WEIGHTS, gate = null } = {}) {
  const byIndex = new Map();
  const byTitle = new Map();
  for (const f of fitSongs || []) {
    if (f.rawOrderIndex != null) byIndex.set(f.rawOrderIndex, f);
    if (f.title) byTitle.set(normTitle(f.title), f);
  }
  for (const s of songs) {
    const f = byIndex.get(s.rawOrderIndex) ?? byTitle.get(normTitle(s.title));
    if (f) {
      const hasManualFit = s.fitSource === 'manual' && (s.fitScore != null || s.gate != null);
      if (!hasManualFit) {
        const tierWord = String(f.fitTier || '').toLowerCase();
        if (f.fitScore != null) s.fitScore = f.fitScore;
        if (f.fitTier != null && !GATE_WORD_SET.has(tierWord)) s.fitTier = f.fitTier;
        const gate = f.gate ?? (GATE_WORD_SET.has(tierWord) ? tierWord : null);
        if (gate) s.gate = gate;
        if (s.fitScore != null && s.fitTier == null) s.fitTier = fitTierForScore(s.fitScore);
        if (s.fitScore != null || s.gate != null) s.fitSource = 'llm';
      }
      for (const k of ['themesHit', 'rationale', 'confidence', 'flags', 'basis', 'submitterAssist']) {
        if (f[k] != null && s[k] == null) s[k] = f[k];
      }
    }
  }
  // Combined scores are a per-round normalization, so they must be set in one pass
  // over the whole field (not song-by-song) once fit is merged in.
  normalizeCombined(songs, weights, gate);
  flagMusicLifts(songs);
  return songs;
}

// Build a durable "pick record" once the owner chooses a distribution option: the
// chosen option, every option that was on the table (slimmed for the report + the
// training log), any manual tweaks (final votes that deviate from the chosen
// option's canonical distribution, e.g. an extra --pin), and an optional reason.
// Pure — IO (scores.json / picks.jsonl) lives in the CLI. `options` are the
// tier-structure tradeoff options (each with `perSong`); `songs` is the allocated
// field after the pick is applied.
export function buildPickRecord({ options, chosenIndex, songs, reason = null, pickedAt = new Date().toISOString() }) {
  const letter = (i) => String.fromCharCode(65 + i);
  const chosen = options[chosenIndex];
  if (!chosen) return null;
  const finalByIdx = new Map(songs.map((s) => [s.rawOrderIndex, s.finalVotes ?? 0]));
  const tweaks = [];
  for (const ps of chosen.perSong) {
    const fin = finalByIdx.get(ps.rawOrderIndex) ?? 0;
    if (fin !== ps.votes) {
      tweaks.push({ rawOrderIndex: ps.rawOrderIndex, title: ps.title, from: ps.votes, to: fin });
    }
  }
  return {
    chosen: letter(chosenIndex),
    chosenIndex,
    tierCount: chosen.tierCount,
    shape: chosen.shape,
    reason: reason || null,
    pickedAt,
    tweaks,
    options: options.map((o, i) => ({
      letter: letter(i),
      tierCount: o.tierCount,
      bucketCount: o.bucketCount,
      shape: o.shape,
      isChosen: i === chosenIndex,
      perSong: (o.perSong || []).map((s) => ({
        rawOrderIndex: s.rawOrderIndex,
        title: s.title,
        score: s.score ?? s.rank ?? null,
        votes: s.votes,
      })),
    })),
  };
}

// Flag songs whose combined rank sits ABOVE a song with a strictly better fit
// tier — i.e. music (not fit) carried them past it. This is surfaced as a
// "music-lifted" callout rather than silently reordering: the user can promote or
// adjust by hand. Names the best-fit song that was leapfrogged. Sets `s.musicLift`
// to `{ overTitle, overTier }` or `null`.
export function flagMusicLifts(songs) {
  for (const s of songs) s.musicLift = null;
  const tierIdx = (t) => {
    const i = FIT_TIER_ORDER.indexOf(String(t || '').toLowerCase());
    return i === -1 ? FIT_TIER_ORDER.length : i; // smaller = better fit
  };
  const ranked = songs
    .filter((s) => s.combinedScore != null && s.fitTier && !s.isDisqualified)
    .sort((a, b) => b.combinedScore - a.combinedScore);
  for (let i = 0; i < ranked.length; i++) {
    const x = ranked[i];
    const xi = tierIdx(x.fitTier);
    let best = null;
    for (let j = i + 1; j < ranked.length; j++) {
      const y = ranked[j];
      const yi = tierIdx(y.fitTier);
      if (yi >= xi) continue; // y is not a better fit tier
      if (
        best == null ||
        yi < tierIdx(best.fitTier) ||
        (yi === tierIdx(best.fitTier) && (y.fitScore ?? 0) > (best.fitScore ?? 0))
      ) {
        best = y;
      }
    }
    if (best) x.musicLift = { overTitle: best.title, overTier: best.fitTier };
  }
  return songs;
}

// Full merge + allocate pass for the fit-research flow: join fit into the
// parsed round, run the profile allocator, and write the results back into the
// fit JSON (draftVotes/musicScore/combinedScore) so render-fit-html shows the
// vote-transfer table. Returns { fitData, songs, tradeoffs }.
export function mergeFitJson(parsed, fitData, profile = {}) {
  const weights = profile.weights || DEFAULT_COMBINED_WEIGHTS;
  const rankBy = profile.rankBy || 'combined';
  mergeFit(parsed.songs, fitData.songs || [], { weights, gate: profile.gate });

  const { tradeoffs } = allocate(
    parsed.songs,
    parsed.budget?.upvoteBankSize ?? 0,
    parsed.budget?.maxUpvotesPerSong ?? Infinity,
    enrichProfileWithBudget({ ...profile, rankBy, weights }, parsed.budget)
  );

  const byIndex = new Map(parsed.songs.map((s) => [s.rawOrderIndex, s]));
  const byTitle = new Map(parsed.songs.map((s) => [normTitle(s.title), s]));
  for (const f of fitData.songs || []) {
    const s = byIndex.get(f.rawOrderIndex) ?? byTitle.get(normTitle(f.title));
    if (!s) continue;
    f.musicScore = s.score ?? null;
    if (s.userComment && f.musicComment == null) f.musicComment = s.userComment;
    f.combinedScore = s.combinedScore ?? null;
    // Normalized per-axis values (display scale) so the report can show why a song
    // landed where it did: combined = w.fit·fitNorm + w.music·musicNorm.
    f.fitNorm = s.fitNorm ?? null;
    f.musicNorm = s.musicNorm ?? null;
    f.musicLift = s.musicLift ?? null;
    f.draftVotes = s.finalVotes ?? 0;
    f.draftDownvotes = s.finalDownvotes ?? 0;
  }
  fitData.combineWeights = weights;
  // Persist the allocator's "needs your call" tradeoffs onto the merged JSON so the
  // scores.html deliverable can render the distribution options as a comparison
  // table (the fit-only source file stays untouched).
  fitData.tradeoffs = tradeoffs;
  // Carry the owner's own (unvotable) submissions so the raw-order ballot can show
  // every submission slot — a hidden gap risks a misaligned ballot in the app.
  fitData.ownSongs = (parsed.ownSongs || []).map((s) => ({
    rawOrderIndex: s.rawOrderIndex,
    title: s.title,
    artist: s.artist,
    isOwn: true,
  }));
  return { fitData, songs: parsed.songs, tradeoffs };
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------
export function flagsOf(s) {
  const f = [];
  if (s.plus) f.push('+');
  if (s.minus) f.push('-');
  if (s.uncertain) f.push('?');
  if (s.playlistAdd) f.push('play');
  if (s.needsReview) f.push('review');
  return f.join(' ');
}

// Upvotes and downvotes are disjoint; downvotes render with a leading minus.
export function formatVoteAllocation(s) {
  const up = s.finalVotes || 0;
  const down = s.finalDownvotes || 0;
  if (up && down) return `${up}/-${down} ⚠`;
  if (down) return `-${down}`;
  return String(up);
}

export function rankedSort(a, b) {
  return (
    b.score - a.score ||
    tiebreakRank(b) - tiebreakRank(a) ||
    a.title.localeCompare(b.title)
  );
}

// Emit a markdown table with cells padded to even column widths so the raw
// source is skimmable. `aligns` is 'right' | 'left' per column.
function renderTable(L, headers, aligns, rows, indent = '') {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length))
  );
  const cell = (s, i) => {
    const v = String(s ?? '');
    return aligns[i] === 'right' ? v.padStart(widths[i]) : v.padEnd(widths[i]);
  };
  const sep = widths.map((w, i) =>
    aligns[i] === 'right' ? `${'-'.repeat(w - 1)}:` : `:${'-'.repeat(w - 1)}`
  );
  L.push(`${indent}| ${headers.map(cell).join(' | ')} |`);
  L.push(`${indent}| ${sep.join(' | ')} |`);
  for (const r of rows) L.push(`${indent}| ${r.map(cell).join(' | ')} |`);
}

// Render a tier-structure tradeoff as ONE side-by-side comparison table: songs
// (in combined/rank order) are rows, options are columns (A = default), and each
// cell is the votes that option gives the song. This reads as a direct
// "what changes between options" diff instead of three separate per-option blocks.
const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
function renderTierStructure(L, t) {
  const opts = (t.options || []).filter((o) => Array.isArray(o.perSong) && o.perSong.length);
  if (!opts.length) {
    for (const o of t.options || []) L.push(`  - ${o.label ?? o}`);
    L.push('');
    return;
  }
  const rows0 = opts[0].perSong; // index-aligned across every option
  const trunc = (s) => (String(s).length > 30 ? `${String(s).slice(0, 29)}…` : String(s));
  const headers = ['#', 'Song', 'Score', ...opts.map((_, i) => OPTION_LETTERS[i])];
  const aligns = ['right', 'left', 'right', ...opts.map(() => 'right')];
  const rows = rows0.map((r, ri) => [
    String(r.rawOrderIndex),
    trunc(r.title),
    formatScore(r.score ?? r.rank),
    ...opts.map((o) => String(o.perSong[ri]?.votes ?? 0)),
  ]);
  rows.push([
    '',
    'Total',
    '',
    ...opts.map((o) => String(o.perSong.reduce((a, s) => a + (s.votes || 0), 0))),
  ]);
  L.push('');
  renderTable(L, headers, aligns, rows, '  ');
  L.push('');
  opts.forEach((o, i) => {
    L.push(
      `  - **${OPTION_LETTERS[i]}**${i === 0 ? ' (default)' : ''} — ${o.tierCount} tier${
        o.tierCount === 1 ? '' : 's'
      }, \`${o.shape ?? `bucket-count ${o.bucketCount}`}\`, \`--option ${OPTION_LETTERS[i]}\``
    );
  });
  L.push('');
}

export function buildMarkdown({ round, budget, songs, totalSongs, ownSkipped, mode, tradeoffs, ownSongs = [] }) {
  const scored = songs.filter((s) => s.score != null).sort(rankedSort);
  const disqualified = songs.filter((s) => s.isDisqualified);
  const needsInput = songs.filter((s) => s.needsUserInput);
  const needsReview = songs.filter((s) => s.needsReview);
  const allocated = songs.reduce((a, s) => a + (s.finalVotes || 0), 0);
  const downAllocated = songs.reduce((a, s) => a + (s.finalDownvotes || 0), 0);

  const L = [];
  L.push(`# ${round.prompt || round.title || 'Round'} — draft votes`);
  L.push('');
  if (round.description) {
    L.push('## Round description');
    L.push('');
    L.push(round.description);
    L.push('');
  }
  L.push(`- League: ${round.league ?? 'n/a'}`);
  L.push(`- Mode: \`${mode}\``);
  L.push(
    `- Budget: ${budget.upvoteBankSize ?? '?'} upvotes, max ${
      budget.maxUpvotesPerSong ?? '?'
    } per song` +
      (budget.downvotesEnabled
        ? `, downvotes ON (${budget.downvoteBankSize}, max ${budget.maxDownvotesPerSong ?? '?'} per song)`
        : ', downvotes off')
  );
  L.push(
    `- Allocated: **${allocated} / ${budget.upvoteBankSize ?? '?'}** up` +
      (budget.downvotesEnabled
        ? `, **${downAllocated} / ${budget.downvoteBankSize ?? '?'}** down`
        : '') +
      (allocated !== budget.upvoteBankSize ||
      (budget.downvotesEnabled && downAllocated !== budget.downvoteBankSize)
        ? ' ⚠️ (does not match budget — rebalance)'
        : '')
  );
  L.push(
    `- Songs: ${totalSongs} total, ${ownSkipped} own (skipped), ${scored.length} scored, ${disqualified.length} disqualified, ${needsInput.length} need a score, ${needsReview.length} need review`
  );
  L.push('');

  // Ranked table
  L.push('## Ranked (by score)');
  L.push('');
  L.push('| # | Title | Artist | Score | Votes | Flags | Comment |');
  L.push('|---|---|---|---|---|---|---|');
  scored.forEach((s, i) => {
    L.push(
      `| ${i + 1} | ${cell(s.title)} | ${cell(s.artist)} | ${formatScore(
        s.score
      )} | ${formatVoteAllocation(s)} | ${cell(flagsOf(s))} | ${cell(s.userComment, 160)} |`
    );
  });
  L.push('');

  // Slim raw-order table
  L.push('## Raw order (for entering votes)');
  L.push('');
  L.push('| Order | Title | Votes | My score |');
  L.push('|---|---|---|---|');
  // Interleave the user's own (unscored) submission so every raw index is present —
  // the user enters votes by position, so a hidden gap risks a misaligned ballot.
  const rawOrderRows = [...songs, ...ownSongs].sort((a, b) => a.rawOrderIndex - b.rawOrderIndex);
  for (const s of rawOrderRows) {
    if (s.isOwn) {
      L.push(`| ${s.rawOrderIndex} | ${cell(s.title)} | — | (your song — not scored) |`);
      continue;
    }
    let raw;
    if (s.score != null) raw = formatScore(s.score) + (flagsOf(s) ? ' ' + flagsOf(s) : '');
    else if (s.needsUserInput) raw = '(needs score)';
    else if (s.isDisqualified) raw = '(disqualified)';
    else if (s.needsReview) raw = '(review)';
    else raw = '';
    L.push(`| ${s.rawOrderIndex} | ${cell(s.title)} | ${formatVoteAllocation(s)} | ${cell(raw)} |`);
  }
  L.push('');

  // Flag lists
  if (needsInput.length) {
    L.push('## Needs my score (blank boxes)');
    L.push('');
    for (const s of needsInput) L.push(`- ${cell(s.title)} — ${cell(s.artist)}`);
    L.push('');
  }
  if (disqualified.length) {
    L.push('## Disqualified (no points — true DQ or unscored low)');
    L.push('');
    for (const s of disqualified)
      L.push(`- ${cell(s.title)} — ${cell(s.artist)}${s.userComment ? ` ("${cell(s.userComment, 80)}")` : ''}`);
    L.push('');
  }
  if (needsReview.length) {
    L.push('## Needs review');
    L.push('');
    for (const s of needsReview)
      L.push(`- ${cell(s.title)} — ${cell(s.artist)} — ${cell(s.reviewReason)}${s.userComment ? ` ("${cell(s.userComment, 80)}")` : ''}`);
    L.push('');
  }

  if (Array.isArray(tradeoffs) && tradeoffs.length) {
    L.push('## Needs your call (tradeoffs)');
    L.push('');
    for (const t of tradeoffs) {
      L.push(`- ${cell(t.question)}`);
      if (t.kind === 'tier-structure') renderTierStructure(L, t);
      else for (const o of t.options || []) L.push(`  - ${cell(o.label)}`);
    }
    L.push('');
  }

  L.push('---');
  L.push('Draft allocation — rebalance as needed. Tiers are relative to this round only.');
  L.push('');
  return L.join('\n');
}

export function buildJsonPayload({ round, budget, songs, totalSongs, ownSkipped, mode, tradeoffs, ownSongs = [] }) {
  return {
    round,
    mode,
    budget,
    totals: {
      totalSongs,
      ownSkipped,
      allocated: songs.reduce((a, s) => a + (s.finalVotes || 0), 0),
      downAllocated: songs.reduce((a, s) => a + (s.finalDownvotes || 0), 0),
    },
    ownSongs: ownSongs.map((s) => ({
      rawOrderIndex: s.rawOrderIndex,
      title: s.title,
      artist: s.artist,
      isOwn: true,
    })),
    tradeoffs: Array.isArray(tradeoffs) ? tradeoffs : [],
    songs: songs.map((s) => ({
      rawOrderIndex: s.rawOrderIndex,
      title: s.title,
      artist: s.artist,
      album: s.album,
      userAllocatedVotes: s.userAllocatedVotes,
      userComment: s.userComment,
      submitterComment: s.submitterComment,
      spotifyUri: s.spotifyUri,
      score: s.score,
      plus: s.plus,
      minus: s.minus,
      uncertain: s.uncertain,
      playlistAdd: s.playlistAdd,
      isDisqualified: s.isDisqualified,
      needsUserInput: s.needsUserInput,
      needsReview: s.needsReview,
      needsResearch: s.needsResearch ?? false,
      reviewReason: s.reviewReason,
      finalVotes: s.finalVotes,
      finalDownvotes: s.finalDownvotes ?? 0,
    })),
  };
}
