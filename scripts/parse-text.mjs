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
// Live Text often OCRs the placeholder as "...think about this song?" (about vs
// of), so match it loosely too.
const PLACEHOLDER_RE = /^what did you think .*\bthis song\?$/i;
const isPlaceholder = (t) => PLACEHOLDERS.has(t) || PLACEHOLDER_RE.test(t);
const FOOTER_RE = /^(\d+)\s*\/\s*1000$/; // user-comment length anchor ("4/1000")
const BUDGET_RE = /^\d+\s+of\s+(\d+)\b/i; // "0 of 25" / "00 OF 10 %" -> bank size
const ROUND_RE = /^round\s+\d+$/i;
const INT_RE = /^\d+$/;
const STITCH_RE = /screenshots?\s+stitched/i; // "3 Screenshots Stitched"
const APPSTORE_RE = /available on the app store/i;
const VOTE_BUTTON_RE = /^[+-]$/; // a lone +/- vote button line

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
    .filter((l) => !isPlaceholder(l.trim()));

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
// Lenient / Live-Text mode: the "Album art" delimiter is gone but the
// "N / 1000" comment-length footer survives, so anchor on it. Segment songs on
// the footers, walk back to recover metadata, and use the footer count as a
// length checksum to pick the user-comment line. Everything is flagged for
// review since the surrounding structure still can't be fully trusted.
// ---------------------------------------------------------------------------
function parseLenient(lines, mode) {
  const { budget, round } = parseHeader(lines);

  // Trim, drop blank + phone/stitch-app chrome, but keep structural lines.
  const cleaned = lines
    .map((l) => l.trim())
    .filter((t) => t !== '')
    .filter((t) => t !== ALBUM_ART && t !== OWN_MARKER)
    .filter((t) => !STITCH_RE.test(t) && !APPSTORE_RE.test(t));

  // Find where the song list starts: just after the round prompt / the
  // "...description to help" helper line that follows it.
  let songStart = 0;
  for (let i = 0; i < cleaned.length; i++) {
    if (/description to help$/i.test(cleaned[i])) songStart = i + 1;
    else if (songStart === 0 && ROUND_RE.test(cleaned[i])) songStart = i + 2; // skip prompt line
  }
  const region = cleaned
    .slice(songStart)
    .filter((t) => !BUDGET_RE.test(t) && !ROUND_RE.test(t));

  const footers = [];
  region.forEach((t, i) => {
    const m = t.match(FOOTER_RE);
    if (m) footers.push({ i, len: Number(m[1]) });
  });

  const songs = [];
  let order = 0;

  const emit = (raw, commentLen, noFooter) => {
    const block = raw.filter((t) => !isPlaceholder(t) && !VOTE_BUTTON_RE.test(t));
    if (block.length < 2 && commentLen !== 0) return; // not a real song block

    let userComment = '';
    let reason = 'lenient/live-text parse — verify title/artist/score';
    if (commentLen && commentLen > 0) {
      // Checksum: the user-comment line's length equals the footer count.
      // Search from the footer backward so we pick the trailing comment.
      for (let i = block.length - 1; i >= 2; i--) {
        if (block[i].length === commentLen) {
          userComment = block[i];
          break;
        }
      }
      if (!userComment) {
        for (let i = block.length - 1; i >= 2; i--) {
          if (/\d/.test(block[i]) && scoreComment(block[i], mode).score != null) {
            userComment = block[i];
            break;
          }
        }
        reason = `comment-length footer (${commentLen}) matched no line — verify`;
      }
    } else if (noFooter) {
      reason = 'no "N / 1000" footer (likely cut off in the screenshot) — verify';
    }

    const title = block[0] || '';
    const artist = block[1] || '';
    const album = block[2] && block[2] !== userComment ? block[2] : '';
    const commentIdx = userComment ? block.indexOf(userComment) : block.length;
    const submitterComment = joinTrim(block.slice(album ? 3 : 2, commentIdx));

    const signals = scoreComment(userComment, mode);
    signals.needsReview = true; // lenient parse: always verify
    signals.reviewReason = signals.reviewReason || reason;

    songs.push({
      rawOrderIndex: order++,
      title,
      artist,
      album,
      userAllocatedVotes: null,
      userComment,
      submitterComment,
      spotifyUri: null,
      ...signals,
      finalVotes: 0,
    });
  };

  let start = 0;
  for (const f of footers) {
    emit(region.slice(start, f.i), f.len, false);
    start = f.i + 1;
  }
  if (start < region.length) emit(region.slice(start), null, true); // trailing, footer cut off

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
