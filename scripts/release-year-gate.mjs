#!/usr/bin/env node
// Release-year gate: turn a parsed round into a pass/fail fit.json by checking
// each song's EARLIEST official release year against a target year.
//
// The heart of a "songs from year N" round. Reads data/analysis/<round>/music.json
// (which already carries a spotifyUri per song), resolves release dates from a
// local cache (data/ref/release-dates.json), and writes data/analysis/<round>/fit.json
// with gate: pass|fail. Merge it the usual way:
//   just merge <round> --rank music --gate passFail
//
// Three dates per track (see spec/release-dates.md):
//   - earliestReleaseDate       — version-earliest gate (bg-years; singles count).
//   - earliestAlbumReleaseDate  — earliest-album-release gate (upcoming; singles excluded).
//   - albumReleaseDate          — linked album release date: exact Spotify row (audit only).
//
// Cache misses: run with --fetch to look up online (needs network). Providers:
//   - spotify      (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET env) → album date,
//                  album_type, ISRC for the exact track id. Fast, keyed, reliable.
//   - musicbrainz  (no key; set MB_CONTACT env for a polite User-Agent) → earliest
//                  release across all releases of the recording (by ISRC or search).
// Without --fetch the script is offline: it gates what the cache knows and lists
// the rest as NEEDS-LOOKUP (never silently passed).
//
// Usage:
//   node scripts/release-year-gate.mjs <round-id> [--year N] [--fetch]
//        [--provider spotify|musicbrainz|auto] [--cache <path>] [--dry-run]

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { matchFlag } from './cli-args.mjs';
import { musicPaths, fitPaths, REF_DIR } from './paths.mjs';

const DEFAULT_CACHE = join(REF_DIR, 'release-dates.json');

function parseArgs(argv) {
  const args = {
    roundId: null,
    year: null,
    fetch: false,
    provider: 'auto',
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

function yearOf(date) {
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

async function loadCache(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    console.error(`Warning: could not read cache ${path}: ${err.message}`);
    return {};
  }
}

// ---- online providers (only used with --fetch) ------------------------------

async function spotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify auth failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function fetchSpotify(trackId, token) {
  const res = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify track ${trackId}: ${res.status}`);
  const t = await res.json();
  return {
    albumTitle: t.album?.name ?? null,
    albumReleaseDate: t.album?.release_date ?? null,
    albumType: t.album?.album_type ?? null,
    isrc: t.external_ids?.isrc ?? null,
    albumSource: t.album?.external_urls?.spotify ?? null,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchMusicBrainzEarliest({ isrc, artist, title }) {
  const ua = { 'User-Agent': `music-league-voting-assistant/1.0 ( ${process.env.MB_CONTACT || 'set MB_CONTACT'} )` };
  let recMbid = null;
  if (isrc) {
    const r = await fetch(`https://musicbrainz.org/ws/2/isrc/${isrc}?fmt=json`, { headers: ua });
    if (r.ok) recMbid = (await r.json()).recordings?.[0]?.id ?? null;
    await sleep(1100);
  }
  if (!recMbid && artist && title) {
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
  };
}

async function enrichViaFetch(entry, meta, args, spToken) {
  const trackId = (meta.spotifyUri || '').split(':').pop();
  const useSpotify = args.provider !== 'musicbrainz' && spToken && trackId;
  const useMb = args.provider !== 'spotify';
  const out = { ...entry };
  if (useSpotify && (!out.albumReleaseDate || !out.isrc)) {
    try {
      Object.assign(out, await fetchSpotify(trackId, spToken));
    } catch (err) {
      console.error(`  spotify: ${err.message}`);
    }
  }
  if (useMb && !out.earliestReleaseDate) {
    try {
      Object.assign(
        out,
        await fetchMusicBrainzEarliest({ isrc: out.isrc, artist: meta.artist, title: meta.title })
      );
    } catch (err) {
      console.error(`  musicbrainz: ${err.message}`);
    }
  }
  // Fallback: if only the album date is known, use it as the earliest candidate
  // (flagged low-confidence — compilations/repackages make this unsafe).
  if (!out.earliestReleaseDate && out.albumReleaseDate) {
    out.earliestReleaseDate = out.albumReleaseDate;
    out.confidence = 'linked-album-date';
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
        : 'No failures — every song is from the target year.',
      ...(unknown.length
        ? [`NEEDS LOOKUP (${unknown.length}): ${unknown.map((r) => r.title).join('; ')} — no cached release date; re-run with --fetch.`]
        : []),
    ],
  };
}

