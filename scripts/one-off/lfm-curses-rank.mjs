#!/usr/bin/env node
// One-off: rank candidate songs for the "lfm-curses" round by top-tracks position.
//
// The round asks for the user's TOP-PLAYED song that features a curse word. The
// authoritative "top tracks" ordering is play count from data/ref/all-scrobbles.csv
// (col0 title, col1 artist, col4 scrobble count). Last.fm ranks per artist+title,
// so we aggregate scrobbles per (title, artist) and assign a global rank.
//
// Usage:
//   node scripts/one-off/lfm-curses-rank.mjs                 # print top 60 overall
//   node scripts/one-off/lfm-curses-rank.mjs --top 100
//   node scripts/one-off/lfm-curses-rank.mjs --find "Title" ["Title|Artist" ...]
//   node scripts/one-off/lfm-curses-rank.mjs --candidates    # score the built-in list

import { parseCsv, norm } from "../title-prefix-scan.mjs";

const SCROBBLES = "data/ref/all-scrobbles.csv";

/** Build ranked list of {title, artist, count, rank} aggregated per (title, artist). */
function buildRanking() {
  const byKey = new Map();
  for (const row of parseCsv(SCROBBLES)) {
    const title = (row[0] || "").trim();
    const artist = (row[1] || "").trim();
    const count = parseInt(row[4], 10) || 0;
    if (!title) continue;
    const key = `${norm(title)}\u0000${norm(artist)}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.count += count;
    } else {
      byKey.set(key, { title, artist, count });
    }
  }
  const ranked = [...byKey.values()].sort((a, b) => b.count - a.count);
  ranked.forEach((r, i) => { r.rank = i + 1; });
  return ranked;
}

/** Also aggregate by title alone (sum across artists) for loose lookups. */
function buildTitleRanking() {
  const byTitle = new Map();
  for (const row of parseCsv(SCROBBLES)) {
    const title = (row[0] || "").trim();
    const artist = (row[1] || "").trim();
    const count = parseInt(row[4], 10) || 0;
    if (!title) continue;
    const key = norm(title);
    const prev = byTitle.get(key);
    if (prev) {
      prev.count += count;
      if (artist) prev.artists.add(artist);
    } else {
      byTitle.set(key, { title, artists: new Set(artist ? [artist] : []), count });
    }
  }
  const ranked = [...byTitle.values()].sort((a, b) => b.count - a.count);
  ranked.forEach((r, i) => { r.rank = i + 1; });
  return ranked;
}

const stripParens = (s) => norm(s.replace(/\s*[\(\[].*$/, "").replace(/\s+-\s+.*$/, ""));

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
  "Savage Love",
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
  "Arson|Jimin",
  "OOTD|Dreamcatcher",
  "Off Road|ONEWE",
  "Zen|JENNIE",
  "With The IE|JENNIE",
  "F.T.S.|JENNIE",
  "Filter|BTS",
  "Bite|Mad Tsai",
  "Hounds of Hell|Mad Tsai",
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
  "Gunshot|BM",
  "TOPLINE|Stray Kids",
  "Super Bowl|Stray Kids",
  "Enough|ATEEZ",
  "Adrenaline|ATEEZ",
  "Lover=Loser",
  "Outside|ENHYPEN",
  "Brought the Heat Back|ENHYPEN",
  "Eyes roll",
];

function main() {
  const argv = process.argv.slice(2);
  const ranking = buildRanking();
  const titleRanking = buildTitleRanking();

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

  const findIdx = argv.indexOf("--find");
  if (findIdx !== -1) {
    for (const q of argv.slice(findIdx + 1)) {
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
  const n = topIdx !== -1 ? parseInt(argv[topIdx + 1], 10) : 60;
  console.log(`# Top ${n} tracks by scrobble count (${ranking.length} unique artist-titles)\n`);
  for (const r of ranking.slice(0, n)) {
    console.log(`${String(r.rank).padStart(4)}  ${r.count.toString().padStart(4)}x  ${r.title} — ${r.artist}`);
  }
}

main();
