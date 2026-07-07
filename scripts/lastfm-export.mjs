#!/usr/bin/env node
// Last.fm export (https://lastfm.ghan.nl/export/) scrobble-count aggregator — shared lib.
//
// Input: a raw scrobble-log CSV exported from https://lastfm.ghan.nl/export/
// ("Recent Tracks"). ONE ROW PER SCROBBLE. Columns:
//   0 uts | 1 utc_time | 2 artist | 3 artist_mbid | 4 album | 5 album_mbid
//   6 track | 7 track_mbid
//
// This module holds the parsing, normalization, custom-rule application, and grouping
// used by lastfm-aggregate.mjs, lastfm-merge-candidates.mjs, and the one-off ranking
// scripts, so there is a single source of truth for "how tracks are counted".
//
// Two families of grouping:
//   Raw layers (aggregate()):
//     literal — (artist, track, album) exact strings, no merging.
//     chart   — Last.fm replica: (artist, track), album-merged, title case-insensitive,
//               artist case-SENSITIVE, symbol/CJK titles INCLUDED.
//   Dimensioned layers (readVariants() + rollup()):
//     Each scrobble is split into a stripped base `title` plus variant columns
//     (language, remix, live, instrumental) and artist columns (mainArtist, artists[],
//     collab). Profiles pick which columns form the grouping key:
//       affinity  [mainArtist,title]                      — fold everything (popularity)
//       title     [title]                                 — cross-artist title matching
//       versions  [mainArtist,title,language,remix]       — split lang/remix/custom; fold live+inst
//       pandora   [mainArtist,title,language,remix,live,instrumental] — split everything
//     artistRollup() credits a spin to EVERY listed artist (features included).
//
// Policy (per user):
//   - Never strip accents (é ≠ e can be a real distinction).
//   - Titles case-insensitive; artists case-SENSITIVE (LISA ≠ LiSa). mainArtist keys the
//     personal profiles so "X feat. Y" still counts toward X.
//   - Parens are never a differentiator; version info lives in columns, not the title.
//   - Dimensions come from title auto-extraction, overridable by merge-rules (esp. by album,
//     for cases like EXO Growl where language depends on the album, not the title).

import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "./title-prefix-scan.mjs";

export const DEFAULT_EXPORT = "data/ref/Recent Tracks Mochiphoria.csv";
export const DEFAULT_OUTDIR = "data/ref/lastfm";
export const DEFAULT_RULES = "data/ref/lastfm/merge-rules.json";
export const DEFAULT_TABLE_MAP = "data/ref/lastfm/table-map.json";

export const COL = {
  uts: 0, time: 1, artist: 2, artistMbid: 3,
  album: 4, albumMbid: 5, track: 6, trackMbid: 7,
};

/** A title has a Latin/numeric sort key iff it contains [A-Za-z0-9]. */
export const hasSortKey = (s) => /[a-z0-9]/i.test(s);

