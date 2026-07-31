// Central registry of recurring Music League leagues and the machinery each one uses.
//
// Single source of truth for per-league context that was previously scattered across
// `.cursor/rules/round-slug-naming.mdc` (slug families), `spec/fit-guidance.md`
// (fit-profile associations), and individual script headers ("this script serves the
// bg league"). A descriptor ties a league to its slug family, mode, standing
// eligibility/DQ reminders, reusable scripts, rules, skills, and fit-guidance profiles.
//
// Consumers: `parse-round.mjs` surfaces the reminders + scripts after a parse;
// `ml leagues` prints the full registry; `ml status <round>` shows the matched league.
// Narrative + how to add a league: spec/leagues.md (this module stays authoritative).

import { bareSlugOf } from './paths.mjs';

/**
 * @typedef {Object} LeagueScript
 * @property {string} cmd   Invocation template; `<round>` / `<year>` are filled when known.
 * @property {string} role  One-line description of what the script does for this league.
 *
 * @typedef {Object} League
 * @property {string} id            Stable kebab-case key.
 * @property {string[]} names       Exact league names as they appear in the ML page title.
 * @property {string} slugFamily    Human slug shape (e.g. `bg-<year>`).
 * @property {string[]} slugPrefixes Bare-slug prefixes used to match a round when the
 *                                   league name is absent (text rounds) or unknown.
 * @property {'objective'|'thematic'} mode  Default scoring mode for the league.
 * @property {string} summary       One-line description of the league.
 * @property {string[]} [reminders] Standing eligibility / DQ / scoring reminders.
 * @property {LeagueScript[]} [scripts] Reusable scripts for this league.
 * @property {string[]} [rules]     Relevant `.cursor/rules/*.mdc` files.
 * @property {string[]} [skills]    Relevant `.cursor/skills/*` ids.
 * @property {string[]} [fitProfiles] `spec/fit-guidance.md` profile ids.
 * @property {string[]} [refs]      Relevant spec files.
 * @property {'version-earliest'|'earliest-album-release'} [releaseDateRule]
 *                                   Which release-date gate rule applies (spec/release-dates.md).
 */

