// Shared scoring, allocation, and reporting core — text helpers.

// Collapse whitespace and escape markdown table cells.
export function cell(s, max = 0) {
  let t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (max && t.length > max) t = t.slice(0, max - 1).trimEnd() + '…';
  return t.replace(/\|/g, '\\|');
}

export function formatScore(n) {
  if (n == null) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
