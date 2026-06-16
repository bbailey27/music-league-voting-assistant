// Shared helpers for one-off round drivers (scripts/one-off/*). These are not part
// of the main pipeline; they wrap the bits each driver repeats: loading a parsed
// round from saved HTML, clearing comment-derived fit so an explicit per-song gate
// wins, and rendering a JSON artifact to HTML.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseHTML } from 'linkedom';
import { parseRoundDocument } from '../extract-html.mjs';

const execFileP = promisify(execFile);

/** Parse saved round HTML into the canonical parsed-round object. */
export function loadParsedFromHtml(html, mode = 'objective') {
  const { document } = parseHTML(html);
  return parseRoundDocument(document, mode);
}

/**
 * Clear comment-derived fit fields so a driver's explicit per-song gate/tier is
 * authoritative — manual comment fit (fitSource 'manual') otherwise wins over a
 * fit JSON during merge.
 */
export function clearManualFit(songs) {
  for (const s of songs) {
    s.fitScore = null;
    s.fitTier = null;
    s.gate = null;
    s.fitSource = null;
    s.combinedScore = null;
  }
}

/** Render a fit/scores JSON artifact to a self-contained HTML report. */
export async function render(jsonPath, htmlPath, order = 'raw') {
  await execFileP('node', ['scripts/render-fit-html.mjs', jsonPath, '--out', htmlPath, '--order', order]);
}
