// Report rendering and fit-research orchestration.

import { cell, formatScore } from './format.mjs';
import { tiebreakRank } from './comment.mjs';
import { DEFAULT_COMBINED_WEIGHTS } from './fit-signal.mjs';
import { mergeFit, normTitle } from './merge.mjs';
import { allocate, enrichProfileWithBudget } from './allocate.mjs';

export function buildPickRecord({
  options,
  chosenIndex,
  songs,
  reason = null,
  downOverrides = null,
  pickedAt = new Date().toISOString(),
}) {
  const letter = (i) => String.fromCharCode(65 + i);
  const chosen = options[chosenIndex];
  if (!chosen) return null;
  const finalByIdx = new Map(songs.map((s) => [s.rawOrderIndex, s.finalVotes ?? 0]));
  const tweaks = [];
  for (const ps of chosen.perSong) {
    const fin = finalByIdx.get(ps.rawOrderIndex) ?? 0;
    if (fin !== ps.votes) {
      tweaks.push({ rawOrderIndex: ps.rawOrderIndex, title: ps.title, from: ps.votes, to: fin });
    }
  }
  // Downvote pins are deliberate manual deviations on the down axis; log them too
  // (as signed magnitudes) so the training data captures the full ballot.
  const downTweaks = [];
  if (downOverrides) {
    const titleByIdx = new Map(songs.map((s) => [s.rawOrderIndex, s.title]));
    const downByIdx = new Map(songs.map((s) => [s.rawOrderIndex, s.finalDownvotes ?? 0]));
    for (const [k, v] of Object.entries(downOverrides)) {
      if (!(v > 0)) continue;
      const i = Number(k);
      downTweaks.push({ rawOrderIndex: i, title: titleByIdx.get(i) ?? null, to: -(downByIdx.get(i) || v) });
    }
  }
  return {
    chosen: letter(chosenIndex),
    chosenIndex,
    tierCount: chosen.tierCount,
    shape: chosen.shape,
    reason: reason || null,
    pickedAt,
    tweaks,
    ...(downTweaks.length ? { downTweaks } : {}),
    options: options.map((o, i) => ({
      letter: letter(i),
      tierCount: o.tierCount,
      bucketCount: o.bucketCount,
      shape: o.shape,
      isChosen: i === chosenIndex,
      perSong: (o.perSong || []).map((s) => ({
        rawOrderIndex: s.rawOrderIndex,
        title: s.title,
        score: s.score ?? s.rank ?? null,
        votes: s.votes,
      })),
    })),
  };
}
// Full merge + allocate pass for the fit-research flow: join fit into the
// parsed round, run the profile allocator, and write the results back into the
// fit JSON (draftVotes/musicScore/combinedScore) so render-fit-html shows the
// vote-transfer table. Returns { fitData, songs, tradeoffs }.
export function mergeFitJson(parsed, fitData, profile = {}) {
  const weights = profile.weights || DEFAULT_COMBINED_WEIGHTS;
  const rankBy = profile.rankBy || 'combined';
  mergeFit(parsed.songs, fitData.songs || [], { weights, gate: profile.gate });

  const { tradeoffs } = allocate(
    parsed.songs,
    parsed.budget?.upvoteBankSize ?? 0,
    parsed.budget?.maxUpvotesPerSong ?? Infinity,
    enrichProfileWithBudget({ ...profile, rankBy, weights }, parsed.budget)
  );

  const byIndex = new Map(parsed.songs.map((s) => [s.rawOrderIndex, s]));
  const byTitle = new Map(parsed.songs.map((s) => [normTitle(s.title), s]));
  for (const f of fitData.songs || []) {
    const s = byIndex.get(f.rawOrderIndex) ?? byTitle.get(normTitle(f.title));
    if (!s) continue;
    f.musicScore = s.score ?? null;
    if (s.userComment && f.musicComment == null) f.musicComment = s.userComment;
    f.combinedScore = s.combinedScore ?? null;
    // Normalized per-axis values (display scale) so the report can show why a song
    // landed where it did: combined = w.fit·fitNorm + w.music·musicNorm.
    f.fitNorm = s.fitNorm ?? null;
    f.musicNorm = s.musicNorm ?? null;
    f.musicLift = s.musicLift ?? null;
    f.draftVotes = s.finalVotes ?? 0;
    f.draftDownvotes = s.finalDownvotes ?? 0;
  }
  fitData.combineWeights = weights;
  // Persist the allocator's "needs your call" tradeoffs onto the merged JSON so the
  // scores.html deliverable can render the distribution options as a comparison
  // table (the fit-only source file stays untouched).
  fitData.tradeoffs = tradeoffs;
  // Carry the owner's own (unvotable) submissions so the raw-order ballot can show
  // every submission slot — a hidden gap risks a misaligned ballot in the app.
  fitData.ownSongs = (parsed.ownSongs || []).map((s) => ({
    rawOrderIndex: s.rawOrderIndex,
    title: s.title,
    artist: s.artist,
    isOwn: true,
  }));
  return { fitData, songs: parsed.songs, tradeoffs };
}
export function flagsOf(s) {
  const f = [];
  if (s.plus) f.push('+');
  if (s.minus) f.push('-');
  if (s.uncertain) f.push('?');
  if (s.playlistAdd) f.push('play');
  if (s.needsReview) f.push('review');
  return f.join(' ');
}

