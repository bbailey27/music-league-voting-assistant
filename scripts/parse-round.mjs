#!/usr/bin/env node
// Deterministic Music League round parser + draft vote allocator.
// Usage: node scripts/parse-round.mjs <round.html|round.txt> [--mode objective|subjective] [--no-json] [--lenient]
//
// HTML and text inputs both emit the same canonical song list, then share the
// scorer/allocator/reporter in score-core.mjs. Scoring reads the USER comment
// only; the submitter quote block is preserved for context but never parsed for
// scoring signals.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import {
  allocate,
  buildMarkdown,
  buildJsonPayload,
  enrichProfileWithBudget,
  formatScore,
} from './score-core.mjs';
import { parseRoundDocument, recoverEscapedSource } from './extract-html.mjs';
import { parseRoundText } from './parse-text.mjs';
import { buildComboBallot } from './render-html-shared.mjs';
import { matchFlag, matchRestFlag, takePositional } from './cli-args.mjs';
import {
  roundIdFromInput,
  musicPaths,
} from './paths.mjs';
import { ensureDateSlugForInput } from './maintain-rounds.mjs';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {
    file: null,
    mode: 'objective',
    json: true,
    lenient: false,
    shape: 'auto',
    downShape: null,
    fit: null,
    rank: null,
    gate: null,
    cutoff: null,
    weights: null,
    pin: [],
    tierCount: null,
    bucketCount: null,
    favoriteBand: null,
    option: null,
    reason: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-json') {
      args.json = false;
      continue;
    }
    if (a === '--lenient') {
      args.lenient = true;
      continue;
    }
    if (a === '--no-favorite-band') {
      args.favoriteBand = false;
      continue;
    }
    const flags = [
      ['mode', (v) => {
        args.mode = v;
      }],
      ['shape', (v) => {
        args.shape = v;
      }],
      ['down-shape', (v) => {
        args.downShape = v;
      }],
      ['fit', (v) => {
        args.fit = v;
      }],
      ['rank', (v) => {
        args.rank = v;
      }],
      ['gate', (v) => {
        args.gate = v;
      }],
      ['cutoff', (v) => {
        args.cutoff = v;
      }],
      ['weights', (v) => {
        args.weights = v;
      }],
      ['pin', (v) => {
        args.pin.push(v);
      }],
      ['tier-count', (v) => {
        args.tierCount = v;
      }],
      ['bucket-count', (v) => {
        args.bucketCount = v;
      }],
      ['favorite-band', (v) => {
        args.favoriteBand = v;
      }],
      ['option', (v) => {
        args.option = v;
      }],
      ['reason', (v) => {
        args.reason = v;
      }],
    ];
    let matched = false;
    for (const [name, setter] of flags) {
      const parse =
        name === 'reason'
          ? (argv, idx, flagName, set) => matchRestFlag(argv, idx, flagName, set)
          : matchFlag;
      const next = parse(argv, i, name, setter);
      if (next != null) {
        i = next;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    if (takePositional(a, args)) continue;
  }
  return args;
}

// Parse manual vote pins from signed "<rawOrderIndex>:<votes>" specs (repeatable
// and/or comma-separated, e.g. --pin 2:2,8:2,6:-2). A positive value pins upvotes,
// a NEGATIVE value pins that many downvotes (6:-2 => two downvotes on song 6).
// Returns { overrides, downOverrides } (each a { index: magnitude } map or undefined)
// for profile.overrides / profile.downOverrides, or undefined when nothing is
// pinned. Throws on garbage.
export function parsePins(specs) {
  const list = (Array.isArray(specs) ? specs : [specs]).filter(Boolean);
  if (!list.length) return undefined;
  const overrides = {};
  const downOverrides = {};
  for (const chunk of list) {
    for (const pair of String(chunk).split(',')) {
      if (!pair.trim()) continue;
      const [idx, votes] = pair.split(':');
      const i = Number(idx);
      const v = Number(votes);
      if (!Number.isInteger(i) || i < 0 || !Number.isInteger(v)) {
        throw new Error(`Invalid --pin "${pair}" (use <rawOrderIndex>:<votes>, negative for downvotes, e.g. 2:2 or 6:-2)`);
      }
      if (v < 0) downOverrides[i] = -v;
      else overrides[i] = v;
    }
  }
  const hasUp = Object.keys(overrides).length > 0;
  const hasDown = Object.keys(downOverrides).length > 0;
  if (!hasUp && !hasDown) return undefined;
  return { overrides: hasUp ? overrides : undefined, downOverrides: hasDown ? downOverrides : undefined };
}

