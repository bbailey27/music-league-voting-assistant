#!/usr/bin/env node
// Deterministic Music League round parser + draft vote allocator (HTML input).
// Usage: node scripts/parse-round.mjs <round.html> [--mode objective|subjective] [--no-json]
//
// Scoring reads the USER comment only (data-comment). The submitter quote block
// is preserved for context but is never parsed for scoring signals.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, join, extname } from 'node:path';
import { parseHTML } from 'linkedom';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { file: null, mode: 'objective', json: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-json') args.json = false;
    else if (a === '--mode') args.mode = argv[++i];
    else if (a.startsWith('--mode=')) args.mode = a.slice('--mode='.length);
    else if (!a.startsWith('--') && !args.file) args.file = a;
  }
  return args;
}

// ---------------------------------------------------------------------------
// Small text helpers
// ---------------------------------------------------------------------------
function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

// Read element text, converting <br> to newlines (for the submitter quote).
function richText(el) {
  if (!el) return '';
  const html = el.innerHTML
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(html).replace(/\u00a0/g, ' ').trim();
}

// Collapse whitespace and escape markdown table cells.
function cell(s, max = 0) {
  let t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (max && t.length > max) t = t.slice(0, max - 1).trimEnd() + '…';
  return t.replace(/\|/g, '\\|');
}

