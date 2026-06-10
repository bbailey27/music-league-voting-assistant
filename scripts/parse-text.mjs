// Text input parser for Music League rounds.
//
// Two paths, both emitting the same canonical song list as the HTML parser:
//   - strict:  structured copy/paste with the "Album art" block delimiter and
//              the "N / 1000" comment-length footer present.
//   - lenient: OS Live Text / Lens style paste where those anchors are missing;
//              group visible lines into songs heuristically and flag generously.
//
// Scoring is delegated to the shared scorer; this module only recovers the
// canonical fields (title/artist/album/votes/userComment/submitterComment).

import { scoreComment } from './score-core.mjs';

const ALBUM_ART = 'Album art';
const OWN_MARKER = 'You submitted this song';
const PLACEHOLDERS = new Set([
  'What did you think of this song?',
  'What did you think of your own song?',
]);
const FOOTER_RE = /^(\d+)\s*\/\s*1000$/; // user-comment length anchor
const BUDGET_RE = /^\d+\s+of\s+(\d+)$/; // "0 of 25" -> upvote bank size
const ROUND_RE = /^round\s+\d+$/i;
const INT_RE = /^\d+$/;

// Join block lines into a single comment, preserving internal blank lines (which
// become paragraph breaks) while trimming surrounding whitespace/indent.
function joinTrim(arr) {
  return arr.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Header: budget + round metadata (best effort; never required for scoring)
// ---------------------------------------------------------------------------
function parseHeader(headerLines) {
  let upvoteBankSize = null;
  let prompt = null;
  let league = null;

  for (let i = 0; i < headerLines.length; i++) {
    const t = headerLines[i].trim();
    if (upvoteBankSize == null) {
      const b = t.match(BUDGET_RE);
      if (b) upvoteBankSize = Number(b[1]);
    }
    if (prompt == null && ROUND_RE.test(t)) {
      // Prompt is the next non-empty line after "ROUND N".
      for (let j = i + 1; j < headerLines.length; j++) {
        if (headerLines[j].trim()) {
          prompt = headerLines[j].trim();
          break;
        }
      }
    }
  }

  // League: the last line of the first run of short, leading-space "badge" lines
  // (e.g. " OPEN" / " SPEEDY" / " Loud & Proud").
  let run = [];
  for (const raw of headerLines) {
    const isBadge = /^\s+\S/.test(raw) && raw.trim().length > 0 && raw.trim().length < 40;
    if (isBadge) {
      run.push(raw.trim());
    } else if (run.length) {
      break;
    }
  }
  if (run.length) league = run[run.length - 1];

  const budget = {
    upvoteBankSize,
    maxUpvotesPerSong: null, // not present in text export
    downvotesEnabled: false,
    downvoteBankSize: null,
    maxDownvotesPerSong: null,
  };
  const title =
    league && prompt ? `Music League | ${league} | ${prompt}` : prompt || league || null;
  return { budget, round: { title, league, prompt } };
}

// ---------------------------------------------------------------------------
// Strict block segmentation: split on the "Album art" delimiter, tracking the
// "You submitted this song" marker that precedes the user's own block.
// ---------------------------------------------------------------------------
function segmentBlocks(lines) {
  const blocks = [];
  const headerLines = [];
  let current = null;
  let ownNext = false;
  for (const raw of lines) {
    const t = raw.trim();
    if (t === OWN_MARKER) {
      ownNext = true;
      continue;
    }
    if (t === ALBUM_ART) {
      current = { isOwn: ownNext, lines: [] };
      blocks.push(current);
      ownNext = false;
      continue;
    }
    if (current) current.lines.push(raw);
    else headerLines.push(raw);
  }
  return { blocks, headerLines };
}

// Recover one canonical song from a non-own block's lines.
function parseBlock(blockLines, mode, rawOrderIndex) {
  let needsReview = false;
  let reviewReason = '';

  // Positional metadata. Album is usually present (title/artist/album/votes);
  // fall back to a 2-line metadata header if the votes integer sits at index 2.
  let metaEnd;
  if (INT_RE.test((blockLines[3] || '').trim())) metaEnd = 3;
  else if (INT_RE.test((blockLines[2] || '').trim())) metaEnd = 2;
  else metaEnd = 3;

  const title = (blockLines[0] || '').trim();
  const artist = (blockLines[1] || '').trim();
  const album = metaEnd >= 3 ? (blockLines[2] || '').trim() : '';

  const votesLine = (blockLines[metaEnd] || '').trim();
  let userAllocatedVotes = null;
  if (INT_RE.test(votesLine)) {
    userAllocatedVotes = Number(votesLine);
  } else {
    needsReview = true;
    reviewReason = 'could not locate the vote count line';
  }

  // Footer "N / 1000" anchors the user-comment length.
  let footerIdx = -1;
  let commentLen = null;
  for (let i = blockLines.length - 1; i > metaEnd; i--) {
    const mm = blockLines[i].trim().match(FOOTER_RE);
    if (mm) {
      footerIdx = i;
      commentLen = Number(mm[1]);
      break;
    }
  }
  if (footerIdx < 0) {
    needsReview = true;
    reviewReason = reviewReason || 'missing the "N / 1000" comment footer';
  }

  // Comment region = everything between the votes line and the footer, minus the
  // empty-box UI placeholder.
  const regionEnd = footerIdx >= 0 ? footerIdx : blockLines.length;
  const region = blockLines
    .slice(metaEnd + 1, regionEnd)
    .filter((l) => !PLACEHOLDERS.has(l.trim()));

  let userComment = '';
  let submitterComment;

  if (commentLen === 0) {
    // Empty box: the whole region (if any) is the submitter's quote.
    submitterComment = joinTrim(region);
  } else {
    // userComment is the trailing column-0 paragraph; the indented block above
    // it (if any) is the scoring-neutral submitter quote.
    const r = region.slice();
    while (r.length && r[r.length - 1].trim() === '') r.pop();
    const last = r.length ? r[r.length - 1] : '';
    userComment = last.trim();
    submitterComment = joinTrim(r.slice(0, Math.max(0, r.length - 1)));

    // Ambiguity: the footer length must agree with the text we pulled out.
    if (commentLen != null && userComment.length !== commentLen) {
      needsReview = true;
      reviewReason =
        reviewReason ||
        `comment length footer (${commentLen}) disagrees with parsed text (${userComment.length})`;
    }
  }

  const signals = scoreComment(userComment, mode);
  if (needsReview) {
    signals.needsReview = true;
    if (!signals.reviewReason) signals.reviewReason = reviewReason;
  }

  return {
    rawOrderIndex,
    title,
    artist,
    album,
    userAllocatedVotes,
    userComment,
    submitterComment,
    spotifyUri: null, // not available from text
    ...signals,
    finalVotes: 0,
  };
}

function parseStrict(lines, mode) {
  const { blocks, headerLines } = segmentBlocks(lines);
  const { budget, round } = parseHeader(headerLines);

  const totalSongs = blocks.length;
  let ownSkipped = 0;
  const songs = [];
  blocks.forEach((block, index) => {
    if (block.isOwn) {
      ownSkipped++;
      return; // skip the user's own submission, but keep its position in the order
    }
    songs.push(parseBlock(block.lines, mode, index));
  });

  return { round, budget, songs, totalSongs, ownSkipped };
}

// ---------------------------------------------------------------------------
// Lenient / Live-Text mode: anchors absent. Group visible lines into songs and
// flag everything for review since the structure can't be trusted.
// ---------------------------------------------------------------------------
function parseLenient(lines, mode) {
  const { budget, round } = parseHeader(lines);

  // Drop known chrome/anchor lines, then split into groups on blank-line gaps.
  const cleaned = lines.filter((l) => {
    const t = l.trim();
    if (t === ALBUM_ART || t === OWN_MARKER) return false;
    if (PLACEHOLDERS.has(t)) return false;
    if (FOOTER_RE.test(t)) return false;
    return true;
  });

  const groups = [];
  let group = [];
  for (const raw of cleaned) {
    if (raw.trim() === '') {
      if (group.length) {
        groups.push(group);
        group = [];
      }
    } else {
      group.push(raw.trim());
    }
  }
  if (group.length) groups.push(group);

  // A plausible song group has a title + at least one more line. Anything that
  // looks like header chrome (single short lines before the first multi-line
  // group) is ignored.
  const songs = [];
  let order = 0;
  for (const g of groups) {
    if (g.length < 2) continue; // skip stray single lines (badges, headings)

    const title = g[0];
    const artist = g[1] || '';
    const album = g.length >= 3 ? g[2] : '';

    // A trailing line that scores (has a numeric token) is the user comment.
    let userComment = '';
    for (let i = g.length - 1; i >= 1; i--) {
      if (/\d/.test(g[i]) && scoreComment(g[i], mode).score != null) {
        userComment = g[i];
        break;
      }
    }

    const signals = scoreComment(userComment, mode);
    signals.needsReview = true; // lenient parse: always verify
    signals.reviewReason =
      signals.reviewReason || 'lenient/live-text parse — verify title/artist/score';

    songs.push({
      rawOrderIndex: order++,
      title,
      artist,
      album,
      userAllocatedVotes: null,
      userComment,
      submitterComment: '',
      spotifyUri: null,
      ...signals,
      finalVotes: 0,
    });
  }

  return { round, budget, songs, totalSongs: songs.length, ownSkipped: 0 };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export function parseRoundText(text, mode, opts = {}) {
  const lines = text.split(/\r?\n/);
  const hasAlbumArt = lines.some((l) => l.trim() === ALBUM_ART);
  const hasFooter = lines.some((l) => FOOTER_RE.test(l.trim()));

  if (opts.lenient || !hasAlbumArt || !hasFooter) {
    return parseLenient(lines, mode);
  }
  return parseStrict(lines, mode);
}
