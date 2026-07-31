// Browser tables matching scripts/parse/cli-print.mjs (Up/Down options + ballot).

import { downShapeShort } from './cli-commands.mjs';
import { OPTION_LETTERS } from './score-core.mjs';
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

const COMMENT_MAX = 56;

function rawOrderRows(songs = [], ownSongs = []) {
  return [...songs, ...ownSongs].sort((a, b) => (a.rawOrderIndex ?? 0) - (b.rawOrderIndex ?? 0));
}

/** One Up or Down option table — same columns as `printOptionTableCli`. */
export function buildOptionTable(tradeoff, songs = [], ownSongs = [], { down = false, profile = null } = {}) {
  const opts = (tradeoff?.options || []).filter((o) => Array.isArray(o.perSong) && o.perSong.length);
  if (!opts.length) return null;

  const tableRows = expandTradeoffRows(opts[0].perSong, songs, ownSongs, profile);
  const showCombined = cliShowsCombined(songs, ownSongs);
  const scoreHdrs = cliScoreHeaders(showCombined);
  const optHeaders = down ? opts.map((o) => downShapeShort(o.downShape)) : opts.map((_, i) => OPTION_LETTERS[i]);
  const headers = ['#', 'Song', ...scoreHdrs, 'Mod', ...optHeaders, 'Comment'];
  const optionStartCol = 2 + scoreHdrs.length + 1;

  const rows = tableRows.map((row) => {
    const excluded = row.excluded || isExcludedFromAllocation(row.song, profile);
    return {
      cells: [
        String(row.rawOrderIndex),
        row.title,
        ...cliScoreCells(row.song, showCombined),
        formatCliMod(row.song),
        ...opts.map((o) => fmtCliVoteCell(o.perSong[row.ri]?.votes ?? 0, { excluded, down })),
        formatCliComment(row.song, COMMENT_MAX),
      ],
      excluded,
    };
  });

  const totals = [
    '',
    'Total',
    ...scoreHdrs.map(() => ''),
    '',
    ...opts.map((o) => fmtCliVoteCell(o.perSong.reduce((a, s) => a + (s.votes || 0), 0), { down })),
    '',
  ];

  const legends = down
    ? []
    : opts.map((o, i) => ({ letter: OPTION_LETTERS[i], label: o.label || o.shape || '' }));

  return {
    title: down ? 'Down' : 'Up',
    down,
    headers,
    rows,
    totals,
    legends,
    optionStartCol,
    optionColCount: optHeaders.length,
    tiebreakLimited: !!tradeoff?.tiebreakLimited,
  };
}

/** Raw-order ballot — same columns as `printRawBallotTable`. */
export function buildBallotTable(songs = [], ownSongs = [], { signed = false } = {}) {
  const list = rawOrderRows(songs, ownSongs);
  if (!list.length) return null;

  const showCombined = cliShowsCombined(songs, ownSongs);
  const scoreHdrs = cliScoreHeaders(showCombined);
  const headers = ['#', 'Song', ...scoreHdrs, 'Mod', 'Votes', 'Comment'];

  let upTotal = 0;
  let downTotal = 0;
  const rows = list.map((s) => {
    if (!s.isOwn && !isExcludedFromAllocation(s)) {
      upTotal += s.finalVotes ?? s.draftVotes ?? 0;
      downTotal += s.finalDownvotes ?? s.draftDownvotes ?? 0;
    }
    return {
      cells: [
        String(s.rawOrderIndex),
        s.title,
        ...cliScoreCells(s, showCombined),
        formatCliMod(s),
        fmtCliBallotVote(s, signed),
        formatCliComment(s, COMMENT_MAX),
      ],
    };
  });

  const totals = [
    '',
    'Total',
    ...scoreHdrs.map(() => ''),
    '',
    fmtCliBallotVoteTotal(upTotal, downTotal, signed),
    '',
  ];

  return { title: 'Ballot', headers, rows, totals, upTotal, downTotal };
}

/** Up + Down tradeoff tables from allocate() output. */
export function buildPickTables(tradeoffs = [], songs = [], ownSongs = [], profile = null) {
  const list = tradeoffs || [];
  const tables = [];
  for (const t of list.filter((x) => x.kind === 'tier-structure')) {
    const table = buildOptionTable(t, songs, ownSongs, { down: false, profile });
    if (table) tables.push(table);
  }
  for (const t of list.filter((x) => x.kind === 'down-structure')) {
    const table = buildOptionTable(t, songs, ownSongs, { down: true, profile });
    if (table) tables.push(table);
  }
  return tables;
}
