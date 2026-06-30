// Shared HTML rendering helpers and stylesheet fragments for fit/final reports.

import { formatScore } from './score-core.mjs';
import { downShapeShort } from './cli-commands.mjs';
import { expandTradeoffRows, isExcludedFromAllocation } from './tradeoff-rows.mjs';

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Stable, theme-neutral accent per fit tier (dark/light friendly hues). Ordered
// to match the vote-tier palette: purple = best, blue = good, green = mid,
// teal = lower, orange = weak, red = worst. Songs with no fit signal fall back
// to a neutral hue.
const TIER_HUE = {
  excellent: 270,
  strong: 220,
  solid: 145,
  moderate: 180,
  weak: 35,
  nope: 0,
};
export const NEUTRAL_HUE = 220;

export function tierHue(tier) {
  return TIER_HUE[String(tier || '').toLowerCase()] ?? NEUTRAL_HUE;
}

// Purple (270) → red (0) heat scale for numeric scores within a round's spread.
// Same direction as the discrete tier/vote palettes: high = purple, low = red.
const SCORE_HUE_LO = 0;
const SCORE_HUE_HI = 270;

function scoreRangeMinMax(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v != null && Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min)) return null;
  return { min, max };
}

export function scoreRangeFromSongs(songs, field) {
  return scoreRangeMinMax((songs || []).map((s) => s[field]));
}

export function scoreToHue(value, min, max) {
  if (value == null || !Number.isFinite(value)) return NEUTRAL_HUE;
  if (min == null || max == null || !Number.isFinite(min) || !Number.isFinite(max)) return NEUTRAL_HUE;
  if (min === max) return (SCORE_HUE_LO + SCORE_HUE_HI) / 2;
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return SCORE_HUE_LO + t * (SCORE_HUE_HI - SCORE_HUE_LO);
}

export function scoreHeatAttrs(value, range, extraClasses = '') {
  if (!range || value == null || !Number.isFinite(value)) {
    return extraClasses ? ` class="${extraClasses}"` : '';
  }
  const hue = scoreToHue(value, range.min, range.max);
  const cls = ['score-heat', extraClasses].filter(Boolean).join(' ');
  return ` class="${cls}" style="--score-hue:${hue}"`;
}

// Discrete upvote-tier palette (rank position among distinct non-zero point values
// in the round). Same hues as the fit tier scale so color language is consistent:
// purple (best) → blue → green → teal → orange → red.
export const VOTE_TIER_HUES = [270, 220, 145, 180, 35, 0];

export function buildVoteTierMap(songs) {
  const values = new Set();
  for (const s of songs || []) {
    const v = Number(s.finalVotes ?? s.draftVotes ?? 0) || 0;
    if (v > 0) values.add(v);
  }
  const sorted = [...values].sort((a, b) => b - a);
  const map = new Map();
  sorted.forEach((v, i) => map.set(v, VOTE_TIER_HUES[Math.min(i, VOTE_TIER_HUES.length - 1)]));
  return map;
}

export function voteTierHue(votes, voteTierMap) {
  const v = Number(votes) || 0;
  if (v <= 0 || !voteTierMap) return null;
  return voteTierMap.get(v) ?? null;
}

export function voteTierAttrs(votes, voteTierMap, extraClasses = '') {
  const hue = voteTierHue(votes, voteTierMap);
  const v = Number(votes) || 0;
  const parts = ['score', 'votes', extraClasses];
  if (v > 0 && hue != null) parts.push('has-votes');
  const cls = parts.filter(Boolean).join(' ');
  if (v > 0 && hue != null) return ` class="${cls}" style="--vote-hue:${hue}"`;
  return ` class="${cls}"`;
}

export function chip(text, hue) {
  const style = hue == null ? '' : ` style="--chip-hue:${hue}"`;
  return `<span class="chip"${style}>${esc(text)}</span>`;
}

// Shared card sub-sections used by both fit and final renderers.

// Theme keyword chips. Returns the joined chip spans, or `emptyFallback` when absent.
export function themeChipsHtml(s, { emptyFallback = '' } = {}) {
  const themes = Array.isArray(s.themesHit) ? s.themesHit : [];
  if (!themes.length) return emptyFallback;
  return themes.map((t) => chip(t)).join('');
}

// LLM fit rationale paragraph with a "fit" label, or empty string when absent.
export function rationaleHtml(s) {
  if (!s.rationale) return '';
  return `<p class="rationale"><span class="label">fit</span> ${esc(s.rationale)}</p>`;
}

