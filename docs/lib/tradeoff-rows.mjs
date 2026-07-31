// Shared tradeoff-table row expansion — songs omitted from the allocation pool
// (blank score, music DQ, gate/cutoff fail) append at the bottom with dash vote cells.

export { songGate, gateClass, isExcludedFromAllocation } from './score/gate.mjs';

import { isExcludedFromAllocation } from './score/gate.mjs';

export function songByIndex(songs = [], ownSongs = []) {
  const m = new Map();
  for (const s of [...songs, ...ownSongs]) m.set(s.rawOrderIndex, s);
  return m;
}

/** perSong rows plus pool-excluded songs appended (raw order). */
export function expandTradeoffRows(perSong, songs = [], ownSongs = [], profile = null) {
  const byIdx = songByIndex(songs, ownSongs);
  const included = new Set((perSong || []).map((r) => r.rawOrderIndex));
  const core = (perSong || []).map((r, ri) => ({
    rawOrderIndex: r.rawOrderIndex,
    title: r.title,
    ri,
    song: byIdx.get(r.rawOrderIndex),
    excluded: false,
  }));
  const tail = [...(songs || []), ...(ownSongs || [])]
    .filter((s) => !included.has(s.rawOrderIndex) && isExcludedFromAllocation(s, profile))
    .sort((a, b) => a.rawOrderIndex - b.rawOrderIndex)
    .map((s) => ({
      rawOrderIndex: s.rawOrderIndex,
      title: s.title,
      ri: null,
      song: s,
      excluded: true,
    }));
  return [...core, ...tail];
}
