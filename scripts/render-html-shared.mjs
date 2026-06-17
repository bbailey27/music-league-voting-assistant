// Shared HTML rendering helpers and stylesheet fragments for fit/final reports.

import { formatScore } from './score-core.mjs';

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Stable, theme-neutral accent per fit tier (dark/light friendly hues). Songs
// with no fit signal fall back to a neutral hue.
export const TIER_HUE = {
  excellent: 145,
  strong: 200,
  solid: 260,
  moderate: 35,
  weak: 15,
  nope: 0,
};
export const NEUTRAL_HUE = 220;

export function tierHue(tier) {
  return TIER_HUE[String(tier || '').toLowerCase()] ?? NEUTRAL_HUE;
}

export function chip(text, hue) {
  const style = hue == null ? '' : ` style="--chip-hue:${hue}"`;
  return `<span class="chip"${style}>${esc(text)}</span>`;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

// A distribution tradeoff (`tier-structure` upvotes A/B/C, or `down-structure`
// downvote shapes) rendered as a single song×option comparison table in
// combined/rank order — for judging which songs each option rewards — plus a legend
// naming each option's shape and its selector (`--option` / `--down-shape`).
// Downvote magnitudes always display as negative. The raw submission-order ballot
// is NOT duplicated per option here; it lives once, combined across up + down, in
// the Vote transfer section. Falls back gracefully when `perSong` is absent.
function tierStructureTableHtml(t, ownSongs = [], chosenIndex = null) {
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
  const optHead = opts.map((o, i) => `<th class="num ${optClass(i)}">${OPTION_LETTERS[i]}</th>`).join('');
  const totalsRow = (extraLead = 0) => {
    const cells = opts
      .map((o, i) => `<td class="num ${optClass(i)}">${fmtVote(o.perSong.reduce((a, s) => a + (s.votes || 0), 0))}</td>`)
      .join('');
    return `<tr>${'<td></td>'.repeat(extraLead)}<td>Total</td>${cells}</tr>`;
  };

  // Combined/rank order. (The raw-submission-order ballot lives once in the Vote
  // transfer section, combined across up + down — not duplicated per option here.)
  const combinedBody = opts[0].perSong
    .map((r, ri) => {
      const cells = opts
        .map((o, i) => {
          const v = o.perSong[ri]?.votes ?? 0;
          return `<td class="num ${optClass(i)}${v > 0 ? ' on' : ''}">${fmtVote(v)}</td>`;
        })
        .join('');
      return `<tr><td class="num muted">${esc(r.rawOrderIndex)}</td><td>${esc(r.title)}</td><td class="num">${formatScore(r.score ?? r.rank)}</td>${cells}</tr>`;
    })
    .join('\n');

  const legend = opts
    .map((o, i) => {
      const tag = chosenIndex == null && i === 0 ? ' <span class="muted">(default)</span>' : '';
      const pick = i === chosenIndex ? ' <span class="muted">(your pick)</span>' : '';
      const desc = down
        ? `<code>${esc(o.shape)}</code>, <code>--down-shape ${esc(o.downShape)}</code>`
        : `${o.tierCount} tier${o.tierCount === 1 ? '' : 's'}, <code>${esc(o.shape)}</code>, <code>--option ${OPTION_LETTERS[i]}</code>`;
      return `<li><b>${OPTION_LETTERS[i]}</b>${tag}${pick} — ${desc}</li>`;
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

// Render a recorded pick: the chosen distribution as a focused combined+raw table
// (incl. the owner's own song), the reason + any manual tweaks, and a collapsed
// "options considered" comparison (all options, chosen column highlighted) so the
// alternatives stay visible and auditable after the pick.
export function pickHtml(pick, ownSongs = []) {
  if (!pick || !Array.isArray(pick.options) || !pick.options.length) return '';
  const ci = pick.chosenIndex ?? pick.options.findIndex((o) => o.isChosen);
  const chosen = pick.options[ci];
  if (!chosen) return '';

  const combinedRows = chosen.perSong
    .map(
      (s) =>
        `<tr${s.votes > 0 ? ' class="has-votes"' : ''}><td class="num muted">${esc(s.rawOrderIndex)}</td><td>${esc(
          s.title
        )}</td><td class="num">${formatScore(s.score)}</td><td class="num votes${s.votes > 0 ? ' on' : ''}">${formatScore(
          s.votes
        )}</td></tr>`
    )
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
  ${tierStructureTableHtml({ kind: 'tier-structure', question: '', options: pick.options }, ownSongs, ci)}
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
export function tradeoffsHtml(tradeoffs, ownSongs = []) {
  const list = Array.isArray(tradeoffs) ? tradeoffs : [];
  if (!list.length) return '';
  const blocks = list
    .map((t) => {
      if (t.kind === 'tier-structure' || t.kind === 'down-structure')
        return tierStructureTableHtml(t, ownSongs);
      const opts = (t.options || []).map((o) => `<li>${esc(o.label ?? o)}</li>`).join('');
      return `<div class="tradeoff"><p class="q">${esc(t.question)}</p>${opts ? `<ul>${opts}</ul>` : ''}</div>`;
    })
    .join('\n');
  return `<section class="tradeoffs">
  <h2>Needs your call</h2>
${blocks}
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

.transfer td.votes { font-weight: 700; }
.transfer tr.has-votes td.votes { color: hsl(145 60% 38%); }
.transfer td.votes.down { color: hsl(0 65% 45%); }
@media (prefers-color-scheme: dark) {
  .transfer tr.has-votes td.votes { color: hsl(145 60% 62%); }
  .transfer td.votes.down { color: hsl(0 70% 68%); }
}
.transfer tfoot td { font-weight: 700; border-top: 2px solid var(--line); border-bottom: none; }

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
.transfer tr.own td { color: var(--muted); font-style: italic; }

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
.score.votes.has-votes { color: #fff; background: hsl(var(--tier-hue) 65% 42%); border-color: hsl(var(--tier-hue) 65% 42%); }
.score.votes.has-down { color: #fff; background: hsl(0 65% 48%); border-color: hsl(0 65% 48%); }
@media (prefers-color-scheme: dark) {
  .score.votes.has-votes { color: #0d0f12; background: hsl(var(--tier-hue) 65% 65%); border-color: hsl(var(--tier-hue) 65% 65%); }
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
.card-head .score.combined { color: var(--fg); background: hsl(var(--tier-hue) 60% 50% / .14); border-color: hsl(var(--tier-hue) 60% 50% / .3); }
.card-head .score.votes { color: var(--muted); }
.card-head .score.votes.has-votes { color: #fff; background: hsl(var(--tier-hue) 65% 42%); border-color: hsl(var(--tier-hue) 65% 42%); }
@media (prefers-color-scheme: dark) { .card-head .score.votes.has-votes { color: #0d0f12; background: hsl(var(--tier-hue) 65% 65%); border-color: hsl(var(--tier-hue) 65% 65%); } }
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
