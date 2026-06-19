#!/usr/bin/env node
// Keep the rounds/ and analysis/ trees tidy:
//   1. Date-slug undated rounds  — prepend today's YYYY-MM-DD to any round id
//      (input file or analysis folder) that lacks a date, matching the
//      <date>-<slug> convention in spec/analysis-artifacts.md.
//   2. Archive stale rounds      — move rounds whose slug date is older than the
//      keep window into rounds/archive/ and analysis/archive/.
//
// Both steps run automatically at the start of `ml run` (naming first so freshly
// generated artifacts land under the dated name). Use them directly with:
//   node scripts/maintain-rounds.mjs [--dry-run] [--age N] [--no-name] [--no-archive]
//
// Date helpers are exported for tests; the file ops are intentionally simple
// renameSync moves within the data submodule (reversible via git).

import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  ROUNDS_DIR,
  ANALYSIS_DIR,
  ARCHIVE_DIR,
  DATE_PREFIX_RE,
  datePrefixOf,
  hasDatePrefix,
  listRoundInputIds,
  listAnalysisRoundIds,
} from './paths.mjs';

// Round inputs are saved as .html (preferred) or pasted .txt; a round id may own
// either or both, and they always move together.
const INPUT_EXTS = ['.html', '.txt'];

// Rounds switch to "older than 2 days" once their slug date is more than this
// many days behind the effective today (today + yesterday + 2-days-ago kept).
export const DEFAULT_ARCHIVE_AGE_DAYS = 2;

// Saving late at night still belongs to "today's" round; before 5am local we
// stamp yesterday so a 1am export keeps the date of the round it came from.
const DAY_ROLLOVER_HOUR = 5;
const MS_PER_DAY = 86_400_000;

/** The local calendar date to stamp, rolling back to yesterday before 5am. */
export function effectiveDate(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (now.getHours() < DAY_ROLLOVER_HOUR) d.setDate(d.getDate() - 1);
  return d;
}

