// Fit tier vocabulary and combined-score weights.

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

export const DEFAULT_COMBINED_WEIGHTS = { fit: 0.7, music: 0.3 };

// Balanced blend when the owner typed manual fit scores in comments (distinct from
// the LLM thematic default above).
export const MANUAL_FIT_WEIGHTS = { fit: 0.5, music: 0.5 };

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

export const GATE_WORD_SET = new Set(['pass', 'maybe', 'fail']);