// A pin above a real per-song cap is an invalid ballot (Music League would reject
// it), so it must fail fast rather than be silently clamped down to the cap. Returns
// a human error string for the first offending pin, or null when every pin is within
// caps. A cap of Infinity (Music League "no limit", encoded as 0 → null) never trips.
// Pure (no process.exit) so it is unit-testable; the CLI exits on a non-null result.
export function pinCapError(overrides, downOverrides, upCap, downCap) {
  const check = (map, cap, label, sign) => {
    if (!map || !Number.isFinite(cap)) return null;
    for (const [i, v] of Object.entries(map)) {
      if (v > cap) {
        return (
          `Invalid --pin ${i}:${sign}${v} — exceeds max ${label} per song (${cap}). ` +
          `Lower the pin or check the round's per-song limit.`
        );
      }
    }
    return null;
  };
  return check(overrides, upCap, 'upvotes', '') || check(downOverrides, downCap, 'downvotes', '-');
}

// Loud, unmissable stderr warning when allocation left a bank over/under-filled. The
// allocator emits a `budget-mismatch` tradeoff (so reports surface it too); this
// echoes it to the terminal because the music-only path doesn't otherwise print
// tradeoffs to stdout. A pin is the only thing that can cause this.
function warnBudgetMismatch(tradeoffs) {
  for (const t of (tradeoffs || []).filter((t) => t.kind === 'budget-mismatch')) {
    console.error(`\n${t.question}`);
  }
}

// Validate a positive-integer count flag (shared by --tier-count / --bucket-count).
// Returns the integer, or undefined for falsy input; throws on malformed input.
function parseCountFlag(spec, flag) {
  if (spec == null || spec === '') return undefined;
  const n = Number(spec);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid ${flag} "${spec}" (use a positive integer, e.g. 3)`);
  }
  return n;
}

// Force the number of final POINT tiers (distinct point values, e.g. 0–2 points =
// 3 tiers), overriding the allocator's automatic choice (e.g. to accept a surfaced
// tier-structure option). The allocator picks the best clustering with that many
// tiers.
export function parseTierCount(spec) {
  return parseCountFlag(spec, '--tier-count');
}

// Force the number of score CLUSTERS (buckets, K) the clustering produces — the
// lower-level knob beneath --tier-count. The budget + smoothness still decide how
// many distinct point values those buckets collapse to.
export function parseBucketCount(spec) {
  return parseCountFlag(spec, '--bucket-count');
}

// The favorite top-band merge (R2): scores at/above the floor share one top tier.
// `false` (from --no-favorite-band) disables it; a number sets the floor; null
// leaves the allocator default (80). Returns false | { min } | undefined.
export function parseFavoriteBand(spec) {
  if (spec === false) return false;
  if (spec == null || spec === '') return undefined;
  const n = Number(spec);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid --favorite-band "${spec}" (use a score floor, e.g. 80, or --no-favorite-band)`);
  }
  return { min: n };
}

// Validate the downvote-shape knob (independent of the upvote --shape). Returns the
// canonical shape, or undefined for falsy input; throws on an unknown value.
export function parseDownShape(spec) {
  if (spec == null || spec === '') return undefined;
  const s = String(spec).toLowerCase().trim();
  const canon = { concentrated: 'concentrated', concentrate: 'concentrated', worst: 'concentrated', flat: 'flat', even: 'flat', curved: 'curved', curve: 'curved', bell: 'curved' };
  if (!canon[s]) {
    throw new Error(`Invalid --down-shape "${spec}" (use concentrated, flat, or curved)`);
  }
  return canon[s];
}

// Parse a combined-rank blend from "<fit>:<music>" (e.g. "0.6:0.4"). Values are
// normalized to sum to 1 so combinedScore stays on the 0–100 scale. Returns
// undefined for falsy input; throws on malformed/degenerate input.
export function parseWeights(spec) {
  if (!spec) return undefined;
  const parts = String(spec).split(':');
  if (parts.length !== 2) {
    throw new Error(`Invalid --weights "${spec}" (use <fit>:<music>, e.g. 0.6:0.4)`);
  }
  const fit = Number(parts[0]);
  const music = Number(parts[1]);
  if (!Number.isFinite(fit) || !Number.isFinite(music) || fit < 0 || music < 0 || fit + music <= 0) {
    throw new Error(`Invalid --weights "${spec}" (use non-negative numbers, e.g. 0.6:0.4)`);
  }
  const total = fit + music;
  return { fit: fit / total, music: music / total };
}

// Build the allocation gate from CLI flags. --cutoff takes "axis:min"
// (e.g. fit:68); --gate takes passFail | passFailMaybe.
export function buildGate(args) {
  if (args.cutoff) {
    const [axis, min] = args.cutoff.split(':');
    return { type: 'cutoff', axis: axis || 'fit', min: Number(min) };
  }
  if (args.gate === 'passFail' || args.gate === 'passFailMaybe') return { type: args.gate };
  return undefined;
}

