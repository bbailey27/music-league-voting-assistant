#!/usr/bin/env node
// Release-year gate: turn a parsed round into a pass/fail fit.json by checking
// each song's EARLIEST official release year against a target year.
//
// Reads data/analysis/<round>/music.json (Spotify URIs from ML export), resolves
// dates from data/ref/release-dates.json, writes fit.json with gate pass|fail|maybe.
// Merge: just merge <round> --rank music --gate passFail
//
// Lookup providers (--fetch):
//   - musicbrainz  (default) — earliest release across MB releases for the recording.
//   - wikipedia    — fallback when MB misses or MB earliest fails the target year
//                    (compilation/repackage trap); cite the wiki URL.
//   - spotify      — NOT IMPLEMENTED for this workspace (stub only; do not configure).
//
// Without --fetch: offline from cache; cache misses → NEEDS CHECK (never silent pass).
//
// Usage:
//   node scripts/release-year-gate.mjs <round-id> [--year N] [--fetch]
//        [--provider musicbrainz|wikipedia|auto] [--cache <path>] [--dry-run]

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { matchFlag } from './cli-args.mjs';
import { musicPaths, fitPaths, REF_DIR } from './paths.mjs';

const DEFAULT_CACHE = join(REF_DIR, 'release-dates.json');
const MONTHS = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

function parseArgs(argv) {
  const args = {
    roundId: null,
    year: null,
    fetch: false,
    provider: 'musicbrainz',
    cache: DEFAULT_CACHE,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fetch') {
      args.fetch = true;
      continue;
    }
    if (a === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    let matched = false;
    for (const [name, set] of [
      ['year', (v) => (args.year = Number(v))],
      ['provider', (v) => (args.provider = v)],
      ['cache', (v) => (args.cache = v)],
    ]) {
      const next = matchFlag(argv, i, name, set);
      if (next != null) {
        i = next;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    if (!args.roundId && !a.startsWith('-')) args.roundId = a;
  }
  return args;
}

export function yearOf(date) {
  if (!date) return null;
  const m = /^(\d{4})/.exec(String(date));
  return m ? Number(m[1]) : null;
}

/** Target year from --year, else a 4-digit round prompt (e.g. "2016"). */
function resolveTargetYear(args, round) {
  if (Number.isFinite(args.year)) return args.year;
  const m = /\b(19|20)\d{2}\b/.exec(round?.prompt || round?.title || '');
  return m ? Number(m[0]) : null;
}

export function wikiSearchUrl(title, artist) {
  const q = encodeURIComponent(`${title} ${artist} song`);
  return `https://en.wikipedia.org/w/index.php?search=${q}`;
}

function wikiPageUrl(title) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(String(title).replace(/ /g, '_'))}`;
}

export function parseWikiReleased(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  const template = /\{\{Start date\|(\d{4})\|(\d{1,2})\|(\d{1,2})/i.exec(s);
  if (template) {
    return `${template[1]}-${String(template[2]).padStart(2, '0')}-${String(template[3]).padStart(2, '0')}`;
  }
  s = s.replace(/\{\{[^}]+\}\}/g, '').replace(/<[^>]+>/g, '').trim();
  const dmy = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(s);
  if (dmy) {
    const mo = MONTHS[dmy[2].toLowerCase()];
    if (mo) return `${dmy[3]}-${mo}-${String(dmy[1]).padStart(2, '0')}`;
  }
  const mdy = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (mdy) {
    const mo = MONTHS[mdy[1].toLowerCase()];
    if (mo) return `${mdy[3]}-${mo}-${String(mdy[2]).padStart(2, '0')}`;
  }
  const yearOnly = /\b(19|20)\d{2}\b/.exec(s);
  return yearOnly ? yearOnly[0] : null;
}

export function resolveGate(info, targetYear) {
  const y = yearOf(info?.earliestReleaseDate);
  if (y == null) return 'maybe';
  if (info?.confidence === 'needs-review' || info?.confidence === 'fuzzy') return 'maybe';
  if (y !== targetYear) {
    // MusicBrainz-only off-year may be a compilation/repackage trap — not a confirmed fail
    // until Wikipedia corroborates or a human verifies.
    const mbOnly =
      info?.earliestSource?.includes('musicbrainz.org') &&
      !info?.earliestSource?.includes('wikipedia.org') &&
      !String(info?.note || '').includes('Wikipedia');
    if (mbOnly) return 'maybe';
    return 'fail';
  }
  return 'pass';
}

/** Normalize title/artist for Wikipedia song-article search. */
export function wikiTitleArtist(title, artist) {
  const cleanTitle = String(title || '')
    .replace(/\s*\(feat\.[^)]+\)/gi, '')
    .replace(/\s*\([^)]*\bver\.[^)]*\)/gi, '')
    .replace(/\s*\([^)]*\)/g, (m) => (/k-hot|clean|explicit|remix/i.test(m) ? '' : m))
    .trim();
  const cleanArtist = String(artist || '').split(',')[0].split('&')[0].trim();
  return { cleanTitle: cleanTitle || title, cleanArtist: cleanArtist || artist };
}

function shouldRefetch(info, targetYear) {
  if (!info?.earliestReleaseDate) return true;
  if (info.confidence === 'needs-review') return true;
  const y = yearOf(info.earliestReleaseDate);
  if (y != null && y !== targetYear && !String(info.note || '').includes('Wikipedia')) return true;
  if (info.wikiCheckUrl && !info.earliestSource?.includes('wikipedia.org')) return true;
  return false;
}

async function loadCache(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    console.error(`Warning: could not read cache ${path}: ${err.message}`);
    return {};
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mbUserAgent() {
  return { 'User-Agent': `music-league-voting-assistant/1.0 ( ${process.env.MB_CONTACT || 'local'} )` };
}

async function fetchMusicBrainzEarliest({ artist, title }) {
  const ua = mbUserAgent();
  let recMbid = null;
  if (artist && title) {
    const q = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
    const r = await fetch(`https://musicbrainz.org/ws/2/recording?query=${q}&fmt=json&limit=1`, { headers: ua });
    if (r.ok) recMbid = (await r.json()).recordings?.[0]?.id ?? null;
    await sleep(1100);
  }
  if (!recMbid) return { earliestReleaseDate: null, earliestSource: null };
  const r = await fetch(
    `https://musicbrainz.org/ws/2/recording/${recMbid}?inc=releases&fmt=json`,
    { headers: ua }
  );
  await sleep(1100);
  if (!r.ok) return { earliestReleaseDate: null, earliestSource: null };
  const dates = (await r.json()).releases
    ?.map((rel) => rel.date)
    .filter(Boolean)
    .sort();
  return {
    earliestReleaseDate: dates?.[0] ?? null,
    earliestSource: `https://musicbrainz.org/recording/${recMbid}`,
    confidence: 'verified',
  };
}