// The identity column: raw-order index, title, artist stacked.
export function cardIdentityHtml(s) {
  return `<div class="identity">
    <span class="rank">#${esc(s.rawOrderIndex)}</span>
    <span class="title">${esc(s.title)}</span>
    <span class="artist">${esc(s.artist)}</span>
  </div>`;
}

// The submitter-assist / confidence / basis meta row (empty string when absent).
export function cardMetaHtml(s) {
  const items = [];
  if (s.confidence) items.push(`<span class="meta-item">confidence: ${esc(s.confidence)}</span>`);
  if (s.basis) items.push(`<span class="meta-item">basis: ${esc(s.basis)}</span>`);
  if (s.submitterAssist) items.push('<span class="meta-item">submitter-assist</span>');
  return items.length ? `<div class="meta">${items.join('')}</div>` : '';
}

// Shared self-contained HTML page shell. `titleSuffix` appears after " — " in <title>.
export function buildHtmlDocument(docTitle, titleSuffix, style, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(docTitle)} — ${titleSuffix}</title>
<style>${style}</style>
</head>
<body>
<main class="wrap">
${body}</main>
</body>
</html>
`;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

// A distribution tradeoff (`tier-structure` upvotes A/B/C, or `down-structure`
// downvote shapes) rendered as a single song×option comparison table in
// combined/rank order — for judging which songs each option rewards — plus a legend
// naming each option's shape and its selector (`--option` / `--down-shape`).
// Downvote magnitudes always display as negative. The raw submission-order ballot
// is NOT duplicated per option here; it lives once, with a column per up×down combo,
// in the "Ballot (raw order)" section. Falls back gracefully when `perSong` is absent.
function tradeoffScoreHtml(row, perSongRef, profile = null) {
  if (row.excluded || isExcludedFromAllocation(row.song, profile)) return '—';
  if (row.ri != null) return formatScore(perSongRef[row.ri]?.score ?? perSongRef[row.ri]?.rank);
  return formatScore(row.song?.combinedScore ?? row.song?.score);
}

function tierStructureTableHtml(t, chosenIndex = null, songs = [], ownSongs = [], profile = null) {
  const down = t.kind === 'down-structure';
  const opts = (t.options || []).filter((o) => Array.isArray(o.perSong) && o.perSong.length);
  if (!opts.length) {
    const items = (t.options || []).map((o) => `<li>${esc(o.label ?? o)}</li>`).join('');
    return `<div class="tradeoff"><p class="q">${esc(t.question)}</p><ul>${items}</ul></div>`;
  }
  // Downvote options carry positive magnitudes but always display as negative.
  const fmtVote = (v) => (down && v > 0 ? `-${formatScore(v)}` : formatScore(v));
  // A column is "highlighted" if it's the default (live tradeoff) or the chosen one
  // (a recorded pick); the chosen column also gets a stronger `chosen` class.
  const optClass = (i) =>
    `opt${chosenIndex == null && i === 0 ? ' default' : ''}${i === chosenIndex ? ' chosen' : ''}`;
  const optHead = opts
    .map((o, i) => {
      const label = down ? downShapeShort(o.downShape) : OPTION_LETTERS[i];
      return `<th class="num ${optClass(i)}">${label}</th>`;
    })
    .join('');
  const totalsRow = (extraLead = 0) => {
    const cells = opts
      .map((o, i) => `<td class="num ${optClass(i)}">${fmtVote(o.perSong.reduce((a, s) => a + (s.votes || 0), 0))}</td>`)
      .join('');
    return `<tr>${'<td></td>'.repeat(extraLead)}<td>Total</td>${cells}</tr>`;
  };

  // Combined/rank order. (The raw-submission-order ballot lives once in the
  // "Ballot (raw order)" section, with a column per up×down combo — not here.)
  const tableRows = expandTradeoffRows(opts[0].perSong, songs, ownSongs, profile);
  const combinedBody = tableRows
    .map((row) => {
      const excluded = row.excluded || isExcludedFromAllocation(row.song, profile);
      const cells = opts
        .map((o, i) => {
          if (excluded) return `<td class="num ${optClass(i)} excluded">—</td>`;
          const v = o.perSong[row.ri]?.votes ?? 0;
          return `<td class="num ${optClass(i)}${v > 0 ? ' on' : ''}">${fmtVote(v)}</td>`;
        })
        .join('');
      const rowClass = excluded ? ' class="excluded"' : '';
      return `<tr${rowClass}><td class="num muted">${esc(row.rawOrderIndex)}</td><td>${esc(row.title)}</td><td class="num">${tradeoffScoreHtml(row, opts[0].perSong, profile)}</td>${cells}</tr>`;
    })
    .join('\n');

  const legend = opts
    .map((o, i) => {
      const tag = chosenIndex == null && i === 0 ? ' <span class="muted">(default)</span>' : '';
      const pick = i === chosenIndex ? ' <span class="muted">(your pick)</span>' : '';
      const axisLabel = down ? downShapeShort(o.downShape) : OPTION_LETTERS[i];
      const desc = down
        ? `<code>${esc(o.shape)}</code>, <code>--down-shape ${esc(o.downShape)}</code> (pair with up letter A|B|C)`
        : `${o.tierCount} tier${o.tierCount === 1 ? '' : 's'}, <code>${esc(o.shape)}</code>, <code>--option ${OPTION_LETTERS[i]}</code>`;
      return `<li><b>${axisLabel}</b>${tag}${pick} — ${desc}</li>`;
    })
    .join('');

  const question = t.question ? `<p class="q">${esc(t.question)}</p>` : '';
  return `<div class="tradeoff">
  ${question}
  <p class="sub muted">By combined score</p>
  <table class="compare">
    <thead><tr><th class="num">#</th><th>Song</th><th class="num">Score</th>${optHead}</tr></thead>
    <tbody>