// Parse a saved HTML round via linkedom, then the shared DOM extractor. When the
// page yields no songs, retry against markup recovered from a rich-text-editor
// wrapper (View Source pasted into TextEdit/Notes re-encodes the real round).
function parseRoundHtml(html, mode) {
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

import { reconcileOptionPins, resolveOptionPick, TRADEOFF_OPTION_LETTERS } from './round/pick.mjs';

export { reconcileOptionPins, resolveOptionPick };

// Print a left/right-aligned text table (col 0 + the "Song" col left-aligned).
function printTextTable(headers, rows, songCol) {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((r) => String(r[i] ?? '').length)));
  const fmt = (row) =>
    row.map((c, i) => (i === songCol ? String(c).padEnd(widths[i]) : String(c).padStart(widths[i]))).join('  ');
  console.log(`    ${fmt(headers)}`);
  for (const row of rows) console.log(`    ${fmt(row)}`);
}

// Print a "needs your call" tradeoff to the terminal. Distribution forks
// (tier-structure upvotes / down-structure downvote shapes) render as a single
// song×option comparison table in combined/rank order (for judgment), plus a legend
// naming each option's shape and its selector (--option / --down-shape). Downvote
// magnitudes always display as negative. The raw submission-order ballot is shown
// once by printBallotCli, with a column per up×down combo.
function printTradeoffCli(t) {
  console.log(`  • ${t.question}`);
  const opts = (t.options || []).filter((o) => Array.isArray(o.perSong) && o.perSong.length);
  const isTable = t.kind === 'tier-structure' || t.kind === 'down-structure';
  if (!isTable || !opts.length) return;
  const down = t.kind === 'down-structure';
  const letters = TRADEOFF_OPTION_LETTERS;
  const trunc = (s) => (String(s).length > 28 ? `${String(s).slice(0, 27)}…` : String(s));
  // Downvote options carry positive magnitudes but always display as negative.
  const fmtVote = (v) => (down && v > 0 ? `-${v}` : String(v));

  // Combined/rank order — easiest for judging which songs each option rewards.
  // (The raw submission-order ballot is shown once, combined across up + down, in
  // the report's Vote transfer section — not duplicated per option here.)
  const headers = ['#', 'Song', 'Score', ...opts.map((_, i) => letters[i])];
  const dataRows = opts[0].perSong.map((r, ri) => [
    String(r.rawOrderIndex),
    trunc(r.title),
    formatScore(r.score ?? r.rank),
    ...opts.map((o) => fmtVote(o.perSong[ri]?.votes ?? 0)),
  ]);
  dataRows.push(['', 'Total', '', ...opts.map((o) => fmtVote(o.perSong.reduce((a, s) => a + (s.votes || 0), 0)))]);
  console.log('    — by combined score —');
  printTextTable(headers, dataRows, 1);

  opts.forEach((o, i) => {
    const selector = down ? `--down-shape ${o.downShape}` : `--option ${letters[i]}`;
    const desc = down
      ? o.shape
      : `${o.tierCount} tier${o.tierCount === 1 ? '' : 's'} · ${o.shape}`;
    console.log(`      ${letters[i]}${i === 0 ? ' (default)' : ''}: ${desc} · ${selector}`);
  });
}

// The raw-order ballot: one column per up-option × down-shape combo, each a full
// signed ballot you transcribe straight down. A song an up option upvotes AND a down
// shape downvotes is a `!` conflict (the two disagree) — flagged, never dropped.
function printBallotCli(tradeoffs, songs = [], ownSongs = []) {
  const { combos, rows } = buildComboBallot(tradeoffs, songs, ownSongs);
  if (!combos.length || !rows.length) return;
  if (!combos.some((c) => c.totals.up > 0 || c.totals.down > 0)) return;
  const trunc = (s) => (String(s).length > 28 ? `${String(s).slice(0, 27)}…` : String(s));
  const codeOf = (c) => c.members.map((m) => m.code).join('/');
  const fmt = (v) => {
    if (v === 'own') return '—';
    if (v === 'conflict') return '!';
    if (v > 0) return `+${v}`;
    if (v < 0) return String(v);
    return '·';
  };
  const headers = ['#', 'Song', ...combos.map(codeOf)];
  const dataRows = rows.map((r) => [
    String(r.rawOrderIndex),
    trunc(r.title),
    ...combos.map((c) => fmt(c.perIndex.get(r.rawOrderIndex))),
  ]);
  dataRows.push([
    '',
    'Total ▲/▼',
    ...combos.map((c) => {
      const base = c.totals.down > 0 ? `${c.totals.up}/-${c.totals.down}` : `${c.totals.up}`;
      return c.totals.conflicts > 0 ? `${base} !${c.totals.conflicts}` : base;
    }),
  ]);
  console.log('\nBallot (raw order) — each column is one full ballot (+up / -down); pick one and transcribe straight down:');
  printTextTable(headers, dataRows, 1);
  for (const c of combos) {
    console.log(`  ${codeOf(c)} = ${c.members.map((m) => m.selector || 'default').join(' | ')}`);
  }
  if (combos.some((c) => c.totals.conflicts > 0)) {
    console.log('  ! = up option and down shape disagree for that song — resolve by hand (or pin the downvote).');
  }
}

