// Scoring: derive signals from the USER comment only.

import { FIT_TIER_SCORES, fitTierForScore } from './fit-signal.mjs';

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
