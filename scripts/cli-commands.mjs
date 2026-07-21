// User-facing command strings — prefer `just pick` over internal `--option` flags.

/** Short codes for down-shape columns (match combo ballot: A·cv). */
export const DOWN_SHAPE_SHORT = { curved: 'cv', flat: 'fl', concentrated: 'cc' };

export function downShapeShort(shape) {
  return DOWN_SHAPE_SHORT[shape] || String(shape || '').slice(0, 2);
}

const DOWN_SHORT_SET = new Set(Object.values(DOWN_SHAPE_SHORT));

export function downShapeFromShort(short) {
  const s = String(short || '').toLowerCase();
  for (const [shape, code] of Object.entries(DOWN_SHAPE_SHORT)) {
    if (code === s) return shape;
  }
  return null;
}

export function isDownShapeShort(token) {
  return DOWN_SHORT_SET.has(String(token || '').toLowerCase());
}

/** Parse pick positional: A, A cc, A·cv, etc. */
export function parsePickSpec(spec) {
  const raw = String(spec || '').trim();
  if (!raw) return { letter: null, downShape: null };
  const combo = raw.match(/^([A-Za-z])[\s·.\-/]+(cv|fl|cc)$/i);
  if (combo) {
    return { letter: combo[1].toUpperCase(), downShape: downShapeFromShort(combo[2]) };
  }
  if (/^[A-Za-z]$/.test(raw)) return { letter: raw.toUpperCase(), downShape: null };
  return { letter: null, downShape: null };
}

export function formatPickSpec(letter, downShape = null) {
  if (letter == null || letter === '') return '';
  const up = String(letter).toUpperCase();
  const short = downShape ? downShapeShort(downShape) : null;
  return short ? `${up} ${short}` : up;
}

function quoteReason(reason) {
  const s = String(reason);
  if (/[\s"'\\]/.test(s)) return JSON.stringify(s);
  return s;
}

/** Primary pick command (`just pick` is the documented interface). */
export function formatPickCmd(roundId, letter, extras = {}) {
  if (!roundId || letter == null || letter === '') return null;
  const parts = ['just', 'pick', roundId, formatPickSpec(letter, extras.downShape)];
  const { pin, reason, scores } = extras;
  if (scores) parts.push('--scores');
  if (pin) parts.push('--pin', pin);
  if (reason) parts.push('--reason', quoteReason(reason));
  return parts.join(' ');
}

/** Convert internal selector text (`--option A --down-shape flat`) to `just pick`. */
export function formatLegacySelector(roundId, selector, defaultLetter = 'A') {
  if (!selector || selector === 'default') return 'default allocation';
  if (!roundId) return selector;
  const letterMatch = selector.match(/(?:^|\s)--option\s+([A-Za-z])/);
  const downMatch = selector.match(/(?:^|\s)--down-shape\s+(\S+)/);
  const letter = letterMatch ? letterMatch[1].toUpperCase() : String(defaultLetter).toUpperCase();
  const downShape = downMatch ? downMatch[1] : undefined;
  return formatPickCmd(roundId, letter, { downShape });
}

export function pickHintLine(roundId, { hasUp = true, hasDown = false } = {}) {
  if (hasDown) return `just pick ${roundId} <A|B|C> <cv|fl|cc>`;
  return `just pick ${roundId} <A|B|C>`;
}

/**
 * One-line syntax reminder for the CLI menu. No round name (pick defaults to the
 * current round) and no per-letter repetition — just the shape of the command plus
 * the most common flags, so it reads as a syntax hint rather than three
 * near-identical commands.
 */
export function pickSyntaxReminder({ hasDown = false } = {}) {
  const down = hasDown ? ' [cv|fl|cc]' : '';
  return `just pick <a|b|c>${down} [--pin <song>:<v>] [--cutoff music:<n>] [--reason "…"]`;
}

// Suffix describing how a point-split option differs from the primary staircase:
// a coarser merge/jump (no tiebreak) or a tie-split (needs a tiebreak). Shared by the
// CLI menu and the md/html legends so all three agree. Empty for the plain staircases.
export function optionNote(o) {
  if (o?.jumped) {
    return ` · merges a tier${o.jump ? ` (${o.jump} jump, no tiebreak)` : ' (no tiebreak)'}`;
  }
  if (o?.separated && o.arbitrarySplits) {
    const n = o.arbitrarySplits;
    return ` · needs a tiebreak (splits ${n} tie${n > 1 ? 's' : ''})`;
  }
  return '';
}

/** @deprecated use pickHintLine */
export function pickPromptLine(roundId, tradeoffsOrCount = 1) {
  const list = Array.isArray(tradeoffsOrCount)
    ? tradeoffsOrCount.filter((t) => t.kind === 'tier-structure' || t.kind === 'down-structure')
    : null;
  const hasUp = list?.some((t) => t.kind === 'tier-structure') ?? true;
  const hasDown = list?.some((t) => t.kind === 'down-structure') ?? false;
  return pickHintLine(roundId, { hasUp, hasDown });
}

export function pickUsageError(roundId, optionSpec, presentedCount, availableLetters) {
  const letters = availableLetters?.length ? availableLetters.join(', ') : 'none';
  const example = roundId
    ? `Example: just pick ${roundId} A --reason "…"`
    : 'Example: just pick <round> A --reason "…"';
  return (
    `Option "${optionSpec}" is not available (this round has ${presentedCount} option(s): ${letters}). ` +
    `Pass the letter as the second argument — not --option. ${example}`
  );
}