// Upvotes and downvotes are disjoint; downvotes render with a leading minus.
export function formatVoteAllocation(s) {
  const up = s.finalVotes || 0;
  const down = s.finalDownvotes || 0;
  if (up && down) return `${up}/-${down} ⚠`;
  if (down) return `-${down}`;
  return String(up);
}

export function rankedSort(a, b) {
  return (
    b.score - a.score ||
    tiebreakRank(b) - tiebreakRank(a) ||
    a.title.localeCompare(b.title)
  );
}

// Emit a markdown table with cells padded to even column widths so the raw
// source is skimmable. `aligns` is 'right' | 'left' per column.
function renderTable(L, headers, aligns, rows, indent = '') {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length))
  );
  const cell = (s, i) => {
    const v = String(s ?? '');
    return aligns[i] === 'right' ? v.padStart(widths[i]) : v.padEnd(widths[i]);
  };
  const sep = widths.map((w, i) =>
    aligns[i] === 'right' ? `${'-'.repeat(w - 1)}:` : `:${'-'.repeat(w - 1)}`
  );
  L.push(`${indent}| ${headers.map(cell).join(' | ')} |`);
  L.push(`${indent}| ${sep.join(' | ')} |`);
  for (const r of rows) L.push(`${indent}| ${r.map(cell).join(' | ')} |`);
}

// Render a tier-structure tradeoff as ONE side-by-side comparison table: songs
// (in combined/rank order) are rows, options are columns (A = default), and each
// cell is the votes that option gives the song. This reads as a direct
// "what changes between options" diff instead of three separate per-option blocks.
const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
function renderTierStructure(L, t) {
  const opts = (t.options || []).filter((o) => Array.isArray(o.perSong) && o.perSong.length);
  if (!opts.length) {
    for (const o of t.options || []) L.push(`  - ${o.label ?? o}`);
    L.push('');
    return;
  }
  const rows0 = opts[0].perSong; // index-aligned across every option
  const trunc = (s) => (String(s).length > 30 ? `${String(s).slice(0, 29)}…` : String(s));
  const headers = ['#', 'Song', 'Score', ...opts.map((_, i) => OPTION_LETTERS[i])];
  const aligns = ['right', 'left', 'right', ...opts.map(() => 'right')];
  const rows = rows0.map((r, ri) => [
    String(r.rawOrderIndex),
    trunc(r.title),
    formatScore(r.score ?? r.rank),
    ...opts.map((o) => String(o.perSong[ri]?.votes ?? 0)),
  ]);
  rows.push([
    '',
    'Total',
    '',
    ...opts.map((o) => String(o.perSong.reduce((a, s) => a + (s.votes || 0), 0))),
  ]);
  L.push('');
  renderTable(L, headers, aligns, rows, '  ');
  L.push('');
  opts.forEach((o, i) => {
    L.push(
      `  - **${OPTION_LETTERS[i]}**${i === 0 ? ' (default)' : ''} — ${o.tierCount} tier${
        o.tierCount === 1 ? '' : 's'
      }, \`${o.shape ?? `bucket-count ${o.bucketCount}`}\`, \`--option ${OPTION_LETTERS[i]}\``
    );
  });
  L.push('');
}

