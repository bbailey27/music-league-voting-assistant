// Terminal print helpers for parse / pick tradeoff menus.

import { formatScore } from '../score-core.mjs';
import { buildComboBallot } from '../render-html-shared.mjs';
import { TRADEOFF_OPTION_LETTERS } from '../round/pick.mjs';

function printTextTable(headers, rows, songCol) {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((r) => String(r[i] ?? '').length)));
  const fmt = (row) =>
    row.map((c, i) => (i === songCol ? String(c).padEnd(widths[i]) : String(c).padStart(widths[i]))).join('  ');
  console.log(`    ${fmt(headers)}`);
  for (const row of rows) console.log(`    ${fmt(row)}`);
}

export function printTradeoffCli(t) {
  console.log(`  • ${t.question}`);
  const opts = (t.options || []).filter((o) => Array.isArray(o.perSong) && o.perSong.length);
  const isTable = t.kind === 'tier-structure' || t.kind === 'down-structure';
  if (!isTable || !opts.length) return;
  const down = t.kind === 'down-structure';
  const letters = TRADEOFF_OPTION_LETTERS;
  const trunc = (s) => (String(s).length > 28 ? `${String(s).slice(0, 27)}…` : String(s));
  const fmtVote = (v) => (down && v > 0 ? `-${v}` : String(v));

  const headers = ['#', 'Song', 'Score', ...opts.map((_, i) => letters[i])];
  const dataRows = opts[0].perSong.map((r, ri) => [
    String(r.rawOrderIndex),
    trunc(r.title),
    formatScore(r.score ?? r.rank),
    ...opts.map((o) => fmtVote(o.perSong[ri]?.votes ?? 0)),
  ]);
  dataRows.push(['', 'Total', '', ...opts.map((o) => fmtVote(o.perSong.reduce((a, s) => a + (s.votes || 0), 0)))]);
  console.log('    — by combined score —');
  printTextTable(headers, dataRows, 1);

  opts.forEach((o, i) => {
    const selector = down ? `--down-shape ${o.downShape}` : `--option ${letters[i]}`;
    const desc = down
      ? o.shape
      : `${o.tierCount} tier${o.tierCount === 1 ? '' : 's'} · ${o.shape}`;
    console.log(`      ${letters[i]}${i === 0 ? ' (default)' : ''}: ${desc} · ${selector}`);
  });
}

export function printBallotCli(tradeoffs, songs = [], ownSongs = []) {
  const { combos, rows } = buildComboBallot(tradeoffs, songs, ownSongs);
  if (!combos.length || !rows.length) return;
  if (!combos.some((c) => c.totals.up > 0 || c.totals.down > 0)) return;
  const trunc = (s) => (String(s).length > 28 ? `${String(s).slice(0, 27)}…` : String(s));
  const codeOf = (c) => c.members.map((m) => m.code).join('/');
  const fmt = (v) => {
    if (v === 'own') return '—';
    if (v === 'conflict') return '!';
    if (v > 0) return `+${v}`;
    if (v < 0) return String(v);
    return '·';
  };
  const headers = ['#', 'Song', ...combos.map(codeOf)];
  const dataRows = rows.map((r) => [
    String(r.rawOrderIndex),
    trunc(r.title),
    ...combos.map((c) => fmt(c.perIndex.get(r.rawOrderIndex))),
  ]);
  dataRows.push([
    '',
    'Total ▲/▼',
    ...combos.map((c) => {
      const base = c.totals.down > 0 ? `${c.totals.up}/-${c.totals.down}` : `${c.totals.up}`;
      return c.totals.conflicts > 0 ? `${base} !${c.totals.conflicts}` : base;
    }),
  ]);
  console.log('\nBallot (raw order) — each column is one full ballot (+up / -down); pick one and transcribe straight down:');
  printTextTable(headers, dataRows, 1);
  for (const c of combos) {
    console.log(`  ${codeOf(c)} = ${c.members.map((m) => m.selector || 'default').join(' | ')}`);
  }
  if (combos.some((c) => c.totals.conflicts > 0)) {
    console.log('  ! = up option and down shape disagree for that song — resolve by hand (or pin the downvote).');
  }
}
