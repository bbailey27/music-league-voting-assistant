#!/usr/bin/env node
// Save clipboard HTML as a round input under the canonical dated round id.
// stdin HTML ← `just save-round <slug>`:
//   1. Strip any leading date from the slug (bare slug families are canonical).
//   2. If exactly one dated sibling exists in rounds/ or analysis/, write the
//      fresh export to that dated file — never a second undated copy.
//   3. Otherwise stamp today's (effective) date: YYYY-MM-DD-<slug>.html.
// Records the resolved id as the current round so the next `just parse` works.
// Round ids and artifact layout: spec/analysis-artifacts.md.

import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { join } from 'node:path';
import {
  ROUNDS_DIR,
  datePrefixOf,
  datedSiblingsOf,
  listAllRoundIds,
  writeCurrentRound,
} from './paths.mjs';
import { effectiveDate, formatDateSlug } from './maintain-rounds.mjs';

const usage = `Usage: just save-round <slug>   # clipboard HTML → data/rounds/<dated slug>.html`;

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk.toString('utf8'));
  return chunks.join('');
}

export function resolveSaveTarget(query, ids = listAllRoundIds(), now = new Date()) {
  if (datePrefixOf(query)) return { id: query, created: true };
  const siblings = datedSiblingsOf(query, ids);
  if (siblings.length === 1) return { id: siblings[0], created: false };
  if (siblings.length > 1) {
    return { error: `"${query}" is ambiguous — matches multiple dated rounds:`, siblings };
  }
  return { id: `${formatDateSlug(effectiveDate(now))}-${query}`, created: true };
}

async function main() {
  const [query] = process.argv.slice(2);
  if (!query || query.startsWith('-')) {
    console.error(usage);
    process.exit(1);
  }

  // Undated ids only linger when a user saved outside just save-round; if one
  // exists, let the (newer-wins) fold logic see it rather than add a second copy.
  const undated = existsSync(join(ROUNDS_DIR, `${query}.html`));

  const target = resolveSaveTarget(query);
  if (target.error) {
    console.error(target.error);
    for (const s of target.siblings) console.error(`  ${s}`);
    process.exit(1);
  }

  const html = await readStdin();
  if (!html.trim()) {
    console.error('Clipboard is empty — nothing saved.');
    process.exit(1);
  }

  const bytes = Buffer.byteLength(html, 'utf8');
  const outPath = join(ROUNDS_DIR, `${target.id}.html`);
  mkdirSync(ROUNDS_DIR, { recursive: true });
  writeFileSync(outPath, html, 'utf8');
  if (target.created) {
    console.log(`Saved ${outPath} (${bytes} bytes)`);
  } else {
    console.log(`Round exists as ${target.id} — replaced ${outPath} (${bytes} bytes)`);
  }
  if (undated && !target.created) {
    console.log(`  note: undated export data/rounds/${query}.html still exists; run "just tidy" to fold it`);
  }
  writeCurrentRound(target.id);
  console.log(`(current round: ${target.id})`);
  console.log(`Next: just parse ${target.id}`);
}

if (process.argv[1] && process.argv[1].endsWith('save-round.mjs')) {
  main();
}
