// Shared CLI table cells — scores, modifiers, comments, excluded songs.

import { formatScore, formatMusicModifierFlags } from '../score-core.mjs';
import { truncDisplay } from '../text-width.mjs';
import {
  expandTradeoffRows,
  isExcludedFromAllocation,
  songByIndex,
  songGate,
} from '../tradeoff-rows.mjs';

export { expandTradeoffRows, isExcludedFromAllocation, songByIndex };

/** Score column: numeric score, BLANK (needs input), or - (disqualified / no score). */
export function formatCliScore(s) {
  if (!s) return '';
  if (s.isOwn) return '—';
  if (s.needsUserInput) return 'BLANK';
  if (s.isDisqualified && s.score == null) return '-';
  if (s.score == null) return '-';
  return formatScore(s.score);
}

export function cliShowsCombined(songs = [], ownSongs = []) {
  return [...songs, ...ownSongs].some((s) => s.combinedScore != null);
}

/** Combined column when fit+music ranking is active. */
export function formatCliCombinedScore(s) {
  if (!s) return '';
  if (s.isOwn) return '—';
  if (isExcludedFromAllocation(s)) return '-';
  if (s.combinedScore == null) return '-';
  return formatScore(s.combinedScore);
}

export function formatCliFitScore(s) {
  if (!s) return '';
  if (s.isOwn) return '—';
  if (s.fitScore == null) return '-';
  return formatScore(s.fitScore);
}

/** Score column headers/cells when fit+music blend is active (Music / Fit / Combined). */
export function cliScoreHeaders(showCombined) {
  return showCombined ? ['Music', 'Fit', 'Combined'] : ['Score'];
}

export function cliScoreCells(s, showCombined) {
  if (!showCombined) return [formatCliScore(s)];
  return [formatCliScore(s), formatCliFitScore(s), formatCliCombinedScore(s)];
}

export function formatCliMod(s) {
  if (!s || s.isOwn) return '·';
  const mods = formatMusicModifierFlags(s);
  if (mods) return mods;
  if (s.needsReview) return 'review';
  if (s.needsUserInput) return '·';
  if (s.isDisqualified) return 'DQ';
  if (songGate(s) === 'fail') return 'fail';
  return '·';
}

/** Scoring line only — same first line scoreComment parses; vote prose after \\n stays in JSON/md. */
export function cliCommentText(s) {
  if (!s?.userComment) return '·';
  const t = String(s.userComment).split(/\r?\n/)[0].trim();
  return t || '·';
}

export function formatCliComment(s, max = 28) {
  const t = cliCommentText(s);
  if (t === '·') return t;
  return truncDisplay(t, max);
}

/** Option-column vote cell: plain counts for up; minus sign for down. */
export function fmtCliVoteCell(v, { excluded = false, down = false } = {}) {
  if (excluded) return '-';
  if (v > 0) return down ? `-${v}` : String(v);
  return '·';
}

/** Signed net-vote: +up, -down, or the zero token (· in tables, 0 in prose diffs). */
export function fmtSignedNet(up = 0, down = 0, zero = '·') {
  if (up > 0) return `+${up}`;
  if (down > 0) return `-${down}`;
  return zero;
}

/** Raw-order ballot cell; signed (+/−) only when the round uses both vote banks. */
export function fmtCliBallotVote(s, signed) {
  if (!s) return '';
  if (s.isOwn) return '—';
  if (isExcludedFromAllocation(s)) return '-';
  const up = s.finalVotes ?? s.draftVotes ?? 0;
  const down = s.finalDownvotes ?? s.draftDownvotes ?? 0;
  if (signed) return fmtSignedNet(up, down);
  if (up > 0) return String(up);
  if (down > 0) return String(down);
  return '·';
}

export function fmtCliBallotVoteTotal(upTotal, downTotal, signed) {
  if (!upTotal && !downTotal) return '·';
  if (signed) {
    const up = upTotal > 0 ? `+${upTotal}` : '';
    const down = downTotal > 0 ? `/-${downTotal}` : '';
    return `${up}${down}` || '·';
  }
  if (upTotal > 0 && downTotal > 0) return `${upTotal}/${downTotal}`;
  return String(upTotal || downTotal);
}

/** @deprecated use fmtCliBallotVote */
export function fmtCliSignedVote(s) {
  return fmtCliBallotVote(s, true);
}

/** @deprecated use fmtCliBallotVoteTotal */
export function fmtCliSignedVoteTotal(upTotal, downTotal) {
  return fmtCliBallotVoteTotal(upTotal, downTotal, true);
}
