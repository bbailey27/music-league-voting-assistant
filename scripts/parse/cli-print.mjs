// Terminal print helpers for parse / pick tradeoff menus.

import { buildComboBallot } from '../render-html-shared.mjs';
import { TRADEOFF_OPTION_LETTERS } from '../round/pick.mjs';
import { formatLegacySelector, formatPickCmd } from '../cli-commands.mjs';
import {
  expandTradeoffRows,
  fmtCliBallotCell,
  fmtCliVoteCell,
  formatCliComment,
  formatCliMod,
  formatCliScore,
  isExcludedFromAllocation,
  songByIndex,
} from './cli-table.mjs';

function printTextTable(headers, rows, songCol) {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((r) => String(r[i] ?? '').length)));
  const fmt = (row) =>
    row.map((c, i) => (i === songCol ? String(c).padEnd(widths[i]) : String(c).padStart(widths[i]))).join('  ');
  console.log(`    ${fmt(headers)}`);
  for (const row of rows) console.log(`    ${fmt(row)}`);
}

const truncTitle = (s) => (String(s).length > 24 ? `${String(s).slice(0, 23)}…` : String(s));

export function printTradeoffCli(t, roundId, songs = [], ownSongs = []) {
  console.log(`  • ${t.question}`);
  const opts = (t.options || []).filter((o) => Array.isArray(o.perSong) && o.perSong.length);
  const isTable = t.kind === 'tier-structure' || t.kind === 'down-structure';
  if (!isTable || !opts.length) return;
  const down = t.kind === 'down-structure';
  const letters = TRADEOFF_OPTION_LETTERS;
  const tableRows = expandTradeoffRows(opts[0].perSong, songs, ownSongs);

  const headers = ['#', 'Song', 'Score', 'Mod', ...opts.map((_, i) => letters[i]), 'Comment'];
  const dataRows = tableRows.map((row) => {
    const excluded = row.excluded || isExcludedFromAllocation(row.song);
    return [
      String(row.rawOrderIndex),
      truncTitle(row.title),
      formatCliScore(row.song),
      formatCliMod(row.song),
      ...opts.map((o) =>
        excluded
          ? '-'
          : fmtCliVoteCell(o.perSong[row.ri]?.votes ?? 0, { down })
      ),
      formatCliComment(row.song),
    ];
  });
  dataRows.push([
    '',
    'Total',
    '',
    '',
    ...opts.map((o) => fmtCliVoteCell(o.perSong.reduce((a, s) => a + (s.votes || 0), 0), { down })),
    '',
  ]);
  console.log('    — by combined score —');
  printTextTable(headers, dataRows, 1);

  opts.forEach((o, i) => {
    const cmd = down
      ? formatPickCmd(roundId, 'A', { downShape: o.downShape, scores: true })
      : formatPickCmd(roundId, letters[i]);
    const desc = down
      ? o.shape
      : `${o.tierCount} tier${o.tierCount === 1 ? '' : 's'} · ${o.shape}`;
    console.log(`      ${letters[i]}${i === 0 ? ' (default)' : ''}: ${desc} · ${cmd}`);
  });
}

export function printBallotCli(tradeoffs, songs = [], ownSongs = [], roundId = null) {
  const { combos, rows } = buildComboBallot(tradeoffs, songs, ownSongs);
  if (!combos.length || !rows.length) return;
  if (!combos.some((c) => c.totals.up > 0 || c.totals.down > 0)) return;
  const byIdx = songByIndex(songs, ownSongs);
  const codeOf = (c) => c.members.map((m) => m.code).join('/');
  const headers = ['#', 'Song', 'Score', 'Mod', ...combos.map(codeOf), 'Comment'];
  const dataRows = rows.map((r) => {
    const song = byIdx.get(r.rawOrderIndex);
    const excluded = isExcludedFromAllocation(song);
    return [
      String(r.rawOrderIndex),
      truncTitle(r.title),
      formatCliScore(song),
      formatCliMod(song),
      ...combos.map((c) => fmtCliBallotCell(c.perIndex.get(r.rawOrderIndex), excluded)),
      formatCliComment(song),
    ];
  });
  dataRows.push([
    '',
    'Total ▲/▼',
    '',
    '',
    ...combos.map((c) => {
      const base = c.totals.down > 0 ? `${c.totals.up}/-${c.totals.down}` : `${c.totals.up}`;
      return c.totals.conflicts > 0 ? `${base} !${c.totals.conflicts}` : base;
    }),
    '',
  ]);
  console.log('\nBallot (raw order) — each column is one full ballot (+up / -down); pick one and transcribe straight down:');
  printTextTable(headers, dataRows, 1);
  for (const c of combos) {
    const labels = c.members.map((m) => formatLegacySelector(roundId, m.selector, 'A'));
    console.log(`  ${codeOf(c)} = ${labels.join(' | ')}`);
  }
  if (combos.some((c) => c.totals.conflicts > 0)) {
    console.log('  ! = up option and down shape disagree for that song — resolve by hand (or pin the downvote).');
  }
}

export function printAppliedAllocationCli(songs = [], ownSongs = [], pick = null) {
  const rows = [...songs, ...ownSongs].sort((a, b) => (a.rawOrderIndex ?? 0) - (b.rawOrderIndex ?? 0));
  if (!rows.length) return;
  const fmtUp = (s) => {
    if (s.isOwn) return '—';
    if (isExcludedFromAllocation(s)) return '-';
    const v = s.finalVotes ?? s.draftVotes ?? 0;
    return v > 0 ? `+${v}` : '·';
  };
  const fmtDown = (s) => {
    if (s.isOwn) return '—';
    if (isExcludedFromAllocation(s)) return '-';
    const v = s.finalDownvotes ?? s.draftDownvotes ?? 0;
    return v > 0 ? `-${v}` : '·';
  };
  let upTotal = 0;
  let downTotal = 0;
  const dataRows = rows.map((s) => {
    if (!s.isOwn && !isExcludedFromAllocation(s)) {
      upTotal += s.finalVotes ?? s.draftVotes ?? 0;
      downTotal += s.finalDownvotes ?? s.draftDownvotes ?? 0;
    }
    return [
      String(s.rawOrderIndex),
      truncTitle(s.title),
      formatCliScore(s),
      formatCliMod(s),
      fmtUp(s),
      fmtDown(s),
      formatCliComment(s),
    ];
  });
  const totalDown = downTotal > 0 ? `/-${downTotal}` : '';
  dataRows.push(['', 'Total ▲/▼', '', '', `${upTotal}${totalDown}`, '', '']);
  console.log('\nApplied allocation (raw order):');
  printTextTable(['#', 'Song', 'Score', 'Mod', '▲', '▼', 'Comment'], dataRows, 1);
  if (pick?.tweaks?.length) {
    console.log('  Manual upvote tweaks (option → applied):');
    for (const t of pick.tweaks) {
      console.log(`    #${t.rawOrderIndex} ${t.title}: ${t.from} → ${t.to}`);
    }
  }
  if (pick?.downTweaks?.length) {
    console.log('  Manual downvote pins:');
    for (const t of pick.downTweaks) {
      console.log(`    #${t.rawOrderIndex}${t.title ? ` ${t.title}` : ''}: ${t.to}`);
    }
  }
}