async function fetchWikipediaRelease({ artist, title }) {
  const ua = mbUserAgent();
  const { cleanTitle, cleanArtist } = wikiTitleArtist(title, artist);
  const queries = [
    `${cleanTitle} (${cleanArtist} song)`,
    `${title} (${cleanArtist} song)`,
    `${cleanTitle} ${cleanArtist} song`,
  ];
  for (const q of queries) {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&origin=*`;
    const sr = await fetch(searchUrl, { headers: ua });
    if (!sr.ok) continue;
    const hit = (await sr.json()).query?.search?.[0];
    if (!hit) continue;
    const parseUrl = `https://en.wikipedia.org/w/api.php?action=parse&pageid=${hit.pageid}&prop=wikitext&format=json&origin=*`;
    const pr = await fetch(parseUrl, { headers: ua });
    await sleep(300);
    if (!pr.ok) continue;
    const wikitext = (await pr.json()).parse?.wikitext?.['*'] ?? '';
    const released = /\|\s*released\s*=\s*([^\n|]+)/i.exec(wikitext)?.[1];
    const date = parseWikiReleased(released);
    if (date) {
      return {
        earliestReleaseDate: date,
        earliestSource: wikiPageUrl(hit.title),
        confidence: 'wikipedia',
      };
    }
  }
  return {
    earliestReleaseDate: null,
    earliestSource: null,
    wikiCheckUrl: wikiSearchUrl(title, artist),
  };
}

