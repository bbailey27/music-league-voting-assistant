// Shared scoring, allocation, and reporting core for all input parsers.
// Re-export barrel — importers keep `from './score-core.mjs'`.

export { cell, formatScore } from './score/format.mjs';
export { FIT_TIER_SCORES, FIT_TIER_ORDER, fitTierForScore } from './score/fit-signal.mjs';
export { scoreComment, tiebreakRank } from './score/comment.mjs';
export {
  rankValue,
  estimateCenter,
  enrichProfileWithBudget,
  allocate,
  ckmeans1dWeighted,
} from './score/allocate.mjs';
export { combinedScore, normalizeCombined, mergeFit, flagMusicLifts } from './score/merge.mjs';
export {
  buildPickRecord,
  mergeFitJson,
  flagsOf,
  formatVoteAllocation,
  rankedSort,
  buildMarkdown,
  buildJsonPayload,
} from './score/render.mjs';
