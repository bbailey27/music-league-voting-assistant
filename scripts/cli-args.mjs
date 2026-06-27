// Shared CLI argv helpers for Music League scripts.

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

/** Assign the first positional token when the file slot is empty. */
export function takePositional(a, args, key = 'file') {
  if (!a.startsWith('--') && !args[key]) {
    args[key] = a;
    return true;
  }
  return false;
}