${combinedBody}
    </tbody>
    <tfoot>${totalsRow(2)}</tfoot>
  </table>
  <ul class="legend">${legend}</ul>
</div>`;
}

// Render a recorded pick: the chosen distribution as a focused combined-score table,
// the reason + any manual tweaks, and a collapsed "options considered" comparison
// (all options, chosen column highlighted) so the alternatives stay visible and
// auditable after the pick.
export function pickHtml(pick, songs = [], ownSongs = [], profile = null) {
  if (!pick || !Array.isArray(pick.options) || !pick.options.length) return '';
  const ci = pick.chosenIndex ?? pick.options.findIndex((o) => o.isChosen);
  const chosen = pick.options[ci];
  if (!chosen) return '';

  const tableRows = expandTradeoffRows(chosen.perSong, songs, ownSongs, profile);
  const combinedRows = tableRows
    .map((row) => {
      const excluded = row.excluded || isExcludedFromAllocation(row.song, profile);
      const votes = excluded ? '—' : formatScore(chosen.perSong[row.ri]?.votes ?? 0);
      const rowClass = excluded ? ' class="excluded"' : row.ri != null && chosen.perSong[row.ri]?.votes > 0 ? ' class="has-votes"' : '';
      return `<tr${rowClass}><td class="num muted">${esc(row.rawOrderIndex)}</td><td>${esc(
          row.title
        )}</td><td class="num">${tradeoffScoreHtml(row, chosen.perSong, profile)}</td><td class="num votes${
          !excluded && chosen.perSong[row.ri]?.votes > 0 ? ' on' : ''
        }">${votes}</td></tr>`;
    })
    .join('\n');
  const total = chosen.perSong.reduce((a, s) => a + (s.votes || 0), 0);

  const reason = pick.reason
    ? `<p class="reason"><span class="label">Why</span> ${esc(pick.reason)}</p>`
    : '';
  const tweaks = (pick.tweaks || []).length
    ? `<p class="tweaks"><span class="label">Manual tweaks</span> ${pick.tweaks
        .map((t) => `#${esc(t.rawOrderIndex)} ${esc(t.title)} ${esc(t.from)}→${esc(t.to)}`)
        .join('; ')}</p>`
    : '';

  const considered = `<details class="considered">
  <summary>Options considered (${pick.options.map((o) => esc(o.letter)).join(' / ')})</summary>
  ${tierStructureTableHtml({ kind: 'tier-structure', question: '', options: pick.options }, ci, songs, ownSongs, profile)}
</details>`;

  return `<section class="pick tradeoffs">
  <h2>Your pick — Option ${esc(pick.chosen)} <span class="muted">(${esc(chosen.tierCount)} tier${
    chosen.tierCount === 1 ? '' : 's'
  }, ${esc(chosen.shape)})</span></h2>
  ${reason}${tweaks}
  <table class="compare">
    <thead><tr><th class="num">#</th><th>Song</th><th class="num">Score</th><th class="num">Votes</th></tr></thead>
    <tbody>
${combinedRows}
    </tbody>
    <tfoot><tr><td></td><td>Total</td><td></td><td class="num">${total}</td></tr></tfoot>
  </table>
  ${considered}
