#!/usr/bin/env node
// JSON-only re-blend + re-allocate. Load music.json (+ fit.json for thematic),
// recompute combinedScore from the stored music score + fitScore under new
// weights/knobs, re-run the draft menu allocation, reset any committed pick back to
// draft, and rewrite music.md/json. Never reads round HTML, never re-scans comments
// for fit/tier/gate words (that stays in `parse`), and never writes picks.jsonl.
//
// Usage: node scripts/rescore-round.mjs <round-id> [--weights fit:music] [--shape ...]
//        [--gate ...] [--cutoff ...] [--down-shape ...] [--tier-count N]
//        [--bucket-count N] [--favorite-band ...] [--rank ...] [--dry-run]

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  allocate,
  buildMarkdown,
  buildJsonPayload,
  mergeFitJson,
  enrichProfileWithBudget,
} from './score-core.mjs';
import { applyManualFitScoring } from './parse-round.mjs';
import { matchFlag, warnUnknownShortFlags } from './cli-args.mjs';
import { musicPaths, fitPaths } from './paths.mjs';
import {
  parseTierCount,
  parseBucketCount,
  parseOptionCount,
  parseFavoriteBand,
  parseDownShape,
  parseWeights,
  buildGate,
  parseScoreOverrides,
} from './parse/cli-flags.mjs';
import { printPickCli } from './parse/cli-print.mjs';
import { warnMissingScoresCli, warnMissingFitScoresCli } from './parse/cli-warn.mjs';

