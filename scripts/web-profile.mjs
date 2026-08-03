// Build explore profile + score overrides from web UI knob values (CLI flag parity).

import {
  enrichProfileWithBudget,
  MANUAL_FIT_WEIGHTS,
  normalizeCombined,
  scoreComment,
} from './score-core.mjs';
import {
  buildGate,
  parseBucketCount,
  parseDownShape,
  parseFavoriteBand,
  parseOptionCount,
  parsePins,
  parseScoreOverrides,
  parseTierCount,
  parseWeights,
  pinCapError,
  pinEligibilityError,
} from './cli-flags.mjs';

function textOrNull(id, $) {
  const v = $(id)?.value?.trim();
  return v || null;
}

function intOrNull(id, $) {
  const v = textOrNull(id, $);
  if (v == null) return null;
  return v;
}

/** Read allocation knob fields from the DOM. */
export function readKnobFields($) {
  const noFav = $('#no-favorite-band')?.checked;
  return {
    rankBy: $('#rankBy')?.value || 'music',
    shape: $('#shape')?.value || 'auto',
    downShape: textOrNull('#down-shape', $) || null,
    weights: textOrNull('#weights', $),
    gate: textOrNull('#gate', $),
    cutoff: textOrNull('#cutoff', $),
    tierCount: intOrNull('#tier-count', $),
    bucketCount: intOrNull('#bucket-count', $),
    optionCount: intOrNull('#option-count', $),
    favoriteBand: noFav ? false : intOrNull('#favorite-band', $),
    pins: textOrNull('#pins', $),
    scoreOverrides: textOrNull('#score-overrides', $),
    fitScoreOverrides: textOrNull('#fit-score-overrides', $),
    pickReason: textOrNull('#pick-reason', $),
  };
}

function applyManualFitScoring(profile, songs, { explicitRank = null, weights = undefined } = {}) {
  const hasManualFit = songs.some(
    (s) => s.fitSource === 'manual' && (s.fitScore != null || s.gate != null)
  );
  if (!hasManualFit) return null;

  if (!profile.gate) {
    const gates = new Set(songs.map((s) => s.gate).filter(Boolean));
    if (gates.size) {
      profile.gate = { type: gates.has('maybe') ? 'passFailMaybe' : 'passFail' };
    }
  }

  const combineWeights = weights ?? MANUAL_FIT_WEIGHTS;
  profile.weights = combineWeights;
  profile.fitTrust = 'manual';
  normalizeCombined(songs, combineWeights, profile.gate, { fitTrust: 'manual' });
  if (!explicitRank) profile.rankBy = 'combined';
  return combineWeights;
}

function applyScoreOverridesToSongs(songs, specs, flag) {
  const overrides = parseScoreOverrides(specs ? [specs] : undefined, flag);
  if (!overrides) return;
  const byIdx = new Map(songs.map((s) => [s.rawOrderIndex, s]));
  for (const ov of overrides) {
    const s = byIdx.get(ov.idx);
    if (!s) throw new Error(`Invalid ${flag} ${ov.idx}:${ov.score} — no song #${ov.idx}.`);
    if (flag === '--fit-score') {
      s.fitScore = ov.score;
    } else {
      s.score = ov.score;
      s.plus = ov.plus;
      s.minus = ov.minus;
      s.uncertain = ov.uncertain;
      s.plusUncertain = ov.plusUncertain;
      s.minusUncertain = ov.minusUncertain;
      s.needsUserInput = false;
    }
  }
}

/**
 * Parse UI knobs into an explore profile; apply score overrides and combined re-blend.
 * @returns {{ profile: object, pickReason: string|null }}
 */
export function prepareRoundForAllocate({ songs, budget, mode, fields, $ }) {
  const f = fields ?? readKnobFields($);
  const gate = buildGate({ gate: f.gate || undefined, cutoff: f.cutoff || undefined });
  const weights = f.weights ? parseWeights(f.weights) : undefined;
  const pins = f.pins ? parsePins([f.pins]) : undefined;
  const tierCount = f.tierCount ? parseTierCount(f.tierCount) : undefined;
  const bucketCount = f.bucketCount ? parseBucketCount(f.bucketCount) : undefined;
  const optionCount = f.optionCount ? parseOptionCount(f.optionCount) : undefined;
  const favoriteBand =
    f.favoriteBand === false ? false : f.favoriteBand ? parseFavoriteBand(f.favoriteBand) : undefined;
  const downShape = f.downShape ? parseDownShape(f.downShape) : undefined;

  if (f.scoreOverrides) applyScoreOverridesToSongs(songs, f.scoreOverrides, '--score');
  if (f.fitScoreOverrides) applyScoreOverridesToSongs(songs, f.fitScoreOverrides, '--fit-score');

  for (const s of songs) {
    if (s.userComment && s.needsUserInput) {
      Object.assign(s, scoreComment(s.userComment, mode));
    }
  }

  const profile = enrichProfileWithBudget(
    {
      shape: f.shape,
      downShape,
      gate,
      weights,
      overrides: pins?.overrides,
      downOverrides: pins?.downOverrides,
      tierCount,
      bucketCount,
      optionCount,
      favoriteBand,
      rankBy: f.rankBy,
    },
    budget
  );

  applyManualFitScoring(profile, songs, { explicitRank: f.rankBy, weights });

  const upCap = budget?.maxUpvotesPerSong ?? Infinity;
  const downCap = budget?.maxDownvotesPerSong ?? Infinity;
  const capErr = pinCapError(profile.overrides, profile.downOverrides, upCap, downCap);
  if (capErr) throw new Error(capErr);
  const pinErr = pinEligibilityError(songs, profile.overrides, profile.downOverrides);
  if (pinErr) throw new Error(pinErr);

  return { profile, pickReason: f.pickReason || null };
}
