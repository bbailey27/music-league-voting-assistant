#!/usr/bin/env node
// Scan song CSVs for titles whose normalized text matches anchored prefix patterns.
//
// Usage: node scripts/title-prefix-scan.mjs <prefix> [<prefix> ...] [--out <path>]
//
// Loads data/ref/fav-songs.csv, chill-minor-rock-etc-search.csv, all-songs-no-inst.csv,
// and lastfm/track-titles.csv (col0 = title, col1 = artist). Dedups by normalized title.
// Regenerate track-titles.csv with: node scripts/lastfm-aggregate.mjs
// Each prefix becomes a start-anchored regex (see prefixRegex). Writes the grouped
// report to --out or stdout; prints a count summary to stderr when --out is a file.

import fs from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { matchFlag } from "./cli-args.mjs";
// NOTE: lastfm-export.mjs imports parseCsv from here. resolveTable is only used inside
// functions (never at module top level), so the circular import is safe.
import { resolveTable } from "./lastfm-export.mjs";

/** Hand-maintained song CSVs (title = col0, artist = col1). */
const REF_CSV_FILES = [
  "data/ref/fav-songs.csv",
  "data/ref/chill-minor-rock-etc-search.csv",
  "data/ref/all-songs-no-inst.csv",
];

/** The Last.fm title table is chosen by the table-map ("title" profile by default). */
export function songCsvFiles(opts = {}) {
  return [...REF_CSV_FILES, resolveTable("title-prefix-scan", { fallback: "title", ...opts })];
}

/** Standard song CSVs: title = col0, artist = col1 in every file. */
export const SONG_CSV_FILES = [...REF_CSV_FILES, "data/ref/lastfm/track-titles.csv"];

export function norm(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCsv(file) {
  let t = fs.readFileSync(file, "utf8");
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); // strip BOM
  const lines = t.split(/\r?\n/).filter(Boolean);
  function row(line) {
    const o = [];
    let c = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { q = !q; continue; }
      if (ch === "," && !q) { o.push(c); c = ""; continue; }
      c += ch;
    }
    o.push(c);
    return o;
  }
  return lines.slice(1).map(row);
}

/** Load and dedup titles from the given CSV paths. */
export function loadTitles(files = SONG_CSV_FILES) {
  const byTitle = new Map();
  let rawRows = 0;
  for (const f of files) {
    for (const r of parseCsv(f)) {
      const title = (r[0] || "").trim();
      const artist = (r[1] || "").trim();
      if (!title) continue;
      rawRows++;
      const k = norm(title);
      if (!k) continue;
      if (!byTitle.has(k)) byTitle.set(k, { title, artists: new Set() });
      if (artist) byTitle.get(k).artists.add(artist);
    }
  }
  return { rawRows, uniq: [...byTitle.values()] };
}

const CONNECTOR_WORDS = new Set([
  "to", "in", "he", "she", "we", "and", "for", "my", "her", "one", "all", "that", "now",
]);

function escapeWord(word) {
  return word
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/'/g, "'?");
}

/**
 * Build a start-anchored regex for a CLI prefix string.
 * Short connectors require a following space so "together" does not match "to".
 */
export function prefixRegex(prefix) {
  const n = norm(prefix);
  if (!n) return null;
  const parts = n.split(" ").map(escapeWord);
  const body = parts.join(" ");
  if (parts.length > 1) return new RegExp(`^${body}\\b`);
  if (n.length <= 3 || CONNECTOR_WORDS.has(n)) return new RegExp(`^${body} `);
  return new RegExp(`^${body}\\b`);
}

/** Map prefix keys to regexes; missing keys are skipped in output with a note. */
export function groupsFromPrefixes(prefixes) {
  const groups = {};
  for (const p of prefixes) {
    groups[p] = prefixRegex(p);
  }
  return groups;
}

export function matchesForGroup(uniq, rx) {
  return uniq.filter((s) => rx.test(norm(s.title)));
}

export function formatReport({ rawRows, uniq, groups, keys }) {
  let out = `# title-prefix-scan — ${rawRows} raw rows, ${uniq.length} unique titles\n`;
  for (const key of keys) {
    const rx = groups[key];
    if (!rx) {
      out += `\n(no group "${key}")\n`;
      continue;
    }
    const list = matchesForGroup(uniq, rx);
    list.sort((a, b) => a.title.localeCompare(b.title));
    out += `\n=== "${key}..." (${list.length} unique titles) ===\n`;
    for (const s of list) {
      const arts = [...s.artists];
      const tag = arts.length
        ? ` — ${arts.slice(0, 2).join(", ")}${arts.length > 2 ? ` +${arts.length - 2}` : ""}`
        : "";
      out += `${s.title}${tag}\n`;
    }
  }
  return out;
}

export function countSummary({ uniq, groups, keys }) {
  const lines = [];
  for (const key of keys) {
    const rx = groups[key];
    if (!rx) continue;
    lines.push(`  ${key}: ${matchesForGroup(uniq, rx).length}`);
  }
  return lines;
}

export function runScan({ prefixes, groups, keys, outPath, files = SONG_CSV_FILES }) {
  const resolvedGroups = groups ?? groupsFromPrefixes(prefixes ?? []);
  const resolvedKeys = keys ?? prefixes ?? Object.keys(resolvedGroups);
  const { rawRows, uniq } = loadTitles(files);
  const report = formatReport({ rawRows, uniq, groups: resolvedGroups, keys: resolvedKeys });
  const summary = [
    `raw rows: ${rawRows}, unique titles: ${uniq.length}`,
    ...countSummary({ uniq, groups: resolvedGroups, keys: resolvedKeys }),
  ];

  const toStdout = !outPath || outPath === "-" || outPath === "/dev/stdout";

  if (toStdout) {
    process.stdout.write(report);
    console.error(summary.join("\n"));
    return { rawRows, uniq, report, outPath: null };
  }

  fs.mkdirSync(dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, report);
  console.log(summary.join("\n"));
  console.log(`\nfull list -> ${outPath}`);
  return { rawRows, uniq, report, outPath };
}

function parseArgs(argv) {
  const args = { prefixes: [], out: null, table: undefined, tableMap: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    let n;
    if ((n = matchFlag(argv, i, "out", (v) => { args.out = v; })) != null) { i = n; continue; }
    if ((n = matchFlag(argv, i, "table", (v) => { args.table = v; })) != null) { i = n; continue; }
    if ((n = matchFlag(argv, i, "table-map", (v) => { args.tableMap = v; })) != null) { i = n; continue; }
    if (!a.startsWith("--")) args.prefixes.push(a);
  }
  return args;
}

function main() {
  const { prefixes, out, table, tableMap } = parseArgs(process.argv.slice(2));
  if (!prefixes.length) {
    console.error("Usage: node scripts/title-prefix-scan.mjs <prefix> [<prefix> ...] [--out <path>] [--table <profile|csv>] [--table-map <path>]");
    process.exit(1);
  }
  runScan({ prefixes, outPath: out ?? null, files: songCsvFiles({ table, tableMap }) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
