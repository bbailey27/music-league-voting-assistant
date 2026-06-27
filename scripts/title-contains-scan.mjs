#!/usr/bin/env node
// Scan song CSVs for titles matching a word by position in the normalized title.
//
// Usage: node scripts/title-contains-scan.mjs [--suffix] <word> [<word> ...] [--out <path>]
//
// Default (contains): each word is matched as a whole word (\b-bounded) anywhere.
// --suffix:           each word must appear as the LAST word(s) of the title.
//
// Reuses loadTitles/norm from title-prefix-scan.mjs.

import fs from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { matchFlag } from "./cli-args.mjs";
import { loadTitles, norm, SONG_CSV_FILES } from "./title-prefix-scan.mjs";

function buildRegex(word, mode) {
  const n = norm(word);
  if (!n) return null;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "'?");
  if (mode === "suffix") return new RegExp(`\\b${escaped}$`);
  return new RegExp(`\\b${escaped}\\b`);
}

function run({ words, outPath, mode }) {
  const label = mode === "suffix" ? "title-suffix-scan" : "title-contains-scan";
  const verb = mode === "suffix" ? "ends with" : "contains";
  const { rawRows, uniq } = loadTitles(SONG_CSV_FILES);
  let out = `# ${label} — ${rawRows} raw rows, ${uniq.length} unique titles\n`;
  const summary = [`raw rows: ${rawRows}, unique titles: ${uniq.length}`];

  for (const w of words) {
    const rx = buildRegex(w, mode);
    if (!rx) continue;
    const hits = uniq.filter((s) => rx.test(norm(s.title)));
    hits.sort((a, b) => a.title.localeCompare(b.title));
    out += `\n=== ${verb} "${w}" (${hits.length} unique titles) ===\n`;
    for (const s of hits) {
      const arts = [...s.artists];
      const tag = arts.length
        ? ` — ${arts.slice(0, 2).join(", ")}${arts.length > 2 ? ` +${arts.length - 2}` : ""}`
        : "";
      out += `${s.title}${tag}\n`;
    }
    summary.push(`  ${w}: ${hits.length}`);
  }

  const toStdout = !outPath || outPath === "-" || outPath === "/dev/stdout";
  if (toStdout) {
    process.stdout.write(out);
    console.error(summary.join("\n"));
  } else {
    fs.mkdirSync(dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, out);
    console.log(summary.join("\n"));
    console.log(`\nfull list -> ${outPath}`);
  }
}

function parseArgs(argv) {
  const args = { words: [], out: null, mode: "contains" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--suffix") { args.mode = "suffix"; continue; }
    const next = matchFlag(argv, i, "out", (v) => { args.out = v; });
    if (next != null) { i = next; continue; }
    if (!argv[i].startsWith("--")) args.words.push(argv[i]);
  }
  return args;
}

function main() {
  const { words, out, mode } = parseArgs(process.argv.slice(2));
  if (!words.length) {
    console.error("Usage: node scripts/title-contains-scan.mjs [--suffix] <word> [<word> ...] [--out <path>]");
    process.exit(1);
  }
  run({ words, outPath: out ?? null, mode });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
