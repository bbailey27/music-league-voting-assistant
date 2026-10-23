// League registry ENGINE — facts live in data/ref/leagues.json (private submodule).
// This module holds no league names or slug families: it loads the descriptor file,
// matches leagues to rounds, renders CLI banners, and tracks slug-family recency.
// Plain leagues self-register into the JSON (save-round primary, parse secondary);
// hand-crafted descriptors with reminders/scripts are edited in the data file.
// Narrative + how to add a league: spec/leagues.md — examples live in the data file.

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { bareSlugOf, datePrefixOf, hasDatePrefix, REF_DIR } from './paths.mjs';
import { slugAgeDays } from './maintain-rounds.mjs';

/**
 * @typedef {Object} LeagueScript
 * @property {string} cmd   Invocation template; `<round>` / `<year>` are filled when known.
 * @property {string} role  One-line description of what the script does for this league.
 *
 * @typedef {Object} League
 * @property {string} id            Stable kebab-case key.
 * @property {string[]} names       Exact league names as they appear in the ML page title.
 * @property {string} slugFamily    Human slug shape (e.g. `<prefix><token>`).
 * @property {string[]} slugPrefixes Bare-slug prefixes used to match a round when the
 *                                   league name is absent (text rounds) or unknown.
 * @property {'objective'|'thematic'|null} mode  Default scoring mode (null until a parse records one).
 * @property {string} summary       One-line description of the league.
 * @property {string[]} [reminders] Standing eligibility / DQ / scoring reminders.
 * @property {LeagueScript[]} [scripts] Reusable scripts for this league.
 * @property {string[]} [rules]     Relevant `.cursor/rules/*.mdc` files.
 * @property {string[]} [skills]    Relevant repo skill ids.
 * @property {string[]} [fitProfile] fit-guidance profile ids.
 * @property {string[]} [refs]      Relevant spec files.
 * @property {'version-earliest'|'earliest-album-release'} [releaseDateRule]
 *                                   Which release-date gate rule applies.
 */

function registryFile() {
  // Tests point the engine at a generic fixture (the data dir holds the real one).
  return process.env.ML_LEAGUES_JSON || join(REF_DIR, 'leagues.json');
}

let registryCache = { mtime: null, leagues: null, failed: false, key: null };

/** Warn once per process/path when the registry file is unreadable. */
function warnRegistryOnce(file, message) {
  if (registryCache.key === file && registryCache.failed) return;
  console.error(`⚠ ${file} is unreadable (${message}).`);
  console.error('  Running without league facts — fix the file, or delete it and the next.');
  console.error('  save/parse recreates the plain entries (history: data submodule git).');
}

/** Merge an entry-less template so late-arriving fields have sane defaults. */
function normalizeDescriptor(raw) {
  const lg = { ...raw };
  lg.names = Array.isArray(raw.names) ? raw.names : [];
  lg.slugPrefixes = Array.isArray(raw.slugPrefixes) ? raw.slugPrefixes : [];
  lg.reminders = Array.isArray(raw.reminders) ? raw.reminders : [];
  lg.scripts = Array.isArray(raw.scripts) ? raw.scripts : [];
  lg.mode = raw.mode ?? null;
  return lg;
}

/** Load registry descriptors (cached per path+mtime; missing file => empty facts). */
export function loadLeagueRegistry() {
  const file = registryFile();
  if (!existsSync(file)) return [];
  let mtime;
  try {
    mtime = statSync(file).mtimeMs;
  } catch {
    return [];
  }
  if (registryCache.key === file && registryCache.mtime === mtime && registryCache.leagues) {
    return registryCache.leagues;
  }
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const list = Array.isArray(data.leagues) ? data.leagues : [];
    if (!Array.isArray(data.leagues)) throw new Error('a "leagues" array is missing');
    const leagues = list.map(normalizeDescriptor);
    registryCache = { mtime: mtime ?? null, leagues, failed: false, key: file };
    return leagues;
  } catch (err) {
    warnRegistryOnce(file, err.message); // warn before the cache records this file as seen
    registryCache = { mtime: null, leagues: [], failed: true, key: file };
    return [];
  }
}

function normalize(name) {
  return String(name || '').trim().toLowerCase();
}

/** Descriptor matched by exact league name (case-insensitive), or null. */
export function leagueByName(leagueName) {
  return loadLeagueRegistry().find((lg) => (lg.names || []).some((n) => normalize(n) === normalize(leagueName))) || null;
}

/** Descriptor matched by a round id's bare slug prefix (e.g. <pattern>-), or null. */
export function leagueBySlug(roundId) {
  if (!roundId) return null;
  const bare = bareSlugOf(roundId);
  return loadLeagueRegistry().find((lg) => (lg.slugPrefixes || []).some((p) => p && bare.startsWith(p))) || null;
}

