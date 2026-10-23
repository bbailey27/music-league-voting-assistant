#!/usr/bin/env node
// Rename a round's slug while keeping its date prefix (the ML round identity stays).
//   just rename <new-slug>              # target = current round (fresh saves)
//   just rename <old-round> <new-slug>  # explicit older round
// Cascades in one pass: input file(s), analysis folder (active or archive),
// picks.jsonl `round` fields, the auto-registered league family key, and the
// current-round pointer. Conflicts (target exists / ambiguous) abort untouched.

import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import {
  ANALYSIS_DIR,
  ROUNDS_DIR,
  bareSlugOf,
  datePrefixOf,
  listAllRoundIds,
  readCurrentRound,
  writeCurrentRound,
} from './paths.mjs';
import { rekeyPlainLeague } from './leagues.mjs';

const usage = `Usage: just rename <new-slug>          # current round
       just rename <old-round> <new-slug> # explicit round`;

/** All round ids from every tree we touch (active + archive). */
function allIds() {
  const ids = new Set(listAllRoundIds());
  for (const base of [join(ROUNDS_DIR, 'archive'), join(ANALYSIS_DIR, 'archive')]) {
    let entries;
    try {
      entries = readdirSync(base);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (f.endsWith('.html') || f.endsWith('.txt')) ids.add(f.slice(0, -(f.endsWith('.html') ? 5 : 4)));
      else ids.add(f);
    }
  }
  return [...ids].sort();
}

function resolveOld(explicit) {
  const ids = allIds();
  if (explicit) {
    const exact = ids.find((id) => id === explicit);
    if (exact) return exact;
    const undated = ids.filter((id) => bareSlugOf(id) === explicit);
    if (undated.length === 1) return undated[0];
    if (undated.length > 1) {
      console.error(`"${explicit}" is ambiguous:`);
      for (const id of undated) console.error(`  ${id}`);
      process.exit(1);
    }
    console.error(`No round matching "${explicit}". Known:`);
    for (const id of ids) console.error(`  ${id}`);
    process.exit(1);
  }
  const cur = readCurrentRound();
  if (!cur) {
    console.error('No current round — name one explicitly: just rename <old-round> <new-slug>');
    process.exit(1);
  }
  return cur;
}

/** Locate a round's paths across the active + archive trees. */
function locate(id) {
  const out = {};
  for (const [label, roundsBase, analysisBase] of [
    ['active', ROUNDS_DIR, ANALYSIS_DIR],
    ['archive', join(ROUNDS_DIR, 'archive'), join(ANALYSIS_DIR, 'archive')],
  ]) {
    if (existsSync(join(roundsBase, `${id}.html`))) out.html = join(roundsBase, `${id}.html`);
    if (existsSync(join(roundsBase, `${id}.txt`))) out.txt = join(roundsBase, `${id}.txt`);
    const dir = join(analysisBase, id);
    if (existsSync(dir) && statSync(dir).isDirectory()) out.analysis = dir;
    out.tree = label;
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  let oldArg = null;
  let newSlug = null;
  if (argv.length === 1) newSlug = argv[0];
  else if (argv.length === 2) {
    [oldArg, newSlug] = argv;
  } else {
    console.error(usage);
    process.exit(1);
  }
  if (!newSlug) {
    console.error(usage);
    process.exit(1);
  }

  const oldId = resolveOld(oldArg);
  const date = datePrefixOf(oldId);
  const newId = `${date}-${bareSlugOf(newSlug)}`;
  if (newId === oldId) {
    console.log(`Round is already ${oldId} — nothing to do.`);
    return;
  }
  if (allIds().includes(newId)) {
    console.error(`Target round id ${newId} already exists — refusing to overwrite.`);
    process.exit(1);
  }

  const paths = locate(oldId);
  if (!paths.html && !paths.txt && !paths.analysis) {
    console.error(`Found no artifacts for ${oldId} (neither rounds/ nor analysis/).`);
    process.exit(1);
  }

  for (const p of [paths.html, paths.txt]) {
    if (p) {
      renameSync(p, p.replace(new RegExp(`(?<=/)${oldId}\\.`), `${newId}.`));
    }
  }
  if (paths.analysis) {
    const parentDir = paths.analysis.slice(0, paths.analysis.lastIndexOf('/'));
    renameSync(paths.analysis, join(parentDir, newId));
  }

  // picks.jsonl rows for this round carry a textual round id.
  const picksPath = join(ANALYSIS_DIR, 'picks.jsonl');
  if (existsSync(picksPath)) {
    const rows = readFileSync(picksPath, 'utf8').split('\n');
    let changed = 0;
    const next = rows.map((row) => {
      if (!row.trim() || !row.includes(`"round":"${oldId}"`)) return row;
      changed++;
      return row.replace(`"round":"${oldId}"`, `"round":"${newId}"`);
    });
    if (changed) {
      writeFileSync(picksPath, next.join('\n'), 'utf8');
      console.log(`picks.jsonl: updated ${changed} row(s) → ${newId}`);
    }
  }

  if (readCurrentRound() === oldId) writeCurrentRound(newId);

  const rekey = rekeyPlainLeague(oldId, newId);
  if (rekey.rekeyed) {
    console.log(`league registry: family re-keyed to ${rekey.entry.slugPrefixes[0]}<topic>`);
  }

  console.log(`Renamed round: ${oldId} → ${newId}`);
  console.log('Next: just parse', newId);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