/** Last.fm tie-break: count desc, then artist asc, then title asc (case-insensitive). */
const ciKey = (s) => (s || "").toLocaleLowerCase();
export const byRank = (a, b) =>
  b.count - a.count
  || ciKey(a.artist).localeCompare(ciKey(b.artist))
  || ciKey(a.track ?? a.title).localeCompare(ciKey(b.track ?? b.title));

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------
const collapse = (s) => (s || "").replace(/\s+/g, " ").trim();
const stripQuotes = (s) => s.replace(/^["'\u201c\u201d\u2018\u2019]+|["'\u201c\u201d\u2018\u2019]+$/g, "");

// Markers stripped from a title into dimension columns (never identify the recording alone).
const RE_EXPLICIT_CLEAN = /\s*[([]\s*(explicit|clean)(\s+(ver\.?|version))?\s*[)\]]/gi;
const RE_FEAT_PAREN = /\s*[([]\s*(feat\.?|ft\.?|featuring|with)\b[^)\]]*[)\]]/gi;
const RE_FEAT_BARE = /\s+(feat\.?|ft\.?|featuring)\b.*$/i;
const RE_SUFFIX = /\s+-\s+(single|ep)\b.*$/gi;
// artist: drop only an explicit trailing feat credit (never split on & or ,).
const RE_ARTIST_FEAT = /\s*[([]?\s*(feat\.?|ft\.?|featuring|with)\b.*$/i;

// Canonical language names. Abbreviations + EXO-K/-M/-C artist-tag hints fold in.
const LANG_CANON = new Map(Object.entries({
  english: "English", eng: "English",
  korean: "Korean", kor: "Korean", kr: "Korean",
  japanese: "Japanese", jpn: "Japanese", jp: "Japanese",
  chinese: "Chinese", chn: "Chinese", chi: "Chinese", cn: "Chinese", mandarin: "Chinese",
  cantonese: "Cantonese",
  spanish: "Spanish", esp: "Spanish",
  thai: "Thai", vietnamese: "Vietnamese", viet: "Vietnamese",
  indonesian: "Indonesian", french: "French", german: "German",
  italian: "Italian", portuguese: "Portuguese", tagalog: "Tagalog",
}));
const RE_LANG_TOKEN = new RegExp(`\\b(${[...LANG_CANON.keys()].join("|")})\\b`, "i");
const RE_INST_SEG = /\b(instrumental|inst)\b/i;
const RE_LIVE_SEG = /\blive\b/i;
const RE_REMIX_SEG = /\b(remix|mix|version|ver|edit|edition|acoustic|reprise|rework|bootleg|slowed|mashup)\b|sped\s*up/i;

const cleanLabel = (s) => collapse(s).replace(/\bver\b\.?/i, "Version");

function classifySegment(seg, dims) {
  const low = seg.toLowerCase();
  const langM = low.match(RE_LANG_TOKEN);
  if (langM) { if (!dims.language) dims.language = LANG_CANON.get(langM[1].toLowerCase()); return true; }
  if (RE_INST_SEG.test(low)) { dims.instrumental = "instrumental"; return true; }
  if (RE_LIVE_SEG.test(low)) { dims.live = "live"; return true; }
  if (RE_REMIX_SEG.test(low)) { if (!dims.remix) dims.remix = cleanLabel(seg); return true; }
  return false;
}

/**
 * Split a raw title into a stripped base + variant dimensions. The base title has all
 * RECOGNIZED markers removed; unrecognized parentheticals stay (as words) so they remain
 * distinct. Returns { title, language, remix, live, instrumental } (title lowercased).
 * Parens are never significant on their own — only the words inside matter.
 */
export function parseVariant(raw) {
  let s = stripQuotes(raw || "")
    .replace(RE_EXPLICIT_CLEAN, " ").replace(RE_FEAT_PAREN, " ")
    .replace(RE_SUFFIX, " ").replace(RE_FEAT_BARE, " ");
  const dims = { language: "", remix: "", live: "", instrumental: "" };

  const exo = s.match(/\bexo[-\s]?([kmc])\b/i);
  if (exo) dims.language = exo[1].toUpperCase() === "K" ? "Korean" : "Chinese";

  // Bracketed/parenthetical segments: pull recognized ones into dims, keep the rest.
  s = s.replace(/[([]([^)\]]*)[)\]]/g, (m, inner) => {
    const seg = inner.trim();
    if (!seg) return " ";
    return classifySegment(seg, dims) ? " " : ` ${seg} `;
  });
  // Trailing " - Live" / " - Steve Aoki Remix" style suffixes (no brackets).
  s = s.replace(/\s+-\s+([^-]+)\s*$/, (m, tail) => (classifySegment(tail.trim(), dims) ? " " : m));
  // Bare trailing "Instrumental" (safe; bare "Live" is too ambiguous — needs a bracket/dash).
  s = s.replace(/\s+instrumental\s*$/i, () => { dims.instrumental = "instrumental"; return " "; });

  const title = collapse(s.replace(/[()[\]]/g, " ")).toLocaleLowerCase();
  return { title, ...dims };
}

/** Stripped base title (case-insensitive). Variant markers become dimensions, not title text. */
export function normTitle(s) {
  return parseVariant(s).title;
}

