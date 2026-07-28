// Shared explore pipeline: unpinned menu → pin reflow → ballot sync → CLI tables.

import { allocate, mergeFitJson } from '../score-core.mjs';
import { printPickCli } from '../parse/cli-print.mjs';
import { slimProfile, warnBudgetMismatch } from '../parse/pipeline.mjs';
import {
  applyPinsToMenuTradeoffs,
  menuProfile,
  syncBallotFromExploreMenu,
} from './pick.mjs';

/** True when parse should chain mergeFitJson (fit.json + blend-stage CLI flags). */
export function parseWantsThematicMerge(args, fitJsonExists) {
  if (!fitJsonExists) return false;
  return (
    args.weights != null ||
    args.rank != null ||
    args.gate != null ||
    args.cutoff != null
  );
}

/**
 * Build unpinned menu tradeoffs, reflow explore pins across all options, sync ballot
 * preview from option A.
 */
export function exploreAllocate({
  songs,
  budget,
  profile,
  fitData = null,
  parsed = null,
  useMerge = false,
}) {
  const upCap = budget?.maxUpvotesPerSong ?? Infinity;
  const downCap = budget?.maxDownvotesPerSong ?? Infinity;
  const upBudget = budget?.upvoteBankSize ?? 0;
  const menu = menuProfile(profile);

  let tradeoffs;
  if (useMerge && fitData && parsed) {
    ({ tradeoffs } = mergeFitJson(parsed, fitData, menu));
  } else {
    ({ tradeoffs } = allocate(songs, upBudget, upCap, menu));
  }

  const pinNotes = applyPinsToMenuTradeoffs(tradeoffs, {
    overrides: profile.overrides,
    downOverrides: profile.downOverrides,
    upCap,
    downCap,
  });
  syncBallotFromExploreMenu(tradeoffs, songs);

  return { tradeoffs, pinNotes };
}

/** Print explore tables; warn when a scored field should have surfaced a menu. */
export function finishExploreCli({ tradeoffs, roundId, songs, ownSongs, budget, profile, pinNotes = [] }) {
  for (const n of pinNotes) console.log(`  ${n}`);
  warnBudgetMismatch(tradeoffs);
  const slim = slimProfile(profile);
  printPickCli(tradeoffs, roundId, songs, ownSongs, budget, slim);

  const upBudget = budget?.upvoteBankSize ?? 0;
  const scored = (songs || []).filter(
    (s) => s.score != null && !s.isDisqualified && !s.isOwn && !s.needsUserInput
  );
  if (upBudget > 0 && scored.length && !(tradeoffs || []).some((t) => t.kind === 'tier-structure')) {
    console.error('Warning: no upvote option menu surfaced — budget may be unallocatable.');
  }
  return slim;
}
