// Terminal print helpers for parse / pick tradeoff menus.

import { TRADEOFF_OPTION_LETTERS } from '../round/pick.mjs';
import { downShapeShort, formatPickCmd, formatPickSpec, pickHintLine } from '../cli-commands.mjs';
import {
  cliScoreCells,
  cliScoreHeaders,
  cliShowsCombined,
  expandTradeoffRows,
  fmtCliBallotVote,
  fmtCliBallotVoteTotal,
  fmtCliVoteCell,
  fmtSignedNet,
  formatCliComment,
  formatCliMod,
  isExcludedFromAllocation,
} from './cli-table.mjs';
import { displayWidth, padEndDisplay, padStartDisplay, truncDisplay } from '../text-width.mjs';
import { computeCliCommentWidth } from '../ml-config.mjs';

const SONG_COL = 1;

function commentColIndex(headers) {
  return headers.indexOf('Comment');
}

function printTextTable(headers, rows) {
  const commentCol = commentColIndex(headers);
  const leftCols = new Set([SONG_COL]);
  if (commentCol >= 0) leftCols.add(commentCol);

  const commentMax = commentCol >= 0 ? computeCliCommentWidth(headers, rows) : null;
  const minWidths = commentCol >= 0 ? { [commentCol]: commentMax } : {};

  const all = [headers, ...rows];
  const widths = headers.map((_, i) => {
    const contentW = Math.max(...all.map((r) => displayWidth(r[i] ?? '')));
    const floor = minWidths[i];
    return floor != null ? Math.max(contentW, floor) : contentW;
  });
  const fmt = (row) =>
    row
      .map((c, i) =>
        leftCols.has(i) ? padEndDisplay(c, widths[i]) : padStartDisplay(c, widths[i])
      )
      .join('  ');
  console.log(`    ${fmt(headers)}`);
  for (const row of rows) console.log(`    ${fmt(row)}`);
}

function buildTableRows(headers, mkRow) {
  const draftRows = mkRow(Number.MAX_SAFE_INTEGER);
  const commentMax = computeCliCommentWidth(headers, draftRows);
  return mkRow(commentMax);
}

const truncTitle = (s) => truncDisplay(s, 24);

function rawOrderRows(songs = [], ownSongs = []) {
  return [...songs, ...ownSongs].sort((a, b) => (a.rawOrderIndex ?? 0) - (b.rawOrderIndex ?? 0));
}

function printRawBallotTable(title, rows, showCombined, signed) {
  if (!rows.length) return;
  const scoreHdrs = cliScoreHeaders(showCombined);
  const headers = ['#', 'Song', ...scoreHdrs, 'Mod', 'Votes', 'Comment'];
  let upTotal = 0;
  let downTotal = 0;
  for (const s of rows) {
    if (!s.isOwn && !isExcludedFromAllocation(s)) {
      upTotal += s.finalVotes ?? s.draftVotes ?? 0;
      downTotal += s.finalDownvotes ?? s.draftDownvotes ?? 0;
    }
  }
  const mkRow = (commentMax) =>
    rows.map((s) => [
      String(s.rawOrderIndex),
      truncTitle(s.title),
      ...cliScoreCells(s, showCombined),
      formatCliMod(s),
      fmtCliBallotVote(s, signed),
      formatCliComment(s, commentMax),
    ]);
  const dataRows = buildTableRows(headers, mkRow);
  dataRows.push([
    '',
    'Total',
    ...scoreHdrs.map(() => ''),
    '',
    fmtCliBallotVoteTotal(upTotal, downTotal, signed),
    '',
  ]);
  console.log(`\n${title}`);
  printTextTable(headers, dataRows);
}

