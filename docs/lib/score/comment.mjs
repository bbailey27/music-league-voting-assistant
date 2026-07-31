// Scoring: derive signals from the USER comment only.

import { FIT_TIER_SCORES, FIT_TIER_ORDER, fitTierForScore } from './fit-signal.mjs';

// Match the FULL digit run (`\d+`, not a clipped `\d{1,3}`) so a 4-digit year can be
// recognized and rejected rather than silently truncated into a bogus score — e.g.
// "2019" would otherwise clip to "201" → 20.1. `matchScoreToken` does the year filtering.
const SCORE_NUM = /(\d+)(\.\d)?([+\-?=]*)/g;

// A bare 4-digit 19xx / 20xx run is a release year, never a score (scores are 1–3
// digits). Years must not be parsed as numeric scores anywhere on the line.
const YEAR_RE = /^(?:19|20)\d{2}$/;

// First score-number token on `text` that is not a bare 4-digit year. Returns
// { intPart, decPart, mods, index, length } or null when there is no usable number.
function matchScoreToken(text) {
  for (const m of (text || '').matchAll(SCORE_NUM)) {
    if (!m[2] && YEAR_RE.test(m[1])) continue; // skip a year (no decimal → not e.g. 20.1)
    return { intPart: m[1], decPart: m[2], mods: m[3] || '', index: m.index, length: m[0].length };
  }
  return null;
}

// Owner vocabulary: multi-word fit phrases (checked before numeric N fit).
const FIT_SHORTHAND = [
  ['strong', /\bfit\s+bonus\b/i],
];

// Tier synonyms as one alternation per tier; the scanner finds the earliest
// match anywhere on the line, then maps it back to its tier (below).
const FIT_TIER_WORDS = {
  excellent: 'excellent|perfect|ideal|on the nose|spot[- ]?on',
  strong: 'strong|great',
  solid: 'solid|good|clearly|on[- ]?theme',
  moderate: 'moderate|okay|ok|fine|loose|partial',
  weak: 'weak|single keyword|tenuous|barely|kinda|bad|meh',
};

const FIT_TIER_RE = new RegExp(
  Object.entries(FIT_TIER_WORDS)
    .map(([tier, alts]) => `\\b(?<${tier}>${alts})\\b`)
    .join('|'),
  'gi',
);

const GATE_WORDS = [
  ['fail', /\b(fail|fails|off[- ]?theme|invalid|no|nope)\b/i],
  ['maybe', /\b(maybe|questionable|borderline|iffy|stretch)\b/i],
  ['pass', /\b(pass|passes|qualifies|valid|good|fine|okay|ok|fits|on[- ]?theme)\b/i],
];

