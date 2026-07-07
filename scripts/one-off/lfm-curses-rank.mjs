#!/usr/bin/env node
// One-off: rank candidate songs for the "lfm-curses" round by top-tracks position.
//
// The round asks for the user's TOP-PLAYED song that features a curse word. The
// authoritative "top tracks" ordering is the raw scrobble-log export in
// data/ref/Recent Tracks Mochiphoria.csv (one row per play; artist=col2,
// track=col6). We aggregate plays per track and assign a global rank that
// reproduces Last.fm's chart (see hasSortKey + byRank for the site quirks).
//
// Usage:
//   node scripts/one-off/lfm-curses-rank.mjs                 # print top 60 overall
//   node scripts/one-off/lfm-curses-rank.mjs --top 100
//   node scripts/one-off/lfm-curses-rank.mjs --find "Title" ["Title|Artist" ...]
//   node scripts/one-off/lfm-curses-rank.mjs --artist "Name" [...]  # list an artist's tracks
//   node scripts/one-off/lfm-curses-rank.mjs --candidates    # score the built-in list
//
// Add --merge to any mode to sum version variants (remix/clean/explicit/JP/…)
// into one row per song (total affinity) instead of Last.fm's per-track chart.

import { norm } from "../title-prefix-scan.mjs";
import {
  DEFAULT_EXPORT, readScrobbles, aggregate, ranked as rankEntries, hasSortKey,
  keyChart, keyMerged, loadRules, buildRuleIndex,
} from "../lastfm-export.mjs";

// Raw scrobble log export: one row per play. The ranking/aggregation logic lives in
// lastfm-export.mjs (shared with lastfm-aggregate.mjs) so this stays a thin wrapper.
const SCROBBLES = DEFAULT_EXPORT;

/**
 * Build ranked list of {title, artist, count, rank}.
 *
 * Two keying modes (see lastfm-export.mjs):
 *  - faithful (default): Last.fm chart replica — every distinct (artist, track) string
 *    ranks on its own; symbol/CJK titles are INCLUDED (Last.fm keeps them, e.g.
 *    놀리러 간다 / Speed is #313 on the site).
 *  - merged (`{ merge: true }`): fold explicit/clean + feat and apply merge-rules,
 *    summing version variants into one row (total affinity).
 */
function buildRanking({ merge = false } = {}) {
  const rows = readScrobbles(SCROBBLES);
  const byKey = merge
    ? aggregate(rows, keyMerged(buildRuleIndex(loadRules())))
    : aggregate(rows, keyChart);
  return rankEntries(byKey).map((e) => ({
    title: e.track, artist: e.artist, count: e.count, rank: e.rank, variantCount: e.variantCount,
  }));
}

/** Also aggregate by title alone (sum across artists) for loose lookups. */
function buildTitleRanking() {
  const byTitle = new Map();
  for (const { track: title, artist } of readScrobbles(SCROBBLES)) {
    if (!hasSortKey(title)) continue;
    const key = norm(title);
    if (!key) continue;
    const prev = byTitle.get(key);
    if (prev) {
      prev.count += 1;
      if (artist) prev.artists.add(artist);
    } else {
      byTitle.set(key, { title, artists: new Set(artist ? [artist] : []), count: 1 });
    }
  }
  const list = [...byTitle.values()].sort(
    (a, b) => b.count - a.count || a.title.toLocaleLowerCase().localeCompare(b.title.toLocaleLowerCase()),
  );
  list.forEach((r, i) => { r.rank = i + 1; });
  return list;
}

