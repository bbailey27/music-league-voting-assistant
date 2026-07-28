#!/usr/bin/env node
// Deterministic Music League round parser + draft vote allocator.
// Usage: node scripts/parse-round.mjs <round.html|round.txt> [--mode objective|subjective] [--no-json] [--lenient] [--fit [tier|gate]]
//
// HTML and text inputs both emit the same canonical song list, then share the
// scorer/allocator/reporter in score-core.mjs. Scoring reads the USER comment
// only; the submitter quote block is preserved for context but never parsed for
// scoring signals.

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildMarkdown,
  buildJsonPayload,
  enrichProfileWithBudget,
  normalizeCombined,
  applyNumericFitAutoDetect,
  MANUAL_FIT_WEIGHTS,
} from './score-core.mjs';
import { parseRoundText } from './parse-text.mjs';
import { matchFlag, matchRestFlag, takePositional } from './cli-args.mjs';
import { roundIdFromInput, musicPaths } from './paths.mjs';
import { ensureDateSlugForInput } from './maintain-rounds.mjs';
import {
  parsePins,
  pinCapError,
  pinEligibilityError,
  parseTierCount,
  parseBucketCount,
  parseOptionCount,
  parseFavoriteBand,
  parseDownShape,
  parseWeights,
  buildGate,
} from './parse/cli-flags.mjs';
import { warnMissingScoresCli, warnMissingFitScoresCli } from './parse/cli-warn.mjs';
import { parseRoundHtml, slimProfile } from './parse/pipeline.mjs';
import { reconcileOptionPins, resolveOptionPick } from './round/pick.mjs';
import { exploreAllocate, finishExploreCli, parseWantsThematicMerge } from './round/explore.mjs';
import { leagueForRound, leagueNotesLines } from './leagues.mjs';
import { fitPaths, scoresPaths } from './paths.mjs';

export {
  parsePins,
  pinCapError,
  pinEligibilityError,
  parseTierCount,
  parseBucketCount,
  parseFavoriteBand,
  parseDownShape,
  parseWeights,
  buildGate,
  reconcileOptionPins,
  resolveOptionPick,
};

// When comments carry manual fit scores, populate combinedScore and default rankBy
// to combined unless the caller already passed --rank.
export function applyManualFitScoring(profile, songs, { explicitRank = null, weights = undefined } = {}) {
  const hasManualFit = songs.some(
    (s) => s.fitSource === 'manual' && (s.fitScore != null || s.gate != null)
  );
  if (!hasManualFit) return null;

  // Auto-activate the gate when comments carry gate words but the caller didn't set
  // an explicit --gate / --cutoff. A parsed per-song `gate` is inert unless
  // `profile.gate` turns the gate machinery on (gateClass short-circuits to 'pass'
  // otherwise), so without this a high-music "maybe"/"fail" would rank at the top.
  // `passFailMaybe` when any maybe is present, else binary `passFail`.
  if (!profile.gate) {
    const gates = new Set(songs.map((s) => s.gate).filter(Boolean));
    if (gates.size) {
      profile.gate = { type: gates.has('maybe') ? 'passFailMaybe' : 'passFail' };
    }
  }

  const combineWeights = weights ?? MANUAL_FIT_WEIGHTS;
  profile.weights = combineWeights;
  profile.fitTrust = 'manual';
  normalizeCombined(songs, combineWeights, profile.gate, { fitTrust: 'manual' });
  if (!explicitRank) profile.rankBy = 'combined';
  return combineWeights;
}

function resolveExplorePins(args) {
  if (!args.pin.length) return { overrides: undefined, downOverrides: undefined };
  const pins = parsePins(args.pin);
  return { overrides: pins?.overrides, downOverrides: pins?.downOverrides };
}

