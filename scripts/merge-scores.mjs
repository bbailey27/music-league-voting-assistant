#!/usr/bin/env node
// Merge music.json + fit.json → scores.json (no HTML, no pick).
//
// Usage: node scripts/merge-scores.mjs <round-id> [--rank combined|fit|music]
//        [--weights <fit>:<music>] [--gate passFail|passFailMaybe] [--cutoff axis:min]
//        [--shape ...] [--down-shape ...] [--pin ...] [--tier-count n] [--bucket-count n]

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { mergeFitJson, enrichProfileWithBudget } from './score-core.mjs';
import { matchFlag } from './cli-args.mjs';
import { musicPaths, fitPaths, scoresPaths } from './paths.mjs';
import { printPickCli } from './parse/cli-print.mjs';
import {
  parsePins,
  pinCapError,
  parseTierCount,
  parseBucketCount,
  parseOptionCount,
  parseFavoriteBand,
  parseDownShape,
  parseWeights,
  buildGate,
} from './parse/cli-flags.mjs';

function parseArgs(argv) {
  const args = {
    roundId: null,
    shape: null,
    downShape: null,
    rank: null,
    gate: null,
    cutoff: null,
    weights: null,
    pin: [],
    tierCount: null,
    bucketCount: null,
    optionCount: null,
    favoriteBand: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-favorite-band') {
      args.favoriteBand = false;
      continue;
    }
    const flags = [
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
    if (!args.roundId && !a.startsWith('-')) {
      args.roundId = a;
      continue;
    }
  }
  return args;
}

function songsFromMusicPayload(data) {
  return (data.songs || []).map((s) => ({ ...s }));
}

function slimProfile(profile) {
  const {
    shape,
    downShape,
    gate,
    weights,
    rankBy,
    tierCount,
    bucketCount,
    optionCount,
    favoriteBand,
    fitTrust,
  } = profile;
  return {
    shape,
    downShape,
    gate,
    weights,
    rankBy,
    tierCount,
    bucketCount,
    optionCount,
    favoriteBand,
    fitTrust,
  };
}

function buildProfile(args, stored, budget) {
  const gate = buildGate(args) ?? stored?.gate;
  const weights = parseWeights(args.weights) ?? stored?.weights;
  const pins = parsePins(args.pin.length ? args.pin : undefined);
  const overrides = pins?.overrides ?? stored?.overrides;
  const downOverrides = pins?.downOverrides ?? stored?.downOverrides;
  const tierCount = parseTierCount(args.tierCount) ?? stored?.tierCount;
  const bucketCount = parseBucketCount(args.bucketCount) ?? stored?.bucketCount;
  const optionCount = parseOptionCount(args.optionCount) ?? stored?.optionCount;
  const favoriteBand = args.favoriteBand !== null ? parseFavoriteBand(args.favoriteBand) : stored?.favoriteBand;
  const downShape = parseDownShape(args.downShape) ?? stored?.downShape;
  const shape = args.shape ?? stored?.shape ?? 'auto';
  const rankBy = args.rank ?? stored?.rankBy ?? 'combined';
  return enrichProfileWithBudget(
    { shape, downShape, gate, weights, overrides, downOverrides, tierCount, bucketCount, optionCount, favoriteBand, rankBy },
    budget
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.roundId) {
    console.error(
      'Usage: node scripts/merge-scores.mjs <round-id> [--rank combined] [--weights <fit>:<music>] [--gate ...] [--cutoff ...] [--shape ...] [--pin ...]'
    );
    process.exit(1);
  }

  const roundId = args.roundId;
  const musicJson = musicPaths(roundId).json;
  const fitJson = fitPaths(roundId).json;
  const scoresOut = scoresPaths(roundId).json;

  let musicData;
  try {
    musicData = JSON.parse(await readFile(musicJson, 'utf8'));
  } catch (err) {
    console.error(`Could not read ${musicJson}: ${err.message}. Run just parse first.`);
    process.exit(1);
  }

  let fitData;
  try {
    fitData = JSON.parse(await readFile(fitJson, 'utf8'));
  } catch (err) {
    console.error(`Could not read ${fitJson}: ${err.message}. Complete fit research first.`);
    process.exit(1);
  }

  const budget = musicData.budget;
  const upCap = budget?.maxUpvotesPerSong ?? Infinity;
  const downCap = budget?.maxDownvotesPerSong ?? Infinity;
  const profile = buildProfile(args, musicData.profile, budget);
  const capErr = pinCapError(profile.overrides, profile.downOverrides, upCap, downCap);
  if (capErr) {
    console.error(capErr);
    process.exit(1);
  }

  const parsed = {
    round: musicData.round,
    budget: musicData.budget,
    songs: songsFromMusicPayload(musicData),
    ownSongs: musicData.ownSongs || [],
  };

  const { fitData: merged, tradeoffs } = mergeFitJson(parsed, fitData, profile);

  await mkdir(scoresPaths(roundId).dir, { recursive: true });
  await writeFile(scoresOut, JSON.stringify(merged, null, 2), 'utf8');
  console.log(`Wrote ${scoresOut} (merged scores + draftVotes; fit source unchanged: ${fitJson})`);

  printPickCli(tradeoffs, roundId, parsed.songs, parsed.ownSongs, parsed.budget, slimProfile(profile));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
