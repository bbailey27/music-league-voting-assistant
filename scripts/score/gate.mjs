// Gate / cutoff classification shared by allocate() and tradeoff table rendering.

import { GATE_WORD_SET, DEFAULT_COMBINED_WEIGHTS } from './fit-signal.mjs';
import { combinedScore } from './merge.mjs';

export function songGate(s) {
  if (!s) return null;
  if (s.gate) return s.gate;
  const t = String(s.fitTier || '').toLowerCase();
  return GATE_WORD_SET.has(t) ? t : null;
}

// A cutoff gate compares against its OWN axis, independent of how the round is
// ranked (rankBy). Otherwise `--cutoff music:65` on a combined-ranked round would
// silently gate on combinedScore. `combined` reads the normalized combinedScore
// (computed over the full field — the cutoff never shrinks it; see merge.mjs).
function cutoffAxisValue(s, axis, profile = {}) {
  if (axis === 'fit') return s.fitScore ?? null;
  if (axis === 'music') return s.score ?? null;
  if (s.combinedScore != null) return s.combinedScore;
  return combinedScore(s, profile.weights || DEFAULT_COMBINED_WEIGHTS);
}

/** Classify a song against the profile gate: pass | maybe | fail. */
export function gateClass(s, profile = {}) {
  const g = profile.gate;
  if (!g) return 'pass';
  if (g.type === 'cutoff') {
    const v = cutoffAxisValue(s, g.axis, profile);
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

/** True when a song cannot receive draft/final votes (own songs are never excluded). */
export function isExcludedFromAllocation(s, profile = null) {
  if (!s || s.isOwn) return false;
  if (s.isDisqualified || s.needsUserInput) return true;
  if (songGate(s) === 'fail') return true;
  if (profile?.gate && gateClass(s, profile) === 'fail') return true;
  return false;
}
