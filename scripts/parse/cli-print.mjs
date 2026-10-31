// Terminal print helpers for parse / pick tradeoff menus.

import { TRADEOFF_OPTION_LETTERS } from '../round/pick.mjs';
import { downShapeShort, formatPickSpec, pickSyntaxReminder } from '../cli-commands.mjs';
import { rankSortByProfile } from '../score-core.mjs';
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

// One-line register of everything actively shaping the allocation: pins (up + down
// + no-vote pins) and non-default profile knobs. Printed ahead of the option
// tables, ballot, and applied views so stored knobs/pins are never silent. Pin
// display matches the pin grammar: unsigned positive, signed negative (`3:2`,
// `6:-1`, no-vote `14:0`).
export function formatProfileKnobsCli(profile) {
  if (!profile) return '';
  const byIdx = new Map();
  for (const [k, v] of Object.entries(profile.overrides || {})) {
    if (Number(v) > 0) byIdx.set(Number(k), Number(v));
  }
  for (const [k, v] of Object.entries(profile.downOverrides || {})) {
    const i = Number(k);
    if (Number(v) < 0 || Number(v) > 0) byIdx.set(i, -Number(v));
    else if ((byIdx.get(i) ?? 0) <= 0) byIdx.set(i, 0); // no-vote pin (overrides[i] unset or 0)
  }
  const pins = [...byIdx.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([i, v]) => `${i}:${v}`);
  const knobs = [];
  const w = profile.weights;
  if (w && Number.isFinite(w.fit) && Number.isFinite(w.music)) {
    knobs.push(`weights ${Math.round(w.fit * 10)}:${Math.round(w.music * 10)} (fit:music)`);
  }
  if (profile.gate) {
    knobs.push(
      profile.gate.type === 'cutoff'
        ? `cutoff ${profile.gate.axis}:${profile.gate.min}`
        : `gate ${profile.gate.type}`
    );
  }
  if (profile.tierCount != null) knobs.push(`tiers ${profile.tierCount}`);
  if (profile.bucketCount != null) knobs.push(`bucket ${profile.bucketCount}`);
  if (profile.optionCount != null) knobs.push(`options ${profile.optionCount}`);
  if (profile.shape && profile.shape !== 'auto') knobs.push(`shape ${profile.shape}`);
  if (profile.downShape) knobs.push(`down ${profile.downShape}`);
  if (profile.favoriteBand === false) knobs.push('no-favorite-band');
  else if (profile.favoriteBand != null) knobs.push(`favorite-band ${profile.favoriteBand}`);
  if (profile.rankBy === 'fit') knobs.push('rank fit');
  const parts = [];
  if (pins.length) parts.push(`Pins: ${pins.join(', ')}`);
  if (knobs.length) parts.push(`Flags: ${knobs.join(', ')}`);
  return parts.join(' · ');
}

function printProfileKnobsCli(profile) {
  const line = formatProfileKnobsCli(profile);
  if (line) console.log(`\n${line}`);
}

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
  // Per-option legend for the up menu: the allocator's label already carries the
  // shape plus any merge/jump or tiebreak note, so print it under each letter.
  if (!down) {
    opts.forEach((o, i) => {
      if (o.label) console.log(`    ${letters[i]}. ${o.label}`);
    });
  }
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

/** Non-own songs ranked like the Up option table (rankValue, then +/− mod, then title). */
function rankedComparisonSongs(songs, profile) {
  const sortFn = rankSortByProfile(profile ?? {});
  return [...songs].sort((a, b) => {
    const ea = isExcludedFromAllocation(a, profile);
    const eb = isExcludedFromAllocation(b, profile);
    if (ea !== eb) return ea ? 1 : -1;
    return sortFn(a, b);
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
  const rows = rankedComparisonSongs(songs, profile);
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
        from: fmtSignedNet(b.up, b.down, '0'),
        to: fmtSignedNet(fUp, fDown, '0'),
      });
    }
  }
  if (!diffs.length) return { rendered: false, changed: false };

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

  printProfileKnobsCli(profile);
  for (const t of up) printOptionTableCli(t, roundId, songs, ownSongs, false, profile);
  for (const t of down) printOptionTableCli(t, roundId, songs, ownSongs, true, profile);
  if (up.length || down.length) {
    console.log(`\n${pickSyntaxReminder({ hasDown: down.length > 0 })}`);
  }
  // When the clean options (primary + merge/jump) couldn't fill the menu, further
  // separation is only possible by breaking a tie — point the owner at the score
  // override rather than silently emitting one option.
  if (up.some((t) => t.tiebreakLimited)) {
    const round = roundId ?? '<round>';
    console.log(
      `  Can't add more distinct tiers without a tiebreak. Set a score: ` +
        `just rescore ${round} --score <i>:<v> (e.g. --score 5:74.5+) or --fit-score <i>:<v>.`
    );
  }
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
  { profile = null, baseline = null } = {}
) {
  const rows = rawOrderRows(songs, ownSongs);
  if (!rows.length) return;
  printProfileKnobsCli(profile);
  const signed = (budget?.downvoteBankSize ?? 0) > 0;
  if (pick?.chosen) {
    printOptionPinComparisonCli(songs, ownSongs, pick, profile, baseline);
  }
  printRawBallotTable('Applied', rows, cliShowsCombined(songs, ownSongs), signed);
}
