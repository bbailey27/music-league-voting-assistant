#!/usr/bin/env node
// JSON-only re-blend + re-allocate. Load music.json (+ fit.json for thematic),
// recompute combinedScore from the stored music score + fitScore under new
// weights/knobs, re-run the draft menu allocation, reset any committed pick back to
// draft, and rewrite music.md/json. Never reads round HTML, never re-scans comments
// for fit/tier/gate words (that stays in `parse`), and never writes picks.jsonl.
//
// Usage: node scripts/rescore-round.mjs <round-id> [--weights fit:music] [--shape ...]
//        [--gate ...] [--cutoff ...] [--down-shape ...] [--tier-count N]
//        [--bucket-count N] [--favorite-band ...] [--rank ...] [--pin ...] [--dry-run]

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  buildMarkdown,
  buildJsonPayload,
  enrichProfileWithBudget,
} from './score-core.mjs';
import { applyManualFitScoring } from './parse-round.mjs';
import { matchRepeatableFlag, warnUnknownShortFlags, expandShortFlags } from './cli-args.mjs';
import { musicPaths, fitPaths } from './paths.mjs';
import { slimProfile } from './parse/pipeline.mjs';
import { exploreAllocate, finishExploreCli } from './round/explore.mjs';
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
  parseScoreOverrides,
  resolveSongRefs,
} from './parse/cli-flags.mjs';
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
    pin: [],
    reset: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (a === '--reset') {
      args.reset = true;
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
      ['pin', (v) => args.pin.push(v)],
    ];
    let matched = false;
    for (const [name, setter] of flags) {
      const next = matchRepeatableFlag(argv, i, name, setter);
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

function resolveExplorePins(args) {
  if (!args.pin.length) return { overrides: undefined, downOverrides: undefined };
  const pins = parsePins(args.pin);
  return { overrides: pins?.overrides, downOverrides: pins?.downOverrides };
}

// Numeric keys: JSON round-trips override maps with string keys; allocation code
// indexes by Number(rawOrderIndex), so normalize on the way in.
function normalizedPins(map) {
  if (!map) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(map)) out[Number(k)] = v;
  return Object.keys(out).length ? out : undefined;
}

// Pins are additive across rescore runs: stored pins (music.json profile) merge with
// any new --pin values, and a new value for the same song replaces the old one. The
// reset flag starts from this invocation's pins alone (--reset also clears the
// stored knobs — see buildProfile).
function mergeExplorePins(stored, resolved, reset) {
  if (reset) return resolved;
  return {
    overrides: mergePinMaps(stored?.overrides, resolved.overrides),
    downOverrides: mergePinMaps(stored?.downOverrides, resolved.downOverrides),
  };
}

function mergePinMaps(stored, incoming) {
  if (stored == null || !Object.keys(stored).length) return incoming;
  if (incoming == null || !Object.keys(incoming).length) return normalizedPins(stored);
  return { ...normalizedPins(stored), ...incoming };
}

// Cleared knobs vanish via undefined spreads, but slimProfile omits empty pin maps
// entirely — strip them from the stored profile so the JSON payload loses them too.
function withoutStoredPins(stored) {
  const copy = { ...(stored || {}) };
  delete copy.overrides;
  delete copy.downOverrides;
  return copy;
}

// "2:3, 6:-1" — sorted by song, downvote magnitudes signed negative.
function pinsLabel(overrides, downOverrides) {
  const entries = [];
  for (const [i, v] of Object.entries(overrides || {})) {
    if (Number(v) !== 0 || downOverrides?.[Number(i)] == null) entries.push([Number(i), Number(v)]);
  }
  for (const [i, v] of Object.entries(downOverrides || {})) {
    if (Number(v) !== 0 || overrides?.[Number(i)] == null) entries.push([Number(i), -Number(v)]);
  }
  entries.sort((a, b) => a[0] - b[0]);
  return entries.map(([i, v]) => `${i}:${v}`).join(', ');
}

function noteExplorePins(args, stored, merged, reset) {
  if (reset) {
    console.log('--reset: stored knobs and pins cleared (manual --score edits kept — a full reset is just parse <round>).');
  }
  const label = pinsLabel(merged.overrides, merged.downOverrides);
  if (!label) return;
  const incoming = resolveExplorePins(args);
  if (reset || !(incoming.overrides || incoming.downOverrides)) {
    // Only stored pins (or only fresh ones after reset) — skip the noise unless it
    // could surprise: stored pins shape the menu silently otherwise.
    if (!reset && (stored?.overrides || stored?.downOverrides)) {
      console.log(`Pins carried from earlier runs: ${label} (pass --reset to clear).`);
    }
    return;
  }
  console.log(`Pins (stored ⊕ --pin): ${label} — pass --reset to clear stored.`);
}

