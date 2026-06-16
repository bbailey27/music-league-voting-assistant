#!/usr/bin/env node
// Render a fit-research JSON sidecar into a self-contained, mobile-friendly HTML report.
// Usage: node scripts/render-fit-html.mjs <fit.json> [--out <path>] [--order fit|combined|music|raw]
//
// The JSON is the source of truth (same file the agent produces during fit research).
// This script only presents it: each candidate is a card with a narrow identity column
// (#raw-order / title / artist stacked) so the rationale/notes get the full width.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join, extname } from 'node:path';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { file: null, out: null, order: 'fit' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a.startsWith('--out=')) args.out = a.slice('--out='.length);
    else if (a === '--order') args.order = argv[++i];
    else if (a.startsWith('--order=')) args.order = a.slice('--order='.length);
    else if (!a.startsWith('--') && !args.file) args.file = a;
  }
  return args;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatScore(n) {
  if (n == null) return '';
  return Number.isInteger(n) ? String(n) : Number(n).toFixed(1);
}

// Stable, theme-neutral accent per tier (dark/light friendly hues).
const TIER_HUE = {
  excellent: 145,
  strong: 200,
  solid: 260,
  moderate: 35,
  weak: 15,
  nope: 0,
};

function tierHue(tier) {
  return TIER_HUE[String(tier || '').toLowerCase()] ?? 220;
}