function slimProfile(profile) {
  const { shape, downShape, gate, weights, rankBy, tierCount, bucketCount, favoriteBand } = profile;
  return { shape, downShape, gate, weights, rankBy, tierCount, bucketCount, favoriteBand };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error(
      'Usage: node scripts/parse-round.mjs <round.html|round.txt> [--mode objective|subjective] [--no-json] [--lenient] [--shape ...] [--down-shape concentrated|flat|curved] [--tier-count <n>] [--bucket-count <n>] [--favorite-band <min>|--no-favorite-band] [--pin <i>:<v>]'
    );
    process.exit(1);
  }
  if (!['objective', 'subjective'].includes(args.mode)) {
    console.error(`Invalid --mode "${args.mode}" (use objective or subjective)`);
    process.exit(1);
  }

  args.file = ensureDateSlugForInput(args.file, { log: console.log });

  const raw = await readFile(args.file, 'utf8');
  const ext = extname(args.file).toLowerCase();
  const parsed =
    ext === '.txt'
      ? parseRoundText(raw, args.mode, { lenient: args.lenient })
      : parseRoundHtml(raw, args.mode);

  if (!parsed.songs.length) {
    console.error(
      `No songs found in ${args.file}. Expected a saved Music League HTML round, or pasted round text.`
    );
    process.exit(1);
  }

  const gate = buildGate(args);
  const weights = parseWeights(args.weights);
  const pins = parsePins(args.pin);
  const overrides = pins?.overrides;
  const downOverrides = pins?.downOverrides;
  // Per-song caps (Music League encodes "no limit" as 0 → null; treat null as
  // unlimited). A pin above a real cap is an INVALID ballot, so error out
  // immediately rather than silently clamping it down to the cap.
  const upCap = parsed.budget?.maxUpvotesPerSong ?? Infinity;
  const downCap = parsed.budget?.maxDownvotesPerSong ?? Infinity;
  const capErr = pinCapError(overrides, downOverrides, upCap, downCap);
  if (capErr) {
    console.error(capErr);
    process.exit(1);
  }
  const tierCount = parseTierCount(args.tierCount);
  const bucketCount = parseBucketCount(args.bucketCount);
  const favoriteBand = parseFavoriteBand(args.favoriteBand);
  const downShape = parseDownShape(args.downShape);
  const profile = enrichProfileWithBudget(
    { shape: args.shape, downShape, gate, weights, overrides, downOverrides, tierCount, bucketCount, favoriteBand },
    parsed.budget
  );
  if (args.rank) profile.rankBy = args.rank;

  const roundId = roundIdFromInput(args.file);

  if (args.fit) {
    console.error(`Deprecated: --fit on parse. Use: just merge ${roundId}`);
    process.exit(1);
  }
  if (args.option != null) {
    const reasonHint = args.reason ? ` --reason "${args.reason}"` : '';
    console.error(`Deprecated: --option on parse. Use: just pick ${roundId} ${args.option}${reasonHint}`);
    process.exit(1);
  }
  if (args.reason != null) {
    console.error(`Deprecated: --reason on parse. Use: just pick ${roundId} <A|B|C> --reason "…"`);
    process.exit(1);
  }

  const budget = parsed.budget.upvoteBankSize ?? 0;
  const cap = parsed.budget.maxUpvotesPerSong ?? Infinity;
  const { tradeoffs } = allocate(parsed.songs, budget, cap, profile);

  const ctx = { ...parsed, mode: args.mode, tradeoffs, pick: null };
  const md = buildMarkdown(ctx);

  const paths = musicPaths(roundId);
  await mkdir(paths.dir, { recursive: true });
  await writeFile(paths.md, md, 'utf8');
  console.log(`Wrote ${paths.md}`);

  if (args.json) {
    const payload = buildJsonPayload({ ...ctx, profile: slimProfile(profile) });
    await writeFile(paths.json, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Wrote ${paths.json}`);
  }

  const calls = tradeoffs.filter((t) => t.kind !== 'budget-mismatch');
  if (calls.length) {
    console.log(`\n${calls.length} tradeoff(s) need your call — use just pick ${roundId} <A|B|C> --reason "…"`);
    for (const t of calls) printTradeoffCli(t);
  }
  printBallotCli(tradeoffs, parsed.songs, parsed.ownSongs);
  warnBudgetMismatch(tradeoffs);
}

// Only run the CLI when executed directly, so helpers (e.g. parseWeights) can be
// imported by tests without triggering a parse.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