export function scoreComment(rawComment, mode, opts = {}) {
  // `--fit` scans tier words, `--fit gate` scans gate words. A bare 2nd number is
  // always surfaced as `fitNumberCandidate`; whether it becomes the fitScore here is
  // controlled by `numericFit` (round-wide auto-detect commits it later — see
  // applyNumericFitAutoDetect). The legacy `fitWords` bundles all three on.
  const fitWords = opts.fitWords === true;
  const fitOpts = {
    tierWords: fitWords || opts.tierWords === true,
    gateWords: fitWords || opts.gateWords === true,
    numericFit: fitWords || opts.numericFit === true,
  };
  const out = {
    score: null,
    plus: false,
    minus: false,
    uncertain: false,
    plusUncertain: false,
    minusUncertain: false,
    playlistAdd: false,
    playlistUncertain: false,
    isDisqualified: false,
    needsUserInput: false,
    needsReview: false,
    reviewReason: '',
    fitScore: null,
    fitTier: null,
    gate: null,
    fitSource: null,
    fitNumberCandidate: null,
    needsFitScore: false,
    needsResearch: false,
  };

  const comment = (rawComment ?? '').trim();

  if (comment === '') {
    out.needsUserInput = true;
    return out;
  }

  if (/\bTODO\b/.test(comment)) {
    out.needsUserInput = true;
    return out;
  }

  const scoringLine = comment.split('\n')[0];
  const peeled = peelMusic(scoringLine);

  const applyFit = (fit) => {
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

  if (peeled == null) {
    if (/^-+$/.test(scoringLine)) {
      out.isDisqualified = true;
    } else if (/\b(invalid|no|nope)\b/i.test(scoringLine)) {
      out.isDisqualified = true;
    } else {
      const fit = parseFitSignals(scoringLine, '', fitOpts);
      if (fit.fitScore != null || fit.gate) {
        applyFit(fit);
      } else if (mode === 'objective') {
        out.isDisqualified = true;
      } else {
        out.needsReview = true;
        out.reviewReason = 'words-only comment (subjective mode)';
      }
    }
    return out;
  }

  out.score = scaleScoreToken(peeled.intPart, peeled.decPart);
  Object.assign(out, parseAttachedMods(peeled.mods));
  Object.assign(out, parsePlaylistModifier(scoringLine));

  const fit = parseFitSignals(scoringLine, peeled.remainder, fitOpts);
  out.fitNumberCandidate = fit.fitNumberCandidate;
  applyFit(fit);

  if (mode === 'thematic' && out.fitScore == null && out.gate == null) out.needsResearch = true;

  return out;
}

// Fraction of scored songs that must carry a bare 2nd number before we assume the
// round is numeric-fit and start committing those numbers as fit scores.
export const NUMERIC_FIT_MIN_RATIO = 0.75;

// A song carries a fit signal if any channel resolved: an explicit/numeric fit score,
// a tier word, or a gate word.
function hasFitSignal(s) {
  return s.fitScore != null || s.fitTier != null || s.gate != null;
}

// Round-wide numeric-fit auto-detect: when most scored songs wrote a second number
// (e.g. `75. 80`), treat it as fit for all of them — no flag needed. Songs that
// already resolved a fit (explicit `N fit`, tier word, gate) are left untouched.
// After the numeric commit, a channel-agnostic coverage pass (flagMissingFitSignals)
// flags any un-graded stragglers with `needsFitScore` so a missing fit signal is
// called out like a missing music score — this covers tier- and gate-graded rounds
// too, not just numeric. Mutates `songs`; returns a small summary.
export function applyNumericFitAutoDetect(songs, ratio = NUMERIC_FIT_MIN_RATIO) {
  const scored = (songs || []).filter((s) => s && s.score != null);
  if (!scored.length) return { active: false, applied: 0, missing: [] };

  const withNumber = scored.filter((s) => s.fitNumberCandidate != null);
  const numericActive = withNumber.length >= 2 && withNumber.length / scored.length >= ratio;

  let applied = 0;
  if (numericActive) {
    for (const s of scored) {
      if (s.fitScore != null) continue; // already graded (explicit fit / tier / gate)
      if (s.fitNumberCandidate == null) continue;
      s.fitScore = s.fitNumberCandidate;
      s.fitTier = fitTierForScore(s.fitScore);
      s.fitSource = 'manual';
      applied++;
    }
  }

  const missing = flagMissingFitSignals(scored, ratio);
  return { active: numericActive, applied, missing };
}

// Channel-agnostic coverage flag: if at least `ratio` of scored songs carry a fit
// signal (numeric, tier, or gate), flag the ones that don't with `needsFitScore`.
// Numeric-missing flagging is a special case of this pass. Mutates `songs`; returns
// the flagged stragglers.
export function flagMissingFitSignals(scored, ratio = NUMERIC_FIT_MIN_RATIO) {
  const missing = [];
  const graded = scored.filter(hasFitSignal);
  if (graded.length < 2 || graded.length / scored.length < ratio) return missing;
  for (const s of scored) {
    if (hasFitSignal(s)) continue;
    s.needsFitScore = true;
    missing.push(s);
  }
  return missing;
}

// First non-year number on the scoring line is always music; return the rest for fit
// parsing. A comment whose only number is a year (e.g. "2019" or a sentence mentioning
// one) peels to null → handled as a words-only comment (DQ in objective mode).
function peelMusic(scoringLine) {
  const m = matchScoreToken(scoringLine);
  if (!m) return null;
  return {
    intPart: m.intPart,
    decPart: m.decPart,
    mods: m.mods,
    remainder: scoringLine.slice(m.index + m.length),
  };
}

// Modifiers glued to the music number. `75?` = score uncertain; `75+?` / `7-?` = that
// modifier is uncertain (the base score is not).
function parseAttachedMods(raw) {
  const mods = (raw || '').replace(/=/g, '+');
  const plus = mods.includes('+');
  const minus = mods.includes('-');
  const out = {
    plus,
    minus,
    uncertain: false,
    plusUncertain: false,
    minusUncertain: false,
  };
  if (!mods.includes('?')) return out;

  const qIdx = mods.indexOf('?');
  const plusIdx = mods.indexOf('+');
  const minusIdx = mods.indexOf('-');

  if (plus && qIdx > plusIdx) out.plusUncertain = true;
  else if (minus && qIdx > minusIdx) out.minusUncertain = true;
  else if (!plus && !minus) out.uncertain = true;
  else out.uncertain = true;

  return out;
}

function parsePlaylistModifier(text) {
  if (/\bplay(list)?\?(?!\w)/i.test(text)) {
    return { playlistAdd: true, playlistUncertain: true };
  }
  if (/\bplay(list)?\b/i.test(text)) {
    return { playlistAdd: true, playlistUncertain: false };
  }
  return { playlistAdd: false, playlistUncertain: false };
}

function parseFitSignals(scoringLine, remainder, { tierWords, gateWords, numericFit }) {
  const out = { fitScore: null, fitTier: null, gate: null, fitNumberCandidate: null };
  const rem = remainder || '';

  for (const [tier, re] of FIT_SHORTHAND) {
    if (re.test(rem)) {
      out.fitTier = tier;
      out.fitScore = FIT_TIER_SCORES[tier];
      break;
    }
  }

  if (out.fitScore == null) {
    const explicit =
      rem.match(/\bfit\s*(\d+)(\.\d)?\b/i) ||
      rem.match(/\b(\d+)(\.\d)?\s+fit\b/i);
    if (explicit && !(explicit[2] == null && YEAR_RE.test(explicit[1]))) {
      out.fitScore = scaleScoreToken(explicit[1], explicit[2]);
    }
  }

  // A bare 2nd number is always surfaced (round-wide auto-detect decides whether it
  // becomes fit); `numericFit` commits it inline for the legacy bundled flag. A year
  // is skipped here too, so a trailing "…released 2019" is never mistaken for a fit.
  const second = matchScoreToken(rem);
  if (second) out.fitNumberCandidate = scaleScoreToken(second.intPart, second.decPart);
  if (out.fitScore == null && numericFit && out.fitNumberCandidate != null) {
    out.fitScore = out.fitNumberCandidate;
  }

  if (tierWords && out.fitScore == null) {
    const tier = pickTier(scoringLine);
    if (tier) {
      out.fitTier = tier;
      out.fitScore = FIT_TIER_SCORES[tier];
    }
  }
  if (gateWords) out.gate = matchGate(scoringLine);

  if (out.fitScore != null && out.fitTier == null) out.fitTier = fitTierForScore(out.fitScore);
  return out;
}

// The owner writes the grade first, so the earliest tier word on the line wins
// (a later prose "great" never overrides an earlier "weak"). A tier word followed
// by "negative" (e.g. "strong negative") means a fit that bad — mirror the tier
// across the scale: excellent↔nope, strong↔weak, solid↔moderate.
function pickTier(text) {
  for (const m of text.matchAll(FIT_TIER_RE)) {
    const tier = Object.keys(m.groups).find((t) => m.groups[t] != null);
    const negated = /^\s*negative\b/i.test(text.slice(m.index + m[0].length));
    return negated ? mirrorTier(tier) : tier;
  }
  return null;
}

// Reflect a tier across the graded scale (excellent↔nope, strong↔weak, solid↔moderate).
function mirrorTier(tier) {
  const i = FIT_TIER_ORDER.indexOf(tier);
  return i < 0 ? tier : FIT_TIER_ORDER[FIT_TIER_ORDER.length - 1 - i];
}

function matchGate(text) {
  for (const [gate, re] of GATE_WORDS) {
    if (re.test(text)) return gate;
  }
  return null;
}

export function scaleScoreToken(intPart, decPart) {
  if (decPart) return parseFloat(intPart + decPart);
  if (intPart.length === 1) return Number(intPart) * 10;
  if (intPart.length === 2) return Number(intPart);
  return Number(intPart) / 10;
}

export function formatMusicModifierFlags(s) {
  const f = [];
  if (s.plus) f.push(s.plusUncertain ? '+?' : '+');
  if (s.minus) f.push(s.minusUncertain ? '-?' : '-');
  if (s.uncertain) f.push('?');
  if (s.playlistAdd) f.push(s.playlistUncertain ? 'play?' : 'play');
  return f.join('');
}

export function tiebreakRank(s) {
  if (s.playlistAdd) return 3;
  if (s.plus) return 2;
  if (s.minus) return 0;
  return 1;
}