function songEntry(meta, info, gate, targetYear) {
  const earliest = info?.earliestReleaseDate ?? null;
  const album = info?.albumReleaseDate ?? null;
  const albumBits = album
    ? ` Album on this track: ${info.albumTitle || 'unknown'} (${album}${info.albumEdition && info.albumEdition !== 'standard' ? `, ${info.albumEdition}` : ''}).`
    : '';
  let rationale;
  if (gate === 'maybe') {
    rationale = `NEEDS LOOKUP — no cached release date for this track. Re-run with --fetch (or add it to the cache). Not counted as a pass.`;
  } else {
    const verdict = gate === 'fail' ? `FAIL — earliest release ${earliest} is not ${targetYear}.` : `Earliest release ${earliest} (${targetYear}).`;
    rationale = `${verdict}${albumBits} Source: ${info.earliestSource || info.albumSource || 'cache'}`;
  }
  // Pure eligibility gate: emit ONLY the gate verdict, no numeric fitScore. That
  // keeps combinedScore == raw music for passing songs (see combinedScore()), so
  // valid songs are ranked purely on music and the fails are DQ'd by the gate —
  // no fit-quality axis, no weighted blend.
  return {
    rawOrderIndex: meta.rawOrderIndex,
    title: meta.title,
    artist: meta.artist,
    gate,
    fitTier: gate,
    basis: 'release-date',
    confidence: info?.confidence || (gate === 'maybe' ? 'low' : 'high'),
    ...(gate === 'maybe' ? { flags: ['needs-lookup'] } : gate === 'fail' ? { flags: ['off-year'] } : {}),
    earliestReleaseDate: earliest,
    albumReleaseDate: album,
    rationale,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.roundId) {
    console.error('Usage: node scripts/release-year-gate.mjs <round-id> [--year N] [--fetch] [--provider spotify|musicbrainz|auto] [--cache <path>] [--dry-run]');
    process.exit(1);
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
  let spToken = null;
  if (args.fetch && args.provider !== 'musicbrainz') {
    spToken = await spotifyToken();
    if (!spToken) console.error('Note: SPOTIFY_CLIENT_ID/SECRET unset — Spotify lookups skipped.');
  }

  const rows = [];
  let cacheDirty = false;
  for (const s of music.songs || []) {
    const uri = s.spotifyUri || '';
    let info = uri ? cache[uri] : null;
    if (args.fetch && (!info || !info.earliestReleaseDate)) {
      console.error(`Fetching ${s.artist} — ${s.title} …`);
      info = await enrichViaFetch(info || {}, s, args, spToken);
      if (uri) {
        cache[uri] = { artist: s.artist, title: s.title, ...info };
        cacheDirty = true;
      }
    }
    const earliestYear = yearOf(info?.earliestReleaseDate);
    const gate = earliestYear == null ? 'maybe' : earliestYear === targetYear ? 'pass' : 'fail';
    rows.push({
      title: s.title,
      earliestReleaseDate: info?.earliestReleaseDate ?? null,
      gate,
      song: songEntry(s, info, gate, targetYear),
    });
  }

  // Report
  const w = Math.max(...rows.map((r) => r.title.length), 5);
  console.log(`\nRelease-year gate — target ${targetYear} (${args.roundId})\n`);
  console.log(`  ${'Song'.padEnd(w)}  Earliest    Album        Gate`);
  for (const r of rows) {
    const a = r.song.albumReleaseDate || '—';
    const flag = r.gate === 'pass' ? 'pass' : r.gate === 'fail' ? 'FAIL' : 'LOOKUP';
    console.log(`  ${r.title.slice(0, w).padEnd(w)}  ${String(r.earliestReleaseDate || '—').padEnd(10)}  ${String(a).padEnd(10)}  ${flag}`);
  }
  const fails = rows.filter((r) => r.gate === 'fail').length;
  const lookups = rows.filter((r) => r.gate === 'maybe').length;
  console.log(`\n  ${rows.length - fails - lookups} pass · ${fails} fail · ${lookups} needs-lookup\n`);

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