function parseArgs(argv) {
  const args = {
    roundId: null,
    dryRun: false,
    shape: null,
    downShape: null,
    rank: null,
    gate: null,
    cutoff: null,
    weights: null,
    tierCount: null,
    bucketCount: null,
    optionCount: null,
    favoriteBand: null,
    score: [],
    fitScore: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (a === '--no-favorite-band') {
      args.favoriteBand = false;
      continue;
    }
    const flags = [
      ['shape', (v) => (args.shape = v)],
      ['down-shape', (v) => (args.downShape = v)],
      ['rank', (v) => (args.rank = v)],
      ['gate', (v) => (args.gate = v)],
      ['cutoff', (v) => (args.cutoff = v)],
      ['weights', (v) => (args.weights = v)],
      ['tier-count', (v) => (args.tierCount = v)],
      ['bucket-count', (v) => (args.bucketCount = v)],
      ['options', (v) => (args.optionCount = v)],
      ['favorite-band', (v) => (args.favoriteBand = v)],
      ['score', (v) => args.score.push(v)],
      ['fit-score', (v) => args.fitScore.push(v)],
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

function songsFromPayload(data) {
  return (data.songs || []).map((s) => ({ ...s }));
}

// Apply `--score` overrides onto the music songs in place: set the raw score and its
// +/-/? modifier flags so the change sticks with no HTML re-parse. Exits on a bad idx.
function applyScoreOverrides(songs, overrides) {
  if (!overrides) return false;
  const byIdx = new Map(songs.map((s) => [s.rawOrderIndex, s]));
  for (const ov of overrides) {
    const s = byIdx.get(ov.idx);
    if (!s) {
      console.error(`Invalid --score ${ov.idx}:${ov.score} — no song with rawOrderIndex ${ov.idx}.`);
      process.exit(1);
    }
    s.score = ov.score;
    s.plus = ov.plus;
    s.minus = ov.minus;
    s.uncertain = ov.uncertain;
    s.plusUncertain = ov.plusUncertain;
    s.minusUncertain = ov.minusUncertain;
  }
  return true;
}

// Apply `--fit-score` overrides onto a fit-song list in place (music.json songs for a
// manual-fit round, or fit.json songs for a merge round). Exits on a bad idx.
function applyFitScoreOverrides(songs, overrides, where) {
  if (!overrides) return false;
  const byIdx = new Map(songs.map((s) => [s.rawOrderIndex, s]));
  for (const ov of overrides) {
    const s = byIdx.get(ov.idx);
    if (!s) {
      console.error(`Invalid --fit-score ${ov.idx}:${ov.score} — no song with rawOrderIndex ${ov.idx} in ${where}.`);
      process.exit(1);
    }
    s.fitScore = ov.score;
  }
  return true;
}

// Merge knobs over the stored profile (same precedence as pick's buildProfile).
// rescore takes no pins — it re-weights and re-shapes the draft menu, not a ballot.
function buildProfile(args, stored, budget, mode) {
  const gate = buildGate(args) ?? stored?.gate;
  const weights = parseWeights(args.weights) ?? stored?.weights;
  const tierCount = parseTierCount(args.tierCount) ?? stored?.tierCount;
  const bucketCount = parseBucketCount(args.bucketCount) ?? stored?.bucketCount;
  const optionCount = parseOptionCount(args.optionCount) ?? stored?.optionCount;
  const favoriteBand =
    args.favoriteBand !== null ? parseFavoriteBand(args.favoriteBand) : stored?.favoriteBand;
  const downShape = parseDownShape(args.downShape) ?? stored?.downShape;
  const shape = args.shape ?? stored?.shape ?? 'auto';
  const rankBy = args.rank ?? stored?.rankBy ?? (mode === 'thematic' ? 'combined' : 'music');
  const fitTrust = stored?.fitTrust;
  return enrichProfileWithBudget(
    {
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
    },
    budget
  );
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

async function main() {
  const argv = process.argv.slice(2);
  warnUnknownShortFlags(argv);
  const args = parseArgs(argv);
  if (!args.roundId) {
    console.error(
      'Usage: just rescore <round-id> [--weights fit:music] [--shape …] [--gate …] [--down-shape …] ' +
        '[--rank …] [--options N] [--tier-count N] [--bucket-count N] [--score <i>:<v>] [--fit-score <i>:<v>] [--dry-run]'
    );
    process.exit(1);
  }

  const roundId = args.roundId;
  const musicJson = musicPaths(roundId).json;
  const fitJson = fitPaths(roundId).json;
  const useMerge = existsSync(fitJson);

  let musicData;
  try {
    musicData = JSON.parse(await readFile(musicJson, 'utf8'));
  } catch (err) {
    console.error(`Could not read ${musicJson}: ${err.message}. Run just parse first.`);
    process.exit(1);
  }

  const budget = musicData.budget;
  const upCap = budget?.maxUpvotesPerSong ?? Infinity;
  const upBudget = budget?.upvoteBankSize ?? 0;
  const profile = buildProfile(args, musicData.profile, budget, musicData.mode);
  const songs = songsFromPayload(musicData);

  // Manual raw-score overrides (no HTML re-parse): --score writes the music score +
  // modifier onto music.json; --fit-score writes the fit score onto fit.json (merge
  // round) or the music song's fitScore (manual-fit round). Applied before allocation
  // so the menu reflects the new numbers; persisted below (unless --dry-run).
  const scoreOverrides = parseScoreOverrides(args.score);
  const fitScoreOverrides = parseScoreOverrides(args.fitScore, '--fit-score');
  let scoreDirty = applyScoreOverrides(songs, scoreOverrides);

  let tradeoffs;
  let combineWeights;
  let fitData = null;
  let fitDirty = false;
  const ownSongs = musicData.ownSongs || [];

  if (useMerge) {
    try {
      fitData = JSON.parse(await readFile(fitJson, 'utf8'));
    } catch (err) {
      console.error(`Could not read ${fitJson}: ${err.message}. Complete fit research first.`);
      process.exit(1);
    }
    fitDirty = applyFitScoreOverrides(fitData.songs || [], fitScoreOverrides, fitJson);
    const parsed = { round: musicData.round, budget, songs, ownSongs };
    const merged = mergeFitJson(parsed, fitData, {
      ...profile,
      rankBy: args.rank ?? musicData.profile?.rankBy ?? 'combined',
    });
    tradeoffs = merged.tradeoffs;
    combineWeights = fitData.combineWeights ?? profile.weights ?? null;
  } else {
    // Non-merge: the fit score lives on the music song and is re-persisted with it, so
    // fold a --fit-score into the music-json write rather than a separate fit.json.
    if (applyFitScoreOverrides(songs, fitScoreOverrides, musicJson)) scoreDirty = true;
    combineWeights = applyManualFitScoring(profile, songs, {
      explicitRank: args.rank,
      weights: profile.weights,
    });
    tradeoffs = allocate(songs, upBudget, upCap, profile).tradeoffs;
  }

  const slim = slimProfile(profile);

  if (args.dryRun) {
    const w = slim.weights ?? combineWeights;
    const wLabel = w
      ? `weights ${Math.round((w.fit ?? 0) * 10)}:${Math.round((w.music ?? 0) * 10)} (fit:music)`
      : 'stored weights';
    const ovLabel =
      scoreDirty || fitDirty
        ? ` [${[scoreDirty && '--score', fitDirty && '--fit-score'].filter(Boolean).join(' + ')} applied]`
        : '';
    console.log(`Would rescore ${roundId} (${wLabel})${ovLabel} → ${musicJson} (pick reset to draft)`);
    return;
  }

  if (fitDirty) {
    await writeFile(fitJson, `${JSON.stringify(fitData, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${fitJson} (fit-score override)`);
  }

  // Reset any committed pick to draft: no `pick`, songs carry the re-allocated draft.
  const ctx = {
    round: musicData.round,
    budget,
    songs,
    totalSongs: musicData.totals?.totalSongs ?? songs.length,
    ownSkipped: musicData.totals?.ownSkipped ?? 0,
    ownSongs,
    mode: musicData.mode,
    tradeoffs,
    pick: null,
    roundId,
    profile: slim,
  };

  const paths = musicPaths(roundId);
  await mkdir(paths.dir, { recursive: true });
  await writeFile(paths.md, buildMarkdown(ctx), 'utf8');
  console.log(`Wrote ${paths.md}`);

  const payload = buildJsonPayload({
    ...ctx,
    profile: { ...(musicData.profile || {}), ...slim },
    combineWeights,
  });
  await writeFile(paths.json, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Wrote ${paths.json}`);
  if (musicData.pick) {
    console.log('Reset committed pick to draft — re-run just pick to commit a distribution.');
  }

  warnMissingScoresCli(songs);
  warnMissingFitScoresCli(songs);
  printPickCli(tradeoffs, roundId, songs, ownSongs, budget, slim);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