async function enrichViaFetch(entry, meta, args, targetYear) {
  const out = { ...entry };
  const tryMb = args.provider !== 'wikipedia';
  const tryWiki = true; // always attempt after MB miss/fail (default path is musicbrainz + wiki)

  let mbDate = null;
  if (tryMb) {
    try {
      const mb = await fetchMusicBrainzEarliest({ artist: meta.artist, title: meta.title });
      mbDate = mb.earliestReleaseDate ?? null;
      if (mbDate) Object.assign(out, mb);
    } catch (err) {
      console.error(`  musicbrainz: ${err.message}`);
    }
  }

  const mbYear = yearOf(mbDate);
  const mbMiss = !mbDate;
  const mbFail = mbYear != null && mbYear !== targetYear;
  if (tryWiki && (mbMiss || mbFail)) {
    try {
      const wiki = await fetchWikipediaRelease({ artist: meta.artist, title: meta.title });
      if (wiki.earliestReleaseDate) {
        const wikiYear = yearOf(wiki.earliestReleaseDate);
        if (mbMiss) {
          Object.assign(out, wiki);
        } else if (mbFail && wikiYear === targetYear) {
          out.mbEarliestReleaseDate = mbDate;
          out.earliestReleaseDate = wiki.earliestReleaseDate;
          out.earliestSource = wiki.earliestSource;
          out.confidence = 'needs-review';
          out.note = `MusicBrainz earliest ${mbDate} (likely compilation/repackage); Wikipedia released ${wiki.earliestReleaseDate}. Verify before passing.`;
        } else if (mbFail && wikiYear !== targetYear) {
          out.confidence = 'verified';
          out.note = `MusicBrainz ${mbDate}; Wikipedia ${wiki.earliestReleaseDate} — both off-year.`;
        }
      } else if (wiki.wikiCheckUrl) {
        out.wikiCheckUrl = wiki.wikiCheckUrl;
      }
    } catch (err) {
      console.error(`  wikipedia: ${err.message}`);
    }
  }

  if (!out.wikiCheckUrl && !out.earliestReleaseDate) {
    const { cleanTitle, cleanArtist } = wikiTitleArtist(meta.title, meta.artist);
    out.wikiCheckUrl = wikiSearchUrl(cleanTitle, cleanArtist);
  }
  out.verifiedAt = new Date().toISOString().slice(0, 10);
  return out;
}

// ---- gate + fit.json --------------------------------------------------------

function buildFit(round, targetYear, rows) {
  const fails = rows.filter((r) => r.gate === 'fail');
  const unknown = rows.filter((r) => r.gate === 'maybe');
  return {
    round: {
      title: round.title,
      league: round.league,
      prompt: round.prompt,
      description: `Song must have been actually released in ${targetYear}. Gate on EARLIEST official release year (a pre-album single counts). Generated by scripts/release-year-gate.mjs.`,
    },
    themeKeywords: [`released in ${targetYear}`, 'earliest release year', 'single before album counts'],
    method: `Pure passFail eligibility gate on earliest official release year vs ${targetYear}. Passing songs carry NO numeric fit — they are scored purely on music (combinedScore falls back to the raw music score); fails are disqualified. earliestReleaseDate gates; albumReleaseDate is the linked row date (audit only).`,
    fitScale: {
      pass: { desc: `Eligible — earliest official release is in ${targetYear}. Scored on music alone.` },
      fail: { desc: `Disqualified — earliest official release is not ${targetYear}.` },
    },
    songs: rows.map((r) => r.song),
    highlights: [
      `Gate = earliest release year == ${targetYear}.`,
      fails.length
        ? `FAIL (${fails.length}): ${fails.map((r) => `${r.title} [${r.earliestReleaseDate}]`).join('; ')}.`
        : 'No confirmed failures.',
      ...(unknown.length
        ? [`NEEDS CHECK (${unknown.length}): ${unknown.map((r) => r.title).join('; ')} — verify release year (see wikiCheckUrl / cache) before merge.`]
        : []),
    ],
  };
}

function songEntry(meta, info, gate, targetYear) {
  const earliest = info?.earliestReleaseDate ?? null;
  const album = info?.albumReleaseDate ?? null;
  const checkUrl = info?.wikiCheckUrl ?? null;
  const albumBits = album
    ? ` Album on this track: ${info.albumTitle || 'unknown'} (${album}${info.albumEdition && info.albumEdition !== 'standard' ? `, ${info.albumEdition}` : ''}).`
    : '';
  let rationale;
  if (gate === 'maybe') {
    const hint = checkUrl ? ` Check: ${checkUrl}` : '';
    const note = info?.note ? ` ${info.note}` : '';
    const mbHint =
      earliest && yearOf(earliest) !== targetYear
        ? ` MusicBrainz earliest ${earliest} (may be compilation/repackage — verify).`
        : '';
    rationale = `NEEDS CHECK — release year not verified for this track.${mbHint}${note}${hint} Not counted as a pass until confirmed (cache or hand verify).`;
  } else {
    const verdict = gate === 'fail' ? `FAIL — earliest release ${earliest} is not ${targetYear}.` : `Earliest release ${earliest} (${targetYear}).`;
    rationale = `${verdict}${albumBits} Source: ${info.earliestSource || 'cache'}`;
  }
  return {
    rawOrderIndex: meta.rawOrderIndex,
    title: meta.title,
    artist: meta.artist,
    gate,
    fitTier: gate,
    basis: 'release-date',
    confidence: info?.confidence || (gate === 'maybe' ? 'low' : 'high'),
    ...(gate === 'maybe' ? { flags: ['needs-check'] } : gate === 'fail' ? { flags: ['off-year'] } : {}),
    earliestReleaseDate: gate === 'maybe' ? null : earliest,
    albumReleaseDate: album,
    ...(checkUrl && gate === 'maybe' ? { wikiCheckUrl: checkUrl } : {}),
    rationale,
  };
}

