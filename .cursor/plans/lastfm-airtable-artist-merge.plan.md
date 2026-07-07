---
name: Fold Airtable artist-merge tagging into Last.fm merge-rules
overview: >-
  Convert the user's Airtable artist tagging (canonical Artist Records, alternate
  Last.fm/Pandora names, featured-artist splits) into artistAliases/titleAliases for
  data/ref/lastfm/merge-rules.json, so the dimensioned aggregation layers (affinity /
  versions / title / artists rollup) use the same artist identities the user maintains
  by hand. Large, partly-unfinished dataset — land it incrementally, not in one pass.
status: pending
isProject: false
---

# Fold Airtable artist-merge tagging into Last.fm merge-rules

Builds on the shipped Last.fm aggregation tooling + rules schema (see `spec/decisions.md`
2026-07-06/07 and `spec/lastfm-data.md`). This plan is only about **populating** the
artist rules from Airtable.

**Carried-over open item (from the retired aggregation plan, D6):** the Pandora all-songs
CSV spells EXO's artist as **`EXO`** while the Last.fm export uses **`Exo`** — an
artist-spelling variant. Decide the canonical form and add an `artistAlias` (do NOT
blanket-merge `EXO` / `EXO-K` / `EXO-M`, which are language indicators). Fold this into the
generated artist rules below rather than hand-writing it.

## Why this is separate / big

The custom rules currently in `merge-rules.json` are two hand-written demos. The user has
extensive artist tagging in Airtable (thousands of artists, alternate names, featured
splits) — "a lot of extra," and **not all of it is finished**. Import it deliberately.

## Inputs

1. **`data/ref/all-songs-no-inst.csv`** (already in repo). Relevant columns:
   - `Artist name` (1) — the Pandora-side raw spelling.
   - `Artist Record` (4) — **canonical artist identity** (Airtable linked record title).
   - `Featured/Remix Artists` (5), `Main Artist Count` (26), `Featured Artist Count` (27),
     `Unsplit Collab?` (28), `Uncertain Artists` (29) — the featured-artist splitting.
   - `Stripped Artist Name` (31) — normalized key.
2. **Supporting artist table export** (user will provide). Expected to carry: canonical
   name, alternate names (explicitly Last.fm vs Pandora spellings that should merge),
   featured-artist split entries, and manual-merge scripts / a finished/uncertain flag.

## Key findings (from mining all-songs-no-inst.csv)

- **Canonical key = `Artist Record`, NOT `Stripped Artist Name`.** The two Lisas prove it:
  `LISA` (BLACKPINK) and `LiSA` (JP) both strip to `lisa` but are distinct `Artist Record`s.
  Stripped also wrongly collapses `MAMAMOO` / `MAMAMOO+`. Never merge by stripped name.
- The all-songs CSV alone yields **Pandora-side** spelling variants → Record (49 stripped
  keys already fold >1 raw name, e.g. `KANG DANIEL|Kang Daniel|KANGDANIEL`). **Last.fm-side**
  spellings (what our export actually contains) are NOT in this CSV — they come from the
  artist table's alternate-names field. So the artist-table export is required for real
  Last.fm→canonical aliases; all-songs is a supplement.
- Featured splits: the user splits collabs into separate artist entries. Last.fm strings
  like `A & B`, `A feat. B`, `A, B` must map to primary `A` (+ optional featured `B`),
  which overlaps the merge-candidates `[artist]` flags already produced.

## Plan

1. **Obtain the artist-table export** and inspect its schema (canonical, alt-names with
   source = lastfm/pandora, featured split, finished/uncertain flag).
2. **Rules loader: support layering.** Extend `loadRules()` to merge either a rules
   directory or multiple files (hand rules + generated), so generated artist rules live in
   their own file (e.g. `merge-rules.artists.json`) and hand rules stay editable.
3. **Converter script** `scripts/lastfm-artist-rules.mjs`:
   - Read artist table (+ all-songs for Pandora variants). Emit `artistAliases`
     `{ canonical: <Artist Record>, aliases: [<all alt spellings incl. Last.fm>] }`.
   - **Skip** rows flagged unfinished/`Uncertain Artists`/`Unsplit Collab?`; report counts.
   - De-dupe against existing hand rules; keep case-sensitive exactness.
   - Optionally emit `titleAliases` where the table encodes per-song merges.
4. **Reconcile with real data.** Run against the Last.fm export: report aliases that never
   match any scrobbled artist string (stale) and scrobbled artists with no rule that
   `lastfm-merge-candidates --reason artist` flags (missing) — a coverage gap list.
5. **Regenerate** the profile CSVs (`tracks-affinity.csv` / `tracks-versions.csv` /
   `track-titles.csv` / `artists.csv`) via `node scripts/lastfm-aggregate.mjs`; spot-check a
   few known merges (the two Lisas stay split; KANG DANIEL variants fold).
6. **Iterate** as the Airtable tagging is finished; this file stays a partial backlog item.

## Risks / notes

- Volume: thousands of artists — generate, don't hand-write; keep generated rules in a
  separate file from hand rules.
- Source mismatch: Pandora spellings ≠ Last.fm spellings; only the artist table bridges them.
- Partial data: honor the finished/uncertain flags; never emit rules for unfinished rows.
- Featured splitting policy interacts with `normArtist` (currently strips only trailing
  `feat./ft./with`, never `&`/`,`). Decide whether generated rules should also canonicalize
  `&`/`,` collab strings, or leave those as merge-candidate flags.
