// Shared scoring, allocation, and reporting core.
//
// Input parsers (HTML, text, …) all emit the same canonical song list and then
// hand it to this module, so scoring stays identical no matter how the round
// was captured. Scoring reads the USER comment only; the submitter quote block
// is preserved for context but never parsed for scoring signals.

// ---------------------------------------------------------------------------
// Small text helpers
// ---------------------------------------------------------------------------

// Collapse whitespace and escape markdown table cells.
export function cell(s, max = 0) {
  let t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (max && t.length > max) t = t.slice(0, max - 1).trimEnd() + '…';
  return t.replace(/\|/g, '\\|');
}

export function formatScore(n) {
  if (n == null) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ---------------------------------------------------------------------------
// Scoring: derive signals from the USER comment only
// ---------------------------------------------------------------------------
export function scoreComment(rawComment, mode) {
  const out = {
    score: null,
    plus: false,
    minus: false,
    uncertain: false,
    playlistAdd: false,
    isDisqualified: false,
    needsUserInput: false,
    needsReview: false,
    reviewReason: '',
  };

  const comment = (rawComment ?? '').trim();

  if (comment === '') {
    out.needsUserInput = true; // empty box = accidental skip, prompt for a score
    return out;
  }

  // First numeric token (optional single decimal) plus any trailing modifiers.
  const m = comment.match(/(\d{1,3})(\.\d)?([+\-?=]*)/);

  if (!m) {
    // No number at all.
    if (/^-+$/.test(comment)) {
      // Bare dash: no real score. Ambiguous on purpose — it can mean a true
      // disqualification, or just "low/unspecified, won't place". Either way it
      // earns no points, so we group it under disqualified.
      out.isDisqualified = true;
    } else if (/\b(invalid|no|nope)\b/i.test(comment)) {
      out.isDisqualified = true; // explicit disqualifying keyword
    } else if (mode === 'objective') {
      out.isDisqualified = true; // words-only -> disqualified in objective rounds
    } else {
      out.needsReview = true; // subjective: words may carry fit meaning, don't auto-decide
      out.reviewReason = 'words-only comment (subjective mode)';
    }
    return out;
  }

  const intPart = m[1];
  const decPart = m[2]; // e.g. ".5"
  const mods = m[3] || '';

  if (decPart) {
    out.score = parseFloat(intPart + decPart); // literal decimal, no scaling
  } else if (intPart.length === 1) {
    out.score = Number(intPart) * 10; // 7 -> 70
  } else if (intPart.length === 2) {
    out.score = Number(intPart); // 73 -> 73
  } else {
    out.score = Number(intPart) / 10; // 755 -> 75.5
  }

  if (mods.includes('+') || mods.includes('=')) out.plus = true; // '=' is a typo for '+'
  if (mods.includes('-')) out.minus = true;
  if (mods.includes('?')) out.uncertain = true;

  // Playlist add: a standalone "play"/"playlist" keyword alongside a score.
  if (/\bplay(list)?\b/i.test(comment)) out.playlistAdd = true;

  return out;
}

// Tiebreak rank: playlistAdd >= '+' > plain > '-'. Higher wins.
export function tiebreakRank(s) {
  if (s.playlistAdd) return 3;
  if (s.plus) return 2;
  if (s.minus) return 0;
  return 1;
}

// ---------------------------------------------------------------------------
// Allocation: relative to THIS round's distribution; no fixed cutoffs.
// ---------------------------------------------------------------------------
export function allocate(songs, budget, cap) {
  for (const s of songs) s.finalVotes = 0;

  const cands = songs.filter(
    (s) => s.score != null && !s.isDisqualified && !s.needsUserInput
  );
  if (!cands.length || budget <= 0) return cands;

  const lo = Math.min(...cands.map((c) => c.score));
  let weights = cands.map((c) => c.score - lo);
  let total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    // every score identical -> equal weighting
    weights = cands.map(() => 1);
    total = cands.length;
  }

  cands.forEach((c, i) => {
    c._exact = (weights[i] / total) * budget;
    c.finalVotes = Math.min(Math.floor(c._exact), cap);
  });

  let remaining = budget - cands.reduce((a, c) => a + c.finalVotes, 0);

  // Hand out the remaining points to whoever is most "owed" relative to their
  // exact share, breaking ties by score then modifier rank.
  while (remaining > 0) {
    const eligible = cands.filter((c) => c.finalVotes < cap);
    if (!eligible.length) break;
    eligible.sort(
      (a, b) =>
        b._exact - b.finalVotes - (a._exact - a.finalVotes) ||
        b.score - a.score ||
        tiebreakRank(b) - tiebreakRank(a)
    );
    eligible[0].finalVotes++;
    remaining--;
  }

  // Flag uncertain songs that sit at a point boundary (a near-equal neighbour
  // ended up with a different number of votes) for user review.
  for (const c of cands) {
    if (!c.uncertain || c.needsReview) continue;
    const atBoundary = cands.some(
      (d) =>
        d !== c &&
        Math.abs(d.score - c.score) <= 0.5 &&
        d.finalVotes !== c.finalVotes
    );
    if (atBoundary) {
      c.needsReview = true;
      c.reviewReason = 'uncertain (?) near a point boundary';
    }
  }

  return cands;
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------
export function flagsOf(s) {
  const f = [];
  if (s.plus) f.push('+');
  if (s.minus) f.push('-');
  if (s.uncertain) f.push('?');
  if (s.playlistAdd) f.push('play');
  if (s.needsReview) f.push('review');
  return f.join(' ');
}

export function rankedSort(a, b) {
  return (
    b.score - a.score ||
    tiebreakRank(b) - tiebreakRank(a) ||
    a.title.localeCompare(b.title)
  );
}

export function buildMarkdown({ round, budget, songs, totalSongs, ownSkipped, mode }) {
  const scored = songs.filter((s) => s.score != null).sort(rankedSort);
  const disqualified = songs.filter((s) => s.isDisqualified);
  const needsInput = songs.filter((s) => s.needsUserInput);
  const needsReview = songs.filter((s) => s.needsReview);
  const allocated = songs.reduce((a, s) => a + (s.finalVotes || 0), 0);

  const L = [];
  L.push(`# ${round.prompt || round.title || 'Round'} — draft votes`);
  L.push('');
  L.push(`- League: ${round.league ?? 'n/a'}`);
  L.push(`- Mode: \`${mode}\``);
  L.push(
    `- Budget: ${budget.upvoteBankSize ?? '?'} upvotes, max ${
      budget.maxUpvotesPerSong ?? '?'
    } per song` +
      (budget.downvotesEnabled
        ? `, downvotes ON (${budget.downvoteBankSize})`
        : ', downvotes off')
  );
  L.push(
    `- Allocated: **${allocated} / ${budget.upvoteBankSize ?? '?'}**` +
      (allocated !== budget.upvoteBankSize
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
      )} | ${s.finalVotes} | ${cell(flagsOf(s))} | ${cell(s.userComment, 160)} |`
    );
  });
  L.push('');

  // Slim raw-order table
  L.push('## Raw order (for entering votes)');
  L.push('');
  L.push('| Order | Title | Votes | My score |');
  L.push('|---|---|---|---|');
  for (const s of songs) {
    let raw;
    if (s.score != null) raw = formatScore(s.score) + (flagsOf(s) ? ' ' + flagsOf(s) : '');
    else if (s.needsUserInput) raw = '(needs score)';
    else if (s.isDisqualified) raw = '(disqualified)';
    else if (s.needsReview) raw = '(review)';
    else raw = '';
    L.push(`| ${s.rawOrderIndex} | ${cell(s.title)} | ${s.finalVotes} | ${cell(raw)} |`);
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

  L.push('---');
  L.push('Draft allocation — rebalance as needed. Tiers are relative to this round only.');
  L.push('');
  return L.join('\n');
}

export function buildJsonPayload({ round, budget, songs, totalSongs, ownSkipped, mode }) {
  return {
    round,
    mode,
    budget,
    totals: {
      totalSongs,
      ownSkipped,
      allocated: songs.reduce((a, s) => a + (s.finalVotes || 0), 0),
    },
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
      reviewReason: s.reviewReason,
      finalVotes: s.finalVotes,
    })),
  };
}