function printReport(rows, targetYear, roundId) {
  const confirmed = rows.filter((r) => r.gate === 'pass' || r.gate === 'fail');
  const needsCheck = rows.filter((r) => r.gate === 'maybe');
  const w = Math.max(...rows.map((r) => r.title.length), 5);

  console.log(`\nRelease-year gate — target ${targetYear} (${roundId})\n`);

  if (confirmed.length) {
    console.log('CONFIRMED');
    console.log(`  ${'Song'.padEnd(w)}  Earliest     Gate   Source`);
    for (const r of confirmed) {
      const src = r.song.rationale.includes('musicbrainz.org')
        ? 'musicbrainz'
        : r.song.rationale.includes('wikipedia.org')
          ? 'wikipedia'
          : 'cache';
      const flag = r.gate === 'pass' ? 'pass' : 'FAIL';
      console.log(`  ${r.title.slice(0, w).padEnd(w)}  ${String(r.earliestReleaseDate || '—').padEnd(10)}  ${flag.padEnd(5)}  ${src}`);
    }
    console.log('');
  }

  if (needsCheck.length) {
    console.log('NEEDS CHECK (verify before merge — do not treat as pass/fail yet)');
    console.log(`  ${'Song'.padEnd(w)}  Hint`);
    for (const r of needsCheck) {
      const mb = r.info?.earliestReleaseDate && yearOf(r.info.earliestReleaseDate) !== targetYear
        ? `MB earliest ${r.info.earliestReleaseDate} (may be wrong) · `
        : '';
      const status = `${mb}${r.info?.note || 'release year not verified'}`;
      console.log(`  ${r.title.slice(0, w).padEnd(w)}  ${status}`);
      const url = r.song.wikiCheckUrl || r.info?.earliestSource;
      if (url) console.log(`  ${''.padEnd(w)}  → ${url}`);
    }
    console.log('');
  }

  const passes = confirmed.filter((r) => r.gate === 'pass').length;
  const fails = confirmed.filter((r) => r.gate === 'fail').length;
  console.log(`  ${passes} confirmed pass · ${fails} confirmed fail · ${needsCheck.length} needs check\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.roundId) {
    console.error('Usage: node scripts/release-year-gate.mjs <round-id> [--year N] [--fetch] [--provider musicbrainz|wikipedia|auto] [--cache <path>] [--dry-run]');
    process.exit(1);
  }
  if (args.provider === 'spotify' || args.provider === 'auto') {
    console.error('Note: Spotify API lookup is not implemented — using MusicBrainz (+ Wikipedia fallback).');
    args.provider = 'musicbrainz';
  }

  const musicJson = musicPaths(args.roundId).json;
  let music;
  try {
    music = JSON.parse(await readFile(musicJson, 'utf8'));
  } catch (err) {
    console.error(`Could not read ${musicJson}: ${err.message}. Run just parse ${args.roundId} first.`);
    process.exit(1);
  }

  const targetYear = resolveTargetYear(args, music.round);
  if (!targetYear) {
    console.error('No target year: pass --year N (round prompt has no 4-digit year).');
    process.exit(1);
  }

  const cache = await loadCache(args.cache);
  const rows = [];
  let cacheDirty = false;
  for (const s of music.songs || []) {
    const uri = s.spotifyUri || '';
    let info = uri ? cache[uri] : null;
    if (args.fetch && shouldRefetch(info, targetYear)) {
      console.error(`Fetching ${s.artist} — ${s.title} …`);
      info = await enrichViaFetch(info || {}, s, args, targetYear);
      if (uri) {
        cache[uri] = { artist: s.artist, title: s.title, ...info };
        cacheDirty = true;
      }
    }
    const gate = resolveGate(info, targetYear);
    rows.push({
      title: s.title,
      earliestReleaseDate: info?.earliestReleaseDate ?? null,
      gate,
      info,
      song: songEntry(s, info, gate, targetYear),
    });
  }

  printReport(rows, targetYear, args.roundId);

  if (cacheDirty && !args.dryRun) {
    await writeFile(args.cache, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
    console.log(`Updated cache ${args.cache}`);
  }

  if (args.dryRun) {
    console.log('(dry-run: fit.json not written)');
    return;
  }
  const fitJson = fitPaths(args.roundId).json;
  await mkdir(fitPaths(args.roundId).dir, { recursive: true });
  await writeFile(fitJson, `${JSON.stringify(buildFit(music.round, targetYear, rows), null, 2)}\n`, 'utf8');
  console.log(`Wrote ${fitJson}`);
  console.log(`Next: just merge ${args.roundId} --rank music --gate passFail && just scores ${args.roundId}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