function applyScoreOverrides(songs, overrides) {
  if (!overrides || !overrides.length) return false;
  const byIdx = new Map(songs.map((s) => [s.rawOrderIndex, s]));
  for (const ov of overrides) {
    const s = byIdx.get(ov.idx);
    if (!s) {
      console.error(`Invalid --score ${ov.idx}:${ov.disqualified ? 'DQ' : ov.score} — no song with rawOrderIndex ${ov.idx}.`);
      process.exit(1);
    }
    if (ov.disqualified) {
      if (!s.isDisqualified) {
        console.log(`Disqualified #${ov.idx} ${s.title || ''} — excluded from allocation (previous score, if any, stays on the record).`);
      }
      s.isDisqualified = true;
      s.needsUserInput = false;
      s.needsReview = false;
    } else {
      if (s.isDisqualified) {
        console.log(`Un-disqualified #${ov.idx} ${s.title || ''} — a manually added score counts the song (comment text stays).`);
      }
      s.score = ov.score;
      s.plus = ov.plus;
      s.minus = ov.minus;
      s.uncertain = ov.uncertain;
      s.plusUncertain = ov.plusUncertain;
      s.minusUncertain = ov.minusUncertain;
      s.playlistAdd = ov.playlistAdd;
      s.playlistUncertain = ov.playlistUncertain;
      s.needsUserInput = false;
      s.isDisqualified = false;
      s.needsReview = false;
      s.reviewReason = '';
    }
  }
  return true;
}

// DQ is a song-level state, never a fit value — whichever flag carries it
// (--score i:DQ or --fit-score <ref>:DQ) writes it to the music song record so
// it holds in both music-only and merged rounds.
function applySongDisqualifications(songs, disqualifications, flag) {
  if (!disqualifications || !disqualifications.length) return false;
  const byIdx = new Map(songs.map((s) => [s.rawOrderIndex, s]));
  for (const ov of disqualifications) {
    const s = byIdx.get(ov.idx);
    if (!s) {
      console.error(`Invalid ${flag} ${ov.idx}:DQ — no song with rawOrderIndex ${ov.idx}.`);
      process.exit(1);
    }
    if (!s.isDisqualified) {
      console.log(`Disqualified #${ov.idx} ${s.title || ''} — excluded from allocation (kept score, if any, stays on the record).`);
    }
    s.isDisqualified = true;
    s.needsUserInput = false;
    s.needsReview = false;
  }
  return true;
}

function applyFitScoreOverrides(songs, overrides, where) {
  if (!overrides || !overrides.length) return false;
  const byIdx = new Map(songs.map((s) => [s.rawOrderIndex, s]));
  for (const ov of overrides) {
    if (ov.disqualified) continue; // song-level state — applied via applySongDisqualifications
    const s = byIdx.get(ov.idx);
    if (!s) {
      console.error(`Invalid --fit-score ${ov.idx}:${ov.score} — no song with rawOrderIndex ${ov.idx} in ${where}.`);
      process.exit(1);
    }
    s.fitScore = ov.score;
    s.playlistAdd = ov.playlistAdd;
    s.playlistUncertain = ov.playlistUncertain;
  }
  return true;
}

