#!/usr/bin/env node
// Last.fm export (https://lastfm.ghan.nl/export/) scrobble-count aggregator — CLI.
//
// Reads a raw "Recent Tracks" scrobble export and writes pre-aggregated count files so
// other scripts can pull counts without re-reading the whole log. Runs from just this
// (parent) repo + a downloaded export — no data submodule needed.
//
// Usage:
//   node scripts/lastfm-aggregate.mjs [--input <export.csv>] [--rules <rules.json>]
//                                     [--outdir data/ref/lastfm] [--top 20]
//
// Writes (in --outdir):
//   tracks-variants.csv  mainArtist,title,album,language,remix,live,instrumental,collab,scrobbles
//                        (finest dimensioned base — every other track file rolls up from here)
//   tracks-affinity.csv  rank,mainArtist,title,scrobbles,variants   (fold everything)
//   tracks-versions.csv  rank,mainArtist,title,language,remix,scrobbles,variants (default)
//   tracks-pandora.csv   rank,mainArtist,title,language,remix,live,instrumental,scrobbles,variants
//   track-titles.csv     title,artist,scrobbles                     (cross-artist title search)
//   tracks-chart.csv     rank,artist,track,scrobbles                (Last.fm replica; raw)
//   tracks-literal.csv   artist,track,album,scrobbles               (rawest; no merging)
//   artists.csv          rank,artist,scrobbles                      (credits every listed artist)
//   _meta.json           provenance (source, date range, totals, rules, dimension coverage)

import fs from "node:fs";
import path from "node:path";
import { matchFlag } from "./cli-args.mjs";
import {
  DEFAULT_EXPORT, DEFAULT_RULES, COL,
  readScrobbles, aggregate, ranked,
  keyLiteral, keyChart,
  readVariants, rollup, rankVariants, artistRollup, PROFILES,
  loadRules, buildRuleIndex, toCsv,
} from "./lastfm-export.mjs";
import { parseCsv } from "./title-prefix-scan.mjs";

const HELP = `lastfm-aggregate — Last.fm export scrobble-count aggregator

WHAT IT DOES
  Reads a raw Last.fm "Recent Tracks" scrobble export (one row per play) and writes
  pre-aggregated count files so other scripts pull counts without re-reading the log.
  Runs from just this repo + a downloaded export (no data submodule needed).

GET AN EXPORT
  Download your scrobbles as CSV from  https://lastfm.ghan.nl/export/
  (choose "Recent Tracks"). Columns must be:
    uts,utc_time,artist,artist_mbid,album,album_mbid,track,track_mbid

USAGE
  node scripts/lastfm-aggregate.mjs [--input <export.csv>] [--rules <rules.json>]
                                    [--outdir <dir>] [--top <n>] [--help]

FLAGS
  --input <path>   Raw export CSV        (default: data/ref/Recent Tracks Mochiphoria.csv)
  --rules <path>   Custom merge rules    (default: data/ref/lastfm/merge-rules.json)
  --outdir <dir>   Where to write files  (default: data/ref/lastfm)
  --top <n>        Print chart top n to stderr for a sanity check (default: 20)

OUTPUT FILES (in --outdir)
  tracks-variants.csv  mainArtist,title,album,language,remix,live,instrumental,collab,scrobbles
                       finest dimensioned base — every track file below rolls up from it
  tracks-affinity.csv  rank,mainArtist,title,scrobbles,variants        fold everything
  tracks-versions.csv  rank,mainArtist,title,language,remix,…           personal default
  tracks-pandora.csv   rank,mainArtist,title,language,remix,live,inst,… split everything
  track-titles.csv     title,artist,scrobbles                          cross-artist title search
  tracks-chart.csv     rank,artist,track,scrobbles                     Last.fm replica (raw)
  tracks-literal.csv   artist,track,album,scrobbles                    rawest; no merging
  artists.csv          rank,artist,scrobbles                           credits every listed artist
  _meta.json           provenance (source, date range, totals, rules, dimension coverage)

GROUPING PROFILES (see spec/lastfm-data.md for the full guide)
  Version info (language/remix/live/instrumental) is auto-extracted from the title into
  COLUMNS. Profiles pick which columns form the grouping key:
    affinity  [mainArtist,title]                       fuzziest "how much do I like it"
    versions  [mainArtist,title,language,remix]         DEFAULT: split lang+remix+custom;
                                                        live/instrumental fold to nearest
    pandora   [+live,+instrumental]                     split everything (album-source parity)
    title     [title]                                   match a title across different artists
  chart/literal stay RAW (no dimensioning): chart is the Last.fm replica (album-merged, title
  case-insensitive, artist case-SENSITIVE, symbol/CJK titles INCLUDED — 놀리러 간다 is #313).
  mainArtist keys the personal profiles so "X feat. Y" still counts toward X; artists.csv
  credits every listed artist.

CUSTOM RULES  (--rules, default data/ref/lastfm/merge-rules.json)
  Version info normalizes in code, so rules are only for what code can't infer. Matches are
  EXACT and case-SENSITIVE.

    {
      "artistAliases": [ { "canonical": "EXO", "aliases": ["Exo (Alt Tag)"] } ],
      "titleAliases":  [ { "artist": "Some Artist", "canonical": "Song", "aliases": ["Song (Romanized)"] } ],
      "albumRules":    [ { "match": { "artist": "Exo", "album": "… (Live)" }, "set": { "live": "live" } } ],
      "overrides":     [
        { "match": { "artist": "Exo", "track": "으르렁 Growl", "album": "The 1st Album 'XOXO' (Repackage)" },
          "as": "Growl", "set": { "language": "Korean" } }
      ]
    }

  artistAliases  fold artist spelling variants into one canonical artist.
  titleAliases   fold title variants code can't (different script/romanization/wording).
  albumRules     set dimensions for EVERY track on an album (e.g. a live album → live).
  overrides      relabel one (artist,track,album) AND/OR set its dimensions (language/remix/
                 live/instrumental). Precedence: override.set > albumRules.set > auto-extract.
  You do NOT need rules for parens or language/version LABELS — those normalize in code.
  Rules apply to the dimensioned layers, NEVER to chart. Add rules interactively:
    node scripts/lastfm-add-rule.mjs
  Find candidates to add with:
    node scripts/lastfm-merge-candidates.mjs --reason artist
  Get exact album strings for an override from tracks-literal.csv.
`;