const stripParens = (s) => norm(s.replace(/\s*[([].*$/, "").replace(/\s+-\s+.*$/, ""));

function titleMatch(rowTitle, nt) {
  const rn = norm(rowTitle);
  if (!rn || !nt) return false;
  const rs = stripParens(rowTitle);
  if (rn === nt || rs === nt) return true;
  // containment only when the query is a substantial token (avoids "" / tiny noise)
  if (nt.length >= 4 && (rn.includes(nt) || rs.includes(nt))) return true;
  if (rs.length >= 4 && nt.includes(rs)) return true;
  return false;
}

function find(query, ranking, titleRanking) {
  const [t, a] = query.split("|").map((s) => s.trim());
  const nt = norm(t);
  const na = a ? norm(a) : null;
  let matches = ranking.filter((r) => titleMatch(r.title, nt));
  if (na) {
    const byArtist = matches.filter((r) => {
      const ra = norm(r.artist);
      return ra && (ra.includes(na) || na.includes(ra));
    });
    if (byArtist.length) matches = byArtist;
  }
  matches.sort((x, y) => x.rank - y.rank);
  const titleAgg = titleRanking.find((r) => norm(r.title) === nt || stripParens(r.title) === nt);
  return { query, matches, titleAgg };
}

const CANDIDATES = [
  // title | artist (artist optional; helps disambiguate)
  "beautiful life|Xdinary Heroes",
  "MIC Drop|BTS",
  "Kill This Love|BLACKPINK",
  "Pivot|KARD",
  "Back to Me",
  "K-POP|Travis Scott",
  "Loved|B.I",
  "Asurabalbalta|PENOMECO",
  "Seven|Jung Kook",
  "3D|Jung Kook",
  "Set Me Free|Jimin",
  "Set Me Free Pt.2|Jimin",
  "Daechwita|Agust D",
  "Savage Love|Jawsh 685",
  "Mermaid|LE SSERAFIM",
  "Sour Grapes|LE SSERAFIM",
  "FEARLESS|LE SSERAFIM",
  "Vengeance|BIBI",
  "LALALI|SEVENTEEN",
  "TAKE A SHOT|HOSHI",
  "Bad Influence|SEVENTEEN",
  "I'm a 마 (I'm a B)|Hwasa",
  "Ruby|WOOZI",
  "REDRED",
  "TOMBOY|(G)I-DLE",
  "Good Thing|(G)I-DLE",
  "Girlfriend|(G)I-DLE",
  "Dirty Work|aespa",
  "Face-off|Jimin",
  "Arson|j-hope",
  "OOTD|Dreamcatcher",
  "Off Road|ONEWE",
  "Zen|JENNIE",
  "With The IE|JENNIE",
  "F.T.S.|JENNIE",
  "Filter|BTS",
  "Bite|Mad Tsai",
  "HOUNDSOFHELL|Mad Tsai",
  "mad's world|Mad Tsai",
  "RATATATA|BABYMETAL",
  "Ooh|BM",
  "Berghain|Rosalía",
  "Medusa|ALLDAY PROJECT",
  "Cake By The Ocean|DNCE",
  "Bum Bum Tam Tam",
  "Taki Taki",
  "FXXK IT|NINEONE",
  "Sorry|MILLI",
  "BUCK|Jackson Wang",
  "Deja Vu|VOILÀ",
  "BHYT|JUST B",
  "Gunshot|KARD",
  "TOPLINE|Stray Kids",
  "SUPER BOARD|Stray Kids",
  "Enough|ATEEZ",
  "Adrenaline|ATEEZ",
  "LO$ER=LO♡ER|Tomorrow X Together",
  "Outside|ENHYPEN",
  "Brought the Heat Back|ENHYPEN",
  "Eyes roll",
];

function main() {
  const argv = process.argv.slice(2);
  const merge = argv.includes("--merge");
  const ranking = buildRanking({ merge });
  const titleRanking = buildTitleRanking();
  if (merge) console.error("(--merge: version variants summed per normalized title+artist)\n");

  if (argv.includes("--candidates")) {
    for (const q of CANDIDATES) {
      const { matches, titleAgg } = find(q, ranking, titleRanking);
      const top = matches[0];
      if (top) {
        console.log(
          `${String(top.rank).padStart(5)}  ${top.count.toString().padStart(4)}x  ${top.title} — ${top.artist}   [q:${q}]`,
        );
      } else if (titleAgg) {
        console.log(`  ?    ${titleAgg.count}x  (title-agg rank ${titleAgg.rank}) ${titleAgg.title}   [q:${q}]`);
      } else {
        console.log(`  --   NOT FOUND   [q:${q}]`);
      }
    }
    return;
  }

  const artistIdx = argv.indexOf("--artist");
  if (artistIdx !== -1) {
    for (const q of argv.slice(artistIdx + 1).filter((a) => !a.startsWith("--"))) {
      const na = norm(q);
      const rows = ranking
        .filter((r) => {
          const ra = norm(r.artist);
          return ra && na && (ra.includes(na) || na.includes(ra));
        })
        .sort((a, b) => a.rank - b.rank);
      console.log(`\n== artist ~ "${q}" (${rows.length} tracks) ==`);
      for (const r of rows) {
        console.log(`  rank ${String(r.rank).padStart(5)}  ${r.count}x  ${r.title} — ${r.artist}`);
      }
    }
    return;
  }

  const findIdx = argv.indexOf("--find");
  if (findIdx !== -1) {
    for (const q of argv.slice(findIdx + 1).filter((a) => !a.startsWith("--"))) {
      const { matches, titleAgg } = find(q, ranking, titleRanking);
      console.log(`\n== ${q} ==`);
      for (const m of matches.slice(0, 6)) {
        console.log(`  rank ${m.rank}  ${m.count}x  ${m.title} — ${m.artist}`);
      }
      if (!matches.length) console.log("  (no artist-title match)");
      if (titleAgg) console.log(`  [title-agg] ${titleAgg.count}x across ${[...titleAgg.artists].join(", ")} (rank ${titleAgg.rank})`);
    }
    return;
  }

  const topIdx = argv.indexOf("--top");
  const n = (topIdx !== -1 && parseInt(argv[topIdx + 1], 10)) || 60;
  const label = merge ? "songs (variants merged)" : "tracks";
  console.log(`# Top ${n} ${label} by scrobble count (${ranking.length} unique ${merge ? "songs" : "artist-titles"})\n`);
  for (const r of ranking.slice(0, n)) {
    console.log(`${String(r.rank).padStart(4)}  ${r.count.toString().padStart(4)}x  ${r.title} — ${r.artist}`);
  }
}

main();
