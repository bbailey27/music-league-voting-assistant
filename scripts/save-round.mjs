#!/usr/bin/env node
// Save clipboard HTML as a round input under the canonical dated round id.
// stdin HTML ← `just save-round <slug>`:
//   1. Strip any leading date from the slug (bare slug families are canonical).
//   2. If exactly one dated sibling exists in rounds/ or analysis/, write the
//      fresh export to that dated file — never a second undated copy.
//   3. Otherwise stamp today's (effective) date: YYYY-MM-DD-<slug>.html.
// Naming-consistency moment: matching a known slug family prints its recent
// concrete slugs; an unknown family gets a digest + (interactive sessions) a
// confirm before writing, then auto-registers the family in the league registry.
// Round ids and artifact layout: spec/analysis-artifacts.md; registry: leagues.mjs.

import { existsSync, writeFileSync, mkdirSync, openSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { join } from 'node:path';
import {
  ROUNDS_DIR,
  bareSlugOf,
  datePrefixOf,
  datedSiblingsOf,
  listAllRoundIds,
  listArchivedRoundIds,
  writeCurrentRound,
} from './paths.mjs';
import { effectiveDate, formatDateSlug } from './maintain-rounds.mjs';
import { upsertPlainLeague, leagueSlugActivity, loadLeagueRegistry } from './leagues.mjs';

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

/** Slug-recall lines: family digest across the registry, active recent slugs first. */
export function familyDigestLines(roundId, { now = new Date() } = {}) {
  const ids = [...listAllRoundIds(), ...listArchivedRoundIds()];
  const activity = leagueSlugActivity(ids, { leagues: loadLeagueRegistry(), now }).sort(
    (a, b) => (b.ageDays ?? Infinity) - (a.ageDays ?? Infinity)
  );
  const mine = leagueSlugActivity(ids, { now }).find(
    (a) => a.matched && (a.league.slugPrefixes || []).some((p) => bareSlugOf(roundId).startsWith(p))
  );
  const lines = [];
  if (mine?.league) {
    const recent = mine.recent.map((r) => `${r.bare} (${r.ageDays}d ago)`);
    lines.push(`Family ${mine.league.slugFamily} — recent: ${recent.join(', ')}`);
  }
  const active = activity.filter((a) => a.active).slice(0, 5);
  for (const { league, latest } of active) {
    if (mine?.league && league.id === mine.league.id) continue;
    lines.push(
      `  ${league.id.padEnd(14)} ${league.slugFamily.padEnd(18)} latest: ${latest ? `${latest.bare} (${activity.find((x) => x.league.id === league.id)?.recent?.[0]?.ageDays ?? '?'}d ago)` : '—'}`
    );
  }
  return { lines, matched: mine?.league ?? null };
}

/** Interactive confirm reading /dev/tty (stdin is the clipboard pipe). Any failure → null. */
async function confirmOnTty(question) {
  if (!existsSync('/dev/tty')) return null; // no device at all (agent/cron runs)
  let fd;
  try {
    fd = openSync('/dev/tty', 'rs'); // throws synchronously when no session backs it
  } catch {
    return null;
  }
  const { createInterface } = await import('node:readline/promises');
  const { createReadStream } = await import('node:fs');
  const stream = createReadStream('', { fd });
  stream.on('error', () => {}); // late ENXIO between open and read — degrade below
  const rl = createInterface({ input: stream, terminal: true });
  try {
    const answer = await rl.question(question);
    return answer.trim().toLowerCase();
  } catch {
    return null;
  } finally {
    rl.close();
  }
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

  // Naming-consistency check BEFORE writing: match the slug family (or the full
  // digest when it is unknown) so alignment with previous rounds is front and center.
  const digest = familyDigestLines(target.id);
  if (digest.matched) {
    for (const line of digest.lines) console.log(line);
  } else {
    console.log(`No known slug family for "${bareSlugOf(target.id)}". Other recent families:`);
    for (const line of digest.lines) console.log(line);
    const answer = await confirmOnTty(`Save as ${target.id}.html anyway? [y/N] `);
    if (answer && answer !== 'y' && answer !== 'yes') {
      console.log('Saved nothing — re-run with the slug you wanted.');
      console.log('No file written; the clipboard is intact for the next attempt.');
      process.exit(1);
    }
    if (answer == null) {
      console.log('(no interactive terminal — saving anyway; re-run just rename <slug> to align)');
    }
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
    console.log(`note: undated export data/rounds/${query}.html still exists; run "just tidy" to fold it`);
  }
  writeCurrentRound(target.id);
  console.log(`(current round: ${target.id})`);

  // Plain-league registration keyed on the confirmed slug family (parse fills the
  // official name later). Covered families return added:false silently.
  const upsert = upsertPlainLeague({ roundId: target.id, leagueName: null, mode: null });
  if (upsert.added) {
    console.log(`Registered slug family: ${upsert.descriptor.slugFamily}`);
  }

  console.log(`Next: just parse ${target.id}`);
  console.log('Renamed your mind? just rename <new-slug>');
}

if (process.argv[1] && process.argv[1].endsWith('save-round.mjs')) {
  main();
}