/** @type {League[]} */
export const LEAGUES = [
  {
    id: 'bg-years',
    names: ['Kpop Boy Group Years'],
    slugFamily: 'bg-<year>',
    slugPrefixes: ['bg-'],
    mode: 'objective',
    summary: 'K-pop songs from a specific release year — boy groups, male soloists, and boy group subunits (one year per round).',
    reminders: [
      'Eligible: boy groups, male soloists, and boy group subunits — disqualify girl-group, female soloist, and male-female collab submissions (write a DQ comment; a text-only comment DQs in objective mode).',
      "Release-year gate (rule: version-earliest — spec/release-dates.md): this version's earliest official release must be the target year. A year-only comment like `2019` DQs a wrong-year pick — years are never scored (spec/score-parsing.md → Years Are Not Scores).",
    ],
    scripts: [
      {
        cmd: 'node scripts/release-year-gate.mjs <round> --year <year> [--fetch]',
        role: 'Gate songs by earliest release year → fit.json (pass/fail); merge with --rank music --gate passFail.',
      },
      {
        cmd: 'node scripts/one-off/bg-year-scan.mjs --year <year>',
        role: 'Seed submission research: scan the library CSV for candidate songs by release year.',
      },
    ],
    rules: ['.cursor/rules/round-slug-naming.mdc'],
    skills: ['submission-song-search'],
    fitProfiles: [],
    releaseDateRule: 'version-earliest',
    refs: ['spec/release-dates.md', 'spec/score-parsing.md'],
  },
  {
    id: 'story-chain',
    names: [],
    slugFamily: 'story-<n>',
    slugPrefixes: ['story-'],
    mode: 'thematic',
    summary: 'Collaborative sentence/story built by chaining song TITLES (lyrics do not matter).',
    reminders: [
      'Judge the TITLE only. Grammar of the attach and an interesting next beat are co-primary; music is a bonus (guidance profile `story-continuation`).',
      'Never grep the song CSVs — use the title scan scripts (they parse only the title column).',
    ],
    scripts: [
      {
        cmd: 'node scripts/title-prefix-scan.mjs <prefix> [...]',
        role: 'Find candidate titles that start with the anchor word(s).',
      },
      {
        cmd: 'node scripts/title-complement-check.mjs --slot <slot>',
        role: 'Tag structural complements for the running stem (default slot: copular).',
      },
      {
        cmd: 'node scripts/title-candidate-score.mjs',
        role: 'Weighted engagement score (scrobbles + Pandora playlist fields) for candidate titles.',
      },
    ],
    rules: ['.cursor/rules/round-slug-naming.mdc', '.cursor/rules/no-grep-csvs.mdc'],
    skills: ['title-chain'],
    fitProfiles: ['story-continuation'],
    refs: ['spec/fit-guidance.md'],
  },
  {
    id: 'tarot',
    names: [],
    slugFamily: 'tarot-<arcana>',
    slugPrefixes: ['tarot-'],
    mode: 'thematic',
    summary: 'One tarot arcana per round; submit a song that fits the card’s archetype.',
    reminders: [
      'Fit is the card’s archetype + personality traits, not just the literal symbol (profile `traits-over-symbols`); judge primarily from lyrics (profile `lyrics-first`).',
    ],
    scripts: [],
    rules: ['.cursor/rules/round-slug-naming.mdc'],
    skills: ['round-fit-research', 'submission-song-search'],
    fitProfiles: ['traits-over-symbols', 'lyrics-first'],
    refs: ['spec/fit-guidance.md', 'spec/fit-evaluation.md'],
  },
  {
    id: 'astrology',
    names: ['Chill Western Astrology League'],
    slugFamily: '<sign>',
    slugPrefixes: [],
    mode: 'thematic',
    summary: 'Western zodiac sign per round; match the sign’s traits / element.',
    reminders: [
      'A shared element across signs (e.g. water) is a positive secondary signal, never a penalty; traits + element together win (profile `traits-over-symbols`); judge from lyrics (`lyrics-first`).',
    ],
    scripts: [],
    rules: [],
    skills: ['round-fit-research', 'submission-song-search'],
    fitProfiles: ['traits-over-symbols', 'lyrics-first'],
    refs: ['spec/fit-guidance.md'],
  },
  {
    id: 'lastfm',
    names: [],
    slugFamily: 'lfm-<topic>',
    slugPrefixes: ['lfm-'],
    mode: 'objective',
    summary: 'Last.fm listening-stats prompts (top tracks, alliteration, curses, …).',
    reminders: [
      'Query the generated Last.fm tables with the scan scripts, never raw grep (spec/lastfm-data.md, no-grep-csvs rule).',
    ],
    scripts: [
      {
        cmd: 'node scripts/lastfm-aggregate.mjs',
        role: 'Regenerate the Last.fm reference tables in data/ref/lastfm/ (title-table via table-map.json).',
      },
      {
        cmd: 'node scripts/lastfm-export.mjs',
        role: 'Export raw Last.fm scrobble data feeding the aggregate tables.',
      },
    ],
    rules: ['.cursor/rules/round-slug-naming.mdc', '.cursor/rules/no-grep-csvs.mdc'],
    skills: ['submission-song-search'],
    fitProfiles: [],
    refs: ['spec/lastfm-data.md'],
  },
  {
    id: 'aaa',
    names: [],
    slugFamily: 'aaa-<topic>',
    slugPrefixes: ['aaa-'],
    mode: 'thematic',
    summary: 'AAA league themed rounds (aaa-<topic>).',
    reminders: [],
    scripts: [],
    rules: ['.cursor/rules/round-slug-naming.mdc'],
    skills: ['submission-song-search', 'round-fit-research'],
    fitProfiles: [],
    refs: [],
  },
  {
    id: 'kpop-themed',
    names: [],
    slugFamily: 'kpop-<theme>',
    slugPrefixes: ['kpop-'],
    mode: 'thematic',
    summary: 'K-pop themed rounds (kpop-<theme>): pick a K-pop song fitting the theme.',
    reminders: [],
    scripts: [],
    rules: ['.cursor/rules/round-slug-naming.mdc'],
    skills: ['submission-song-search', 'round-fit-research'],
    fitProfiles: [],
    refs: ['spec/fit-guidance.md'],
  },
];

function normalize(name) {
  return String(name || '')
    .trim()
    .toLowerCase();
}

const BY_NAME = new Map();
for (const league of LEAGUES) {
  for (const name of league.names) BY_NAME.set(normalize(name), league);
}

/** Descriptor matched by exact league name (case-insensitive), or null. */
export function leagueByName(leagueName) {
  return BY_NAME.get(normalize(leagueName)) || null;
}

/** Descriptor matched by a round id's bare slug prefix (e.g. bg-2018 → bg-years), or null. */
export function leagueBySlug(roundId) {
  if (!roundId) return null;
  const bare = bareSlugOf(roundId);
  for (const league of LEAGUES) {
    if ((league.slugPrefixes || []).some((p) => p && bare.startsWith(p))) return league;
  }
  return null;
}

/**
 * Resolve a league descriptor for a round: prefer the exact league name (from the
 * parsed round), fall back to the round id's slug family. Returns null when unknown.
 */
export function leagueForRound({ roundId = null, leagueName = null } = {}) {
  return leagueByName(leagueName) || leagueBySlug(roundId) || null;
}

/** Fill a script template with the known round id (and year for bg-YYYY slugs). */
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
 * Compact notes block for CLI banners: league name, standing reminders, and one-line
 * script hints. Returns an array of lines (no leading/trailing blanks).
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
  lines.push(`${league.id}  (${league.slugFamily}, ${league.mode})`);
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