export function renderPickMarkdown(L, pick) {
  const opts = (pick?.options || []).filter((o) => Array.isArray(o.perSong) && o.perSong.length);
  if (!opts.length) return;
  L.push('## Your pick');
  L.push('');
  L.push(
    `- **Option ${pick.chosen}** — ${pick.tierCount} tier${pick.tierCount === 1 ? '' : 's'}, \`${pick.shape}\`${
      pick.reason ? ` — ${cell(pick.reason)}` : ''
    }`
  );
  if (pick.tweaks?.length) {
    L.push(`- Manual tweaks: ${pick.tweaks.length}`);
  }
  L.push('');
  L.push('## Options considered');
  L.push('');
  const trunc = (s) => (String(s).length > 30 ? `${String(s).slice(0, 29)}…` : String(s));
  const headers = ['#', 'Song', 'Score', ...opts.map((o) => o.letter)];
  const aligns = ['right', 'left', 'right', ...opts.map(() => 'right')];
  const rows0 = opts[0].perSong;
  const rows = rows0.map((r, ri) => [
    String(r.rawOrderIndex),
    trunc(r.title),
    formatScore(r.score ?? r.rank),
    ...opts.map((o) => String(o.perSong[ri]?.votes ?? 0)),
  ]);
  rows.push([
    '',
    'Total',
    '',
    ...opts.map((o) => String(o.perSong.reduce((a, s) => a + (s.votes || 0), 0))),
  ]);
  renderTable(L, headers, aligns, rows, '  ');
  L.push('');
  opts.forEach((o) => {
    const tag = o.isChosen ? ' **(chosen)**' : '';
    L.push(`  - **${o.letter}**${tag} — ${o.tierCount} tier${o.tierCount === 1 ? '' : 's'}, \`${o.shape}\``);
  });
  L.push('');
}

