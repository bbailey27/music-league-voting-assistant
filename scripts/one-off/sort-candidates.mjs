#!/usr/bin/env node
// Sort candidates.md list entries within each tier by engagement score.
//
// Usage: node scripts/one-off/sort-candidates.mjs [path/to/candidates.md]
// Default: data/analysis/story-6/candidates.md

import fs from "node:fs";
import {
  buildTitleEngagementIndex,
  engagementScore,
  lookupEngagement,
} from "../title-candidate-score.mjs";

const CANDIDATES = process.argv[2] || "data/analysis/story-6/candidates.md";

const index = buildTitleEngagementIndex();

function scoreFor(title) {
  return engagementScore(lookupEngagement(index, title));
}

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
  const cleaned = line.replace(/\s+\[\d+\]$/, "");
  const m = cleaned.match(/^- (.+?)(?:\s+[—-]+\s+.+)?$/);
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
console.log(`Sorted ${CANDIDATES} by engagement scores.`);
