// Shared scoring, allocation, and reporting core for all input parsers.
// Re-export barrel — importers keep `from './score-core.mjs'`.

export { cell, formatScore } from './score/format.mjs';
export { FIT_TIER_SCORES, FIT_TIER_ORDER, fitTierForScore, MANUAL_FIT_WEIGHTS } from './score/fit-signal.mjs';
export {
  scoreComment,
  tiebreakRank,
  formatMusicModifierFlags,
  applyNumericFitAutoDetect,
  NUMERIC_FIT_MIN_RATIO,
} from './score/comment.mjs';
export {
  rankValue,
  estimateCenter,
  enrichProfileWithBudget,
  allocate,
  ckmeans1dWeighted,
  normalizeDownShape,
} from './score/allocate.mjs';
export { combinedScore, normalizeCombined, mergeFit, flagMusicLifts, resolveFitTrust } from './score/merge.mjs';
export {
  buildPickRecord,
  mergeFitJson,
  flagsOf,
  formatVoteAllocation,
  rankedSort,
  buildMarkdown,
  buildJsonPayload,
  OPTION_LETTERS,
} from './score/render.mjs';
