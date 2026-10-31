// Shared CLI argv helpers for Music League scripts.

/**
 * Single-dash aliases for the value flags. Expanded long early (see
 * expandShortFlags) so every argv consumer — dispatcher or direct script — sees
 * the long form. Long flags keep working; booleans have no short forms.
 */
export const SHORT_FLAGS = {
  '-w': '--weights',
  '-c': '--cutoff',
  '-p': '--pin',
  '-rk': '--rank',
  '-sh': '--shape',
  '-ds': '--down-shape',
  '-tc': '--tier-count',
  '-bc': '--bucket-count',
  '-fb': '--favorite-band',
  '-sc': '--score',
  '-fs': '--fit-score',
};

/** Rewrite known single-dash flags to their long form. Pure; unknown tokens pass. */
export function expandShortFlags(argv) {
  return argv.map((a) => SHORT_FLAGS[a] ?? a);
}

/** Parse `--name value` or `--name=value`; returns new index if matched. */
export function matchFlag(argv, i, name, onValue) {
  const a = argv[i];
  const prefix = `--${name}`;
  if (a === prefix) {
    onValue(argv[i + 1]);
    return i + 1;
  }
  if (a.startsWith(`${prefix}=`)) {
    onValue(a.slice(prefix.length + 1));
    return i;
  }
  return null;
}

/** Value flags whose spec may repeat as space-separated pairs (`--pin 9:2 12:1`). */
const PAIR_VALUE_FLAGS = new Set(['pin', 'score', 'fit-score']);

// A pair segment carries its own ref:value colon. Anything not starting with
// '-' and containing a colon counts; malformed segments still fail downstream
// with the flag's own error (never silently swallowed).
const isPairToken = (t) => !t.startsWith('-') && t.includes(':');

/**
 * Parse `--name value[=value]` plus any following space-separated pair tokens
 * for the repeatable pair flags (pin / score / fit-score); other flags behave
 * exactly like matchFlag.
 */
export function matchRepeatableFlag(argv, i, name, onValue) {
  const once = matchFlag(argv, i, name, onValue);
  if (once == null) return null;
  if (!PAIR_VALUE_FLAGS.has(name)) return once;
  let end = once;
  for (let k = once + 1; k < argv.length; k++) {
    if (!isPairToken(argv[k])) break;
    onValue(argv[k]);
    end = k;
  }
  return end;
}

/** True when `token` starts a new long option (`--foo` or `--foo=bar`). */
function isLongFlag(token) {
  return token.startsWith('--') && token.length > 2 && token !== '--';
}

/**
 * Parse `--name word word …` — value is all tokens until the next `--flag`.
 * Handles shells/just splitting a quoted reason into separate argv words.
 * Also accepts `--name=value` (value may contain spaces when quoted by the shell).
 */
export function matchRestFlag(argv, i, name, onValue) {
  const a = argv[i];
  const prefix = `--${name}`;
  if (a.startsWith(`${prefix}=`)) {
    onValue(a.slice(prefix.length + 1));
    return i;
  }
  if (a !== prefix) return null;
  const parts = [];
  for (let j = i + 1; j < argv.length; j++) {
    if (isLongFlag(argv[j])) break;
    parts.push(argv[j]);
  }
  if (parts.length) onValue(parts.join(' '));
  return i + parts.length;
}

/** Warn when argv uses single-dash flags (this CLI is long-flag only). */
export function warnUnknownShortFlags(argv) {
  for (const a of argv) {
    if (/^-[a-zA-Z]/.test(a) && !a.startsWith('--')) {
      console.error(
        `Warning: "${a}" is not a recognized flag — use two dashes (e.g. --pin not -pin).`
      );
    }
  }
}

/** Assign the first positional token when the file slot is empty. */
export function takePositional(a, args, key = 'file') {
  if (!a.startsWith('--') && !args[key]) {
    args[key] = a;
    return true;
  }
  return false;
}