function chip(text, hue) {
  const style = hue == null ? '' : ` style="--chip-hue:${hue}"`;
  return `<span class="chip"${style}>${esc(text)}</span>`;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------
function renderHead(data) {
  const r = data.round || {};
  const keywords = Array.isArray(data.themeKeywords) ? data.themeKeywords : [];
  const kwChips = keywords.map((k) => chip(k)).join('');
  const titleLine = r.prompt
    ? `${esc(r.prompt)}${r.league ? ` <span class="muted">— ${esc(r.league)}</span>` : ''}`
    : esc(r.title || 'Fit report');

  return `<header class="report-head">
  <h1>${titleLine}</h1>
  ${r.description ? `<p class="lead">${esc(r.description)}</p>` : ''}
  ${kwChips ? `<div class="chips">${kwChips}</div>` : ''}
  ${data.method ? `<details class="method"><summary>Method</summary><p>${esc(data.method)}</p></details>` : ''}
</header>`;
}

function renderScale(data) {
  const scale = data.fitScale;
  if (!scale || typeof scale !== 'object') return '';
  const rows = Object.entries(scale)
    .map(([tier, info]) => {
      const hue = tierHue(tier);
      const score = info && info.fitScore != null ? formatScore(info.fitScore) : '';
      const desc = info && info.desc ? esc(info.desc) : '';
      return `<tr>
      <td><span class="tier" style="--tier-hue:${hue}">${esc(tier)}</span></td>
      <td class="num">${score}</td>
      <td>${desc}</td>
    </tr>`;
    })
    .join('\n');
  return `<section class="scale">
  <h2>Fit scale</h2>
  <table>
    <thead><tr><th>Tier</th><th class="num">Score</th><th>Meaning</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</section>`;
}

function renderCard(s, combineLabel) {
  const hue = tierHue(s.fitTier);
  const themes = Array.isArray(s.themesHit) ? s.themesHit : [];
  const themeChips = themes.length
    ? themes.map((t) => chip(t)).join('')
    : '<span class="muted">no themes</span>';

  const flags = Array.isArray(s.flags) ? s.flags : [];
  const flagChips = flags.map((f) => `<span class="flag">${esc(f)}</span>`).join('');

  const meta = [];
  if (s.confidence) meta.push(`<span class="meta-item">confidence: ${esc(s.confidence)}</span>`);
  if (s.basis) meta.push(`<span class="meta-item">basis: ${esc(s.basis)}</span>`);
  if (s.submitterAssist) meta.push('<span class="meta-item">submitter-assist</span>');

  const scores = [`<span class="score" title="fit score">fit ${formatScore(s.fitScore)}</span>`];
  if (s.musicScore != null)
    scores.push(`<span class="score music" title="your music score">music ${formatScore(s.musicScore)}</span>`);
  if (s.combinedScore != null)
    scores.push(
      `<span class="score combined" title="${esc(combineLabel || 'music+fit blend')}">combined ${formatScore(s.combinedScore)}</span>`
    );
  if (s.draftVotes != null)
    scores.push(
      `<span class="score votes${s.draftVotes > 0 ? ' has-votes' : ''}" title="draft upvotes">${formatScore(s.draftVotes)} ▲</span>`
    );

  return `<article class="card" style="--tier-hue:${hue}">
  <div class="identity">
    <span class="rank">#${esc(s.rawOrderIndex)}</span>
    <span class="title">${esc(s.title)}</span>
    <span class="artist">${esc(s.artist)}</span>
  </div>
  <div class="body">
    <div class="card-head">
      <span class="tier">${esc(s.fitTier)}</span>
      ${scores.join('')}
      <div class="themes">${themeChips}</div>
    </div>
    ${flagChips ? `<div class="flags">${flagChips}</div>` : ''}
    ${s.rationale ? `<p class="rationale">${esc(s.rationale)}</p>` : ''}
    ${s.musicComment ? `<p class="music-note"><span class="label">your note</span> ${esc(s.musicComment)}</p>` : ''}
    ${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}
  </div>
</article>`;
}

function renderCandidates(data, order) {
  const songs = Array.isArray(data.songs) ? data.songs.slice() : [];
  if (order === 'raw') {
    songs.sort((a, b) => (a.rawOrderIndex ?? 0) - (b.rawOrderIndex ?? 0));
  } else if (order === 'combined') {
    songs.sort(
      (a, b) =>
        (b.combinedScore ?? b.fitScore ?? 0) - (a.combinedScore ?? a.fitScore ?? 0) ||
        (a.rawOrderIndex ?? 0) - (b.rawOrderIndex ?? 0)
    );
  } else if (order === 'music') {
    // Music-score order: best for gate rounds where fit is an unweighted pass and
    // the music score drives the ranking — funded songs first within a tie so the
    // vote boundary is easy to eyeball. Songs without a music score sort last.
    songs.sort(
      (a, b) =>
        (b.musicScore ?? -Infinity) - (a.musicScore ?? -Infinity) ||
        (b.draftVotes ?? 0) - (a.draftVotes ?? 0) ||
        (a.rawOrderIndex ?? 0) - (b.rawOrderIndex ?? 0)
    );
  } else {
    songs.sort(
      (a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0) || (a.rawOrderIndex ?? 0) - (b.rawOrderIndex ?? 0)
    );
  }
  const heading =
    order === 'raw'
      ? 'Candidates (raw order)'
      : order === 'combined'
        ? 'Candidates (by combined score)'
        : order === 'music'
          ? 'Candidates (by music score)'
          : 'Candidates (by fit)';
  const w = data.combineWeights;
  const combineLabel =
    w && w.fit != null && w.music != null
      ? `${Math.round(w.fit * 100)}% fit / ${Math.round(w.music * 100)}% music`
      : 'music+fit blend';
  return `<section class="candidates">
  <h2>${heading}</h2>
  ${songs.map((s) => renderCard(s, combineLabel)).join('\n')}
</section>`;
}

function renderHighlights(data) {
  const items = Array.isArray(data.highlights) ? data.highlights : [];
  if (!items.length) return '';
  const lis = items.map((h) => `<li>${esc(h)}</li>`).join('\n');
  return `<section class="highlights">
  <h2>Highlights &amp; judgment calls</h2>
  <ul>
${lis}
  </ul>
</section>`;
}

function renderTransfer(data) {
  const songs = Array.isArray(data.songs) ? data.songs.slice() : [];
  if (!songs.length) return '';
  // Only worth showing once an allocation exists.
  if (!songs.some((s) => s.draftVotes != null)) return '';
  songs.sort((a, b) => (a.rawOrderIndex ?? 0) - (b.rawOrderIndex ?? 0));
  const total = songs.reduce((sum, s) => sum + (Number(s.draftVotes) || 0), 0);
  const rows = songs
    .map(
      (s) => `<tr${s.draftVotes > 0 ? ' class="has-votes"' : ''}>
      <td class="num">${esc(s.rawOrderIndex)}</td>
      <td>${esc(s.title)}</td>
      <td class="muted">${esc(s.artist)}</td>
      <td class="num votes">${formatScore(s.draftVotes ?? 0)}</td>
    </tr>`
    )
    .join('\n');
  return `<section class="transfer">
  <h2>Vote transfer (raw order)</h2>
  <p class="muted">Songs in Music League submission order with the draft upvotes — for entering back into the app.</p>
  <table>
    <thead><tr><th class="num">#</th><th>Title</th><th>Artist</th><th class="num">Votes</th></tr></thead>
    <tbody>
${rows}
    </tbody>
    <tfoot><tr><td></td><td></td><td class="num">Total</td><td class="num">${formatScore(total)}</td></tr></tfoot>
  </table>
</section>`;
}

function renderCombine(data) {
  const c = data.combine;
  if (!c || typeof c !== 'object') return '';
  const note = c.note ? `<p>${esc(c.note)}</p>` : '';
  const options = Array.isArray(c.options) ? c.options : [];
  const ol = options.length ? `<ol>${options.map((o) => `<li>${esc(o)}</li>`).join('\n')}</ol>` : '';
  if (!note && !ol) return '';
  return `<section class="combine">
  <h2>How to combine with music scores</h2>
  ${note}
  ${ol}
</section>`;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------
const STYLE = `
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
h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
h2 { font-size: 1.05rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 2rem 0 .75rem; }
.lead { font-size: 1.05rem; margin: .25rem 0 .75rem; }
.muted { color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: .35rem; }
.chip {
  --chip-hue: 220;
  display: inline-block; padding: .1rem .5rem; border-radius: 999px; font-size: .8rem;
  background: hsl(var(--chip-hue) 60% 50% / .14); color: hsl(var(--chip-hue) 55% 38%);
  border: 1px solid hsl(var(--chip-hue) 60% 50% / .25);
}
@media (prefers-color-scheme: dark) {
  .chip { color: hsl(var(--chip-hue) 70% 72%); }
}
.method { margin-top: .75rem; }
.method summary { cursor: pointer; color: var(--muted); font-size: .9rem; }
.method p { margin: .5rem 0 0; color: var(--muted); font-size: .92rem; }

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
.card-head .score {
  font-weight: 700; font-variant-numeric: tabular-nums; font-size: .8rem;
  padding: .1rem .45rem; border-radius: 6px; border: 1px solid var(--line); color: var(--muted);
}
.card-head .score.combined { color: var(--fg); background: hsl(var(--tier-hue) 60% 50% / .14); border-color: hsl(var(--tier-hue) 60% 50% / .3); }
.card-head .score.votes { color: var(--muted); }
.card-head .score.votes.has-votes { color: #fff; background: hsl(var(--tier-hue) 65% 42%); border-color: hsl(var(--tier-hue) 65% 42%); }
@media (prefers-color-scheme: dark) { .card-head .score.votes.has-votes { color: #0d0f12; background: hsl(var(--tier-hue) 65% 65%); border-color: hsl(var(--tier-hue) 65% 65%); } }
.themes { display: flex; flex-wrap: wrap; gap: .3rem; }
.music-note { margin: .25rem 0 .5rem; color: var(--muted); font-size: .9rem; }
.music-note .label { text-transform: uppercase; letter-spacing: .04em; font-size: .7rem; font-weight: 700; margin-right: .35rem; }
.flags { display: flex; flex-wrap: wrap; gap: .3rem; margin-bottom: .5rem; }
.flag {
  display: inline-block; padding: .1rem .45rem; border-radius: 6px; font-size: .75rem;
  background: hsl(40 90% 50% / .16); color: hsl(35 85% 35%); border: 1px solid hsl(40 90% 50% / .3);
}
@media (prefers-color-scheme: dark) { .flag { color: hsl(42 90% 70%); } }
.rationale { margin: .25rem 0 .5rem; }
.meta { display: flex; flex-wrap: wrap; gap: .75rem; color: var(--muted); font-size: .82rem; }

.highlights li, .combine li { margin: .3rem 0; }

.transfer td.votes { font-weight: 700; }
.transfer tr.has-votes td.votes { color: hsl(145 60% 38%); }
@media (prefers-color-scheme: dark) { .transfer tr.has-votes td.votes { color: hsl(145 60% 62%); } }
.transfer tfoot td { font-weight: 700; border-top: 2px solid var(--line); border-bottom: none; }

@media (max-width: 560px) {
  .card { grid-template-columns: 1fr; gap: .5rem; }
  .identity { flex-direction: row; align-items: baseline; flex-wrap: wrap; gap: .4rem; }
}
`;

function renderDocument(data, order) {
  const r = data.round || {};
  const docTitle = r.prompt || r.title || 'Fit report';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(docTitle)} — fit report</title>
<style>${STYLE}</style>
</head>
<body>
<main class="wrap">
${renderHead(data)}
${renderScale(data)}
${renderCandidates(data, order)}
${renderHighlights(data)}
${renderCombine(data)}
${renderTransfer(data)}
</main>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error('Usage: node scripts/render-fit-html.mjs <fit.json> [--out <path>] [--order fit|combined|music|raw]');
    process.exit(1);
  }
  if (!['fit', 'raw', 'combined', 'music'].includes(args.order)) {
    console.error(`Invalid --order "${args.order}" (use fit, combined, music, or raw)`);
    process.exit(1);
  }

  const raw = await readFile(args.file, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`Could not parse JSON from ${args.file}: ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(data.songs) || !data.songs.length) {
    console.error(`No songs found in ${args.file}. Expected a fit JSON with a "songs" array.`);
    process.exit(1);
  }

  const html = renderDocument(data, args.order);

  const outPath =
    args.out ||
    join(
      dirname(args.file),
      basename(args.file, extname(args.file)) === 'scores' ? 'scores.html' : 'fit.html'
    );
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html, 'utf8');
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
