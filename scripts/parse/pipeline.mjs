// Parse pipeline helpers (HTML extraction, profile snapshot, budget warnings).

import { parseHTML } from 'linkedom';
import { parseRoundDocument, recoverEscapedSource } from '../extract-html.mjs';

export function parseRoundHtml(html, mode) {
  const { document } = parseHTML(html);
  const parsed = parseRoundDocument(document, mode);
  if (parsed.songs.length) return parsed;
  const recovered = recoverEscapedSource(document);
  if (recovered) {
    const { document: recoveredDoc } = parseHTML(recovered);
    return parseRoundDocument(recoveredDoc, mode);
  }
  return parsed;
}

export function warnBudgetMismatch(tradeoffs) {
  for (const t of (tradeoffs || []).filter((t) => t.kind === 'budget-mismatch')) {
    console.error(`\n${t.question}`);
  }
}

export function slimProfile(profile) {
  const { shape, downShape, gate, weights, rankBy, tierCount, bucketCount, favoriteBand } = profile;
  return { shape, downShape, gate, weights, rankBy, tierCount, bucketCount, favoriteBand };
}
