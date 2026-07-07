#!/usr/bin/env node
// Last.fm export (https://lastfm.ghan.nl/export/) merge-candidate detector.
//
// Last.fm splits scrobbles by raw (artist, track) string. Different tools/tags spell the
// same song differently — feat. in the title vs the artist field, punctuation drift, case,
// accents — so one song ends up as several rows you'd want to merge with a Last.fm merge
// rule (or in your Airtable tagging). This flags those clusters. It NEVER auto-merges;
// it's a review list you act on manually.
//
// Clusters distinct (artist, track) identities by a fuzzy key (PRIMARY artist + title,
// with feat/parentheticals/case/accents folded), then reports clusters with >1 identity,
// tagged by WHY they're fuzzy so you can trust the safe ones and scrutinize the rest.
//
// Usage:
//   node scripts/lastfm-merge-candidates.mjs [--input <export.csv>]
//        [--min <combinedPlays>] [--limit <clusters>] [--reason case|accent|artist|naming]
//        [--out <path>]

import fs from "node:fs";
import { dirname } from "node:path";
import { matchFlag } from "./cli-args.mjs";
import { readScrobbles, aggregate, fuzzyKey, normTitle, parseVariant } from "./lastfm-export.mjs";

const HELP = `lastfm-merge-candidates — flag Last.fm tracks that are probably the same song

WHAT IT DOES
  Last.fm splits scrobbles by raw (artist, track) string, so one song ends up as several
  rows (feat. in the title vs the artist field, punctuation/case/accent drift). This
  clusters those and lists the ones worth merging. It NEVER edits anything — the output
  is a review list you act on by adding rules to data/ref/lastfm/merge-rules.json (see
  \`node scripts/lastfm-aggregate.mjs --help\`) or your Airtable tagging.

USAGE
  node scripts/lastfm-merge-candidates.mjs [--input <export.csv>] [--min <n>] [--limit <n>]
       [--reason case|accent|parens|label|artist|language|instrumental] [--fuzzy]
       [--inst-min <n>] [--out <path>] [--help]

FLAGS
  --input <path>   Raw export CSV (default: data/ref/Recent Tracks Mochiphoria.csv)
  --min <n>        Only clusters with >= n combined plays (default: 2)
  --limit <n>      Max clusters to show (default: 80)
  --reason <tag>   Only clusters carrying this flag (see below)
  --fuzzy          Also group remix/version FAMILIES (drops all parentheticals). Default
                   groups only what our normalization treats as one song.
  --inst-min <n>   Min plays to list an instrumental (default: 5)
  --out <path>     Write report to a file instead of stdout

FLAGS ON EACH CLUSTER
  case    variants differ only by capitalization
  accent  variants differ only by accents
  parens  same words, different () or [] — parenthesization is never a real difference
  label   language/version label form differs (Eng Ver = English Version = English)
  artist  the ARTIST field differs (feat in artist, &/,-collab spelling) — often safe
  language  the cluster mixes detected languages (the XOXO trap) — check before merging
  naming  (only with --fuzzy) the title text genuinely differs (remix/version family)

  Plus a trailing [instrumental] section: instrumentals with >= --inst-min plays, which are
  usually a mis-scrobble to fold into the vocal track.

  Default clustering already folds parens + language labels (chart ranking never does),
  so this report IS your "fix these on Last.fm" list.

TYPICAL WORKFLOW
  node scripts/lastfm-merge-candidates.mjs --reason artist --out data/analysis/merge-artist.txt
  node scripts/lastfm-add-rule.mjs      # interactively add merge rules, then:
  node scripts/lastfm-aggregate.mjs     # regenerate the pre-aggregated files
`;

