#!/usr/bin/env node
// Recover story-3 fit + merged scores from chat ab209b37 (2026-06-10).
//
// Why a driver instead of plain `parse-round --fit`:
//   Every song has a manual fit token in the user comment ("6 fit", "85 fit", …).
//   Those were starting notes; the chat's G/C axis research superseded them.
//   comment-derived fit (fitSource 'manual') wins over fit.json, so we clear
//   those fields before merge — same pattern as kpop-solo-versions.mjs.
//
// Final ballot: the ACTUAL votes Bridget cast, verified against the platform
// results (not the chat reconstruction). It's a 1-point swap off the chat draft —
// Trade Hearts 2→1, Burn Your Village 0→1 ("liked the music"). 10 up / 5 down.
// The fit research (G/C axes) is still the chat's; only draftVotes are ground truth.
// Allocator tiering won't reproduce this concentrated shape, so votes are set here.
//
// Run: node scripts/one-off/story-3-recover.mjs

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { mergeFitJson, fitTierForScore } from '../score-core.mjs';
import {
  fitPaths,
  scoresPaths,
  roundAnalysisDir,
  inputPathFor,
  stripScoresFields,
} from '../paths.mjs';
import { loadParsedFromHtml, render, clearManualFit } from './_helpers.mjs';

const ROUND_ID = '2026-06-10-story-3';

// Actual cast ballot (Bridget), confirmed against the platform results.
// rawOrderIndex 3 = "Wish You Were Here" (SuperM), Bridget's own submission — not votable.
const CAST_VOTES = {
  0: { up: 0, down: 2 }, // Play Noble
  1: { up: 2, down: 0 }, // Got A Call
  2: { up: 1, down: 0 }, // Burn Your Village (swapped up off the chat draft — liked the music)
  4: { up: 0, down: 0 }, // Drink Deep
  5: { up: 0, down: 0 }, // Laugh It Off
  6: { up: 2, down: 0 }, // Said I Loved You...But I Lied
  7: { up: 0, down: 0 }, // Spin The Bottle
  8: { up: 0, down: 0 }, // Had A Talk
  9: { up: 0, down: 0 }, // Drink Before the War
  10: { up: 2, down: 0 }, // Watching A Good Thing Burn
  11: { up: 2, down: 0 }, // Breathing the Same Air
  12: { up: 1, down: 0 }, // Trade Hearts (1 point moved to Burn Your Village)
  13: { up: 0, down: 1 }, // Plan For My Escape - Vol.1
  14: { up: 0, down: 1 }, // WE MADE PLANS & GOD LAUGHED
  15: { up: 0, down: 1 }, // Turn Loose the Mermaids
};

// Music-hedge composite: 0.45×C + 0.20×G + 0.35×M  →  0.65 fit + 0.35 music
const MERGE_WEIGHTS = { fit: 0.65, music: 0.35 };

function applyCastVotes(songs, fitSongs) {
  const byIndex = new Map(songs.map((s) => [s.rawOrderIndex, s]));
  let upTotal = 0;
  let downTotal = 0;
  for (const f of fitSongs) {
    const v = CAST_VOTES[f.rawOrderIndex];
    if (!v) continue;
    f.draftVotes = v.up;
    f.draftDownvotes = v.down;
    upTotal += v.up;
    downTotal += v.down;
    const s = byIndex.get(f.rawOrderIndex);
    if (s) {
      s.finalVotes = v.up;
      s.finalDownvotes = v.down;
    }
  }
  return { upTotal, downTotal };
}

async function main() {
  const fitOnlyPath = fitPaths(ROUND_ID).json;
  const fitOnlyRaw = await readFile(fitOnlyPath, 'utf8');
  const fitOnly = JSON.parse(fitOnlyRaw);

  const html = await readFile(inputPathFor(ROUND_ID), 'utf8');
  const parsed = loadParsedFromHtml(html, 'subjective');
  clearManualFit(parsed.songs);

  const fitWorking = JSON.parse(JSON.stringify(fitOnly));
  for (const f of fitWorking.songs) {
    if (f.fitScore != null && !f.fitTier) f.fitTier = fitTierForScore(f.fitScore);
  }

  const { tradeoffs } = mergeFitJson(parsed, fitWorking, {
    rankBy: 'combined',
    weights: MERGE_WEIGHTS,
  });

  const { upTotal, downTotal } = applyCastVotes(parsed.songs, fitWorking.songs);
  fitWorking.combineWeights = MERGE_WEIGHTS;
  fitWorking.recovery = {
    fitSource: 'chat ab209b37-ea4d-42f7-bd24-bbf918a51174 (G/C axis research)',
    ballot: 'actual cast votes (Bridget), confirmed against platform results',
    draftVotesHandSet: true,
    reason: 'ground-truth ballot; tier allocator does not reproduce the concentrated +2 shape',
    note: '1-point swap off the chat draft: Trade Hearts 2→1, Burn Your Village 0→1',
  };

  const dir = roundAnalysisDir(ROUND_ID);
  await mkdir(dir, { recursive: true });

  await writeFile(fitOnlyPath, `${JSON.stringify(stripScoresFields(fitOnly), null, 2)}\n`, 'utf8');

  const scoresJson = scoresPaths(ROUND_ID).json;
  await writeFile(scoresJson, `${JSON.stringify(fitWorking, null, 2)}\n`, 'utf8');

  await render(fitOnlyPath, fitPaths(ROUND_ID).html, 'fit');
  await render(scoresJson, scoresPaths(ROUND_ID).html, 'raw');

  console.log(`Wrote ${fitOnlyPath} (fit-only)`);
  console.log(`Wrote ${scoresJson} (merged; draftVotes = actual cast ballot)`);
  console.log(`Upvotes ${upTotal}/10 · Downvotes ${downTotal}/5`);
  if (tradeoffs.length) {
    console.log(`Allocator tradeoffs (informational; votes overridden): ${tradeoffs.length}`);
    for (const t of tradeoffs) console.log(`  • ${t.question}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
