// Browser explore pipeline — unpinned menu, pin reflow, ballot sync.

import { allocate } from './score-core.mjs';
import {
  applyPinsToMenuTradeoffs,
  cloneTradeoffs,
  menuProfile,
  syncBallotFromExploreMenu,
} from './web-pick-core.mjs';

export function exploreAllocate({ songs, budget, profile }) {
  const upCap = budget?.maxUpvotesPerSong ?? Infinity;
  const downCap = budget?.maxDownvotesPerSong ?? Infinity;
  const upBudget = budget?.upvoteBankSize ?? 0;
  const menu = menuProfile(profile);

  const { tradeoffs } = allocate(songs, upBudget, upCap, menu);
  const menuTradeoffs = cloneTradeoffs(tradeoffs);
  const pinNotes = applyPinsToMenuTradeoffs(tradeoffs, {
    overrides: profile.overrides,
    downOverrides: profile.downOverrides,
    upCap,
    downCap,
  });
  syncBallotFromExploreMenu(tradeoffs, songs);

  return { tradeoffs, menuTradeoffs, pinNotes };
}
