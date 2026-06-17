#!/usr/bin/env node
// Render a fit-research JSON sidecar into a self-contained, mobile-friendly HTML report.
// Usage: node scripts/render-fit-html.mjs <fit.json> [--out <path>] [--order fit|combined|music|raw]
//
// The JSON is the source of truth (same file the agent produces during fit research).
// This script only presents it: each candidate is a card with a narrow identity column
// (#raw-order / title / artist stacked) so the rationale/notes get the full width.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join, extname } from 'node:path';
import { formatScore } from './score-core.mjs';
import { matchFlag, takePositional } from './cli-args.mjs';
import { esc, tierHue, chip, tradeoffsHtml, pickHtml, RENDER_FIT_STYLE } from './render-html-shared.mjs';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { file: null, out: null, order: 'fit' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    let next = matchFlag(argv, i, 'out', (v) => {
      args.out = v;
    });
    if (next != null) {
      i = next;
      continue;
    }
    next = matchFlag(argv, i, 'order', (v) => {
      args.order = v;
    });
    if (next != null) {
      i = next;
      continue;
    }
    if (takePositional(a, args)) continue;
  }
  return args;
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

function renderCard(s, combineLabel, weights) {
  const hue = tierHue(s.fitTier);
  const themes = Array.isArray(s.themesHit) ? s.themesHit : [];
  const themeChips = themes.length
    ? themes.map((t) => chip(t)).join('')
    : '<span class="muted">no themes</span>';

  const flags = Array.isArray(s.flags) ? s.flags : [];
  let flagChips = flags.map((f) => `<span class="flag">${esc(f)}</span>`).join('');
  if (s.musicLift) {
    flagChips += `<span class="flag lift" title="Music pulled this above ${esc(
      s.musicLift.overTitle
    )} (${esc(s.musicLift.overTier)} fit) despite a weaker fit tier — promote/adjust by hand if you disagree">↑ music-lifted over ${esc(
      s.musicLift.overTier
    )}</span>`;
  }

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
  if (s.draftDownvotes > 0)
    scores.push(
      `<span class="score votes has-down" title="draft downvotes">-${formatScore(s.draftDownvotes)} ▼</span>`
    );
  else if (s.draftVotes != null)
    scores.push(
      `<span class="score votes${s.draftVotes > 0 ? ' has-votes' : ''}" title="draft upvotes">${formatScore(s.draftVotes)} ▲</span>`
    );

  // Show how the combined score is actually built: each axis normalized onto the
  // same 75-centered scale, then weighted. This is what explains a jump that the
  // raw 100-point fit / music numbers can't (low fitⁿ but high musicⁿ → lifted).
  const wf = weights && weights.fit != null ? weights.fit : 0.7;
  const wm = weights && weights.music != null ? weights.music : 0.3;
  const normLine =
    s.fitNorm != null && s.musicNorm != null
      ? `<div class="norm" title="Each axis is z-scored across the contenders and remapped to a 75-centered scale, then blended. Raw fit/music sit on different spreads; normalizing is what puts them on equal footing.">` +
        `<span class="muted">combined</span> <b>${formatScore(s.combinedScore)}</b> ` +
        `<span class="muted">=</span> fit<sup>n</sup> <b>${formatScore(s.fitNorm)}</b> ` +
        `<span class="muted">×&#8202;${wf}</span> <span class="muted">+</span> ` +
        `music<sup>n</sup> <b>${formatScore(s.musicNorm)}</b> <span class="muted">×&#8202;${wm}</span>` +
        `<span class="raw muted"> (raw fit ${formatScore(s.fitScore)}, music ${formatScore(s.musicScore)})</span>` +
        `</div>`
      : '';

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
    ${normLine}
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
    // Combined first, then music as the explicit secondary axis (so equal-combined
    // songs read high-to-low on the real music score, not by raw submission order),
    // then raw order as the final stable tiebreak.
    songs.sort(
      (a, b) =>
        (b.combinedScore ?? b.fitScore ?? 0) - (a.combinedScore ?? a.fitScore ?? 0) ||
        (b.musicScore ?? -Infinity) - (a.musicScore ?? -Infinity) ||
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
  ${songs.map((s) => renderCard(s, combineLabel, w)).join('\n')}
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
  if (!songs.some((s) => s.draftVotes != null || s.draftDownvotes != null)) return '';
  // Interleave the owner's own (unvotable) submissions so EVERY raw submission slot
  // is present — the user enters votes by position, so a hidden gap (your own song)
  // risks a misaligned ballot.
  const own = Array.isArray(data.ownSongs) ? data.ownSongs : [];
  const rowsAll = [...songs, ...own].sort((a, b) => (a.rawOrderIndex ?? 0) - (b.rawOrderIndex ?? 0));
  const upTotal = songs.reduce((sum, s) => sum + (Number(s.draftVotes) || 0), 0);
  const downTotal = songs.reduce((sum, s) => sum + (Number(s.draftDownvotes) || 0), 0);
  const rows = rowsAll
    .map((s) => {
      if (s.isOwn) {
        return `<tr class="own">
      <td class="num">${esc(s.rawOrderIndex)}</td>
      <td>${esc(s.title)}</td>
      <td class="muted">${esc(s.artist)}</td>
      <td class="num votes muted">— your song</td>
    </tr>`;
      }
      const up = Number(s.draftVotes) || 0;
      const downv = Number(s.draftDownvotes) || 0;
      const cell = downv > 0 ? `-${downv}` : String(up);
      const cls = downv > 0 ? ' class="has-down"' : up > 0 ? ' class="has-votes"' : '';
      const voteCls = downv > 0 ? 'num votes down' : 'num votes';
      return `<tr${cls}>
      <td class="num">${esc(s.rawOrderIndex)}</td>
      <td>${esc(s.title)}</td>
      <td class="muted">${esc(s.artist)}</td>
      <td class="${voteCls}">${cell}</td>
    </tr>`;
    })
    .join('\n');
  const totalCell = downTotal > 0 ? `${upTotal} ▲ / -${downTotal} ▼` : String(upTotal);
  return `<section class="transfer">
  <h2>Vote transfer (raw order)</h2>
  <p class="muted">Songs in Music League submission order with the draft votes (upvotes positive, downvotes negative) — for entering back into the app in one pass.</p>
  <table>
    <thead><tr><th class="num">#</th><th>Title</th><th>Artist</th><th class="num">Votes</th></tr></thead>
    <tbody>
${rows}
    </tbody>
    <tfoot><tr><td></td><td></td><td class="num">Total</td><td class="num">${totalCell}</td></tr></tfoot>
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
const STYLE = RENDER_FIT_STYLE;

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
${tradeoffsHtml(data.tradeoffs, data.ownSongs)}
${pickHtml(data.pick, data.ownSongs)}
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
