// User-facing command strings — prefer `just pick` over internal `--option` flags.

function quoteReason(reason) {
  const s = String(reason);
  if (/[\s"'\\]/.test(s)) return JSON.stringify(s);
  return s;
}

/** Primary pick command (`just pick` is the documented interface). */
export function formatPickCmd(roundId, letter, extras = {}) {
  if (!roundId || letter == null || letter === '') return null;
  const parts = ['just', 'pick', roundId, String(letter).toUpperCase()];
  const { downShape, pin, reason, scores } = extras;
  if (scores) parts.push('--scores');
  if (downShape) parts.push('--down-shape', downShape);
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

export function pickPromptLine(roundId, count = 1) {
  const n = Number(count) || 1;
  const word = n === 1 ? 'tradeoff' : 'tradeoffs';
  return `${n} ${word} need your call — use just pick ${roundId} <A|B|C> --reason "…"`;
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