export function buildMarkdown({ round, budget, songs, totalSongs, ownSkipped, mode, tradeoffs, ownSongs = [], pick = null }) {
  const scored = songs.filter((s) => s.score != null).sort(rankedSort);
  const disqualified = songs.filter((s) => s.isDisqualified);
  const needsInput = songs.filter((s) => s.needsUserInput);
  const needsReview = songs.filter((s) => s.needsReview);
  const allocated = songs.reduce((a, s) => a + (s.finalVotes || 0), 0);
  const downAllocated = songs.reduce((a, s) => a + (s.finalDownvotes || 0), 0);

  const L = [];
  L.push(`# ${round.prompt || round.title || 'Round'} — draft votes`);
  L.push('');
  if (round.description) {
    L.push('## Round description');
    L.push('');
    L.push(round.description);
    L.push('');
  }
  L.push(`- League: ${round.league ?? 'n/a'}`);
  L.push(`- Mode: \`${mode}\``);
  L.push(
    `- Budget: ${budget.upvoteBankSize ?? '?'} upvotes, max ${
      budget.maxUpvotesPerSong ?? '?'
    } per song` +
      (budget.downvotesEnabled
        ? `, downvotes ON (${budget.downvoteBankSize}, max ${budget.maxDownvotesPerSong ?? '?'} per song)`
        : ', downvotes off')
  );
  L.push(
    `- Allocated: **${allocated} / ${budget.upvoteBankSize ?? '?'}** up` +
      (budget.downvotesEnabled
        ? `, **${downAllocated} / ${budget.downvoteBankSize ?? '?'}** down`
        : '') +
      (allocated !== budget.upvoteBankSize ||
      (budget.downvotesEnabled && downAllocated !== budget.downvoteBankSize)
        ? ' ⚠️ (does not match budget — rebalance)'
        : '')
  );
  L.push(
    `- Songs: ${totalSongs} total, ${ownSkipped} own (skipped), ${scored.length} scored, ${disqualified.length} disqualified, ${needsInput.length} need a score, ${needsReview.length} need review`
  );
  L.push('');

  // Ranked table
  L.push('## Ranked (by score)');
  L.push('');
  L.push('| # | Title | Artist | Score | Votes | Flags | Comment |');
  L.push('|---|---|---|---|---|---|---|');
  scored.forEach((s, i) => {
    L.push(
      `| ${i + 1} | ${cell(s.title)} | ${cell(s.artist)} | ${formatScore(
        s.score
      )} | ${formatVoteAllocation(s)} | ${cell(flagsOf(s))} | ${cell(s.userComment, 160)} |`
    );
  });
  L.push('');

  // Slim raw-order table
  L.push('## Raw order (for entering votes)');
  L.push('');
  L.push('| Order | Title | Votes | My score |');
  L.push('|---|---|---|---|');
  // Interleave the user's own (unscored) submission so every raw index is present —
  // the user enters votes by position, so a hidden gap risks a misaligned ballot.
  const rawOrderRows = [...songs, ...ownSongs].sort((a, b) => a.rawOrderIndex - b.rawOrderIndex);
  for (const s of rawOrderRows) {
    if (s.isOwn) {
      L.push(`| ${s.rawOrderIndex} | ${cell(s.title)} | — | (your song — not scored) |`);
      continue;
    }
    let raw;
    if (s.score != null) raw = formatScore(s.score) + (flagsOf(s) ? ' ' + flagsOf(s) : '');
    else if (s.needsUserInput) raw = '(needs score)';
    else if (s.isDisqualified) raw = '(disqualified)';
    else if (s.needsReview) raw = '(review)';
    else raw = '';
    L.push(`| ${s.rawOrderIndex} | ${cell(s.title)} | ${formatVoteAllocation(s)} | ${cell(raw)} |`);
  }
  L.push('');

  // Flag lists
  if (needsInput.length) {
    L.push('## Needs my score (blank boxes)');
    L.push('');
    for (const s of needsInput) L.push(`- ${cell(s.title)} — ${cell(s.artist)}`);
    L.push('');
  }
  if (disqualified.length) {
    L.push('## Disqualified (no points — true DQ or unscored low)');
    L.push('');
    for (const s of disqualified)
      L.push(`- ${cell(s.title)} — ${cell(s.artist)}${s.userComment ? ` ("${cell(s.userComment, 80)}")` : ''}`);
    L.push('');
  }
  if (needsReview.length) {
    L.push('## Needs review');
    L.push('');
    for (const s of needsReview)
      L.push(`- ${cell(s.title)} — ${cell(s.artist)} — ${cell(s.reviewReason)}${s.userComment ? ` ("${cell(s.userComment, 80)}")` : ''}`);
    L.push('');
  }

  if (Array.isArray(tradeoffs) && tradeoffs.length && !pick) {
    L.push('## Needs your call (tradeoffs)');
    L.push('');
    for (const t of tradeoffs) {
      L.push(`- ${cell(t.question)}`);
      if (t.kind === 'tier-structure') renderTierStructure(L, t);
      else for (const o of t.options || []) L.push(`  - ${cell(o.label)}`);
    }
    L.push('');
  }

  if (pick) renderPickMarkdown(L, pick);

  L.push('---');
  L.push('Draft allocation — rebalance as needed. Tiers are relative to this round only.');
  L.push('');
  return L.join('\n');
}

export function buildJsonPayload({ round, budget, songs, totalSongs, ownSkipped, mode, tradeoffs, ownSongs = [], pick = null, profile = null }) {
  return {
    round,
    mode,
    budget,
    ...(profile ? { profile } : {}),
    ...(pick ? { pick } : {}),
    totals: {
      totalSongs,
      ownSkipped,
      allocated: songs.reduce((a, s) => a + (s.finalVotes || 0), 0),
      downAllocated: songs.reduce((a, s) => a + (s.finalDownvotes || 0), 0),
    },
    ownSongs: ownSongs.map((s) => ({
      rawOrderIndex: s.rawOrderIndex,
      title: s.title,
      artist: s.artist,
      isOwn: true,
    })),
    tradeoffs: Array.isArray(tradeoffs) ? tradeoffs : [],
    songs: songs.map((s) => ({
      rawOrderIndex: s.rawOrderIndex,
      title: s.title,
      artist: s.artist,
      album: s.album,
      userAllocatedVotes: s.userAllocatedVotes,
      userComment: s.userComment,
      submitterComment: s.submitterComment,
      spotifyUri: s.spotifyUri,
      score: s.score,
      plus: s.plus,
      minus: s.minus,
      uncertain: s.uncertain,
      playlistAdd: s.playlistAdd,
      isDisqualified: s.isDisqualified,
      needsUserInput: s.needsUserInput,
      needsReview: s.needsReview,
      needsResearch: s.needsResearch ?? false,
      reviewReason: s.reviewReason,
      finalVotes: s.finalVotes,
      finalDownvotes: s.finalDownvotes ?? 0,
    })),
  };
}
