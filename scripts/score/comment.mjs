// Scoring: derive signals from the USER comment only.

import { FIT_TIER_SCORES, fitTierForScore } from './fit-signal.mjs';

const SCORE_NUM = /(\d{1,3})(\.\d)?([+\-?=]*)/;

// Owner vocabulary: multi-word fit phrases (checked before numeric N fit).
const FIT_SHORTHAND = [
  ['strong', /\bfit\s+bonus\b/i],
];

const FIT_TIER_SYNONYMS = [
  ['excellent', /\b(excellent|perfect|ideal|on the nose|spot[- ]?on)\b/i],
  ['strong', /\b(strong|great)\b/i],
  ['solid', /\b(solid|good|clearly|on[- ]?theme)\b/i],
  ['moderate', /\b(moderate|okay|ok|loose|partial)\b/i],
  ['weak', /\b(weak|single keyword|tenuous|barely)\b/i],
];

const GATE_WORDS = [
  ['fail', /\b(fail|fails|off[- ]?theme|invalid)\b/i],
  ['maybe', /\b(maybe|questionable|borderline|iffy|stretch)\b/i],
  ['pass', /\b(pass|passes|qualifies|valid|fits|on[- ]?theme)\b/i],
];

export function scoreComment(rawComment, mode, opts = {}) {
  const fitWords = opts.fitWords === true;
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
      const fit = parseFitSignals(scoringLine, '', { fitWords });
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

  applyFit(parseFitSignals(scoringLine, peeled.remainder, { fitWords }));

  if (mode === 'thematic' && out.fitScore == null && out.gate == null) out.needsResearch = true;

  return out;
}

// First number on the scoring line is always music; return the rest for fit parsing.
function peelMusic(scoringLine) {
  const m = scoringLine.match(SCORE_NUM);
  if (!m) return null;
  return {
    intPart: m[1],
    decPart: m[2],
    mods: m[3] || '',
    remainder: scoringLine.slice(m.index + m[0].length),
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

function parseFitSignals(scoringLine, remainder, { fitWords }) {
  const out = { fitScore: null, fitTier: null, gate: null };
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
      rem.match(/\bfit\s*(\d{1,3})(\.\d)?\b/i) ||
      rem.match(/\b(\d{1,3})(\.\d)?\s+fit\b/i);
    if (explicit) {
      out.fitScore = scaleScoreToken(explicit[1], explicit[2]);
    }
  }

  if (out.fitScore == null && fitWords) {
    const second = rem.match(SCORE_NUM);
    if (second) {
      out.fitScore = scaleScoreToken(second[1], second[2]);
    }
  }

  if (fitWords) {
    if (out.fitScore == null && !tierNegated(scoringLine)) {
      for (const [tier, re] of FIT_TIER_SYNONYMS) {
        if (re.test(scoringLine)) {
          out.fitTier = tier;
          out.fitScore = FIT_TIER_SCORES[tier];
          break;
        }
      }
    }
    out.gate = matchGate(scoringLine);
  }

  if (out.fitScore != null && out.fitTier == null) out.fitTier = fitTierForScore(out.fitScore);
  return out;
}

function tierNegated(text) {
  return FIT_TIER_SYNONYMS.some(([, re]) => {
    const m = text.match(re);
    if (!m) return false;
    const after = text.slice(m.index + m[0].length);
    return /^\s*negative\b/i.test(after);
  });
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
