#!/usr/bin/env node
// Deterministic Music League round parser + draft vote allocator.
// Usage: node scripts/parse-round.mjs <round.html|round.txt> [--mode objective|subjective] [--no-json] [--lenient]
//
// HTML and text inputs both emit the same canonical song list, then share the
// scorer/allocator/reporter in score-core.mjs. Scoring reads the USER comment
// only; the submitter quote block is preserved for context but never parsed for
// scoring signals.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, join, extname } from 'node:path';
import { parseHTML } from 'linkedom';
import { allocate, buildMarkdown, buildJsonPayload, scoreComment } from './score-core.mjs';
import { parseRoundText } from './parse-text.mjs';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { file: null, mode: 'objective', json: true, lenient: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-json') args.json = false;
    else if (a === '--lenient') args.lenient = true;
    else if (a === '--mode') args.mode = argv[++i];
    else if (a.startsWith('--mode=')) args.mode = a.slice('--mode='.length);
    else if (!a.startsWith('--') && !args.file) args.file = a;
  }
  return args;
}

// ---------------------------------------------------------------------------
// HTML-specific text helpers
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

// ---------------------------------------------------------------------------
// Parse the HTML round into structured songs + budget + round metadata
// ---------------------------------------------------------------------------
function parseRoundHtml(html, mode) {
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
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error(
      'Usage: node scripts/parse-round.mjs <round.html|round.txt> [--mode objective|subjective] [--no-json] [--lenient]'
    );
    process.exit(1);
  }
  if (!['objective', 'subjective'].includes(args.mode)) {
    console.error(`Invalid --mode "${args.mode}" (use objective or subjective)`);
    process.exit(1);
  }

  const raw = await readFile(args.file, 'utf8');
  const ext = extname(args.file).toLowerCase();
  const parsed =
    ext === '.txt'
      ? parseRoundText(raw, args.mode, { lenient: args.lenient })
      : parseRoundHtml(raw, args.mode);

  if (!parsed.songs.length) {
    console.error(
      `No songs found in ${args.file}. Expected a saved Music League HTML round, or pasted round text.`
    );
    process.exit(1);
  }

  allocate(
    parsed.songs,
    parsed.budget.upvoteBankSize ?? 0,
    parsed.budget.maxUpvotesPerSong ?? Infinity
  );

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
    const payload = buildJsonPayload(ctx);
    await writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Wrote ${jsonPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
