#!/usr/bin/env node
// Render the FINAL draft-vote output (the analysis/<roundname>/music.md equivalent) as a
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
//   --fit <fit.json> optional LLM fit sidecar (analysis/<roundname>/fit.json). When
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
  flagsOf,
  formatVoteAllocation,
} from './score-core.mjs';
import { parseDownShape } from './parse-round.mjs';
import { matchFlag, takePositional } from './cli-args.mjs';
import { esc, tierHue, chip, tradeoffsHtml, pickHtml, comboBallotHtml, NEUTRAL_HUE, RENDER_FINAL_STYLE } from './render-html-shared.mjs';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { file: null, fit: null, out: null, order: 'votes', downShape: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    let next = matchFlag(argv, i, 'fit', (v) => {
      args.fit = v;
    });
    if (next != null) {
      i = next;
      continue;
    }
    next = matchFlag(argv, i, 'down-shape', (v) => {
      args.downShape = v;
    });
    if (next != null) {
      i = next;
      continue;
    }
    next = matchFlag(argv, i, 'out', (v) => {
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
// Helpers
// ---------------------------------------------------------------------------
// The user's modifier badges, in the order they read in a comment.
function modifierText(s) {
  return flagsOf(s)
    .split(/\s+/)
    .filter((f) => f && f !== 'review')
    .map((f) => (f === '-' ? '−' : f))
    .join(' ');
}

// Upvotes and downvotes are disjoint; render the side that has votes.
function voteBadge(s) {
  const up = s.finalVotes || 0;
  const down = s.finalDownvotes || 0;
  if (formatVoteAllocation(s).includes('⚠'))
    return `<span class="score votes has-votes" title="draft votes">${up} ▲ / -${down} ▼ ⚠</span>`;
  if (down) return `<span class="score votes has-down" title="draft downvotes">-${down} ▼</span>`;
  return `<span class="score votes${up > 0 ? ' has-votes' : ''}" title="draft upvotes">${up} ▲</span>`;
}

// ---------------------------------------------------------------------------
// Build the model: music JSON is authoritative; the fit sidecar (when present)
// is merged deterministically so votes/combined/tradeoffs stay consistent.
// ---------------------------------------------------------------------------
function buildModel(music, fitData, downShape = null) {
  const mode = music.mode || 'objective';
  // Rehydrate each song's scoring signals from its comment so a manual fit
  // token (e.g. "8 fit") keeps precedence over the LLM during the merge — this
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
    const result = mergeFitJson(parsed, fitData, { rankBy: 'combined', weights, downShape });
    tradeoffs = result.tradeoffs || [];
    combine = fitData.combine || null;
    combineWeights = fitData.combineWeights || null;
    // mergeFit only fills fit-silent songs; backfill a tier word for display
    // when a numeric fit landed without one.
    for (const s of songs) {
      if (s.fitScore != null && !s.fitTier) s.fitTier = fitTierForScore(s.fitScore);
    }
  }

  return {
    round: music.round || {},
    mode,
    budget: music.budget || {},
    songs,
    ownSongs: Array.isArray(music.ownSongs) ? music.ownSongs : [],
    tradeoffs,
    pick: (fitData && fitData.pick) || music.pick || null,
    combine,
    combineWeights,
  };
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
  ${r.description ? `<p class="lead">${esc(r.description)}</p>` : ''}
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
  const hasCombine = combine && (combine.note || (combine.options || []).length);
  if (!tradeoffs.length && !hasCombine) return '';

  // Distribution forks render as song×option comparison tables (shared helper);
  // append the qualitative "how to combine" note as a trailing block.
  const main = tradeoffsHtml(tradeoffs);
  let combineBlock = '';
  if (hasCombine) {
    const opts = (combine.options || []).map((o) => `<li>${esc(o)}</li>`).join('');
    combineBlock = `<div class="tradeoff"><p class="q">${esc(combine.note || 'How to combine')}</p>${opts ? `<ul>${opts}</ul>` : ''}</div>`;
  }

  if (main) return `${main}\n${combineBlock}`;
  return `<section class="tradeoffs">
  <h2>Needs your call</h2>
${combineBlock}
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

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------
const STYLE = RENDER_FINAL_STYLE;

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
${pickHtml(model.pick)}
${renderList('Needs my score (blank boxes)', songs.filter((s) => s.needsUserInput))}
${renderList('Needs review', songs.filter((s) => s.needsReview), 'review')}
${renderList('Disqualified (no points)', songs.filter((s) => s.isDisqualified))}
${comboBallotHtml(model.tradeoffs, model.songs, model.ownSongs)}
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

  const model = buildModel(music, fitData, parseDownShape(args.downShape));
  const html = renderDocument(model, args.order);

  const outPath =
    args.out ||
    join(
      dirname(args.file),
      basename(args.file, extname(args.file)) === 'music' ? 'music.html' : 'report.html'
    );
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html, 'utf8');
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
