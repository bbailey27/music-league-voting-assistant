// Terminal display width — East Asian wide chars occupy two columns in monospace.

const WIDE =
  /[\u1100-\u115F\u2E80-\u303E\u3040-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;

export function displayWidth(str) {
  let w = 0;
  for (const ch of String(str)) w += WIDE.test(ch) ? 2 : 1;
  return w;
}

export function padEndDisplay(str, width) {
  const s = String(str);
  return s + ' '.repeat(Math.max(0, width - displayWidth(s)));
}

export function padStartDisplay(str, width) {
  const s = String(str);
  return ' '.repeat(Math.max(0, width - displayWidth(s))) + s;
}

export function truncDisplay(str, max) {
  const s = String(str);
  if (displayWidth(s) <= max) return s;
  const ellipsis = '…';
  const ellW = displayWidth(ellipsis);
  let w = 0;
  let out = '';
  for (const ch of s) {
    const cw = WIDE.test(ch) ? 2 : 1;
    if (w + cw + ellW > max) break;
    out += ch;
    w += cw;
  }
  return out + ellipsis;
}
