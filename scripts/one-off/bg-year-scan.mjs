#!/usr/bin/env node
// One-off: scan the Airtable export (data/ref/all-songs-no-inst.csv) for K-pop songs
// by "Release Year", surfacing the columns that decide which *version* of a recording
// a date belongs to (Album, Single, Remix/Alt Version, Cover, Featured/Remix Artists).
//
// Purpose: seed the "Kpop Boy Group Years" submission research for a target year. The
// Airtable Release Year is only a HINT (often an album/library-tag year); the earliest
// official release of the specific recording still has to be web-verified.
//
// Usage:
//   node scripts/one-off/bg-year-scan.mjs [--year N] [--blank] [--all] [--out <path>]
//     --year N   only rows whose Release Year == N (repeatable, comma-ok). Default: list all years.
//     --blank    also include K-pop rows with an empty Release Year
//     --all      include non-K-pop rows too (default: K-Pop truthy only)
//     --out P    write full report to P (else stdout)

import fs from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const CSV = "data/ref/all-songs-no-inst.csv";

function parseCsvWithHeader(file) {
  let t = fs.readFileSync(file, "utf8");
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  // Full CSV parse that respects quotes spanning commas AND newlines.
  const rows = [];
  let field = "";
  let row = [];
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') {
        if (t[i + 1] === '"') { field += '"'; i++; }
        else q = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { q = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (ch === "\r") continue;
    field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  return { rows, idx };
}

function truthy(v) {
  const s = (v || "").trim().toLowerCase();
  return s === "true" || s === "yes" || s === "checked" || s === "1" || s === "x" || s === "kpop" || s === "k-pop";
}

function parseArgs(argv) {
  const args = { years: [], blank: false, all: false, out: null, artists: false, artist: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--blank") { args.blank = true; continue; }
    if (a === "--all") { args.all = true; continue; }
    if (a === "--artists") { args.artists = true; continue; }
    if (a === "--dump") { args.dump = true; continue; }
    if (a === "--artist") { args.artist = (argv[++i] || "").toLowerCase(); continue; }
    if (a === "--year") { for (const y of (argv[++i] || "").split(",")) if (y.trim()) args.years.push(y.trim()); continue; }
    if (a === "--out") { args.out = argv[++i]; continue; }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { rows, idx } = parseCsvWithHeader(CSV);
  const col = (r, name) => (r[idx[name]] ?? "").trim();

  const isKpop = (r) => truthy(col(r, "K-Pop")) || truthy(col(r, "K-Pop (Auto/Agg)"));
  let pool = args.all ? rows : rows.filter(isKpop);

  // --artists: distinct artists (by Artist Record) with song counts, sorted desc
  if (args.artists) {
    const counts = new Map();
    for (const r of pool) {
      const a = col(r, "Artist Record") || col(r, "Artist name");
      counts.set(a, (counts.get(a) || 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    let out = `# bg-year-scan artists — ${sorted.length} distinct K-pop artists (${pool.length} rows)\n`;
    for (const [a, c] of sorted) out += `${String(c).padStart(4)}  ${a}\n`;
    if (args.out) { fs.mkdirSync(dirname(args.out), { recursive: true }); fs.writeFileSync(args.out, out); console.log(`-> ${args.out}`); }
    else process.stdout.write(out);
    return;
  }

  // --dump: every K-pop row as Artist | Year | Title | Album | Single | Remix/Alt | Cover
  if (args.dump) {
    pool.sort((a, b) =>
      (col(a, "Artist Record") || col(a, "Artist name")).localeCompare(col(b, "Artist Record") || col(b, "Artist name")) ||
      (col(a, "Albums")).localeCompare(col(b, "Albums")) ||
      col(a, "Track name").localeCompare(col(b, "Track name")));
    let out = `# bg-year-scan dump — ${pool.length} K-pop rows\n# Artist | Year | Title | Album | Single | Remix/Alt | Cover | Feat/Remix\n`;
    for (const r of pool) {
      out += [
        col(r, "Artist Record") || col(r, "Artist name"),
        col(r, "Release Year") || "----",
        col(r, "Track name"),
        col(r, "Albums"),
        col(r, "Single"),
        col(r, "Remix / Alt Version"),
        col(r, "Cover"),
        col(r, "Featured/Remix Artists"),
      ].join(" | ") + "\n";
    }
    if (args.out) { fs.mkdirSync(dirname(args.out), { recursive: true }); fs.writeFileSync(args.out, out); console.log(`-> ${args.out} (${pool.length} rows)`); }
    else process.stdout.write(out);
    return;
  }

  // --artist NAME: all rows for one artist (any year), with year + version columns
  if (args.artist) {
    const list = pool.filter((r) => (col(r, "Artist Record") + " " + col(r, "Artist name")).toLowerCase().includes(args.artist));
    list.sort((a, b) => (col(a, "Release Year") || "zzz").localeCompare(col(b, "Release Year") || "zzz") || col(a, "Track name").localeCompare(col(b, "Track name")));
    let out = `# bg-year-scan artist "${args.artist}" — ${list.length} rows\n# Year | Title | Artist | Album | Single | Remix/Alt | Cover | Feat/Remix\n`;
    for (const r of list) {
      out += [col(r, "Release Year") || "----", col(r, "Track name"), col(r, "Artist name"), col(r, "Albums"), col(r, "Single"), col(r, "Remix / Alt Version"), col(r, "Cover"), col(r, "Featured/Remix Artists")].join(" | ") + "\n";
    }
    if (args.out) { fs.mkdirSync(dirname(args.out), { recursive: true }); fs.writeFileSync(args.out, out); console.log(`-> ${args.out}`); }
    else process.stdout.write(out);
    return;
  }

  // Group by Release Year
  const byYear = new Map();
  for (const r of pool) {
    const y = col(r, "Release Year") || "(blank)";
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(r);
  }

  const wantYear = (y) => {
    if (args.years.length === 0) return true;
    if (args.years.includes(y)) return true;
    if (y === "(blank)" && args.blank) return true;
    return false;
  };

  let out = `# bg-year-scan — ${pool.length} K-pop rows (of ${rows.length} total)\n`;
  out += `# columns: Title | Artist | Artist Record | Album | Single | Remix/Alt | Cover | Feat/Remix Artists\n`;

  const years = [...byYear.keys()].sort();
  const summary = [];
  for (const y of years) {
    const list = byYear.get(y);
    summary.push(`  ${y}: ${list.length}`);
    if (!wantYear(y)) continue;
    list.sort((a, b) => col(a, "Artist name").localeCompare(col(b, "Artist name")) || col(a, "Track name").localeCompare(col(b, "Track name")));
    out += `\n=== Release Year ${y} (${list.length}) ===\n`;
    for (const r of list) {
      const bits = [
        col(r, "Track name"),
        col(r, "Artist name"),
        col(r, "Artist Record"),
        col(r, "Albums"),
        col(r, "Single"),
        col(r, "Remix / Alt Version"),
        col(r, "Cover"),
        col(r, "Featured/Remix Artists"),
      ];
      out += bits.join(" | ") + "\n";
    }
  }

  out += `\n# year counts:\n` + summary.join("\n") + "\n";

  if (!args.out) {
    process.stdout.write(out);
  } else {
    fs.mkdirSync(dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, out);
    console.log(summary.join("\n"));
    console.log(`\nfull report -> ${args.out}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