function printOptionTableCli(t, roundId, songs, ownSongs, down, profile = null) {
  const opts = (t.options || []).filter((o) => Array.isArray(o.perSong) && o.perSong.length);
  if (!opts.length) return;
  const letters = TRADEOFF_OPTION_LETTERS;
  const tableRows = expandTradeoffRows(opts[0].perSong, songs, ownSongs, profile);
  const showCombined = cliShowsCombined(songs, ownSongs);
  const scoreHdrs = cliScoreHeaders(showCombined);
  const optHeaders = down ? opts.map((o) => downShapeShort(o.downShape)) : opts.map((_, i) => letters[i]);
  const headers = ['#', 'Song', ...scoreHdrs, 'Mod', ...optHeaders, 'Comment'];
  const mkRow = (commentMax) =>
    tableRows.map((row) => {
      const excluded = row.excluded || isExcludedFromAllocation(row.song, profile);
      return [
        String(row.rawOrderIndex),
        truncTitle(row.title),
        ...cliScoreCells(row.song, showCombined),
        formatCliMod(row.song),
        ...opts.map((o) =>
          excluded ? '-' : fmtCliVoteCell(o.perSong[row.ri]?.votes ?? 0, { down })
        ),
        formatCliComment(row.song, commentMax),
      ];
    });
  const dataRows = buildTableRows(headers, mkRow);
  dataRows.push([
    '',
    'Total',
    ...scoreHdrs.map(() => ''),
    '',
    ...opts.map((o) =>
      fmtCliVoteCell(o.perSong.reduce((a, s) => a + (s.votes || 0), 0), { down })
    ),
    '',
  ]);
  console.log(`\n${down ? 'Down' : 'Up'}`);
  printTextTable(headers, dataRows);
  const legend = opts
    .map((o, i) => {
      const code = down ? downShapeShort(o.downShape) : letters[i];
      const cmd = down
        ? formatPickCmd(roundId, 'A', { downShape: o.downShape })
        : formatPickCmd(roundId, letters[i]);
      return `${code}  ${cmd}`;
    })
    .join('    ');
  console.log(`    ${legend}`);
}

/** Combo baseline label: `A cv + pin` (up letter + down shape) or `A + pin`. */
function comparisonTitle(letter, profile, anyDown) {
  const downShape = profile?.downShape || (anyDown ? 'curved' : null);
  return `${formatPickSpec(letter, downShape)} + pin`;
}

/** Baseline net votes per song: prefer the captured pin-free allocation, else fall
 *  back to the chosen option's up split (no downvotes) for legacy callers. */
function baselineNetMap(baseline, pick) {
  if (baseline instanceof Map) return baseline;
  if (baseline) return new Map(Object.entries(baseline).map(([k, v]) => [Number(k), v]));
  const chosen =
    pick?.options?.find((o) => o.isChosen) ??
    pick?.options?.[pick?.chosenIndex ?? (pick?.chosen ? pick.chosen.charCodeAt(0) - 65 : 0)];
  const m = new Map();
  for (const p of chosen?.perSong || []) m.set(p.rawOrderIndex, { up: p.votes || 0, down: 0 });
  return m;
}

/** Non-own songs ranked by combined (or music) score desc; unscored/excluded last. */
function rankedComparisonSongs(songs, showCombined, profile) {
  const scoreOf = (s) => (showCombined ? s.combinedScore : s.score);
  return [...songs].sort((a, b) => {
    const ea = isExcludedFromAllocation(a, profile);
    const eb = isExcludedFromAllocation(b, profile);
    if (ea !== eb) return ea ? 1 : -1;
    const sa = scoreOf(a);
    const sb = scoreOf(b);
    if (sa == null && sb == null) return (a.rawOrderIndex ?? 0) - (b.rawOrderIndex ?? 0);
    if (sa == null) return 1;
    if (sb == null) return -1;
    return sb - sa || (a.rawOrderIndex ?? 0) - (b.rawOrderIndex ?? 0);
  });
}

/**
 * One shared comparison table for a pinned pick: the chosen up option + down shape
 * as the `Original` net-vote baseline, the applied ballot as `Altered`, ranked by
 * combined (or music) score. Downvote and upvote pins read from the same signed
 * column, and every net change lists a single diff. Returns `{ rendered, changed }`.
 */
