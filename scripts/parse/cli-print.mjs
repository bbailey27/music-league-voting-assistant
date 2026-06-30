// Terminal print helpers for parse / pick tradeoff menus.

import { TRADEOFF_OPTION_LETTERS } from '../round/pick.mjs';
import { downShapeShort, formatPickCmd, pickHintLine } from '../cli-commands.mjs';
import {
  cliScoreCells,
  cliScoreHeaders,
  cliShowsCombined,
  expandTradeoffRows,
  fmtCliBallotVote,
  fmtCliBallotVoteTotal,
  fmtCliVoteCell,
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

function optionPinColumnLabels(letter) {
  return [`${letter} (original)`, `${letter} (altered)`];
}

/** Side-by-side original option vs pin-reconciled allocation (combined-score order). */
export function printOptionPinComparisonCli(songs = [], ownSongs = [], pick = null, profile = null) {
  if (!pick?.chosen) return false;
  const chosen =
    pick.options?.find((o) => o.isChosen) ??
    pick.options?.[pick.chosenIndex ?? pick.chosen.charCodeAt(0) - 65];
  if (!chosen?.perSong?.length) return false;

  const letter = pick.chosen;
  const [origHdr, altHdr] = optionPinColumnLabels(letter);
  const tableRows = expandTradeoffRows(chosen.perSong, songs, ownSongs, profile);
  const showCombined = cliShowsCombined(songs, ownSongs);
  const scoreHdrs = cliScoreHeaders(showCombined);
  const headers = ['#', 'Song', ...scoreHdrs, 'Mod', origHdr, altHdr, 'Comment'];
  const finalByIdx = new Map(songs.map((s) => [s.rawOrderIndex, s.finalVotes ?? 0]));
  const origTotal = chosen.perSong.reduce((a, s) => a + (s.votes || 0), 0);
  let altUp = 0;
  let altDown = 0;
  for (const s of songs) {
    if (s.isOwn || isExcludedFromAllocation(s)) continue;
    altUp += s.finalVotes ?? 0;
    altDown += s.finalDownvotes ?? 0;
  }
  const mkRow = (commentMax) =>
    tableRows.map((row) => {
      const excluded = row.excluded || isExcludedFromAllocation(row.song, profile);
      const orig = chosen.perSong[row.ri]?.votes ?? 0;
      const alt = finalByIdx.get(row.rawOrderIndex) ?? 0;
      return [
        String(row.rawOrderIndex),
        truncTitle(row.title),
        ...cliScoreCells(row.song, showCombined),
        formatCliMod(row.song),
        excluded ? '-' : fmtCliVoteCell(orig),
        excluded ? '-' : fmtCliVoteCell(alt),
        formatCliComment(row.song, commentMax),
      ];
    });
  const dataRows = buildTableRows(headers, mkRow);
  dataRows.push([
    '',
    'Total',
    ...scoreHdrs.map(() => ''),
    '',
    fmtCliVoteCell(origTotal),
    fmtCliBallotVoteTotal(altUp, altDown, false),
    '',
  ]);
  console.log(`\n${letter} + pin`);
  printTextTable(headers, dataRows);
  return true;
}

function printUpTweakLines(pick) {
  if (!pick?.tweaks?.length) return false;
  for (const t of pick.tweaks) {
    console.log(`    #${t.rawOrderIndex} ${t.title}: ${t.from} → ${t.to}`);
  }
  return true;
}

function printDownTweakLines(pick) {
  if (!pick?.downTweaks?.length) return;
  for (const t of pick.downTweaks) {
    console.log(`    #${t.rawOrderIndex}${t.title ? ` ${t.title}` : ''}: ${t.to}`);
  }
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
  { hadPins = false, profile = null } = {}
) {
  const rows = rawOrderRows(songs, ownSongs);
  if (!rows.length) return;
  const signed = (budget?.downvoteBankSize ?? 0) > 0;
  const showComparison = hadPins || (pick?.tweaks?.length ?? 0) > 0;
  if (showComparison && printOptionPinComparisonCli(songs, ownSongs, pick, profile)) {
    if (hadPins) {
      if (!printUpTweakLines(pick)) console.log('    Pins produced no changes');
    } else {
      printUpTweakLines(pick);
    }
    printDownTweakLines(pick);
  }
  printRawBallotTable('Applied', rows, cliShowsCombined(songs, ownSongs), signed);
}