</section>`;
}

// Render an allocator "needs your call" tradeoff list: distribution forks become
// comparison tables; every other kind stays a compact bulleted choice list.
export function tradeoffsHtml(tradeoffs, songs = [], ownSongs = [], profile = null) {
  const list = Array.isArray(tradeoffs) ? tradeoffs : [];
  if (!list.length) return '';
  const blocks = list
    .map((t) => {
      if (t.kind === 'tier-structure' || t.kind === 'down-structure')
        return tierStructureTableHtml(t, null, songs, ownSongs, profile);
      const opts = (t.options || []).map((o) => `<li>${esc(o.label ?? o)}</li>`).join('');
      return `<div class="tradeoff"><p class="q">${esc(t.question)}</p>${opts ? `<ul>${opts}</ul>` : ''}</div>`;
    })
    .join('\n');
  return `<section class="tradeoffs">
  <h2>Needs your call</h2>
${blocks}
</section>`;
}

// Read the live allocation off a song regardless of report source: final-html uses
// `finalVotes`/`finalDownvotes`, fit-html uses `draftVotes`/`draftDownvotes`.
const ballotUp = (s) => Number(s.finalVotes ?? s.draftVotes ?? 0) || 0;
const ballotDown = (s) => Number(s.finalDownvotes ?? s.draftDownvotes ?? 0) || 0;

// Build the raw-order ballot as one column per up-option × down-shape COMBO. Each
// column is a complete signed ballot (upvotes positive, downvotes negative) that
// reads straight down. A song that an up option upvotes AND a down shape also
// downvotes is a `'conflict'` cell: the two axes disagree for that combo, so we
// neither silently drop the downvote nor shrink the total — we flag it and let the
// user resolve it by hand (or via a downvote pin). Per-column totals report each
// axis's intended budget plus a conflict count. Identical columns are deduped.
// Pure; consumed by both the HTML report and the CLI.
export function buildComboBallot(tradeoffs, songs = [], ownSongs = [], pick = null) {
  const list = Array.isArray(tradeoffs) ? tradeoffs : [];
  const upTr = list.find((t) => t.kind === 'tier-structure');
  const downTr = list.find((t) => t.kind === 'down-structure');

  const mapVotes = (perSong) => {
    const m = new Map();
    for (const p of perSong || []) {
      const v = Number(p.votes) || 0;
      if (v) m.set(p.rawOrderIndex, v);
    }
    return m;
  };
  const defaultMap = (read) => {
    const m = new Map();
    for (const s of songs || []) {
      const v = read(s);
      if (v) m.set(s.rawOrderIndex, v);
    }
    return m;
  };

  const pickOptions = pick?.options?.filter((o) => Array.isArray(o.perSong) && o.perSong.length) || [];

  // Up axis: tier-structure options if present, else frozen pick menu, else live allocation.
  const upOptions =
    upTr && Array.isArray(upTr.options) && upTr.options.length
      ? upTr.options.map((o, i) => ({
          code: OPTION_LETTERS[i],
          selector: `--option ${OPTION_LETTERS[i]}`,
          votes: mapVotes(o.perSong),
        }))
      : pickOptions.length
        ? pickOptions.map((o, i) => ({
            code: o.letter || OPTION_LETTERS[i],
            selector: `--option ${o.letter || OPTION_LETTERS[i]}`,
            votes: mapVotes(o.perSong),
          }))
        : [{ code: null, selector: null, votes: defaultMap(ballotUp) }];

  // Down axis: down-structure shapes if present, else the single live down shape,
  // else none at all (up-only columns).
  let downOptions;
  if (downTr && Array.isArray(downTr.options) && downTr.options.length) {
    downOptions = downTr.options.map((o) => ({
      code: downShapeShort(o.downShape),
      selector: `--down-shape ${o.downShape}`,
      down: mapVotes(o.perSong),
    }));
  } else {
    const dmap = defaultMap(ballotDown);
    downOptions = dmap.size ? [{ code: '▼', selector: null, down: dmap }] : [null];
  }

  const rows = [
    ...(songs || []).map((s) => ({
      rawOrderIndex: s.rawOrderIndex,
      title: s.title,
      artist: s.artist,
      isOwn: false,
      song: s,
    })),
    ...(ownSongs || []).map((s) => ({
      rawOrderIndex: s.rawOrderIndex,
      title: s.title,
      artist: s.artist,
      isOwn: true,
      song: s,
    })),
  ].sort((a, b) => (a.rawOrderIndex ?? 0) - (b.rawOrderIndex ?? 0));

  const raw = [];
  for (const up of upOptions) {
    for (const down of downOptions) {
      const perIndex = new Map();
      let upTotal = 0;
      let downTotal = 0;
      let conflicts = 0;
      for (const r of rows) {
        if (r.isOwn) {
          perIndex.set(r.rawOrderIndex, 'own');
          continue;
        }
        const u = up.votes.get(r.rawOrderIndex) || 0;
        const d = down ? down.down.get(r.rawOrderIndex) || 0 : 0;
        upTotal += u;
        downTotal += d;
        let cell;
        if (u > 0 && d > 0) {
          cell = 'conflict';
          conflicts++;
        } else if (u > 0) cell = u;
        else if (d > 0) cell = -d;
        else cell = 0;
        perIndex.set(r.rawOrderIndex, cell);
      }
      const code = [up.code, down && down.code].filter(Boolean).join('·') || '▲';
      const selector = [up.selector, down && down.selector].filter(Boolean).join(' ') || null;
      raw.push({ code, selector, perIndex, totals: { up: upTotal, down: downTotal, conflicts } });
    }
  }

  // Dedup columns that produce an identical ballot; merge their selectors.
  const bySig = new Map();
  const combos = [];
  for (const c of raw) {
    const sig = rows.map((r) => c.perIndex.get(r.rawOrderIndex)).join('|');
    const hit = bySig.get(sig);
    if (hit) {
      hit.members.push({ code: c.code, selector: c.selector });
      continue;
    }
    const col = { perIndex: c.perIndex, totals: c.totals, members: [{ code: c.code, selector: c.selector }] };
    bySig.set(sig, col);
    combos.push(col);
  }

  return { combos, rows };
}

// Render the combo ballot as a (horizontally scrollable) table: rows are raw
// submission slots (own songs interleaved as dashes), columns are deduped combos.
export function comboBallotHtml(tradeoffs, songs = [], ownSongs = [], pick = null) {
  const { combos, rows } = buildComboBallot(tradeoffs, songs, ownSongs, pick);
  if (!combos.length || !rows.length) return '';
  if (!combos.some((c) => c.totals.up > 0 || c.totals.down > 0)) return '';
  const anyConflict = combos.some((c) => c.totals.conflicts > 0);

  const headCols = combos
    .map((c) => {
      const title = c.members.map((m) => m.selector || 'default').join('  ·  ');
      return `<th class="num c" title="${esc(title)}">${esc(c.members.map((m) => m.code).join(' / '))}</th>`;
    })
    .join('');

  const body = rows
    .map((r) => {
      const cells = combos
        .map((c) => {
          const v = c.perIndex.get(r.rawOrderIndex);
          if (r.isOwn || v === 'own') return '<td class="c zero">—</td>';
        if (isExcludedFromAllocation(r.song)) return '<td class="c zero excluded">—</td>';
          if (v === 'conflict')
            return '<td class="c conflict" title="Conflict: upvoted by this option and downvoted by this shape — resolve by hand">!</td>';
          if (v > 0) return `<td class="c up">+${v}</td>`;
          if (v < 0) return `<td class="c down">${v}</td>`;
          return '<td class="c zero">·</td>';
        })
        .join('');
      const id = `<td class="num muted">${esc(r.rawOrderIndex)}</td><td>${esc(r.title)}</td><td class="muted">${esc(r.artist)}</td>`;
      return `<tr${r.isOwn ? ' class="own"' : isExcludedFromAllocation(r.song) ? ' class="excluded"' : ''}>${id}${cells}</tr>`;
    })
    .join('\n');

  const foot = combos
    .map((c) => {
      const base = c.totals.down > 0 ? `${c.totals.up}/-${c.totals.down}` : `${c.totals.up}`;
      const conf = c.totals.conflicts > 0 ? ` <span class="cf">!${c.totals.conflicts}</span>` : '';
      return `<td class="num c">${base}${conf}</td>`;
    })
    .join('');

  const legend = combos
    .map(
      (c) =>
        `<li>${c.members
          .map((m) => `<code>${esc(m.code)}</code> = <code>${esc(m.selector || 'default')}</code>`)
          .join('; ')}</li>`
    )
    .join('');

  const conflictNote = anyConflict
    ? '<p class="muted cf-note"><b>!</b> = this up option upvotes a song the down shape also downvotes, so the two disagree for that combo — resolve by hand (or pin the downvote). Totals show each axis\u2019s intended budget.</p>'
    : '';

  return `<section class="ballot">
  <h2>Ballot (raw order)</h2>
  <p class="muted">Each column is one complete ballot (upvotes +, downvotes \u2212) in Music League submission order — pick a column and transcribe straight down, no need to choose first.</p>
  <div class="ballot-scroll">
  <table>
    <thead><tr><th class="num">#</th><th>Title</th><th>Artist</th>${headCols}</tr></thead>
    <tbody>
