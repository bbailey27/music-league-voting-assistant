#!/usr/bin/env node
// Deterministic Music League round parser + draft vote allocator.
// Usage: node scripts/parse-round.mjs <round.html|round.txt> [--mode objective|subjective] [--no-json] [--lenient]
//
// HTML and text inputs both emit the same canonical song list, then share the
// scorer/allocator/reporter in score-core.mjs. Scoring reads the USER comment
// only; the submitter quote block is preserved for context but never parsed for
// scoring signals.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import {
  allocate,
  buildMarkdown,
  buildJsonPayload,
  mergeFitJson,
  enrichProfileWithBudget,
  formatScore,
  buildPickRecord,
} from './score-core.mjs';
import { parseRoundDocument, recoverEscapedSource } from './extract-html.mjs';
import { parseRoundText } from './parse-text.mjs';
import { matchFlag, takePositional } from './cli-args.mjs';
import {
  roundIdFromInput,
  musicPaths,
  scoresPaths,
} from './paths.mjs';

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
      const next = matchFlag(argv, i, name, setter);
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

// Parse manual vote pins from "<rawOrderIndex>:<votes>" specs (repeatable and/or
// comma-separated, e.g. --pin 2:2,8:2). Returns an overrides map { index: votes }
// for profile.overrides, or undefined when nothing is pinned. Throws on garbage.
export function parsePins(specs) {
  const list = (Array.isArray(specs) ? specs : [specs]).filter(Boolean);
  if (!list.length) return undefined;
  const overrides = {};
  for (const chunk of list) {
    for (const pair of String(chunk).split(',')) {
      if (!pair.trim()) continue;
      const [idx, votes] = pair.split(':');
      const i = Number(idx);
      const v = Number(votes);
      if (!Number.isInteger(i) || i < 0 || !Number.isInteger(v) || v < 0) {
        throw new Error(`Invalid --pin "${pair}" (use <rawOrderIndex>:<votes>, e.g. 2:2)`);
      }
      overrides[i] = v;
    }
  }
  return Object.keys(overrides).length ? overrides : undefined;
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
function buildGate(args) {
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

const TRADEOFF_OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

// Resolve an --option spec ("A".."F" or "1".."n") to a 0-based index, or null.
function resolveOptionIndex(spec, count) {
  if (!count) return null;
  const s = String(spec).trim();
  let idx = null;
  if (/^[A-Za-z]$/.test(s)) idx = s.toUpperCase().charCodeAt(0) - 65;
  else if (/^\d+$/.test(s)) idx = Number(s) - 1;
  return idx != null && idx >= 0 && idx < count ? idx : null;
}

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
// (tier-structure) render as TWO song×option comparison tables — one in
// combined/rank order (for judgment), one in raw submission order incl. the
// owner's own (unvotable) song (for entering straight into the app) — plus a
// legend that names each option's distinct vote shape and its --option selector.
function printTradeoffCli(t, ownSongs = []) {
  console.log(`  • ${t.question}`);
  const opts = (t.options || []).filter((o) => Array.isArray(o.perSong) && o.perSong.length);
  if (t.kind !== 'tier-structure' || !opts.length) return;
  const letters = TRADEOFF_OPTION_LETTERS;
  const trunc = (s) => (String(s).length > 28 ? `${String(s).slice(0, 27)}…` : String(s));

  // Combined/rank order — easiest for judging which songs each option rewards.
  const headers = ['#', 'Song', 'Score', ...opts.map((_, i) => letters[i])];
  const dataRows = opts[0].perSong.map((r, ri) => [
    String(r.rawOrderIndex),
    trunc(r.title),
    formatScore(r.score ?? r.rank),
    ...opts.map((o) => String(o.perSong[ri]?.votes ?? 0)),
  ]);
  dataRows.push(['', 'Total', '', ...opts.map((o) => String(o.perSong.reduce((a, s) => a + (s.votes || 0), 0)))]);
  console.log('    — by combined score —');
  printTextTable(headers, dataRows, 1);

  // Raw submission order — every slot present (incl. your own song) so a column
  // transcribes straight into the app without a pick command.
  const byIdx = opts.map((o) => new Map(o.perSong.map((s) => [s.rawOrderIndex, s.votes])));
  const slots = [
    ...opts[0].perSong.map((s) => ({ i: s.rawOrderIndex, title: s.title, own: false })),
    ...(ownSongs || []).map((s) => ({ i: s.rawOrderIndex, title: s.title, own: true })),
  ].sort((a, b) => a.i - b.i);
  const rawRows = slots.map((r) => [
    String(r.i),
    trunc(r.title),
    ...opts.map((_, k) => (r.own ? '—' : String(byIdx[k].get(r.i) ?? 0))),
  ]);
  rawRows.push(['', 'Total', ...opts.map((o) => String(o.perSong.reduce((a, s) => a + (s.votes || 0), 0)))]);
  console.log('    — raw submission order (for app entry) —');
  printTextTable(['#', 'Song', ...opts.map((_, i) => letters[i])], rawRows, 1);

  opts.forEach((o, i) => {
    console.log(
      `      ${letters[i]}${i === 0 ? ' (default)' : ''}: ${o.tierCount} tier${
        o.tierCount === 1 ? '' : 's'
      } · ${o.shape} · --option ${letters[i]}`
    );
  });
}

// Append one self-contained line to the global training log (analysis/picks.jsonl):
// the round, the chosen option + reason + tweaks, every option that was presented
// (as votes-by-index), and a compact score snapshot of the field. One growing
// dataset of "options shown → what was chosen and why" across rounds.
async function recordPickToTrainingLog(roundId, fitData, pick) {
  const logPath = join(dirname(scoresPaths(roundId).dir), 'picks.jsonl');
  const entry = {
    round: roundId,
    pickedAt: pick.pickedAt,
    chosen: pick.chosen,
    tierCount: pick.tierCount,
    shape: pick.shape,
    reason: pick.reason,
    tweaks: pick.tweaks,
    options: pick.options.map((o) => ({
      letter: o.letter,
      tierCount: o.tierCount,
      bucketCount: o.bucketCount,
      shape: o.shape,
      isChosen: o.isChosen,
      votesByIndex: Object.fromEntries(o.perSong.map((s) => [s.rawOrderIndex, s.votes])),
    })),
    field: (fitData.songs || []).map((s) => ({
      rawOrderIndex: s.rawOrderIndex,
      title: s.title,
      artist: s.artist,
      fitScore: s.fitScore ?? null,
      fitTier: s.fitTier ?? null,
      musicScore: s.musicScore ?? null,
      combinedScore: s.combinedScore ?? null,
      draftVotes: s.draftVotes ?? 0,
    })),
  };
  // Idempotent per round: re-running a pick replaces that round's prior line rather
  // than appending a duplicate, so the log stays one-row-per-round for training.
  let prior = [];
  try {
    prior = (await readFile(logPath, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .filter((l) => {
        try {
          return JSON.parse(l).round !== roundId;
        } catch {
          return true;
        }
      });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  await writeFile(logPath, `${[...prior, JSON.stringify(entry)].join('\n')}\n`, 'utf8');
  console.log(`Logged pick to ${logPath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error(
      'Usage: node scripts/parse-round.mjs <round.html|round.txt> [--mode objective|subjective] [--no-json] [--lenient] [--shape ...] [--tier-count <n>] [--bucket-count <n>] [--option <A|B|C> [--reason "why"]] [--favorite-band <min>|--no-favorite-band] [--pin <i>:<v>] [--fit <fit.json> [--rank combined] [--weights <fit>:<music>] [--gate ...] [--cutoff ...]]'
    );
    process.exit(1);
  }
  if (!['objective', 'subjective'].includes(args.mode)) {
    console.error(`Invalid --mode "${args.mode}" (use objective or subjective)`);
    process.exit(1);
  }

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
  const overrides = parsePins(args.pin);
  const tierCount = parseTierCount(args.tierCount);
  const bucketCount = parseBucketCount(args.bucketCount);
  const favoriteBand = parseFavoriteBand(args.favoriteBand);
  const profile = enrichProfileWithBudget(
    { shape: args.shape, gate, weights, overrides, tierCount, bucketCount, favoriteBand },
    parsed.budget
  );
  if (args.rank) profile.rankBy = args.rank;

  // Merge path: join an LLM fit JSON with the parsed music scores, allocate on
  // the blend, and write draftVotes back into the fit JSON for render-fit-html.
  if (args.fit) {
    const fitRaw = await readFile(args.fit, 'utf8');
    let fitData;
    try {
      fitData = JSON.parse(fitRaw);
    } catch (err) {
      console.error(`Could not parse fit JSON from ${args.fit}: ${err.message}`);
      process.exit(1);
    }
    const roundId = roundIdFromInput(args.file);
    const mergeProfile = {
      ...enrichProfileWithBudget(profile, parsed.budget),
      rankBy: args.rank || 'combined',
    };
    let { tradeoffs } = mergeFitJson(parsed, fitData, mergeProfile);

    // --option <A|B|C…> picks a distribution fork by its column letter and applies
    // it deterministically (sugar over per-song pins), so a pick is one clean flag
    // even when two options happen to share a tier/bucket-count label.
    if (args.option != null) {
      // The presented menu must be free of the user's tweak pins: a `--pin` alongside
      // `--option` should read as a manual tweak ON TOP of the chosen option, not get
      // baked into the menu (a pinned song is otherwise pulled out of the tier pool,
      // so it'd vanish from every option and the tweak couldn't be diffed).
      let menuTradeoffs = tradeoffs;
      if (profile.overrides && Object.keys(profile.overrides).length) {
        ({ tradeoffs: menuTradeoffs } = mergeFitJson(parsed, fitData, { ...mergeProfile, overrides: undefined }));
      }
      const ts = menuTradeoffs.find((t) => t.kind === 'tier-structure');
      // Capture the options that were presented BEFORE applying the pick — the pick
      // record (and HTML) keep them visible even though the second pass clears the
      // live tradeoff.
      const presented = (ts?.options || []).filter((o) => Array.isArray(o.perSong) && o.perSong.length);
      const idx = resolveOptionIndex(args.option, presented.length);
      if (idx == null) {
        console.error(
          `--option "${args.option}" is not available (this round has ${presented.length || 0} option(s): ${presented
            .map((_, i) => String.fromCharCode(65 + i))
            .join(', ') || 'none'}).`
        );
        process.exit(1);
      }
      const chosen = presented[idx];
      const overrides = {
        ...Object.fromEntries(chosen.perSong.map((s) => [s.rawOrderIndex, s.votes])),
        ...(profile.overrides || {}),
      };
      ({ tradeoffs } = mergeFitJson(parsed, fitData, { ...mergeProfile, overrides }));

      const pick = buildPickRecord({
        options: presented,
        chosenIndex: idx,
        songs: parsed.songs,
        reason: args.reason,
      });
      fitData.pick = pick;
      await recordPickToTrainingLog(roundId, fitData, pick);

      console.log(
        `Applied option ${pick.chosen} — ${pick.tierCount} tier${pick.tierCount === 1 ? '' : 's'}, ${pick.shape}.` +
          (pick.tweaks.length ? ` (${pick.tweaks.length} manual tweak${pick.tweaks.length === 1 ? '' : 's'})` : '') +
          (pick.reason ? ` Reason: ${pick.reason}` : '')
      );
    } else if (args.reason != null) {
      console.error('--reason needs an --option pick to attach to; ignoring.');
    }

    const scoresOut = scoresPaths(roundId).json;
    await mkdir(scoresPaths(roundId).dir, { recursive: true });
    await writeFile(scoresOut, JSON.stringify(fitData, null, 2), 'utf8');
    console.log(`Wrote ${scoresOut} (merged scores + draftVotes; fit-only source unchanged: ${args.fit})`);
    if (tradeoffs.length) {
      console.log(`\n${tradeoffs.length} tradeoff(s) need your call:`);
      for (const t of tradeoffs) printTradeoffCli(t, parsed.ownSongs);
    }
    return;
  }

  const { tradeoffs } = allocate(
    parsed.songs,
    parsed.budget.upvoteBankSize ?? 0,
    parsed.budget.maxUpvotesPerSong ?? Infinity,
    profile
  );

  const ctx = { ...parsed, mode: args.mode, tradeoffs };
  const md = buildMarkdown(ctx);

  const roundId = roundIdFromInput(args.file);
  const paths = musicPaths(roundId);
  await mkdir(paths.dir, { recursive: true });
  await writeFile(paths.md, md, 'utf8');
  console.log(`Wrote ${paths.md}`);

  if (args.json) {
    const payload = buildJsonPayload(ctx);
    await writeFile(paths.json, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Wrote ${paths.json}`);
  }
}

// Only run the CLI when executed directly, so helpers (e.g. parseWeights) can be
// imported by tests without triggering a parse.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