/** Split an artist string into { mainArtist, artists[], collab }. mainArtist = lead credit. */
export function parseArtist(raw) {
  const s = (raw || "").trim();
  const featMatch = s.match(/[([]?\s*(?:feat\.?|ft\.?|featuring|with)\b(.*)$/i);
  const base = s.replace(RE_ARTIST_FEAT, "").trim();
  const mainParts = base.split(/\s*[&,]\s*|\s+[xX]\s+/).map((x) => x.trim()).filter(Boolean);
  const mainArtist = mainParts[0] || base;
  let featArtists = [];
  if (featMatch && featMatch[1]) {
    featArtists = featMatch[1].replace(/[)\]]/g, " ").split(/\s*[&,]\s*|\s+[xX]\s+/)
      .map((x) => x.replace(/^[.\s]+|[.\s]+$/g, "").trim()).filter(Boolean);
  }
  const artists = [...new Set([...mainParts, ...featArtists])];
  return { mainArtist, artists, collab: artists.length > 1 };
}

/** Artist key for `merged` (legacy): case-SENSITIVE, only trailing feat credit dropped. */
export function normArtist(s) {
  return collapse((s || "").replace(RE_ARTIST_FEAT, ""));
}

/** Aggressive fuzzy key for merge-candidate CLUSTERING only (never used to auto-merge). */
export function fuzzyKey(s) {
  return (s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // fold accents (flagging only)
    .toLocaleLowerCase()
    .replace(/[([].*?[)\]]/g, " ")   // drop ALL parentheticals
    .replace(/\bfeat\.?|\bft\.?|\bfeaturing|\bwith\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Custom merge rules
// ---------------------------------------------------------------------------
export function loadRules(path = DEFAULT_RULES) {
  const empty = { artistAliases: [], titleAliases: [], overrides: [], albumRules: [] };
  if (!fs.existsSync(path)) return empty;
  const raw = JSON.parse(fs.readFileSync(path, "utf8"));
  return {
    artistAliases: raw.artistAliases || [],
    titleAliases: raw.titleAliases || [],
    overrides: raw.overrides || [],
    albumRules: raw.albumRules || [],
  };
}

const DIM_KEYS = ["language", "remix", "live", "instrumental"];
const pickDims = (o = {}) => Object.fromEntries(DIM_KEYS.filter((k) => k in o).map((k) => [k, o[k]]));

export function buildRuleIndex(rules) {
  const artistAlias = new Map();      // alias(exact) -> canonical
  for (const { canonical, aliases = [] } of rules.artistAliases) {
    for (const a of aliases) artistAlias.set(a, canonical);
  }
  const titleAlias = new Map();       // `${artist}\u0000${aliasTitle}` -> canonical title
  for (const { artist, canonical, aliases = [] } of rules.titleAliases) {
    for (const a of aliases) titleAlias.set(`${artist}\u0000${a}`, canonical);
  }
  // override: (artist,track,album) -> { as?, set:{dims} }.  albumRule: (artist,album) -> { set }.
  const override = new Map();
  for (const o of rules.overrides || []) {
    const { artist = "", track = "", album = "" } = o.match || {};
    override.set(`${artist}\u0000${track}\u0000${album}`, { as: o.as, set: { ...pickDims(o), ...pickDims(o.set) } });
  }
  const albumRule = new Map();
  for (const r of rules.albumRules || []) {
    const { artist = "", album = "" } = r.match || {};
    albumRule.set(`${artist}\u0000${album}`, { ...pickDims(r), ...pickDims(r.set) });
  }
  return { artistAlias, titleAlias, override, albumRule };
}

/**
 * Resolve a raw scrobble to its rules-canonical (artist, track) + any dimension overrides.
 * Precedence for dimensions: track override.set > albumRule.set (> auto-extraction, applied
 * later by the caller). Returns { artist, track, set }.
 */
export function applyRules(row, idx) {
  let artist = row.artist;
  let track = row.track;
  let set = {};
  const ar = idx.albumRule && idx.albumRule.get(`${artist}\u0000${row.album}`);
  if (ar) set = { ...set, ...ar };
  const ov = idx.override.get(`${artist}\u0000${track}\u0000${row.album}`);
  if (ov) { if (ov.as != null) track = ov.as; set = { ...set, ...ov.set }; }
  if (idx.artistAlias.has(artist)) artist = idx.artistAlias.get(artist);
  const canonTitle = idx.titleAlias.get(`${artist}\u0000${track}`);
  if (canonTitle) track = canonTitle;
  return { artist, track, set };
}

// ---------------------------------------------------------------------------
// Reading + aggregation
// ---------------------------------------------------------------------------
export function readScrobbles(path = DEFAULT_EXPORT) {
  const rows = [];
  for (const r of parseCsv(path)) {
    const track = (r[COL.track] || "").trim();
    if (!track) continue;
    rows.push({
      artist: (r[COL.artist] || "").trim(),
      album: (r[COL.album] || "").trim(),
      track,
    });
  }
  return rows;
}

/**
 * Group scrobbles by keyFn. Returns entries with:
 *   { count, artist, track, album?, variants:Map, variantCount }
 * where the display artist/track/album is the most-played literal variant.
 */
export function aggregate(rows, keyFn, { dropNoSortKey = false } = {}) {
  const byKey = new Map();
  for (const r of rows) {
    if (dropNoSortKey && !hasSortKey(r.track)) continue;
    const key = keyFn(r);
    if (key == null) continue;
    let e = byKey.get(key);
    if (!e) { e = { count: 0, variants: new Map() }; byKey.set(key, e); }
    e.count += 1;
    const vk = `${r.track}\u0000${r.artist}\u0000${r.album}`;
    const v = e.variants.get(vk);
    if (v) v.count += 1;
    else e.variants.set(vk, { track: r.track, artist: r.artist, album: r.album, count: 1 });
  }
  for (const e of byKey.values()) {
    let best = null;
    for (const v of e.variants.values()) if (!best || v.count > best.count) best = v;
    e.track = best.track;
    e.artist = best.artist;
    e.album = best.album;
    e.variantCount = e.variants.size;
  }
  return byKey;
}

export function ranked(byKey) {
  const list = [...byKey.values()].sort(byRank);
  list.forEach((r, i) => { r.rank = i + 1; });
  return list;
}

// Key functions for the standard layers.
export const keyLiteral = (r) => `${r.artist}\u0000${r.track}\u0000${r.album}`;
export const keyChart = (r) => `${r.track.toLocaleLowerCase()}\u0000${r.artist}`; // album-merged, artist case-sensitive
export const keyTitle = (r) => `${r.track.toLocaleLowerCase()}\u0000${r.artist}`;
export function keyMerged(idx) {
  return (r) => {
    const { artist, track } = applyRules(r, idx);
    return `${normTitle(track)}\u0000${normArtist(artist)}`;
  };
}

// ---------------------------------------------------------------------------
// Variant dimensions: base rows + profile rollups
// ---------------------------------------------------------------------------

/** Field list for the finest base granularity (one row per distinct recording+album). */
export const BASE_KEYS = ["mainArtist", "title", "album", "language", "remix", "live", "instrumental"];

/**
 * Read scrobbles into dimensioned base rows: apply rules, split title into variant dims,
 * split artist into main/all/collab, then group at BASE_KEYS granularity summing plays.
 * Each row: { mainArtist, artists[], collab, title, album, language, remix, live,
 * instrumental, count }.
 */
export function readVariants(path = DEFAULT_EXPORT, idx = null) {
  const base = new Map();
  for (const r of readScrobbles(path)) {
    let { artist, track, album } = r;
    let setDims = {};
    if (idx) { const a = applyRules(r, idx); artist = a.artist; track = a.track; setDims = a.set || {}; }
    const v = parseVariant(track);
    const a = parseArtist(artist);
    const row = {
      mainArtist: a.mainArtist,
      title: setDims.title != null ? setDims.title : v.title,
      album,
      language: setDims.language != null ? setDims.language : v.language,
      remix: setDims.remix != null ? setDims.remix : v.remix,
      live: setDims.live != null ? setDims.live : v.live,
      instrumental: setDims.instrumental != null ? setDims.instrumental : v.instrumental,
      collab: a.collab ? "collab" : "",
    };
    const key = BASE_KEYS.map((k) => (row[k] || "").toLocaleLowerCase()).join("\u0000");
    let e = base.get(key);
    if (!e) { e = { ...row, count: 0, artistSet: new Set() }; base.set(key, e); }
    e.count += 1;
    for (const one of a.artists) e.artistSet.add(one);
  }
  return [...base.values()].map((e) => {
    const { artistSet, ...rest } = e;
    return { ...rest, artists: [...artistSet] };
  });
}

/** Grouping profiles: which base fields form the key. chart/literal stay raw (not here). */
export const PROFILES = {
  affinity: ["mainArtist", "title"],
  title: ["title"],
  versions: ["mainArtist", "title", "language", "remix"],
  pandora: ["mainArtist", "title", "language", "remix", "live", "instrumental"],
};

/** Re-aggregate base rows by an arbitrary field list. Display = most-played sub-row. */
export function rollup(baseRows, by) {
  const byKey = new Map();
  for (const r of baseRows) {
    const key = by.map((f) => (r[f] || "").toLocaleLowerCase()).join("\u0000");
    let e = byKey.get(key);
    if (!e) { e = { count: 0, rows: [], artistSet: new Set() }; byKey.set(key, e); }
    e.count += r.count;
    e.rows.push(r);
    for (const a of r.artists || []) e.artistSet.add(a);
  }
  const out = [];
  for (const e of byKey.values()) {
    let best = null;
    for (const r of e.rows) if (!best || r.count > best.count) best = r;
    out.push({
      mainArtist: best.mainArtist, title: best.title, album: best.album,
      language: best.language, remix: best.remix, live: best.live, instrumental: best.instrumental,
      artists: [...e.artistSet], count: e.count, variantCount: e.rows.length,
    });
  }
  return out;
}

/** Rank dimensioned rows: plays desc, then mainArtist/title/language/remix asc (case-insensitive). */
export function rankVariants(rows) {
  const ci = (s) => (s || "").toLocaleLowerCase();
  rows.sort((a, b) =>
    b.count - a.count
    || ci(a.mainArtist).localeCompare(ci(b.mainArtist))
    || ci(a.title).localeCompare(ci(b.title))
    || ci(a.language).localeCompare(ci(b.language))
    || ci(a.remix).localeCompare(ci(b.remix)));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

/** Artist-level plays crediting EVERY listed artist (features bump the featured artist too). */
export function artistRollup(baseRows) {
  const m = new Map();
  for (const r of baseRows) for (const a of r.artists || []) m.set(a, (m.get(a) || 0) + r.count);
  return [...m.entries()]
    .map(([artist, count]) => ({ artist, count }))
    .sort((x, y) => y.count - x.count || x.artist.localeCompare(y.artist))
    .map((r, i) => ({ rank: i + 1, ...r }));
}

// ---------------------------------------------------------------------------
// Table map: which pre-aggregated CSV a consumer reads (personal, swappable)
// ---------------------------------------------------------------------------
export const PROFILE_FILE = {
  variants: "tracks-variants.csv", affinity: "tracks-affinity.csv", title: "track-titles.csv",
  versions: "tracks-versions.csv", pandora: "tracks-pandora.csv", chart: "tracks-chart.csv",
  literal: "tracks-literal.csv", artists: "artists.csv",
};

export function loadTableMap(mapPath = DEFAULT_TABLE_MAP) {
  if (!mapPath || !fs.existsSync(mapPath)) return {};
  try { return JSON.parse(fs.readFileSync(mapPath, "utf8")); } catch { return {}; }
}

/**
 * Resolve which CSV a consumer should read. Precedence:
 *   explicit `table` (profile name or path) > table-map[consumer] > table-map.default > "versions".
 * Defaults are baked in so this is fork-safe when table-map.json is absent.
 */
export function resolveTable(consumer, { table, tableMap, fallback = "versions", outdir = DEFAULT_OUTDIR } = {}) {
  const toPath = (choice) => {
    const file = PROFILE_FILE[choice] || choice;
    return path.isAbsolute(file) || file.includes("/") ? file : path.join(outdir, file);
  };
  if (table) return toPath(table);
  const map = loadTableMap(tableMap);
  return toPath(map[consumer] || map.default || fallback);
}

// ---------------------------------------------------------------------------
// CSV writing
// ---------------------------------------------------------------------------
export function csvCell(v) {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(header, rows) {
  const lines = [header.join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  return lines.join("\n") + "\n";
}