${body}
    </tbody>
    <tfoot><tr><td></td><td>Total ▲ / ▼</td><td></td>${foot}</tr></tfoot>
  </table>
  </div>
  <ul class="legend">${legend}</ul>
  ${conflictNote}
</section>`;
}

const RENDER_HTML_BASE_STYLE = `
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1a1c20;
  --muted: #6b7280;
  --line: #e5e7eb;
  --card: #fbfbfc;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #14161a; --fg: #e6e8ec; --muted: #9aa1ab; --line: #2a2e35; --card: #1b1e24; }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 1.5rem 1rem 4rem;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
.wrap { max-width: 900px; margin: 0 auto; }
h2 { font-size: 1.05rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 2rem 0 .75rem; }
.muted { color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: .35rem; }
.chip {
  --chip-hue: 220;
  display: inline-block; padding: .1rem .5rem; border-radius: 999px; font-size: .8rem;
  background: hsl(var(--chip-hue) 60% 50% / .14); color: hsl(var(--chip-hue) 55% 38%);
  border: 1px solid hsl(var(--chip-hue) 60% 50% / .25);
}
@media (prefers-color-scheme: dark) { .chip { color: hsl(var(--chip-hue) 70% 72%); } }

table { width: 100%; border-collapse: collapse; font-size: .9rem; }
th, td { text-align: left; padding: .4rem .5rem; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; }
.num { text-align: right; font-variant-numeric: tabular-nums; }

