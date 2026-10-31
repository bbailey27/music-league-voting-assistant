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

/**
 * Longest matching slug prefix wins, so a broader family cannot swallow a more
 * specific one's rounds (e.g. <family>- over <family>-constraints-). Equal-length
 * ties go to the league listed LATER in the registry file — entries are appended
 * (save-round/parse hand-edit appends too), so order is creation order and the
 * newest family wins. Returns the winning {league, prefix} or null.
 */
export function mostSpecificSlugMatch(registry, roundId) {
  if (!roundId) return null;
  const bare = bareSlugOf(roundId);
  let best = null;
  let bestLen = -1;
  for (const league of registry) {
    for (const p of league.slugPrefixes || []) {
      if (!p || !bare.startsWith(p)) continue;
      if (p.length >= bestLen) {
        best = { league, prefix: p };
        bestLen = p.length;
      }
    }
  }
  return best;
}

/** Descriptor matched by a round id's bare slug prefix (most-specific match), or null. */
export function leagueBySlug(roundId) {
  return mostSpecificSlugMatch(loadLeagueRegistry(), roundId)?.league || null;
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

/** Family-shape display for an auto-registered token prefix (dashed value). */
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

/** Family-shape display from a prefix: token families open with <topic>, exact-slug ones stay concrete. */
function familyShapeForPrefixes(prefixes) {
  const list = prefixes.filter(Boolean);
  if (!list.length) return '<unknown>';
  const p = list[0];
  return p.endsWith('-') ? `${p}<topic>` : p;
}

/**
 * Longest common token-run prefix across slugs, shaped for startsWith matching:
 * every slug lands under `kpop-` (full shared tokens + tail) or under the exact
 * shared run (`group-one` owns `group-one` and `group-one-covers`). Null when the
 * slugs share no leading token.
 */
export function commonSlugRun(slugs) {
  const parts = (slugs || []).map((s) => String(s).split('-'));
  if (!parts.length || !parts[0].length) return null;
  let run = '';
  for (let k = 0; ; k++) {
    const token = parts[0][k];
    if (token === undefined) break;
    if (!parts.every((p) => p[k] === token)) break;
    run = k === 0 ? token : `${run}-${token}`;
  }
  if (!run) return null;
  if (slugs.every((s) => s.startsWith(`${run}-`))) return `${run}-`;
  if (slugs.every((s) => s === run || s.startsWith(`${run}-`))) return run;
  return null;
}

/** Apply a round's bare slug to a matched entry: a no-op when owned, a common-run
 *  upgrade when the league can be folded one level wider, else an exact-slug add. */
function applySlugToEntry(entry, bare) {
  const prefixes = entry.slugPrefixes || [];
  if (prefixes.some((p) => p && bare.startsWith(p))) return false;
  // Token-anchored families keep their shape: a divergent sibling slug joins as
  // an exact add, never widening the pattern below the anchor (`kpop-constraints-`
  // + `kpop-free-1` stays `['kpop-constraints-', 'kpop-free-1']`, not `kpop-`).
  // Exact-slug (1-round) families are the ones that widen to the shared run.
  const tokenAnchored = prefixes.some((p) => p && p.endsWith('-'));
  const common = tokenAnchored ? null : commonSlugRun([...prefixes, bare]);
  if (common) {
    entry.slugPrefixes = [common];
  } else {
    entry.slugPrefixes.push(bare);
  }
  entry.slugFamily = familyShapeForPrefixes(entry.slugPrefixes);
  return true;
}

/**
 * Merge a confirmed second round into its 1-round family (CLI/save-round path).
 * @returns {{merged: boolean, upgraded: boolean, entry: League}}
 */
export function mergeRoundIntoLeague(leagueId, roundId) {
  const file = registryFile();
  let container;
  try {
    container = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file} cannot be read for merge (${err.message}).`, { cause: err });
  }
  const leagues = (container.leagues || []).map(normalizeDescriptor);
  const entry = leagues.find((lg) => lg.id === leagueId);
  if (!entry) throw new Error(`No league "${leagueId}" in ${file}.`);
  const bare = bareSlugOf(roundId);
  const before = [...(entry.slugPrefixes || [])];
  const changed = applySlugToEntry(entry, bare);
  const upgraded = changed && !(entry.slugPrefixes || []).includes(bare);
  container.leagues = leagues;
  mkdirSync(REF_DIR, { recursive: true });
  writeFileSync(file, `${JSON.stringify(container, null, 2)}\n`, 'utf8');
  registryCache = { mtime: null, leagues: null, failed: false, key: null };
  return { merged: changed, upgraded, before, entry };
}

/**
 * Upsert a plain-league descriptor (name + family prefix; no reminders/scripts).
 * A genuinely unknown round registers a **1-round family** (exact bare slug) — the
 * safe default until a second same-league round proves broader shape (league name
 * match on parse upgrades the family automatically; text-family merges at
 * save-round ask for confirmation). Covered-by-name/covered-by-slug rounds are
 * left untouched. An entry created nameless by save-round gets its official name
 * + mode on parse.
 * @returns {{added: boolean, descriptor?: League, reason?: 'covered-name'|'covered-slug'|'unreadable'}}
 */
export function upsertPlainLeague({ roundId, leagueName = null, mode = null, forceFresh = false, addName = false, freshPrefix = null }) {
  const file = registryFile();

  let container;
  const existed = existsSync(file);
  container = existed
    ? readFileSyncOrThrow(file)
    : { version: 1, note: 'League registry — engine reads this file; plain leagues self-register here. Private data.', leagues: [] };

  const leagues = container.leagues.map(normalizeDescriptor);
  // forceFresh (owner confirmed "different league") bypasses both coverage checks
  // so the slug gets its own fresh 1-round family even when another family's
  // prefix would claim it.
  const coveredByName = !forceFresh && leagueName
    ? leagues.find((lg) => (lg.names || []).some((n) => normalize(n) === normalize(leagueName)))
    : null;
  const coveredBySlug = !forceFresh ? mostSpecificSlugMatch(leagues, roundId)?.league || null : null;
  let changed = false;

  if (coveredByName) {
    if (coveredByName.mode == null && mode != null) {
      coveredByName.mode = mode;
      changed = true;
    }
    // Official-name match is the same-league proof (no mode gate — repeat parses
    // with owned slugs stay no-ops): fold the round in — owned slugs stay,
    // otherwise widen to the common run (or add an exact slug when the round's
    // naming diverged entirely). Never a broad first-token prefix that could
    // claim unrelated leagues' rounds.
    if (applySlugToEntry(coveredByName, bareSlugOf(roundId))) changed = true;
  } else if (coveredBySlug) {
    // An official name lands on a slug-matched family only as the FIRST name
    // (nameless fill) or on the owner's explicit confirm — never as a silent
    // alias, so shared-prefix reuse has to be confirmed somewhere.
    const nameless = !(coveredBySlug.names || []).length;
    if (leagueName && (nameless || addName) && !coveredBySlug.names.includes(leagueName)) {
      coveredBySlug.names.push(leagueName);
      changed = true;
    }
    if (coveredBySlug.mode == null && mode != null) {
      coveredBySlug.mode = mode;
      changed = true;
    }
  } else {
    // Fresh family: the full bare slug by default (1-round), or the owner-staked
    // root (`freshPrefix`, typically trailing dash) when they declare one at save.
    const bare = bareSlugOf(roundId);
    const fresh = forceFresh && freshPrefix ? normalizeLeaguePrefix(freshPrefix) : bare;
    if (freshPrefix && bare && !bare.startsWith(fresh) && !fresh.startsWith(bare)) {
      console.error(`warning: staked family root "${fresh}" does not cover the saved slug "${bare}" — it will not claim this round.`);
    }
    const descriptor = normalizeDescriptor({
      id: uniquePlainId(leagues, fresh),
      names: leagueName ? [leagueName] : [],
      slugFamily: familyShapeForPrefixes([fresh]), // 1-round shape until a sibling round widens it
      slugPrefixes: [fresh],
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

/**
 * Prefix semantics — trailing dash = token family (<family>- claims every round
 * under it), no trailing dash = exact-slug family: a one-off league owns its saved
 * slug itself (plus same-league sub-slugs like <slug>-covers) without implying a
 * broader <thing>-<topic> series.
 */
function normalizeLeaguePrefix(p) {
  return String(p || '').trim() || null;
}

/**
 * Manually adjust a descriptor's slug-family facts (CLI: ml leagues <name> --set-*).
 * Registry auto-registration never revises a matched entry's shape, so families drift
 * when a league changes its round naming — this is the hand-fix. Applies only the
 * provided fields.
 * @returns {{before: League, after: League}}
 */
export function updateLeagueSlugs(leagueId, { family = null, prefixes = null, summary = null } = {}) {
  const file = registryFile();
  let container;
  try {
    container = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file} cannot be read for edit (${err.message}).`, { cause: err });
  }
  if (family == null && prefixes == null && summary == null) return null;
  const leagues = (container.leagues || []).map(normalizeDescriptor);
  const entry = leagues.find((lg) => lg.id === leagueId);
  if (!entry) throw new Error(`No league "${leagueId}" in ${file}.`);
  const before = { ...entry };
  if (family != null) {
    const shape = String(family).trim();
    if (!shape) throw new Error('--set-family needs a non-empty shape (e.g. <prefix>-<token>).');
    entry.slugFamily = shape;
  }
  if (prefixes != null) {
    const list = (Array.isArray(prefixes) ? prefixes : [prefixes]).map(normalizeLeaguePrefix);
    if (list.some((p) => !p)) throw new Error('--set-prefixes needs non-empty prefix values.');
    entry.slugPrefixes = [...new Set(list)];
  }
  if (summary != null) {
    const text = String(summary).trim();
    if (!text) throw new Error('--summary needs non-empty text.');
    entry.summary = text;
  }
  container.leagues = leagues;
  try {
    writeFileSync(file, `${JSON.stringify(container, null, 2)}\n`, 'utf8');
  } catch (err) {
    throw new Error(`${file} cannot be written for edit (${err.message}).`, { cause: err });
  }
  registryCache = { mtime: null, leagues: null, failed: false, key: null };
  return { before, after: entry };
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
  // Dated ids belong to at most one family: the most-specific matching prefix
  // (longest wins) — a broader family must not re-claim a narrower league's rounds
  // in its recency digest.
  const ownerOf = new Map();
  for (const id of ids) {
    if (!hasDatePrefix(id)) continue;
    const win = mostSpecificSlugMatch(registry, id);
    if (win) ownerOf.set(id, win.league.id);
  }
  const out = [];
  for (const league of registry) {
    const matches = ids
      .filter((id) => ownerOf.get(id) === league.id)
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
