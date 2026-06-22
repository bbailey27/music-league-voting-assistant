import fs from "node:fs";

function parse(file) {
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

const norm = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const fav = parse("data/ref/fav-songs.csv"); // col0 title, col1 artist, col2 playlists
const mood = parse("data/ref/chill-minor-rock-etc-search.csv"); // col0 title, col1 artist, col3 playlists

const favKey = new Set(fav.map((r) => norm(r[0]) + "|" + norm(r[1])));

// Unified song list across both files
const all = [];
for (const r of fav) all.push({ title: r[0], artist: r[1], pls: r[2] || "", src: "fav" });
for (const r of mood) all.push({ title: r[0], artist: r[1], pls: r[3] || r[2] || "", src: "mood" });

// Dedup by title|artist
const seen = new Map();
for (const s of all) {
  const k = norm(s.title) + "|" + norm(s.artist);
  if (!seen.has(k)) seen.set(k, s);
}
const uniq = [...seen.values()];

const arg = process.argv[2] || "lucy";

if (arg === "lucy" || arg === "onewe") {
  const rx = arg === "lucy" ? /^lucy$/i : /^onewe$/i;
  const list = uniq.filter((s) => rx.test((s.artist || "").trim()));
  list.sort((a, b) => a.title.localeCompare(b.title));
  console.log(`=== ALL ${arg.toUpperCase()} songs across both files (${list.length}) ===`);
  for (const s of list) console.log(`[${s.src}] ${s.title}`);
}

if (arg === "new") {
  // New-to-favorites from mood, full promising scan, NO truncation
  const titleRx = /\b(alone|lonely|loner|solitude|myself|inner|self|soul|lost|find|finding|road|path|lantern|mirror|reflect|silence|silent|quiet|empty|identity|who am i|childhood|ending|dawn|dusk|grey|gray|singularity|epiphany|colorless|insomnia|farther|stranger|shadow|breathe|breathing|drifting|wander|nowhere|disappear|fade|calling|night|nameless|maze|fog|drown|sink|hollow|numb|blank|distance|far|away|home|deep|cold|winter|gloom|grow|growing|mature|island|map|compass|light|candle|monologue|diary|me|i am|behind)\b/i;
  const artRx = /LUCY|ONEWE|DAY6|The Rose|Xdinary|CNBLUE|N\.Flying|Nell|The Volunteers|Touched|wave to earth|ADOY|SE SO NEON|Hyukoh|Jannabi/i;
  const minorRx = /Oh It.s Minor/i;
  const out = [];
  for (const r of mood) {
    const title = r[0], artist = r[1], pls = r[3] || r[2] || "";
    const key = norm(title) + "|" + norm(artist);
    if (favKey.has(key)) continue;
    const tHit = titleRx.test(title);
    const aHit = artRx.test(artist);
    const mHit = minorRx.test(pls);
    if (tHit || mHit || aHit)
      out.push({ title, artist, pls, score: (tHit ? 2 : 0) + (mHit ? 1 : 0) + (aHit ? 1 : 0), tHit, mHit, aHit, idx: out.length });
  }
  console.log(`=== New-to-favorites promising candidates (${out.length}) — FULL list ===`);
  out.sort((a, b) => b.score - a.score || a.artist.localeCompare(b.artist));
  for (const o of out)
    console.log(`${o.score} ${o.tHit ? "T" : " "}${o.mHit ? "M" : " "}${o.aHit ? "A" : " "}  ${o.title} — ${o.artist}`);
}

if (arg === "newcount") {
  let n = 0;
  for (const r of mood) {
    const key = norm(r[0]) + "|" + norm(r[1]);
    if (!favKey.has(key)) n++;
  }
  console.log("Total new-to-favorites rows in mood csv:", n, "of", mood.length);
}