function parseArgs(argv) {
  const args = {
    file: null,
    mode: 'objective',
    json: true,
    lenient: false,
    shape: 'auto',
    downShape: null,
    fitMode: null,
    rank: null,
    gate: null,
    cutoff: null,
    weights: null,
    pin: [],
    tierCount: null,
    bucketCount: null,
    optionCount: null,
    favoriteBand: null,
    option: null,
    reason: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // `--fit` scans tier words; `--fit gate` scans gate words (only the literal
    // `tier`/`gate` is consumed as the value, so a following round name is safe).
    // `--fit-words` is the legacy spelling of `--fit`.
    if (a === '--fit-words') {
      args.fitMode = 'tier';
      continue;
    }
    if (a === '--fit') {
      const next = argv[i + 1];
      if (next === 'tier' || next === 'gate') {
        args.fitMode = next;
        i++;
      } else {
        args.fitMode = 'tier';
      }
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
      ['options', (v) => {
        args.optionCount = v;
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
      'Usage: node scripts/parse-round.mjs <round.html|round.txt> [--mode objective|subjective] [--no-json] [--lenient] [--fit [tier|gate]] [--shape ...] [--down-shape concentrated|flat|curved] [--tier-count <n>] [--bucket-count <n>] [--favorite-band <min>|--no-favorite-band] [--pin <i>:<v>]'
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
  const parseOpts = {
    lenient: args.lenient,
    tierWords: args.fitMode === 'tier',
    gateWords: args.fitMode === 'gate',
  };
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

  // Round-wide: if most scored songs wrote a 2nd number, treat it as fit (no flag).
  applyNumericFitAutoDetect(parsed.songs);

  const gate = buildGate(args);
  const weights = parseWeights(args.weights);
  const { overrides, downOverrides } = resolveExplorePins(args);
  const upCap = parsed.budget?.maxUpvotesPerSong ?? Infinity;
  const downCap = parsed.budget?.maxDownvotesPerSong ?? Infinity;
  const capErr = pinCapError(overrides, downOverrides, upCap, downCap);
  if (capErr) {
    console.error(capErr);
    process.exit(1);
  }
  const tierCount = parseTierCount(args.tierCount);
  const bucketCount = parseBucketCount(args.bucketCount);
  const optionCount = parseOptionCount(args.optionCount);
  const favoriteBand = parseFavoriteBand(args.favoriteBand);
  const downShape = parseDownShape(args.downShape);
  const profile = enrichProfileWithBudget(
    { shape: args.shape, downShape, gate, weights, overrides, downOverrides, tierCount, bucketCount, optionCount, favoriteBand },
    parsed.budget
  );
  const combineWeights = applyManualFitScoring(profile, parsed.songs, {
    explicitRank: args.rank,
    weights,
  });
  if (args.rank) profile.rankBy = args.rank;

  const roundId = roundIdFromInput(args.file);

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
  const fitJson = fitPaths(roundId).json;
  const fitJsonExists = existsSync(fitJson);
  const thematicMerge = parseWantsThematicMerge(args, fitJsonExists);

  let fitData = null;
  if (thematicMerge) {
    try {
      fitData = JSON.parse(await readFile(fitJson, 'utf8'));
    } catch (err) {
      console.error(`Could not read ${fitJson}: ${err.message}. Complete fit research first.`);
      process.exit(1);
    }
  }

  const { tradeoffs, menuTradeoffs, pinNotes } = exploreAllocate({
    songs: parsed.songs,
    budget: parsed.budget,
    profile,
    fitData,
    parsed,
    useMerge: thematicMerge,
  });

  const slim = slimProfile(profile);
  const ctx = { ...parsed, mode: args.mode, tradeoffs, menuTradeoffs, pick: null, roundId, profile: slim };
  const md = buildMarkdown(ctx);

  const paths = musicPaths(roundId);
  await mkdir(paths.dir, { recursive: true });
  await writeFile(paths.md, md, 'utf8');
  console.log(`Wrote ${paths.md}`);

  if (args.json) {
    const payload = buildJsonPayload({ ...ctx, profile: slim, combineWeights });
    await writeFile(paths.json, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Wrote ${paths.json}`);
  }

  if (thematicMerge && fitData) {
    fitData.tradeoffs = tradeoffs;
    fitData.menuTradeoffs = menuTradeoffs;
    fitData.combineWeights = profile.weights ?? fitData.combineWeights;
    const scoresOut = scoresPaths(roundId).json;
    await mkdir(scoresPaths(roundId).dir, { recursive: true });
    await writeFile(scoresOut, JSON.stringify(fitData, null, 2), 'utf8');
    console.log(`Wrote ${scoresOut} (thematic merge from fit.json + parse flags)`);
  }

  const league = leagueForRound({ roundId, leagueName: parsed.round?.league });
  const notes = leagueNotesLines(league, { roundId });
  if (notes.length) console.log(`\n${notes.join('\n')}`);

  warnMissingScoresCli(parsed.songs);
  warnMissingFitScoresCli(parsed.songs);

  finishExploreCli({
    tradeoffs,
    roundId,
    songs: parsed.songs,
    ownSongs: parsed.ownSongs,
    budget: parsed.budget,
    profile,
    pinNotes,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