function formatScore(n) {
  if (n == null) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ---------------------------------------------------------------------------
// Scoring: derive signals from the USER comment only
// ---------------------------------------------------------------------------
function scoreComment(rawComment, mode) {
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
function tiebreakRank(s) {
  if (s.playlistAdd) return 3;
  if (s.plus) return 2;
  if (s.minus) return 0;
  return 1;
}

// ---------------------------------------------------------------------------
// Allocation: relative to THIS round's distribution; no fixed cutoffs.
// ---------------------------------------------------------------------------
function allocate(songs, budget, cap) {
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
// Parse the HTML round into structured songs + budget + round metadata
// ---------------------------------------------------------------------------
function parseRound(html, mode) {
  const { document } = parseHTML(html);

  // Budget config lives in the root Alpine x-data string.
  const budget = {
    upvoteBankSize: null,
    maxUpvotesPerSong: null,
    downvotesEnabled: false,
    downvoteBankSize: null,
    maxDownvotesPerSong: null,
  };
  const budgetEl = [...document.querySelectorAll('[x-data]')].find((el) =>
    /upvoteBankSize/.test(el.getAttribute('x-data') || '')
  );
  if (budgetEl) {
    const x = budgetEl.getAttribute('x-data');
    const num = (re) => {
      const mm = x.match(re);
      return mm ? Number(mm[1]) : null;
    };
    budget.upvoteBankSize = num(/upvoteBankSize:\s*(\d+)/);
    budget.maxUpvotesPerSong = num(/maxUpvotesPerSong:\s*(\d+)/);
    budget.downvoteBankSize = num(/downvoteBankSize:\s*(\d+)/);
    budget.maxDownvotesPerSong = num(/maxDownvotesPerSong:\s*(\d+)/);
    budget.downvotesEnabled = /downvotesEnabled:\s*true/.test(x);
  }

  // Round metadata from <title>: "Music League | <league> | <round>"
  const titleText = decodeEntities(
    document.querySelector('title')?.textContent || ''
  ).trim();
  const titleParts = titleText.split('|').map((p) => p.trim()).filter(Boolean);
  const round = {
    title: titleText,
    league: titleParts.length >= 2 ? titleParts[1] : null,
    prompt: titleParts.length >= 3 ? titleParts.slice(2).join(' | ') : null,
  };

  const songNodes = [...document.querySelectorAll('div.song[id^="song-"]')];
  const totalSongs = songNodes.length;
  let ownSkipped = 0;
  const songs = [];

  for (const node of songNodes) {
    const xdata = node.getAttribute('x-data') || '';
    if (/mine:\s*true/.test(xdata)) {
      ownSkipped++;
      continue; // skip the user's own submission entirely
    }

    const idAttr = node.getAttribute('id') || '';
    const idMatch = idAttr.match(/song-(\d+)/);
    const rawOrderIndex = idMatch ? Number(idMatch[1]) : songs.length;

    const titleEl = node.querySelector('h6');
    const meta = titleEl ? titleEl.parentElement : node;
    const title = decodeEntities(titleEl?.textContent || '').trim();
    const artist = decodeEntities(
      meta.querySelector('span.d-block.text-truncate')?.textContent || ''
    ).trim();
    const album = decodeEntities(
      meta.querySelector('span.text-body-secondary')?.textContent || ''
    ).trim();

    const userComment = (node.getAttribute('data-comment') || '').trim();
    const weightAttr = node.getAttribute('data-weight');
    const userAllocatedVotes =
      weightAttr != null && weightAttr !== '' ? Number(weightAttr) : null;
    const spotifyUri =
      node.querySelector('input[name="uri"]')?.getAttribute('value') || null;

    // Submitter quote: only when the bi-quote <p> is shown and non-empty.
    let submitterComment = '';
    const quoteP = [...node.querySelectorAll('p')].find((p) =>
      p.querySelector('i.bi-quote')
    );
    if (quoteP && (quoteP.getAttribute('x-show') || '') === 'true') {
      submitterComment = richText(quoteP.querySelector('span.ws-pre-wrap'));
    }

    const signals = scoreComment(userComment, mode);

    songs.push({
      rawOrderIndex,
      title,
      artist,
      album,
      userAllocatedVotes,
      userComment,
      submitterComment, // context only; never used for scoring
      spotifyUri,
      ...signals,
      finalVotes: 0,
    });
  }

  songs.sort((a, b) => a.rawOrderIndex - b.rawOrderIndex);
  return { round, budget, songs, totalSongs, ownSkipped };
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------
function flagsOf(s) {
  const f = [];
  if (s.plus) f.push('+');
  if (s.minus) f.push('-');
  if (s.uncertain) f.push('?');
  if (s.playlistAdd) f.push('play');
  if (s.needsReview) f.push('review');
  return f.join(' ');
}

function rankedSort(a, b) {
  return (
    b.score - a.score ||
    tiebreakRank(b) - tiebreakRank(a) ||
    a.title.localeCompare(b.title)
  );
}

function buildMarkdown({ round, budget, songs, totalSongs, ownSkipped, mode }) {
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error(
      'Usage: node scripts/parse-round.mjs <round.html> [--mode objective|subjective] [--no-json]'
    );
    process.exit(1);
  }
  if (!['objective', 'subjective'].includes(args.mode)) {
    console.error(`Invalid --mode "${args.mode}" (use objective or subjective)`);
    process.exit(1);
  }

  const html = await readFile(args.file, 'utf8');
  const parsed = parseRound(html, args.mode);

  if (!parsed.songs.length) {
    console.error(
      `No songs found in ${args.file}. This MVP expects a saved Music League HTML round.`
    );
    process.exit(1);
  }

  allocate(parsed.songs, parsed.budget.upvoteBankSize ?? 0, parsed.budget.maxUpvotesPerSong ?? Infinity);

  const ctx = { ...parsed, mode: args.mode };
  const md = buildMarkdown(ctx);

  const base = basename(args.file, extname(args.file));
  const outDir = 'analysis';
  await mkdir(outDir, { recursive: true });
  const mdPath = join(outDir, `${base}.md`);
  await writeFile(mdPath, md, 'utf8');
  console.log(`Wrote ${mdPath}`);

  if (args.json) {
    const jsonPath = join(outDir, `${base}.json`);
    const payload = {
      round: parsed.round,
      mode: args.mode,
      budget: parsed.budget,
      totals: {
        totalSongs: parsed.totalSongs,
        ownSkipped: parsed.ownSkipped,
        allocated: parsed.songs.reduce((a, s) => a + (s.finalVotes || 0), 0),
      },
      songs: parsed.songs.map((s) => ({
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
    await writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Wrote ${jsonPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