/**
 * Resolve a league descriptor for a round: prefer the exact league name (from the
 * parsed round), fall back to the round id's slug family. Returns null when unknown.
 */
export function leagueForRound({ roundId = null, leagueName = null } = {}) {
  return leagueByName(leagueName) || leagueBySlug(roundId) || null;
}

/** Family prefix from a round id: first dash token plus '-' (e.g. vim, sm, lfm). */
export function deriveFamilyPrefix(roundId) {
  const bare = bareSlugOf(roundId);
  const tokens = bare.split('-');
  return tokens.length >= 2 ? `${tokens[0]}-` : `${bare}-`;
}

/** Family-shape display for an auto-registered plain league. */
function shapeForPrefix(prefix) {
  if (/<.*>/.test(prefix)) return prefix; // hand-written shape
  return `${prefix}<topic>`;
}

function uniquePlainId(registry, prefix) {
  const base = `${prefix.replace(/-$/, '')}-plain`;
  let id = base;
  let n = 2;
  while (registry.some((lg) => lg.id === id)) id = `${base}-${n++}`;
  return id;
}

/**
 * Upsert a plain-league descriptor (name + family prefix; no reminders/scripts).
 * Covered-by-name/covered-by-slug rounds are left untouched — only genuinely
 * unknown official names (or fresh slugs with no matching family) register. An
 * entry created nameless by save-round gets its official name + mode on parse.
 * @returns {{added: boolean, descriptor?: League, reason?: 'covered-name'|'covered-slug'|'unreadable'}}
 */
export function upsertPlainLeague({ roundId, leagueName = null, mode = null }) {
  const file = registryFile();
  const byName = leagueName ? leagueByName(leagueName) : null;

  if (byName && byName.mode != null) return { added: false, reason: 'covered-name' };

  let container;
  const existed = existsSync(file);
  container = existed
    ? readFileSyncOrThrow(file)
    : { version: 1, note: 'League registry — engine reads this file; plain leagues self-register here. Private data.', leagues: [] };

  const leagues = container.leagues.map(normalizeDescriptor);
  const prefix = deriveFamilyPrefix(roundId);
  const coveredByName = leagueName
    ? leagues.find((lg) => (lg.names || []).some((n) => normalize(n) === normalize(leagueName)))
    : null;
  const coveredBySlug = leagues.find((lg) => (lg.slugPrefixes || []).some((p) => p && bareSlugOf(roundId).startsWith(p)));
  let changed = false;

  if (coveredByName) {
    if (coveredByName.mode == null && mode != null) {
      coveredByName.mode = mode;
      changed = true;
    }
    if (!coveredByName.slugPrefixes.includes(prefix)) {
      coveredByName.slugPrefixes.push(prefix);
      changed = true;
    }
  } else if (coveredBySlug) {
    if (leagueName && !coveredBySlug.names.includes(leagueName)) {
      coveredBySlug.names.push(leagueName);
      changed = true;
    }
    if (coveredBySlug.mode == null && mode != null) {
      coveredBySlug.mode = mode;
      changed = true;
    }
  } else {
    const descriptor = normalizeDescriptor({
      id: uniquePlainId(leagues, prefix),
      names: leagueName ? [leagueName] : [],
      slugFamily: shapeForPrefix(prefix),
      slugPrefixes: [prefix],
      mode,
      summary: leagueName
        ? 'Auto-registered plain league.'
        : 'Auto-registered plain league (official name filled by a later parse).',
      reminders: [],
      scripts: [],
    });
    leagues.push(descriptor);
    changed = true; // appends always alter the file
  }

  if (changed) {
    container.leagues = leagues;
    mkdirSync(REF_DIR, { recursive: true });
    writeFileSync(file, `${JSON.stringify(container, null, 2)}\n`, 'utf8');
    registryCache = { mtime: null, leagues: null, failed: false, key: null };
  }
  const added = !coveredByName && !coveredBySlug;
  return { added, reason: coveredByName ? 'covered-name' : coveredBySlug ? 'covered-slug' : 'added', descriptor: added ? leagues.at(-1) : coveredByName || coveredBySlug };
}

function readFileSyncOrThrow(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    const wrapped = new Error(`${file} cannot be read (${err.message}) — fix it manually.`);
    throw wrapped;
  }
}

/** Backfill plain league entries from a [{roundId, leagueName, mode}] scan. */
export function registerPlainLeaguesFromRounds(rounds) {
  let added = 0;
  for (const r of rounds || []) {
    if (upsertPlainLeague(r).added) added++;
  }
  return added;
}