.tier {
  --tier-hue: 220;
  display: inline-block; padding: .1rem .5rem; border-radius: 6px; font-weight: 700; font-size: .78rem;
  text-transform: uppercase; letter-spacing: .03em;
  background: hsl(var(--tier-hue) 60% 50% / .16); color: hsl(var(--tier-hue) 55% 36%);
}
@media (prefers-color-scheme: dark) { .tier { color: hsl(var(--tier-hue) 70% 70%); } }

.card {
  --tier-hue: 220;
  display: grid; grid-template-columns: 9.5rem 1fr; gap: 1rem;
  padding: 1rem; margin: .75rem 0; border: 1px solid var(--line); border-radius: 10px;
  background: var(--card); border-left: 4px solid hsl(var(--tier-hue) 60% 50% / .7);
}
.identity { display: flex; flex-direction: column; gap: .15rem; min-width: 0; }
.identity .rank { font-variant-numeric: tabular-nums; color: var(--muted); font-size: .8rem; font-weight: 600; }
.identity .title { font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
.identity .artist { color: var(--muted); font-size: .9rem; overflow-wrap: anywhere; }

.body { min-width: 0; }
.card-head { display: flex; align-items: center; flex-wrap: wrap; gap: .4rem; margin-bottom: .5rem; }
.themes { display: flex; flex-wrap: wrap; gap: .3rem; }
.rationale { margin: .25rem 0 .5rem; }
.flags { display: flex; flex-wrap: wrap; gap: .3rem; margin-bottom: .5rem; }
.flag {
  display: inline-block; padding: .1rem .45rem; border-radius: 6px; font-size: .75rem;
  background: hsl(40 90% 50% / .16); color: hsl(35 85% 35%); border: 1px solid hsl(40 90% 50% / .3);
}
.flag.dq { background: hsl(0 80% 50% / .14); color: hsl(0 70% 42%); border-color: hsl(0 80% 50% / .3); }
@media (prefers-color-scheme: dark) { .flag { color: hsl(42 90% 70%); } .flag.dq { color: hsl(0 80% 72%); } }
.meta { display: flex; flex-wrap: wrap; gap: .75rem; color: var(--muted); font-size: .82rem; }

.ballot-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.ballot table { font-size: .85rem; }
.ballot th.c, .ballot td.c { white-space: nowrap; }
.ballot td.c { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; }
.ballot td.c.up { color: hsl(145 60% 38%); }
.ballot td.c.down { color: hsl(0 65% 45%); }
.ballot td.c.conflict { color: hsl(35 90% 42%); font-weight: 800; }
.ballot td.c.zero { color: var(--muted); font-weight: 400; }
.ballot tr.own td { color: var(--muted); font-style: italic; }
.ballot tfoot td { font-weight: 700; border-top: 2px solid var(--line); border-bottom: none; white-space: nowrap; }
.ballot tfoot .cf { color: hsl(35 90% 42%); }
.ballot .legend { margin: .6rem 0 0; padding-left: 1.1rem; font-size: .82rem; color: var(--muted); }
.ballot .legend code { font-size: .82rem; }
.ballot .cf-note { font-size: .82rem; margin: .5rem 0 0; }
@media (prefers-color-scheme: dark) {
  .ballot td.c.up { color: hsl(145 60% 62%); }
  .ballot td.c.down { color: hsl(0 70% 68%); }
  .ballot td.c.conflict, .ballot tfoot .cf { color: hsl(40 90% 65%); }
}

.tradeoffs .tradeoff { margin: 0 0 1.25rem; }
.tradeoffs .q { font-weight: 600; margin: 0 0 .5rem; }
.tradeoffs table.compare { font-size: .88rem; }
.tradeoffs table.compare th.opt, .tradeoffs table.compare td.opt { width: 3rem; }
.tradeoffs table.compare td.opt { color: var(--muted); }
.tradeoffs table.compare td.opt.on { color: var(--fg); font-weight: 700; }
.tradeoffs table.compare .opt.default { background: hsl(145 60% 50% / .1); }
.tradeoffs table.compare .opt.chosen { background: hsl(265 70% 55% / .16); }
.tradeoffs table.compare th.opt.chosen { color: hsl(265 60% 45%); font-weight: 800; }
@media (prefers-color-scheme: dark) { .tradeoffs table.compare th.opt.chosen { color: hsl(265 80% 78%); } }
.pick .reason, .pick .tweaks { margin: .25rem 0; font-size: .92rem; }
.pick .reason .label, .pick .tweaks .label { text-transform: uppercase; letter-spacing: .04em; font-size: .7rem; font-weight: 700; color: var(--muted); margin-right: .4rem; }
.pick table.compare td.votes.on { font-weight: 700; color: hsl(265 60% 45%); }
@media (prefers-color-scheme: dark) { .pick table.compare td.votes.on { color: hsl(265 80% 78%); } }
.considered { margin-top: 1rem; }
.considered summary { cursor: pointer; color: var(--muted); font-size: .9rem; }
.considered[open] summary { margin-bottom: .5rem; }
.tradeoffs table.compare tfoot td { font-weight: 700; border-top: 2px solid var(--line); border-bottom: none; }
.tradeoffs .sub { margin: .9rem 0 .3rem; font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; }
.tradeoffs table.compare tr.own td { color: var(--muted); font-style: italic; }
.tradeoffs .legend { margin: .6rem 0 0; padding-left: 1.1rem; font-size: .85rem; color: var(--muted); }
.tradeoffs .legend code { font-size: .82rem; }

@media (max-width: 560px) {
  .card { grid-template-columns: 1fr; gap: .5rem; }
  .identity { flex-direction: row; align-items: baseline; flex-wrap: wrap; gap: .4rem; }
}
`;

const RENDER_FINAL_STYLE_EXTRA = `
h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
.lead { font-size: 1.05rem; line-height: 1.45; margin: .5rem 0 1rem; }

.facts { display: flex; flex-wrap: wrap; gap: .4rem; margin: .25rem 0 .5rem; }
.fact { font-size: .82rem; color: var(--muted); padding: .15rem .55rem; border: 1px solid var(--line); border-radius: 999px; }
.fact b { color: var(--fg); font-variant-numeric: tabular-nums; }
.fact.warn { color: hsl(35 85% 38%); border-color: hsl(40 90% 50% / .4); }
@media (prefers-color-scheme: dark) { .fact.warn { color: hsl(42 90% 70%); } }
.counts { font-size: .85rem; margin: .25rem 0 0; }

.score {
  font-weight: 700; font-variant-numeric: tabular-nums; font-size: .8rem;
  padding: .1rem .45rem; border-radius: 6px; border: 1px solid var(--line); color: var(--muted);
}
.score .mods { color: var(--fg); font-weight: 800; margin-left: .15rem; }
.score.your { color: var(--fg); background: hsl(var(--tier-hue) 60% 50% / .06); border-color: var(--line); }
.score.fit { color: var(--muted); }
.score.combined { color: var(--fg); background: hsl(var(--tier-hue) 60% 50% / .14); border-color: hsl(var(--tier-hue) 60% 50% / .3); }
.score.votes { color: var(--muted); }
.score.votes.has-votes { color: #fff; background: hsl(var(--vote-hue, 270) 70% 60%); border-color: hsl(var(--vote-hue, 270) 70% 60%); }
.score.votes.has-down { color: #fff; background: hsl(0 65% 48%); border-color: hsl(0 65% 48%); }
@media (prefers-color-scheme: dark) {
  .score.votes.has-votes { color: #0d0f12; background: hsl(var(--vote-hue, 270) 70% 60%); border-color: hsl(var(--vote-hue, 270) 70% 60%); }
  .score.votes.has-down { color: #0d0f12; background: hsl(0 70% 68%); border-color: hsl(0 70% 68%); }
}

.themes { margin: .25rem 0 .5rem; }
.comment { margin: .25rem 0 .5rem; }
.comment .label, .rationale .label { text-transform: uppercase; letter-spacing: .04em; font-size: .7rem; font-weight: 700; color: var(--muted); margin-right: .35rem; }

.tradeoffs .q { font-weight: 600; }
.tradeoffs li.tradeoff { margin: .4rem 0; }
.tradeoffs li.tradeoff ul { margin: .25rem 0 0; }
.list li { margin: .25rem 0; }
`;

const RENDER_FIT_STYLE_EXTRA = `
h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
.lead { font-size: 1.05rem; margin: .25rem 0 .75rem; }
.method { margin-top: .75rem; }
.method summary { cursor: pointer; color: var(--muted); font-size: .9rem; }
.method p { margin: .5rem 0 0; color: var(--muted); font-size: .92rem; }

.card-head .score {
  font-weight: 700; font-variant-numeric: tabular-nums; font-size: .8rem;
  padding: .1rem .45rem; border-radius: 6px; border: 1px solid var(--line); color: var(--muted);
}
.score-heat, .tier.score-heat {
  --score-hue: 145;
  color: hsl(var(--score-hue) 60% 32%);
  background: hsl(var(--score-hue) 65% 50% / .16);
  border: 1px solid hsl(var(--score-hue) 65% 50% / .4);
}
@media (prefers-color-scheme: dark) {
  .score-heat, .tier.score-heat { color: hsl(var(--score-hue) 80% 72%); background: hsl(var(--score-hue) 65% 50% / .18); }
}
.card-head .score.score-heat { color: hsl(var(--score-hue) 60% 32%); background: hsl(var(--score-hue) 65% 50% / .16); border-color: hsl(var(--score-hue) 65% 50% / .4); }
@media (prefers-color-scheme: dark) {
  .card-head .score.score-heat { color: hsl(var(--score-hue) 80% 72%); background: hsl(var(--score-hue) 65% 50% / .18); }
}
.card-head .score.votes { color: var(--muted); }
.card-head .score.votes.has-votes { color: #fff; background: hsl(var(--vote-hue, 270) 70% 60%); border-color: hsl(var(--vote-hue, 270) 70% 60%); }
@media (prefers-color-scheme: dark) { .card-head .score.votes.has-votes { color: #0d0f12; background: hsl(var(--vote-hue, 270) 70% 60%); border-color: hsl(var(--vote-hue, 270) 70% 60%); } }
.music-note { margin: .25rem 0 .5rem; color: var(--muted); font-size: .9rem; }
.music-note .label { text-transform: uppercase; letter-spacing: .04em; font-size: .7rem; font-weight: 700; margin-right: .35rem; }

.norm {
  margin: 0 0 .5rem; font-size: .82rem; font-variant-numeric: tabular-nums;
  padding: .25rem .5rem; border: 1px dashed var(--line); border-radius: 6px;
  background: hsl(var(--tier-hue) 60% 50% / .05);
}
.norm sup { font-size: .65em; }
.norm .raw { font-size: .95em; }
.flag.lift { background: hsl(265 70% 55% / .16); color: hsl(265 60% 45%); border-color: hsl(265 70% 55% / .35); }
@media (prefers-color-scheme: dark) { .flag.lift { color: hsl(265 80% 78%); } }

.highlights li, .combine li { margin: .3rem 0; }
`;

export const RENDER_FINAL_STYLE = RENDER_HTML_BASE_STYLE + RENDER_FINAL_STYLE_EXTRA;
export const RENDER_FIT_STYLE = RENDER_HTML_BASE_STYLE + RENDER_FIT_STYLE_EXTRA;
