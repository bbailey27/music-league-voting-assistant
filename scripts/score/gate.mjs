// Gate / cutoff classification shared by allocate() and tradeoff table rendering.

import { GATE_WORD_SET, DEFAULT_COMBINED_WEIGHTS } from './fit-signal.mjs';
import { combinedScore } from './merge.mjs';

export function songGate(s) {
  if (!s) return null;
  if (s.gate) return s.gate;
  const t = String(s.fitTier || '').toLowerCase();
  return GATE_WORD_SET.has(t) ? t : null;
}

function rankValueForGate(s, profile = {}) {
  const music = s.score;
  const fit = s.fitScore;
  switch (profile.rankBy) {
    case 'fit':
      return fit ?? music ?? null;
    case 'combined': {
      if (s.combinedScore != null) return s.combinedScore;
      return combinedScore(s, profile.weights || DEFAULT_COMBINED_WEIGHTS);
    }
    default:
      return music ?? fit ?? null;
  }
}

/** Classify a song against the profile gate: pass | maybe | fail. */
export function gateClass(s, profile = {}) {
  const g = profile.gate;
  if (!g) return 'pass';
  if (g.type === 'cutoff') {
    const v = g.axis === 'fit' ? s.fitScore : rankValueForGate(s, profile);
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