const lc = (s) => (s || "").toLocaleLowerCase();
const collapse = (s) => (s || "").replace(/\s+/g, " ").trim();
const deaccent = (s) => (s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
const stripFeat = (s) => (s || "").replace(/\s*[([]?\s*(feat\.?|ft\.?|featuring|with)\b.*$/i, "");
/** Lead artist only: drop feat credits, then cut at the first &/,/ x collaborator. */
const primaryArtist = (s) => stripFeat(s).split(/\s*[&,]\s*|\s+[xX]\s+/)[0].trim();
const artistFold = (s) => fuzzyKey(primaryArtist(s)) || collapse(deaccent(lc(primaryArtist(s)))).replace(/\s+/g, "");

/**
 * Cluster key. Default groups by the `merged` normalized title (parens + language/version
 * labels folded, remix/version words kept) so it flags exactly what our normalization
 * treats as one song but Last.fm splits. `--fuzzy` drops ALL parentheticals to also group
 * remix/version families together for a coarser review.
 */
function clusterKey(e, fuzzy) {
  const a = artistFold(e.artist);
  const t = fuzzy ? fuzzyKey(e.track) : deaccent(normTitle(e.track));
  return a && t ? `${a}\u0000${t}` : null;
}

// Layered title keys, coarsest-collapsing last, to name the tightest reason.
const kCase = (t) => lc(t);
const kAccent = (t) => deaccent(lc(t));
const kParens = (t) => collapse(deaccent(lc(t)).replace(/[()[\]]/g, " "));
const kNorm = (t) => deaccent(normTitle(t));

/** Tags describing why the identities in a cluster differ. */
function reasons(members) {
  const tracks = members.map((m) => m.track);
  const artists = members.map((m) => m.artist);
  const size = (xs) => new Set(xs).size;
  const flags = [];
  if (size(tracks) > 1) {
    if (size(tracks.map(kCase)) === 1) flags.push("case");
    else if (size(tracks.map(kAccent)) === 1) flags.push("accent");
    else if (size(tracks.map(kParens)) === 1) flags.push("parens");
    else if (size(tracks.map(kNorm)) === 1) flags.push("label");
    else flags.push("naming");
  }
  if (size(artists) > 1) flags.push("artist");
  const langs = new Set(tracks.map((t) => parseVariant(t).language).filter(Boolean));
  if (langs.size > 1) flags.push("language");
  return flags.length ? flags : ["merge"];
}

function parseArgs(argv) {
  const args = { input: undefined, min: 2, limit: 80, reason: null, out: null, fuzzy: false, instMin: 5 };
  for (let i = 0; i < argv.length; i++) {
    let n;
    if (argv[i] === "--fuzzy") { args.fuzzy = true; continue; }
    if ((n = matchFlag(argv, i, "input", (v) => { args.input = v; })) != null) { i = n; continue; }
    if ((n = matchFlag(argv, i, "min", (v) => { args.min = parseInt(v, 10) || 2; })) != null) { i = n; continue; }
    if ((n = matchFlag(argv, i, "limit", (v) => { args.limit = parseInt(v, 10) || 80; })) != null) { i = n; continue; }
    if ((n = matchFlag(argv, i, "reason", (v) => { args.reason = v; })) != null) { i = n; continue; }
    if ((n = matchFlag(argv, i, "inst-min", (v) => { args.instMin = parseInt(v, 10) || 5; })) != null) { i = n; continue; }
    if ((n = matchFlag(argv, i, "out", (v) => { args.out = v; })) != null) { i = n; continue; }
  }
  return args;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) { process.stdout.write(HELP); return; }
  const args = parseArgs(argv);
  const rows = readScrobbles(args.input);
  // One identity per (artist, track); album is ignored (Last.fm merges albums already).
  const byAT = aggregate(rows, (r) => `${r.artist}\u0000${r.track}`);

  const clusters = new Map();
  for (const e of byAT.values()) {
    const ck = clusterKey(e, args.fuzzy);
    if (!ck) continue;
    if (!clusters.has(ck)) clusters.set(ck, []);
    clusters.get(ck).push(e);
  }

  let candidates = [];
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const total = members.reduce((s, m) => s + m.count, 0);
    if (total < args.min) continue;
    const flags = reasons(members);
    if (args.reason && !flags.includes(args.reason)) continue;
    members.sort((a, b) => b.count - a.count);
    candidates.push({ total, flags, members });
  }
  candidates.sort((a, b) => b.total - a.total || b.members.length - a.members.length);

  const shown = candidates.slice(0, args.limit);
  const lines = [];
  lines.push(`# lastfm-merge-candidates — ${candidates.length} clusters (${rows.length} scrobbles)${args.fuzzy ? " [--fuzzy]" : ""}`);
  lines.push(`# flags: case  accent  parens(same words, different ()[])  label(Eng Ver=English Version=English)  artist(field differs)  language(mixed langs)${args.fuzzy ? "  naming(remix/version family)" : ""}  + trailing [instrumental] section`);
  lines.push(`# these are things to fix on Last.fm (its raw strings) — never auto-merged. Add rules: node scripts/lastfm-add-rule.mjs`);
  for (const c of shown) {
    lines.push("");
    lines.push(`[${c.flags.join(",") || "?"}]  ${c.total}x combined  (${c.members.length} variants)`);
    for (const m of c.members) {
      lines.push(`    ${String(m.count).padStart(4)}x  ${m.track}  —  ${m.artist}`);
    }
  }

  // Instrumentals with real play counts — likely a mis-scrobble to fold into the main track.
  if (!args.reason || args.reason === "instrumental") {
    const instr = [...byAT.values()]
      .filter((e) => parseVariant(e.track).instrumental && e.count >= args.instMin)
      .sort((a, b) => b.count - a.count);
    if (instr.length) {
      lines.push("");
      lines.push(`# [instrumental] ${instr.length} instrumental(s) with >= ${args.instMin} plays — consider folding into the vocal track`);
      for (const e of instr) lines.push(`    ${String(e.count).padStart(4)}x  ${e.track}  —  ${e.artist}`);
    }
  }
  const report = lines.join("\n") + "\n";

  if (args.out && args.out !== "-") {
    fs.mkdirSync(dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, report);
    console.error(`${candidates.length} clusters (showing ${shown.length}) -> ${args.out}`);
  } else {
    process.stdout.write(report);
    console.error(`\n${candidates.length} clusters total; showing ${shown.length} (--limit, --min, --reason to filter).`);
  }
}

main();
