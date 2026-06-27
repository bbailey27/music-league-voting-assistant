#!/usr/bin/env node
// Sort candidates.md entries within each tier by engagement data from CSVs.
// Scoring: scrobble count + favorite playlist count + ranking game points (all normalized).

import fs from "node:fs";
import { parseCsv, norm } from "../title-prefix-scan.mjs";

const CANDIDATES = "data/analysis/story-6/candidates.md";

// Build lookup: normalized title → scores
const scores = new Map();

// Build lookup: normalized title → scores
// Index both full title and title-without-parentheticals so candidates with
// stripped suffixes still match.
function stripParens(s) {
  return s.replace(/\s*\(.*$/, "").replace(/\s+-\s+.*$/, "").trim();
}

function setScore(key, data) {
  const existing = scores.get(key) || {};
  scores.set(key, {
    ...existing,
    ...data,
    scrobbles: (existing.scrobbles || 0) + (data.scrobbles || 0),
    favPlaylists: Math.max(existing.favPlaylists || 0, data.favPlaylists || 0),
    rankingPts: Math.max(existing.rankingPts || 0, data.rankingPts || 0),
    artistRating: Math.max(existing.artistRating || 0, data.artistRating || 0),
    myPlaylists: Math.max(existing.myPlaylists || 0, data.myPlaylists || 0),
  });
}

// All-songs first: presence here = thumbed up on Pandora = baseline affinity.
for (const row of parseCsv("data/ref/all-songs-no-inst.csv")) {
  const title = (row[0] || "").trim();
  const key = norm(title);
  if (!key) continue;
  const favPlaylists = parseInt(row[21], 10) || 0;
  const rankingPts = parseInt(row[24], 10) || 0;
  const artistRating = parseInt((row[20] || "").replace("%", ""), 10) || 0;
  const myPlaylists = parseInt(row[32], 10) || 0;
  const data = { inAllSongs: true, favPlaylists, rankingPts, artistRating, myPlaylists };
  setScore(key, data);
  const shortKey = norm(stripParens(title));
  if (shortKey && shortKey !== key) setScore(shortKey, data);
}

// Scrobbles: sum scrobble counts per normalized title
for (const row of parseCsv("data/ref/all-scrobbles.csv")) {
  const title = (row[0] || "").trim();
  const key = norm(title);
  if (!key) continue;
  const count = parseInt(row[4], 10) || 0;
  setScore(key, { scrobbles: count });
  const shortKey = norm(stripParens(title));
  if (shortKey && shortKey !== key) setScore(shortKey, { scrobbles: count });
}

function scoreFor(title) {
  const key = norm(title);
  const s = scores.get(key);
  if (!s) return 0;
  const base = s.inAllSongs ? 10 : 0;
  return base
    + (s.scrobbles || 0) * 2
    + (s.favPlaylists || 0) * 5
    + (s.rankingPts || 0)
    + (s.myPlaylists || 0) * 2
    + Math.round((s.artistRating || 0) / 10);
}

// Parse candidates.md: preserve structure, sort entries within tiers
const text = fs.readFileSync(CANDIDATES, "utf8");
const lines = text.split("\n");
const output = [];
let bucket = [];

function flushBucket() {
  if (!bucket.length) return;
  bucket.sort((a, b) => b.score - a.score);
  for (const entry of bucket) {
    const scoreSuffix = entry.score > 0 ? `  [${entry.score}]` : "";
    output.push(`${entry.line}${scoreSuffix}`);
  }
  bucket = [];
}

for (const line of lines) {
  // Strip old score brackets before processing
  const cleaned = line.replace(/\s+\[\d+\]$/, "");
  // Handle both " — " (em-dash) and " - " (hyphen) as title/artist separators
  const m = cleaned.match(/^- (.+?)(?:\s+[—\-]+\s+.+)?$/);
  if (m) {
    const rawTitle = m[1].replace(/\?$/, "");
    const shortTitle = rawTitle.replace(/ \(.*$/, "");
    bucket.push({ line: cleaned, score: scoreFor(rawTitle) || scoreFor(shortTitle) });
  } else {
    flushBucket();
    output.push(cleaned);
  }
}
flushBucket();

fs.writeFileSync(CANDIDATES, output.join("\n"));
console.log("Sorted candidates.md by engagement scores.");

// Show score breakdown for top entries
const allEntries = [];
for (const line of lines) {
  const cleaned = line.replace(/\s+\[\d+\]$/, "");
  const m = cleaned.match(/^- (.+?)(?:\s+[—\-]+\s+.+)?$/);
  if (m) {
    const rawTitle = m[1].replace(/\?$/, "");
    const shortTitle = rawTitle.replace(/ \(.*$/, "");
    const key = norm(rawTitle) || norm(shortTitle);
    const s = scores.get(key) || {};
    const total = scoreFor(rawTitle) || scoreFor(shortTitle);
    if (total > 0) {
      allEntries.push({ title: m[1], ...s, total });
    }
  }
}
allEntries.sort((a, b) => b.total - a.total);
console.log("\nTop scored candidates:");
for (const e of allEntries.slice(0, 15)) {
  console.log(`  ${e.total} — ${e.title}  (scr:${e.scrobbles||0} fav:${e.favPlaylists||0} rk:${e.rankingPts||0} pl:${e.myPlaylists||0})`);
}
