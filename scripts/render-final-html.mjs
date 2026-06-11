#!/usr/bin/env node
// Render the FINAL draft-vote output (the analysis/<round>.md equivalent) as a
// self-contained, card-based HTML page. The ranked markdown table gets too wide
// once you want scores, modifiers, comments AND fit reasoning side by side, so
// each song becomes a card instead.
//
// Usage:
//   node scripts/render-final-html.mjs <analysis.json> [--fit <fit.json>]
//                                      [--out <path>] [--order votes|score|raw]
//
// Inputs:
//   <analysis.json>  the deterministic parse output (buildJsonPayload) — the
//                    authoritative source for round/mode/budget/your scores +
//                    modifiers + comments + tradeoffs.
//   --fit <fit.json> optional LLM fit sidecar (analysis/<round>-fit.json). When
//                    present we re-run the deterministic merge+allocate from
//                    score-core (mergeFitJson) so the votes, combined scores and
//                    "needs your call" tradeoffs shown here are internally
//                    consistent with the fit reasoning — no stale numbers.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join, extname } from 'node:path';
import {
  scoreComment,
  mergeFitJson,
  formatScore,
  fitTierForScore,
} from './score-core.mjs';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { file: null, fit: null, out: null, order: 'votes' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fit') args.fit = argv[++i];
    else if (a.startsWith('--fit=')) args.fit = a.slice('--fit='.length);
    else if (a === '--out') args.out = argv[++i];
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

// Stable, theme-neutral accent per fit tier (dark/light friendly hues). Songs
// with no fit signal fall back to a neutral hue.
const TIER_HUE = {
  excellent: 145,
  strong: 200,
  solid: 260,
  moderate: 35,
  weak: 15,
  nope: 0,
};
const NEUTRAL_HUE = 220;

function tierHue(tier) {
  return TIER_HUE[String(tier || '').toLowerCase()] ?? NEUTRAL_HUE;
}

function chip(text, hue) {
  const style = hue == null ? '' : ` style="--chip-hue:${hue}"`;
  return `<span class="chip"${style}>${esc(text)}</span>`;
}

// The user's modifier badges, in the order they read in a comment.
function modifierText(s) {
  const m = [];
  if (s.plus) m.push('+');
  if (s.minus) m.push('−');
  if (s.uncertain) m.push('?');
  if (s.playlistAdd) m.push('play');
  return m.join(' ');
}

// Upvotes and downvotes are disjoint; render the side that has votes.
function voteBadge(s) {
  const up = s.finalVotes || 0;
  const down = s.finalDownvotes || 0;
  if (up && down)
    return `<span class="score votes has-votes" title="draft votes">${up} ▲ / ${down} ▼ ⚠</span>`;
  if (down) return `<span class="score votes has-down" title="draft downvotes">${down} ▼</span>`;
  return `<span class="score votes${up > 0 ? ' has-votes' : ''}" title="draft upvotes">${up} ▲</span>`;
}

// ---------------------------------------------------------------------------
// Build the model: music JSON is authoritative; the fit sidecar (when present)
// is merged deterministically so votes/combined/tradeoffs stay consistent.
// ---------------------------------------------------------------------------
function buildModel(music, fitData) {
  const mode = music.mode || 'objective';
  // Rehydrate each song's scoring signals from its comment so a manual fit
  // token (e.g. "fit 8") keeps precedence over the LLM during the merge — this
  // reproduces what parse-round did from the original round.
  const songs = (music.songs || []).map((s) => ({
    ...s,
    ...scoreComment(s.userComment ?? '', mode),
  }));

  let tradeoffs = Array.isArray(music.tradeoffs) ? music.tradeoffs : [];
  let combine = null;
  let combineWeights = null;

  if (fitData) {
    const parsed = { songs, budget: music.budget || {} };
    const weights = fitData.combineWeights || undefined;
    const result = mergeFitJson(parsed, fitData, { rankBy: 'combined', weights });
    tradeoffs = result.tradeoffs || [];
    combine = fitData.combine || null;
    combineWeights = fitData.combineWeights || null;
    // mergeFit only fills fit-silent songs; backfill a tier word for display
    // when a numeric fit landed without one.
    for (const s of songs) {
      if (s.fitScore != null && !s.fitTier) s.fitTier = fitTierForScore(s.fitScore);
    }
  }

  return { round: music.round || {}, mode, budget: music.budget || {}, songs, tradeoffs, combine, combineWeights };
}

function sortSongs(songs, order) {
  const v = (s) => s.finalVotes || 0;
  const rank = (s) => (s.combinedScore != null ? s.combinedScore : s.score ?? -Infinity);
  const list = songs.slice();
  if (order === 'raw') {
    list.sort((a, b) => (a.rawOrderIndex ?? 0) - (b.rawOrderIndex ?? 0));
  } else if (order === 'score') {
    list.sort((a, b) => rank(b) - rank(a) || v(b) - v(a) || (a.rawOrderIndex ?? 0) - (b.rawOrderIndex ?? 0));
  } else {
    list.sort((a, b) => v(b) - v(a) || rank(b) - rank(a) || (a.rawOrderIndex ?? 0) - (b.rawOrderIndex ?? 0));
  }
  return list;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------
function renderHead(model) {
  const r = model.round;
  const b = model.budget;
  const titleLine = r.prompt
    ? `${esc(r.prompt)}${r.league ? ` <span class="muted">— ${esc(r.league)}</span>` : ''}`
    : esc(r.title || 'Draft votes');

  const songs = model.songs;
  const scored = songs.filter((s) => s.score != null);
  const disqualified = songs.filter((s) => s.isDisqualified);
  const needsInput = songs.filter((s) => s.needsUserInput);
  const needsReview = songs.filter((s) => s.needsReview);
  const allocated = songs.reduce((a, s) => a + (s.finalVotes || 0), 0);
  const downAllocated = songs.reduce((a, s) => a + (s.finalDownvotes || 0), 0);

  const upTarget = b.upvoteBankSize ?? '?';
  const upOff = allocated !== b.upvoteBankSize;
  const downOff = b.downvotesEnabled && downAllocated !== b.downvoteBankSize;

  const facts = [];
  facts.push(`<span class="fact">mode <b>${esc(model.mode)}</b></span>`);
  facts.push(
    `<span class="fact">budget <b>${esc(upTarget)}</b> up · max ${esc(b.maxUpvotesPerSong ?? '?')}/song${
      b.downvotesEnabled ? ` · <b>${esc(b.downvoteBankSize)}</b> down` : ' · downvotes off'
    }</span>`
  );
  facts.push(
    `<span class="fact${upOff || downOff ? ' warn' : ''}">allocated <b>${allocated} / ${esc(upTarget)}</b> up${
      b.downvotesEnabled ? ` · <b>${downAllocated} / ${esc(b.downvoteBankSize ?? '?')}</b> down` : ''
    }${upOff || downOff ? ' ⚠️ rebalance' : ''}</span>`
  );
  if (model.combineWeights)
    facts.push(
      `<span class="fact">combined <b>${Math.round(model.combineWeights.fit * 100)}%</b> fit / <b>${Math.round(
        model.combineWeights.music * 100
      )}%</b> music</span>`
    );

  return `<header class="report-head">
  <h1>${titleLine} <span class="muted">— draft votes</span></h1>
  <div class="facts">${facts.join('')}</div>
  <p class="counts muted">${songs.length} songs · ${scored.length} scored · ${disqualified.length} disqualified · ${needsInput.length} need a score · ${needsReview.length} need review</p>
</header>`;
}

function statusFlags(s) {
  const flags = [];
  if (s.needsUserInput) flags.push('<span class="flag review">needs your score</span>');
  if (s.isDisqualified) flags.push('<span class="flag dq">disqualified</span>');
  if (s.needsReview) flags.push(`<span class="flag review">review${s.reviewReason ? `: ${esc(s.reviewReason)}` : ''}</span>`);
  const fit = Array.isArray(s.flags) ? s.flags : [];
  for (const f of fit) flags.push(`<span class="flag">${esc(f)}</span>`);
  return flags;
}

function renderCard(s) {
  const hue = s.fitTier ? tierHue(s.fitTier) : NEUTRAL_HUE;
  const mods = modifierText(s);

  const scores = [];
  if (s.score != null)
    scores.push(
      `<span class="score your" title="your music score">your ${formatScore(s.score)}${mods ? ` <span class="mods">${esc(mods)}</span>` : ''}</span>`
    );
  else if (mods)
    scores.push(`<span class="score your" title="your modifiers"><span class="mods">${esc(mods)}</span></span>`);
  if (s.fitTier || s.fitScore != null) {
    if (s.fitTier) scores.push(`<span class="tier">${esc(s.fitTier)}</span>`);
    if (s.fitScore != null) scores.push(`<span class="score fit" title="fit score">fit ${formatScore(s.fitScore)}</span>`);
  }
  if (s.combinedScore != null)
    scores.push(`<span class="score combined" title="combined score">combined ${formatScore(s.combinedScore)}</span>`);
  scores.push(voteBadge(s));

  const flags = statusFlags(s);
  const themes = Array.isArray(s.themesHit) ? s.themesHit : [];
  const themeChips = themes.length ? themes.map((t) => chip(t)).join('') : '';

  const meta = [];
  if (s.confidence) meta.push(`<span class="meta-item">confidence: ${esc(s.confidence)}</span>`);
  if (s.basis) meta.push(`<span class="meta-item">basis: ${esc(s.basis)}</span>`);
  if (s.submitterAssist) meta.push('<span class="meta-item">submitter-assist</span>');

  return `<article class="card" style="--tier-hue:${hue}">
  <div class="identity">
    <span class="rank">#${esc(s.rawOrderIndex)}</span>
    <span class="title">${esc(s.title)}</span>
    <span class="artist">${esc(s.artist)}</span>
  </div>
  <div class="body">
    <div class="card-head">${scores.join('')}</div>
    ${flags.length ? `<div class="flags">${flags.join('')}</div>` : ''}
    ${s.userComment ? `<p class="comment"><span class="label">your comment</span> ${esc(s.userComment)}</p>` : '<p class="comment muted"><span class="label">your comment</span> (none)</p>'}
    ${themeChips ? `<div class="themes">${themeChips}</div>` : ''}
    ${s.rationale ? `<p class="rationale"><span class="label">fit</span> ${esc(s.rationale)}</p>` : ''}
    ${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}
  </div>
</article>`;
}

function renderCandidates(model, order) {
  const heading =
    order === 'raw' ? 'Songs (raw order)' : order === 'score' ? 'Songs (by score)' : 'Songs (by votes)';
  const cards = sortSongs(model.songs, order).map(renderCard).join('\n');
  return `<section class="candidates">
  <h2>${heading}</h2>
  ${cards}
</section>`;
}

function renderTradeoffs(model) {
  const tradeoffs = Array.isArray(model.tradeoffs) ? model.tradeoffs : [];
  const combine = model.combine;
  if (!tradeoffs.length && !(combine && (combine.note || (combine.options || []).length))) return '';

  const items = tradeoffs
    .map((t) => {
      const opts = (t.options || []).map((o) => `<li>${esc(o.label ?? o)}</li>`).join('');
      return `<li class="tradeoff"><span class="q">${esc(t.question)}</span>${opts ? `<ul>${opts}</ul>` : ''}</li>`;
    })
    .join('\n');

  let combineBlock = '';
  if (combine && (combine.note || (combine.options || []).length)) {
    const opts = (combine.options || []).map((o) => `<li>${esc(o)}</li>`).join('');
    combineBlock = `<li class="tradeoff"><span class="q">${esc(combine.note || 'How to combine')}</span>${opts ? `<ul>${opts}</ul>` : ''}</li>`;
  }

  return `<section class="tradeoffs">
  <h2>Needs your call</h2>
  <ul>
${items}${combineBlock ? `\n${combineBlock}` : ''}
  </ul>
</section>`;
}

function renderList(title, songs, label) {
  if (!songs.length) return '';
  const lis = songs
    .map(
      (s) =>
        `<li>${esc(s.title)} <span class="muted">— ${esc(s.artist)}</span>${
          label === 'review' && s.reviewReason ? ` <span class="muted">— ${esc(s.reviewReason)}</span>` : ''
        }${s.userComment ? ` <span class="muted">("${esc(s.userComment)}")</span>` : ''}</li>`
    )
    .join('\n');
  return `<section class="list">
  <h2>${esc(title)}</h2>
  <ul>
${lis}
  </ul>
</section>`;
}

function renderTransfer(model) {
  const songs = model.songs.slice().sort((a, b) => (a.rawOrderIndex ?? 0) - (b.rawOrderIndex ?? 0));
  const up = songs.reduce((a, s) => a + (s.finalVotes || 0), 0);
  const down = songs.reduce((a, s) => a + (s.finalDownvotes || 0), 0);
  const hasDown = down > 0 || model.budget.downvotesEnabled;
  const rows = songs
    .map((s) => {
      const u = s.finalVotes || 0;
      const d = s.finalDownvotes || 0;
      const cls = u || d ? ' class="has-votes"' : '';
      return `<tr${cls}>
      <td class="num">${esc(s.rawOrderIndex)}</td>
      <td>${esc(s.title)}</td>
      <td class="muted">${esc(s.artist)}</td>
      <td class="num votes">${u || ''}</td>${hasDown ? `<td class="num votes down">${d || ''}</td>` : ''}
    </tr>`;
    })
    .join('\n');
  return `<section class="transfer">
  <h2>Vote transfer (raw order)</h2>
  <p class="muted">Songs in submission order with the draft votes — for entering back into the app.</p>
  <table>
    <thead><tr><th class="num">#</th><th>Title</th><th>Artist</th><th class="num">▲</th>${hasDown ? '<th class="num">▼</th>' : ''}</tr></thead>
    <tbody>
${rows}
    </tbody>
    <tfoot><tr><td></td><td></td><td class="num">Total</td><td class="num">${up}</td>${hasDown ? `<td class="num">${down}</td>` : ''}</tr></tfoot>
  </table>
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
h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
h2 { font-size: 1.05rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 2rem 0 .75rem; }
.muted { color: var(--muted); }

.facts { display: flex; flex-wrap: wrap; gap: .4rem; margin: .25rem 0 .5rem; }
.fact { font-size: .82rem; color: var(--muted); padding: .15rem .55rem; border: 1px solid var(--line); border-radius: 999px; }
.fact b { color: var(--fg); font-variant-numeric: tabular-nums; }
.fact.warn { color: hsl(35 85% 38%); border-color: hsl(40 90% 50% / .4); }
@media (prefers-color-scheme: dark) { .fact.warn { color: hsl(42 90% 70%); } }
.counts { font-size: .85rem; margin: .25rem 0 0; }

.chips { display: flex; flex-wrap: wrap; gap: .35rem; }
.chip {
  --chip-hue: 220;
  display: inline-block; padding: .1rem .5rem; border-radius: 999px; font-size: .8rem;
  background: hsl(var(--chip-hue) 60% 50% / .14); color: hsl(var(--chip-hue) 55% 38%);
  border: 1px solid hsl(var(--chip-hue) 60% 50% / .25);
}
@media (prefers-color-scheme: dark) { .chip { color: hsl(var(--chip-hue) 70% 72%); } }

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
.score {
  font-weight: 700; font-variant-numeric: tabular-nums; font-size: .8rem;
  padding: .1rem .45rem; border-radius: 6px; border: 1px solid var(--line); color: var(--muted);
}
.score .mods { color: var(--fg); font-weight: 800; margin-left: .15rem; }
.score.your { color: var(--fg); background: hsl(var(--tier-hue) 60% 50% / .06); border-color: var(--line); }
.score.fit { color: var(--muted); }
.score.combined { color: var(--fg); background: hsl(var(--tier-hue) 60% 50% / .14); border-color: hsl(var(--tier-hue) 60% 50% / .3); }
.score.votes { color: var(--muted); }
.score.votes.has-votes { color: #fff; background: hsl(var(--tier-hue) 65% 42%); border-color: hsl(var(--tier-hue) 65% 42%); }
.score.votes.has-down { color: #fff; background: hsl(0 65% 48%); border-color: hsl(0 65% 48%); }
@media (prefers-color-scheme: dark) {
  .score.votes.has-votes { color: #0d0f12; background: hsl(var(--tier-hue) 65% 65%); border-color: hsl(var(--tier-hue) 65% 65%); }
  .score.votes.has-down { color: #0d0f12; background: hsl(0 70% 68%); border-color: hsl(0 70% 68%); }
}
.tier {
  --tier-hue: 220;
  display: inline-block; padding: .1rem .5rem; border-radius: 6px; font-weight: 700; font-size: .78rem;
  text-transform: uppercase; letter-spacing: .03em;
  background: hsl(var(--tier-hue) 60% 50% / .16); color: hsl(var(--tier-hue) 55% 36%);
}
@media (prefers-color-scheme: dark) { .tier { color: hsl(var(--tier-hue) 70% 70%); } }

.themes { display: flex; flex-wrap: wrap; gap: .3rem; margin: .25rem 0 .5rem; }
.comment { margin: .25rem 0 .5rem; }
.comment .label, .rationale .label { text-transform: uppercase; letter-spacing: .04em; font-size: .7rem; font-weight: 700; color: var(--muted); margin-right: .35rem; }
.rationale { margin: .25rem 0 .5rem; }
.flags { display: flex; flex-wrap: wrap; gap: .3rem; margin-bottom: .5rem; }
.flag {
  display: inline-block; padding: .1rem .45rem; border-radius: 6px; font-size: .75rem;
  background: hsl(40 90% 50% / .16); color: hsl(35 85% 35%); border: 1px solid hsl(40 90% 50% / .3);
}
.flag.dq { background: hsl(0 80% 50% / .14); color: hsl(0 70% 42%); border-color: hsl(0 80% 50% / .3); }
@media (prefers-color-scheme: dark) { .flag { color: hsl(42 90% 70%); } .flag.dq { color: hsl(0 80% 72%); } }
.meta { display: flex; flex-wrap: wrap; gap: .75rem; color: var(--muted); font-size: .82rem; }

.tradeoffs .q { font-weight: 600; }
.tradeoffs li.tradeoff { margin: .4rem 0; }
.tradeoffs li.tradeoff ul { margin: .25rem 0 0; }
.list li { margin: .25rem 0; }

table { width: 100%; border-collapse: collapse; font-size: .9rem; }
th, td { text-align: left; padding: .4rem .5rem; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.transfer td.votes { font-weight: 700; }
.transfer tr.has-votes td.votes { color: hsl(145 60% 38%); }
.transfer td.votes.down { color: hsl(0 65% 45%); }
@media (prefers-color-scheme: dark) { .transfer tr.has-votes td.votes { color: hsl(145 60% 62%); } .transfer td.votes.down { color: hsl(0 70% 68%); } }
.transfer tfoot td { font-weight: 700; border-top: 2px solid var(--line); border-bottom: none; }

@media (max-width: 560px) {
  .card { grid-template-columns: 1fr; gap: .5rem; }
  .identity { flex-direction: row; align-items: baseline; flex-wrap: wrap; gap: .4rem; }
}
`;

function renderDocument(model, order) {
  const r = model.round;
  const docTitle = r.prompt || r.title || 'Draft votes';
  const songs = model.songs;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(docTitle)} — draft votes</title>
<style>${STYLE}</style>
</head>
<body>
<main class="wrap">
${renderHead(model)}
${renderCandidates(model, order)}
${renderTradeoffs(model)}
${renderList('Needs my score (blank boxes)', songs.filter((s) => s.needsUserInput))}
${renderList('Needs review', songs.filter((s) => s.needsReview), 'review')}
${renderList('Disqualified (no points)', songs.filter((s) => s.isDisqualified))}
${renderTransfer(model)}
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
    console.error(
      'Usage: node scripts/render-final-html.mjs <analysis.json> [--fit <fit.json>] [--out <path>] [--order votes|score|raw]'
    );
    process.exit(1);
  }
  if (!['votes', 'score', 'raw'].includes(args.order)) {
    console.error(`Invalid --order "${args.order}" (use votes, score, or raw)`);
    process.exit(1);
  }

  let music;
  try {
    music = JSON.parse(await readFile(args.file, 'utf8'));
  } catch (err) {
    console.error(`Could not parse JSON from ${args.file}: ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(music.songs) || !music.songs.length) {
    console.error(`No songs found in ${args.file}. Expected the analysis JSON (buildJsonPayload output).`);
    process.exit(1);
  }

  let fitData = null;
  if (args.fit) {
    try {
      fitData = JSON.parse(await readFile(args.fit, 'utf8'));
    } catch (err) {
      console.error(`Could not parse fit JSON from ${args.fit}: ${err.message}`);
      process.exit(1);
    }
  }

  const model = buildModel(music, fitData);
  const html = renderDocument(model, args.order);

  const outPath =
    args.out || join(dirname(args.file), `${basename(args.file, extname(args.file))}.html`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html, 'utf8');
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
