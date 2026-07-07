#!/usr/bin/env node
// Weighted engagement score for title-chain candidate titles.
//
// Usage:
//   node scripts/title-candidate-score.mjs "Title One" ["Title Two" ...]
//   node scripts/title-candidate-score.mjs --json "Title" ...
//
// Weights (same as story-5/6 sort-candidates):
//   +10  in all-songs-no-inst.csv (Pandora thumb-up baseline)
//   +2   per scrobble (lastfm/track-titles.csv col 2, summed by title)
//   +5   per favorite playlist (all-songs col 21)
//   +1   per ranking-game point (all-songs col 24)
//   +2   per "my playlist" count (all-songs col 32)
//   +1   per 10% artist rating (all-songs col 20)
//
// Guidance: .cursor/skills/title-chain/SKILL.md → "Engagement score"

import { parseCsv, norm } from "./title-prefix-scan.mjs";
import { resolveTable } from "./lastfm-export.mjs";
import { matchFlag } from "./cli-args.mjs";

export const ENGAGEMENT_WEIGHTS = {
  inAllSongs: 10,
  scrobble: 2,
  favPlaylist: 5,
  rankingPt: 1,
  myPlaylist: 2,
  artistRatingPer10: 1,
};

const ALL_SONGS = "data/ref/all-songs-no-inst.csv";
// Pre-aggregated Last.fm play counts (title, artist, scrobbles). Which CSV is chosen by the
// table-map ("title" profile by default → stripped titles, best for cross-artist matching).
// Regenerate the tables with: node scripts/lastfm-aggregate.mjs
const scrobblesTable = (opts = {}) => resolveTable("title-candidate-score", { fallback: "title", ...opts });

export function stripParens(s) {
  return s.replace(/\s*\(.*$/, "").replace(/\s+-\s+.*$/, "").trim();
}

function mergeEntry(existing, data) {
  return {
    ...existing,
    ...data,
    scrobbles: (existing.scrobbles || 0) + (data.scrobbles || 0),
    favPlaylists: Math.max(existing.favPlaylists || 0, data.favPlaylists || 0),
    rankingPts: Math.max(existing.rankingPts || 0, data.rankingPts || 0),
    artistRating: Math.max(existing.artistRating || 0, data.artistRating || 0),
    myPlaylists: Math.max(existing.myPlaylists || 0, data.myPlaylists || 0),
    inAllSongs: existing.inAllSongs || data.inAllSongs || false,
  };
}

function setScore(map, key, data) {
  if (!key) return;
  map.set(key, mergeEntry(map.get(key) || {}, data));
}

/** Build normalized-title → raw engagement fields from ref CSVs. */
export function buildTitleEngagementIndex({
  allSongsPath = ALL_SONGS,
  scrobblesPath = scrobblesTable(),
} = {}) {
  const scores = new Map();

  for (const row of parseCsv(allSongsPath)) {
    const title = (row[0] || "").trim();
    const key = norm(title);
    if (!key) continue;
    const data = {
      inAllSongs: true,
      favPlaylists: parseInt(row[21], 10) || 0,
      rankingPts: parseInt(row[24], 10) || 0,
      artistRating: parseInt(String(row[20] || "").replace("%", ""), 10) || 0,
      myPlaylists: parseInt(row[32], 10) || 0,
    };
    setScore(scores, key, data);
    setScore(scores, norm(stripParens(title)), data);
  }

  for (const row of parseCsv(scrobblesPath)) {
    const title = (row[0] || "").trim();
    const key = norm(title);
    if (!key) continue;
    const data = { scrobbles: parseInt(row[2], 10) || 0 };
    setScore(scores, key, data);
    setScore(scores, norm(stripParens(title)), data);
  }

  return scores;
}

export function lookupEngagement(index, title) {
  const key = norm(title);
  const shortKey = norm(stripParens(title));
  return index.get(key) || index.get(shortKey) || null;
}

/** Weighted total for ranking candidates (higher = more personal affinity). */
export function engagementScore(raw) {
  if (!raw) return 0;
  const w = ENGAGEMENT_WEIGHTS;
  const base = raw.inAllSongs ? w.inAllSongs : 0;
  return (
    base
    + (raw.scrobbles || 0) * w.scrobble
    + (raw.favPlaylists || 0) * w.favPlaylist
    + (raw.rankingPts || 0) * w.rankingPt
    + (raw.myPlaylists || 0) * w.myPlaylist
    + Math.round((raw.artistRating || 0) / 10) * w.artistRatingPer10
  );
}

export function scoreTitle(index, title) {
  const raw = lookupEngagement(index, title);
  return { raw, total: engagementScore(raw) };
}

export function scoreTitles(titles, index = buildTitleEngagementIndex()) {
  return titles.map((title) => ({ title, ...scoreTitle(index, title) }));
}

const isMain = process.argv[1]?.endsWith("title-candidate-score.mjs");
if (isMain) {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  let table, tableMap;
  const titles = [];
  for (let i = 0; i < argv.length; i++) {
    let n;
    if (argv[i] === "--json") continue;
    if ((n = matchFlag(argv, i, "table", (v) => { table = v; })) != null) { i = n; continue; }
    if ((n = matchFlag(argv, i, "table-map", (v) => { tableMap = v; })) != null) { i = n; continue; }
    titles.push(argv[i]);
  }
  if (!titles.length || titles.includes("--help") || titles.includes("-h")) {
    console.error(`Usage: node scripts/title-candidate-score.mjs [--json] [--table <profile|csv>] [--table-map <path>] "Title" ...`);
    process.exit(titles.length ? 0 : 1);
  }
  const index = buildTitleEngagementIndex({ scrobblesPath: scrobblesTable({ table, tableMap }) });
  const rows = scoreTitles(titles, index).sort((a, b) => b.total - a.total);
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    for (const { title, total, raw } of rows) {
      const r = raw || {};
      console.log([
        total,
        title,
        `scr:${r.scrobbles || 0}`,
        `fav:${r.favPlaylists || 0}`,
        `rk:${r.rankingPts || 0}`,
        `pl:${r.myPlaylists || 0}`,
      ].join("\t"));
    }
  }
}