/** Format a Date as a local YYYY-MM-DD slug (no timezone shift). */
export function formatDateSlug(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Whole-day age of a YYYY-MM-DD slug relative to the effective today. */
export function slugAgeDays(slug, now = new Date()) {
  const m = DATE_PREFIX_RE.exec(`${slug}-`);
  if (!m) return null;
  const slugDate = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.round((effectiveDate(now) - slugDate) / MS_PER_DAY);
}

function inputFilesFor(roundId) {
  return INPUT_EXTS.map((ext) => ({ ext, path: join(ROUNDS_DIR, `${roundId}${ext}`) })).filter(
    ({ path }) => existsSync(path)
  );
}

function analysisDirFor(roundId) {
  const dir = join(ANALYSIS_DIR, roundId);
  try {
    return statSync(dir).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}

/**
 * Prepend the effective date to every undated round id (input file and/or
 * analysis folder), renaming an id's input(s) and analysis folder together.
 * Returns the renames performed (or that would be performed under dryRun).
 */
export function applyDateSlugs({ now = new Date(), dryRun = false, log = () => {} } = {}) {
  const stamp = formatDateSlug(effectiveDate(now));
  const ids = [...new Set([...listRoundInputIds(), ...listAnalysisRoundIds()])]
    .filter((id) => !hasDatePrefix(id))
    .sort();

  const done = [];
  for (const id of ids) {
    const newId = `${stamp}-${id}`;
    const moves = [];
    for (const { ext } of inputFilesFor(id)) {
      moves.push([join(ROUNDS_DIR, `${id}${ext}`), join(ROUNDS_DIR, `${newId}${ext}`)]);
    }
    const analysisDir = analysisDirFor(id);
    if (analysisDir) moves.push([analysisDir, join(ANALYSIS_DIR, newId)]);

    const clash = moves.find(([, to]) => existsSync(to));
    if (clash) {
      log(`  ! skip ${id} → ${newId}: ${clash[1]} already exists`);
      continue;
    }
    for (const [from, to] of moves) {
      if (!dryRun) renameSync(from, to);
    }
    log(`  ${dryRun ? 'would name' : 'named'} ${id} → ${newId}`);
    done.push({ from: id, to: newId, moves });
  }
  return done;
}

function moveIntoArchive(srcPath, archiveDir, log, dryRun) {
  const dest = join(archiveDir, basename(srcPath));
  if (existsSync(dest)) {
    log(`  ! skip archive of ${srcPath}: ${dest} already exists`);
    return false;
  }
  if (!dryRun) {
    mkdirSync(archiveDir, { recursive: true });
    renameSync(srcPath, dest);
  }
  return true;
}

/**
 * Move rounds whose slug date is older than `ageDays` into the archive folders.
 * `keep` is a set of round ids to leave active (e.g. the round being run).
 * Undated rounds are skipped — their age is unknown.
 */
export function archiveStaleRounds({
  now = new Date(),
  ageDays = DEFAULT_ARCHIVE_AGE_DAYS,
  keep = new Set(),
  dryRun = false,
  log = () => {},
} = {}) {
  const roundsArchive = join(ROUNDS_DIR, ARCHIVE_DIR);
  const analysisArchive = join(ANALYSIS_DIR, ARCHIVE_DIR);
  const ids = [...new Set([...listRoundInputIds(), ...listAnalysisRoundIds()])]
    .filter((id) => hasDatePrefix(id) && !keep.has(id))
    .sort();

  const done = [];
  for (const id of ids) {
    if (slugAgeDays(datePrefixOf(id), now) <= ageDays) continue;
    let moved = false;
    for (const { path } of inputFilesFor(id)) {
      moved = moveIntoArchive(path, roundsArchive, log, dryRun) || moved;
    }
    const analysisDir = analysisDirFor(id);
    if (analysisDir) {
      moved = moveIntoArchive(analysisDir, analysisArchive, log, dryRun) || moved;
    }
    if (moved) {
      log(`  ${dryRun ? 'would archive' : 'archived'} ${id} (${slugAgeDays(datePrefixOf(id), now)}d old)`);
      done.push({ id });
    }
  }
  return done;
}

/** Run naming then archiving; shared by the CLI and `ml run`. */
export function tidyRounds({
  now = new Date(),
  ageDays = DEFAULT_ARCHIVE_AGE_DAYS,
  keep = new Set(),
  name = true,
  archive = true,
  dryRun = false,
  log = () => {},
} = {}) {
  const named = name ? applyDateSlugs({ now, dryRun, log }) : [];
  // Re-stat after naming so a freshly dated round can be archived in the same pass.
  const archived = archive ? archiveStaleRounds({ now, ageDays, keep, dryRun, log }) : [];
  return { named, archived };
}

function main() {
  const argv = process.argv.slice(2);
  let dryRun = false;
  let name = true;
  let archive = true;
  let ageDays = DEFAULT_ARCHIVE_AGE_DAYS;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '-n') dryRun = true;
    else if (a === '--no-name') name = false;
    else if (a === '--no-archive') archive = false;
    else if (a === '--age') ageDays = Number(argv[++i]);
    else if (a.startsWith('--age=')) ageDays = Number(a.slice('--age='.length));
    else {
      console.error(`Unknown option "${a}".`);
      console.error('Usage: maintain-rounds.mjs [--dry-run] [--age N] [--no-name] [--no-archive]');
      process.exit(1);
    }
  }
  if (!Number.isInteger(ageDays) || ageDays < 0) {
    console.error(`--age must be a non-negative integer (got "${ageDays}").`);
    process.exit(1);
  }

  const { named, archived } = tidyRounds({ ageDays, name, archive, dryRun, log: console.log });
  if (!named.length && !archived.length) {
    console.log(dryRun ? 'Nothing to tidy.' : 'Nothing to tidy — rounds are already dated and current.');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