function parseArgs(argv) {
  const args = { input: DEFAULT_EXPORT, rules: DEFAULT_RULES, outdir: "data/ref/lastfm", top: 20 };
  for (let i = 0; i < argv.length; i++) {
    let n;
    if ((n = matchFlag(argv, i, "input", (v) => { args.input = v; })) != null) { i = n; continue; }
    if ((n = matchFlag(argv, i, "rules", (v) => { args.rules = v; })) != null) { i = n; continue; }
    if ((n = matchFlag(argv, i, "outdir", (v) => { args.outdir = v; })) != null) { i = n; continue; }
    if ((n = matchFlag(argv, i, "top", (v) => { args.top = parseInt(v, 10) || 20; })) != null) { i = n; continue; }
  }
  return args;
}

function dateRange(inputPath) {
  let min = Infinity, max = -Infinity, n = 0;
  for (const r of parseCsv(inputPath)) {
    const uts = parseInt(r[COL.uts], 10);
    if (!Number.isFinite(uts)) continue;
    n++;
    if (uts < min) min = uts;
    if (uts > max) max = uts;
  }
  const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10);
  return { first: Number.isFinite(min) ? iso(min) : null, last: Number.isFinite(max) ? iso(max) : null, dated: n };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) { process.stdout.write(HELP); return; }
  const args = parseArgs(argv);
  const rows = readScrobbles(args.input);
  const rules = loadRules(args.rules);
  const idx = buildRuleIndex(rules);

  // Raw layers (no dimensioning).
  const literal = ranked(aggregate(rows, keyLiteral));
  // Last.fm KEEPS symbol/CJK titles in the ranked chart and numbers through them
  // (confirmed: 놀리러 간다 / Speed is #313 on the site, matching its include-rank).
  const chart = ranked(aggregate(rows, keyChart));

  // Dimensioned base + profile rollups.
  const base = readVariants(args.input, idx);
  const affinity = rankVariants(rollup(base, PROFILES.affinity));
  const versions = rankVariants(rollup(base, PROFILES.versions));
  const pandora = rankVariants(rollup(base, PROFILES.pandora));
  const titles = rankVariants(rollup(base, PROFILES.title));
  const artists = artistRollup(base);

  fs.mkdirSync(args.outdir, { recursive: true });
  const p = (f) => path.join(args.outdir, f);

  // Base: finest granularity, sorted by plays then keys (no rank column — it's a lookup base).
  const baseSorted = [...base].sort(
    (a, b) => b.count - a.count
      || a.mainArtist.localeCompare(b.mainArtist)
      || a.title.localeCompare(b.title)
      || a.album.localeCompare(b.album),
  );
  fs.writeFileSync(p("tracks-variants.csv"), toCsv(
    ["mainArtist", "title", "album", "language", "remix", "live", "instrumental", "collab", "scrobbles"],
    baseSorted.map((r) => [r.mainArtist, r.title, r.album, r.language, r.remix, r.live, r.instrumental, r.collab, r.count]),
  ));
  fs.writeFileSync(p("tracks-affinity.csv"), toCsv(
    ["rank", "mainArtist", "title", "scrobbles", "variants"],
    affinity.map((r) => [r.rank, r.mainArtist, r.title, r.count, r.variantCount]),
  ));
  fs.writeFileSync(p("tracks-versions.csv"), toCsv(
    ["rank", "mainArtist", "title", "language", "remix", "scrobbles", "variants"],
    versions.map((r) => [r.rank, r.mainArtist, r.title, r.language, r.remix, r.count, r.variantCount]),
  ));
  fs.writeFileSync(p("tracks-pandora.csv"), toCsv(
    ["rank", "mainArtist", "title", "language", "remix", "live", "instrumental", "scrobbles", "variants"],
    pandora.map((r) => [r.rank, r.mainArtist, r.title, r.language, r.remix, r.live, r.instrumental, r.count, r.variantCount]),
  ));
  fs.writeFileSync(p("track-titles.csv"), toCsv(
    ["title", "artist", "scrobbles"],
    titles.map((r) => [r.title, r.mainArtist, r.count]),
  ));
  fs.writeFileSync(p("tracks-chart.csv"), toCsv(
    ["rank", "artist", "track", "scrobbles"],
    chart.map((r) => [r.rank, r.artist, r.track, r.count]),
  ));
  fs.writeFileSync(p("tracks-literal.csv"), toCsv(
    ["artist", "track", "album", "scrobbles"],
    [...literal].sort((a, b) => b.count - a.count || a.artist.localeCompare(b.artist)
      || a.track.localeCompare(b.track) || a.album.localeCompare(b.album))
      .map((r) => [r.artist, r.track, r.album, r.count]),
  ));
  fs.writeFileSync(p("artists.csv"), toCsv(
    ["rank", "artist", "scrobbles"],
    artists.map((r) => [r.rank, r.artist, r.count]),
  ));

  const dimCount = (k) => base.reduce((n, r) => n + (r[k] ? r.count : 0), 0);
  const range = dateRange(args.input);
  const meta = {
    source: path.basename(args.input),
    generatedAt: new Date().toISOString(),
    exportTool: "https://lastfm.ghan.nl/export/",
    scrobbles: rows.length,
    dateRange: range,
    unique: {
      literal: literal.length, chart: chart.length, variants: base.length,
      affinity: affinity.length, versions: versions.length, pandora: pandora.length,
      titles: titles.length, artists: artists.length,
    },
    dimensionScrobbles: {
      language: dimCount("language"), remix: dimCount("remix"),
      live: dimCount("live"), instrumental: dimCount("instrumental"), collab: dimCount("collab"),
    },
    rules: {
      file: path.basename(args.rules),
      artistAliases: rules.artistAliases.length,
      titleAliases: rules.titleAliases.length,
      overrides: rules.overrides.length,
      albumRules: rules.albumRules.length,
    },
    policy: "version info lives in columns, not the title; titles case-insensitive; artists "
      + "case-sensitive; accents never stripped; chart is a raw Last.fm replica (no dimensioning)",
  };
  fs.writeFileSync(p("_meta.json"), JSON.stringify(meta, null, 2) + "\n");

  // ---- validation stats to stderr ----
  console.error(`# lastfm-aggregate — ${rows.length} scrobbles, ${range.first}…${range.last}`);
  console.error(`  variants (dimensioned base): ${base.length}`);
  console.error(`  affinity / versions / pandora: ${affinity.length} / ${versions.length} / ${pandora.length}`);
  console.error(`  titles / artists: ${titles.length} / ${artists.length}`);
  console.error(`  chart (LFM replica) / literal: ${chart.length} / ${literal.length}`);
  console.error(`  rules: ${meta.rules.artistAliases} artist / ${meta.rules.titleAliases} title / ${meta.rules.overrides} override / ${meta.rules.albumRules} album`);
  console.error(`  wrote -> ${args.outdir}/{tracks-variants,affinity,versions,pandora,chart,literal,track-titles,artists}.csv, _meta.json\n`);
  console.error(`## chart top ${args.top}`);
  for (const r of chart.slice(0, args.top)) {
    console.error(`${String(r.rank).padStart(4)}  ${String(r.count).padStart(3)}x  ${r.track} — ${r.artist}`);
  }
}

main();