/** After a slug rename, follow the entry keyed on the old family to the new one. */
export function rekeyPlainLeague(oldRoundId, newRoundId) {
  const file = registryFile();
  if (!existsSync(file)) return { rekeyed: false };
  let container;
  try {
    container = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`⚠ ${file} cannot be read for rename (${err.message}).`);
    return { rekeyed: false };
  }
  const leagues = (container.leagues || []).map(normalizeDescriptor);
  const oldPrefix = deriveFamilyPrefix(oldRoundId);
  const newPrefix = deriveFamilyPrefix(newRoundId);
  const entry = leagues.find((lg) => (lg.slugPrefixes || []).includes(oldPrefix));
  if (!entry) return { rekeyed: false };
  if (entry.slugPrefixes.length === 1) entry.slugPrefixes = [newPrefix];
  else entry.slugPrefixes = entry.slugPrefixes.map((p) => (p === oldPrefix ? newPrefix : p));
  entry.slugFamily = shapeForPrefix(newPrefix);
  container.leagues = leagues;
  writeFileSync(file, `${JSON.stringify(container, null, 2)}\n`, 'utf8');
  registryCache = { mtime: null, leagues: null, failed: false, key: null };
  return { rekeyed: true, entry };
}

/** Fill a script template with the known round id (and year for <year> slugs). */
export function resolveScriptCmd(cmd, { roundId = null } = {}) {
  let out = String(cmd);
  if (roundId) {
    out = out.replaceAll('<round>', roundId);
    const year = bareSlugOf(roundId).match(/(?:^|-)((?:19|20)\d{2})(?:$|-)/);
    if (year) out = out.replaceAll('<year>', year[1]);
  }
  return out;
}

/**
 * Compact notes block for CLI banners: league label, standing reminders (constraint
 * leagues), and one-line script hints. Plain leagues get a two-line banner.
 */
export function leagueNotesLines(league, { roundId = null } = {}) {
  if (!league) return [];
  const label = league.names[0] || league.slugFamily;
  const lines = [`League: ${label} — ${league.summary}`];
  for (const r of league.reminders || []) lines.push(`  ⚠ ${r}`);
  for (const s of league.scripts || []) {
    lines.push(`  $ ${resolveScriptCmd(s.cmd, { roundId })}`);
    lines.push(`      ${s.role}`);
  }
  lines.push('  See: spec/leagues.md');
  return lines;
}

/** Full multi-section detail for `ml leagues <name>`. Returns an array of lines. */
export function leagueDetailLines(league) {
  if (!league) return [];
  const lines = [];
  lines.push(`${league.id}  (${league.slugFamily}${league.mode ? `, ${league.mode}` : ''})`);
  lines.push(`  ${league.summary}`);
  if (league.names.length) lines.push(`  Names: ${league.names.join(', ')}`);
  const section = (title, items, fmt = (x) => x) => {
    if (!items || !items.length) return;
    lines.push(`  ${title}:`);
    for (const it of items) lines.push(`    ${fmt(it)}`);
  };
  section('Reminders', league.reminders);
  section('Scripts', league.scripts, (s) => `${s.cmd}\n        ${s.role}`);
  section('Fit profiles', league.fitProfiles);
  section('Skills', league.skills);
  section('Rules', league.rules);
  section('Specs', league.refs);
  return lines;
}

/**
 * Recency of each league's slug family against the known round ids (dated ids only).
 * A league is "active" while its newest dated slug match is within `activeWindowDays`
 * (default 14; effective-date aware so the pre-5am window belongs to yesterday).
 * `recent` holds the last `recentCount` (default 3) matches, newest first — the
 * recent concrete slugs an owner copies when saving the next round.
 * Call sites pass ALL round ids — active tree + archive (listAllRoundIds +
 * listArchivedRoundIds): the archive sweep moves rounds out at 2 days.
 * @returns {Array<{league: League, latest: {roundId: string, bare: string, date: string}|null,
 *   recent: Array<{roundId: string, bare: string, date: string, ageDays: number}>,
 *   ageDays: number|null, matched: boolean, active: boolean}>}
 */
export function leagueSlugActivity(
  ids,
  { leagues = null, now = new Date(), activeWindowDays = 14, recentCount = 3 } = {}
) {
  const registry = leagues ?? loadLeagueRegistry();
  const out = [];
  for (const league of registry) {
    const matches = ids
      .filter((id) =>
        (league.slugPrefixes || []).some((p) => p && hasDatePrefix(id) && bareSlugOf(id).startsWith(p))
      )
      .sort()
      .reverse(); // newest first
    const recent = matches.slice(0, recentCount).map((roundId) => {
      const date = datePrefixOf(roundId);
      return { roundId, bare: bareSlugOf(roundId), date, ageDays: slugAgeDays(date, now) };
    });
    if (!recent.length) {
      out.push({ league, latest: null, recent: [], ageDays: null, matched: false, active: false });
      continue;
    }
    out.push({
      league,
      latest: { roundId: recent[0].roundId, bare: recent[0].bare, date: recent[0].date },
      recent,
      ageDays: recent[0].ageDays,
      matched: true,
      active: recent[0].ageDays !== null && recent[0].ageDays <= activeWindowDays,
    });
  }
  return out;
}