export function printOptionPinComparisonCli(
  songs = [],
  ownSongs = [],
  pick = null,
  profile = null,
  baseline = null
) {
  if (!pick?.chosen) return { rendered: false, changed: false };
  const base = baselineNetMap(baseline, pick);
  const baseFor = (idx) => base.get(idx) || { up: 0, down: 0 };
  const showCombined = cliShowsCombined(songs, ownSongs);
  const scoreHdrs = cliScoreHeaders(showCombined);
  const rows = rankedComparisonSongs(songs, showCombined, profile);
  const anyDown = rows.some(
    (s) => baseFor(s.rawOrderIndex).down > 0 || (s.finalDownvotes || 0) > 0
  );
  const headers = ['#', 'Song', ...scoreHdrs, 'Mod', 'Original', 'Altered', 'Comment'];

  let baseUp = 0;
  let baseDown = 0;
  let altUp = 0;
  let altDown = 0;
  const diffs = [];
  for (const s of rows) {
    if (isExcludedFromAllocation(s, profile)) continue;
    const b = baseFor(s.rawOrderIndex);
    const fUp = s.finalVotes || 0;
    const fDown = s.finalDownvotes || 0;
    baseUp += b.up;
    baseDown += b.down;
    altUp += fUp;
    altDown += fDown;
    if (b.up !== fUp || b.down !== fDown) {
      diffs.push({
        rawOrderIndex: s.rawOrderIndex,
        title: s.title,
        from: fmtSignedNet(b.up, b.down),
        to: fmtSignedNet(fUp, fDown),
      });
    }
  }

  const mkRow = (commentMax) =>
    rows.map((s) => {
      const excluded = isExcludedFromAllocation(s, profile);
      const b = baseFor(s.rawOrderIndex);
      return [
        String(s.rawOrderIndex),
        truncTitle(s.title),
        ...cliScoreCells(s, showCombined),
        formatCliMod(s),
        excluded ? '-' : fmtSignedNet(b.up, b.down),
        excluded ? '-' : fmtSignedNet(s.finalVotes || 0, s.finalDownvotes || 0),
        formatCliComment(s, commentMax),
      ];
    });
  const dataRows = buildTableRows(headers, mkRow);
  dataRows.push([
    '',
    'Total',
    ...scoreHdrs.map(() => ''),
    '',
    fmtCliBallotVoteTotal(baseUp, baseDown, true),
    fmtCliBallotVoteTotal(altUp, altDown, true),
    '',
  ]);
  console.log(`\n${comparisonTitle(pick.chosen, profile, anyDown)}`);
  printTextTable(headers, dataRows);
  for (const d of diffs) {
    console.log(`    #${d.rawOrderIndex} ${d.title}: ${d.from} → ${d.to}`);
  }
  return { rendered: true, changed: diffs.length > 0 };
}

const PICK_TRADEOFF_KINDS = new Set(['tier-structure', 'down-structure']);

export function actionTradeoffsForCli(tradeoffs) {
  return (tradeoffs || []).filter((t) => !PICK_TRADEOFF_KINDS.has(t.kind));
}

function printActionTradeoffsCli(tradeoffs) {
  const notes = actionTradeoffsForCli(tradeoffs);
  if (!notes.length) return;
  console.log('\nNotes');
  for (const t of notes) {
    console.log(`  ${t.question}`);
    for (const o of t.options || []) {
      console.log(`    ${o.label ?? o}`);
    }
  }
}

/** Up/down option tables, action notes, raw ballot. */
export function printPickCli(tradeoffs, roundId, songs = [], ownSongs = [], budget = null, profile = null) {
  const list = tradeoffs || [];
  const up = list.filter((t) => t.kind === 'tier-structure');
  const down = list.filter((t) => t.kind === 'down-structure');
  const signed = (budget?.downvoteBankSize ?? 0) > 0;

  if (up.length || down.length) {
    console.log(`\n${pickHintLine(roundId, { hasUp: up.length > 0, hasDown: down.length > 0 })}`);
  }
  for (const t of up) printOptionTableCli(t, roundId, songs, ownSongs, false, profile);
  for (const t of down) printOptionTableCli(t, roundId, songs, ownSongs, true, profile);
  printActionTradeoffsCli(list);
  printBallotCli(songs, ownSongs, signed);
}

export function printBallotCli(songs = [], ownSongs = [], signed = false) {
  const rows = rawOrderRows(songs, ownSongs);
  if (!rows.length) return;
  const hasVotes = rows.some(
    (s) => !s.isOwn && ((s.finalVotes ?? s.draftVotes ?? 0) || (s.finalDownvotes ?? s.draftDownvotes ?? 0))
  );
  if (!hasVotes) return;
  printRawBallotTable('Ballot', rows, cliShowsCombined(songs, ownSongs), signed);
}

export function printAppliedAllocationCli(
  songs = [],
  ownSongs = [],
  pick = null,
  budget = null,
  { hadPins = false, profile = null, baseline = null } = {}
) {
  const rows = rawOrderRows(songs, ownSongs);
  if (!rows.length) return;
  const signed = (budget?.downvoteBankSize ?? 0) > 0;
  const hasTweaks = (pick?.tweaks?.length ?? 0) > 0 || (pick?.downTweaks?.length ?? 0) > 0;
  if (hadPins || hasTweaks) {
    const { rendered, changed } = printOptionPinComparisonCli(songs, ownSongs, pick, profile, baseline);
    if (rendered && !changed && hadPins) console.log('    Pins produced no changes');
  }
  printRawBallotTable('Applied', rows, cliShowsCombined(songs, ownSongs), signed);
}
