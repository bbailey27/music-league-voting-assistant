// Environment-agnostic Music League HTML extractor.
//
// Walks an already-parsed DOM `document` (linkedom in Node, native DOMParser in
// the browser) into the same canonical song list the text parser emits, then
// hands user comments to the shared scorer. No Node or browser APIs beyond the
// standard DOM are used here, so docs/app.js and the CLI share this code.

import { scoreComment } from './score-core.mjs';

export function decodeEntities(s) {
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
  const html = el.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  return decodeEntities(html).replace(/\u00a0/g, ' ').trim();
}

// Extract the canonical round (songs + budget + metadata) from a parsed DOM.
export function parseRoundDocument(document, mode) {
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
  const titleText = decodeEntities(document.querySelector('title')?.textContent || '').trim();
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
    const spotifyUri = node.querySelector('input[name="uri"]')?.getAttribute('value') || null;

    // Submitter quote: only when the bi-quote <p> is shown and non-empty.
    let submitterComment = '';
    const quoteP = [...node.querySelectorAll('p')].find((p) => p.querySelector('i.bi-quote'));
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
