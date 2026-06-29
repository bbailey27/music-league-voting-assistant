// Shared CLI table cells — scores, modifiers, comments, excluded songs.

import { formatScore, formatMusicModifierFlags } from '../score-core.mjs';

export function songByIndex(songs = [], ownSongs = []) {
  const m = new Map();
  for (const s of [...songs, ...ownSongs]) m.set(s.rawOrderIndex, s);
  return m;
}

export function isExcludedFromAllocation(s) {
  return !!s && !s.isOwn && s.isDisqualified;
}

/** Score column: numeric score, BLANK (needs input), or - (disqualified / no score). */
export function formatCliScore(s) {
  if (!s) return '';
  if (s.isOwn) return '—';
  if (s.needsUserInput) return 'BLANK';
  if (s.isDisqualified && s.score == null) return '-';
  if (s.score == null) return '-';
  return formatScore(s.score);
}

export function formatCliMod(s) {
  if (!s || s.isOwn) return '·';
  const mods = formatMusicModifierFlags(s);
  if (mods) return mods;
  if (s.needsReview) return 'review';
  if (s.needsUserInput) return '·';
  if (s.isDisqualified) return 'DQ';
  return '·';
}

export function formatCliComment(s, max = 28) {
  if (!s?.userComment) return '·';
  const t = String(s.userComment).trim();
  if (!t) return '·';
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** perSong rows plus missing/disqualified songs appended (raw order). */
export function expandTradeoffRows(perSong, songs = [], ownSongs = []) {
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
    .filter((s) => !included.has(s.rawOrderIndex) && !s.isOwn && (s.needsUserInput || s.isDisqualified))
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

export function fmtCliVoteCell(v, { down = false, excluded = false } = {}) {
  if (excluded) return '-';
  if (down && v > 0) return `-${v}`;
  if (v > 0) return String(v);
  return '·';
}

export function fmtCliBallotCell(v, excluded = false) {
  if (excluded) return '-';
  if (v === 'own') return '—';
  if (v === 'conflict') return '!';
  if (v > 0) return `+${v}`;
  if (v < 0) return String(v);
  return '·';
}
