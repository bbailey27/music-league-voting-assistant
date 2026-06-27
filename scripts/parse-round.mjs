#!/usr/bin/env node
// Deterministic Music League round parser + draft vote allocator.
// Usage: node scripts/parse-round.mjs <round.html|round.txt> [--mode objective|subjective] [--no-json] [--lenient] [--fit-words]
//
// HTML and text inputs both emit the same canonical song list, then share the
// scorer/allocator/reporter in score-core.mjs. Scoring reads the USER comment
// only; the submitter quote block is preserved for context but never parsed for
// scoring signals.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  allocate,
  buildMarkdown,
  buildJsonPayload,
  enrichProfileWithBudget,
  combinedScore,
  MANUAL_FIT_WEIGHTS,
} from './score-core.mjs';
import { parseRoundText } from './parse-text.mjs';
import { matchFlag, matchRestFlag, takePositional } from './cli-args.mjs';
import { roundIdFromInput, musicPaths } from './paths.mjs';
import { ensureDateSlugForInput } from './maintain-rounds.mjs';
import {
  parsePins,
  pinCapError,
  parseTierCount,
  parseBucketCount,
  parseFavoriteBand,
  parseDownShape,
  parseWeights,
  buildGate,
} from './parse/cli-flags.mjs';
import { printTradeoffCli, printBallotCli } from './parse/cli-print.mjs';
import { parseRoundHtml, warnBudgetMismatch, slimProfile } from './parse/pipeline.mjs';
import { reconcileOptionPins, resolveOptionPick } from './round/pick.mjs';

export {
  parsePins,
  pinCapError,
  parseTierCount,
  parseBucketCount,
  parseFavoriteBand,
  parseDownShape,
  parseWeights,
  buildGate,
  reconcileOptionPins,
  resolveOptionPick,
};

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
    fitWords: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fit-words') {
      args.fitWords = true;
      continue;
    }
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error(
      'Usage: node scripts/parse-round.mjs <round.html|round.txt> [--mode objective|subjective] [--no-json] [--lenient] [--fit-words] [--shape ...] [--down-shape concentrated|flat|curved] [--tier-count <n>] [--bucket-count <n>] [--favorite-band <min>|--no-favorite-band] [--pin <i>:<v>]'
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
  const parseOpts = { lenient: args.lenient, fitWords: args.fitWords };
  const parsed =
    ext === '.txt'
      ? parseRoundText(raw, args.mode, parseOpts)
      : parseRoundHtml(raw, args.mode, parseOpts);

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

  const hasManualFit = parsed.songs.some(
    (s) => s.fitSource === 'manual' && (s.fitScore != null || s.gate != null)
  );
  let combineWeights = null;
  if (hasManualFit && !args.rank) {
    combineWeights = parseWeights(args.weights) || MANUAL_FIT_WEIGHTS;
    profile.rankBy = 'combined';
    profile.weights = combineWeights;
    for (const s of parsed.songs) s.combinedScore = combinedScore(s, combineWeights);
  }

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
    const payload = buildJsonPayload({ ...ctx, profile: slimProfile(profile), combineWeights });
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