function buildProfile(args, stored, budget, mode) {
  const reset = args.reset === true;
  const gate = buildGate(args) ?? (reset ? undefined : stored?.gate);
  const weights = parseWeights(args.weights) ?? (reset ? undefined : stored?.weights);
  const { overrides, downOverrides } = mergeExplorePins(stored, resolveExplorePins(args), reset);
  const tierCount = parseTierCount(args.tierCount) ?? (reset ? undefined : stored?.tierCount);
  const bucketCount = parseBucketCount(args.bucketCount) ?? (reset ? undefined : stored?.bucketCount);
  const optionCount = parseOptionCount(args.optionCount) ?? (reset ? undefined : stored?.optionCount);
  const favoriteBand =
    args.favoriteBand !== null
      ? parseFavoriteBand(args.favoriteBand)
      : reset
        ? undefined
        : stored?.favoriteBand;
  const downShape = parseDownShape(args.downShape) ?? (reset ? undefined : stored?.downShape);
  const shape = args.shape ?? (reset ? 'auto' : (stored?.shape ?? 'auto'));
  const rankBy =
    args.rank ??
    (reset
      ? mode === 'thematic'
        ? 'combined'
        : 'music'
      : (stored?.rankBy ?? (mode === 'thematic' ? 'combined' : 'music')));
  const fitTrust = reset ? undefined : stored?.fitTrust;
  return enrichProfileWithBudget(
    {
      shape,
      downShape,
      gate,
      weights,
      overrides,
      downOverrides,
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

async function main() {
  const argv = expandShortFlags(process.argv.slice(2));
  warnUnknownShortFlags(argv);
  const args = parseArgs(argv);
  if (!args.roundId) {
    console.error(
      'Usage: just rescore <round-id> [--weights fit:music] [--shape …] [--gate …] [--down-shape …] ' +
        '[--rank …] [--options N] [--tier-count N] [--bucket-count N] [--pin <i>:<v>] ' +
        '[--score <i>:<v>] [--fit-score <i>:<v>] [--reset] [--dry-run]'
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
  const downCap = budget?.maxDownvotesPerSong ?? Infinity;
  const profile = buildProfile(args, musicData.profile, budget, musicData.mode);
  noteExplorePins(args, musicData.profile, profile, args.reset === true);
  const capErr = pinCapError(profile.overrides, profile.downOverrides, upCap, downCap);
  if (capErr) {
    console.error(capErr);
    process.exit(1);
  }

  const songs = songsFromPayload(musicData);
  const scoreOverrides = parseScoreOverrides(resolveSongRefs(args.score, songs, '--score'));
  const fitScoreOverrides = parseScoreOverrides(
    resolveSongRefs(args.fitScore, songs, '--fit-score'),
    '--fit-score'
  );
  // DQ is song-level: a --fit-score <ref>:DQ lands on the music song record,
  // the same place --score i:DQ writes — so it holds in either mode.
  const fitDqOverrides = (fitScoreOverrides || []).filter((o) => o.disqualified);
  const fitNumericOverrides = fitScoreOverrides?.some((o) => !o.disqualified)
    ? fitScoreOverrides.filter((o) => !o.disqualified)
    : undefined;
  let scoreDirty =
    applyScoreOverrides(songs, scoreOverrides) ||
    applySongDisqualifications(songs, fitDqOverrides, '--fit-score');

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
    fitDirty = applyFitScoreOverrides(fitData.songs || [], fitNumericOverrides, fitJson);
  } else if (applyFitScoreOverrides(songs, fitNumericOverrides, musicJson)) {
    scoreDirty = true;
  }

  let combineWeights = null;
  if (!useMerge) {
    combineWeights = applyManualFitScoring(profile, songs, {
      explicitRank: args.rank,
      weights: profile.weights,
    });
  }

  const parsed = { round: musicData.round, budget, songs, ownSongs };
  const { tradeoffs, menuTradeoffs, pinNotes } = exploreAllocate({
    songs,
    budget,
    profile: useMerge
      ? { ...profile, rankBy: args.rank ?? musicData.profile?.rankBy ?? 'combined' }
      : profile,
    fitData,
    parsed,
    useMerge,
  });

  if (useMerge) {
    combineWeights = fitData.combineWeights ?? profile.weights ?? null;
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
    warnMissingScoresCli(songs);
    warnMissingFitScoresCli(songs);
    finishExploreCli({ tradeoffs, roundId, songs, ownSongs, budget, profile, pinNotes });
    return;
  }

  if (fitDirty) {
    await writeFile(fitJson, `${JSON.stringify(fitData, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${fitJson} (fit-score override)`);
  }

  const ctx = {
    round: musicData.round,
    budget,
    songs,
    totalSongs: musicData.totals?.totalSongs ?? songs.length,
    ownSkipped: musicData.totals?.ownSkipped ?? 0,
    ownSongs,
    mode: musicData.mode,
    tradeoffs,
    menuTradeoffs,
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
    profile: { ...(args.reset ? withoutStoredPins(musicData.profile) : musicData.profile || {}), ...slim },
    combineWeights,
  });
  await writeFile(paths.json, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Wrote ${paths.json}`);
  if (musicData.pick) {
    console.log('Reset committed pick to draft — re-run just pick to commit a distribution.');
  }

  warnMissingScoresCli(songs);
  warnMissingFitScoresCli(songs);
  finishExploreCli({ tradeoffs, roundId, songs, ownSongs, budget, profile, pinNotes });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
