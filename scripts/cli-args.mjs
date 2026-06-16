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

/** Assign the first positional token when the file slot is empty. */
export function takePositional(a, args, key = 'file') {
  if (!a.startsWith('--') && !args[key]) {
    args[key] = a;
    return true;
  }
  return false;
}
