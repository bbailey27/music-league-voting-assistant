---
name: release-date-enrichment
overview: >-
  Shared release-date cache + CSV enrichment for all-songs and scrobble data. Powers the
  shipped round release-year gate and feeds Airtable sync (see release-date-airtable-sync).
  Tracks earliest-release vs specific-album date, with deluxe/repackage handling.
status: pending
isProject: false
---

# Release-date enrichment

Give every song a trustworthy **earliest release date** (single-before-album counts) and the
**specific-album date** it appears under, so year-themed rounds gate deterministically and the
Airtable songs DB can be mass-labeled.

## Shipped (phase 0 — done)

- `scripts/release-year-gate.mjs` — reads `data/analysis/<round>/music.json`, resolves each
  track from the cache, gates on earliest-release **year** vs a target, writes a **pure
  passFail** `fit.json` (gate-only: NO numeric fitScore, so passing songs are scored purely on
  music and fails are DQ'd). Offline by default; `--fetch` enriches on cache miss via
  **MusicBrainz + Wikipedia** (Spotify API **not implemented / not planned**).
  - Run: `node scripts/release-year-gate.mjs <round> --year N [--fetch]`
    then `just merge <round> --rank music --gate passFail && just scores <round>`.
- `data/ref/release-dates.json` — the shared cache, keyed by Spotify track URI. Fields per
  track: `earliestReleaseDate`, `earliestSource`, `albumTitle`, `albumReleaseDate`,
  `albumType`, `albumEdition`, `confidence`, `verifiedAt`. Seeded with the 16 bg-2016 tracks.
- Verified on bg-2016: 14 pass / 2 fail; correctly handles the compilation trap (album year ≠
  earliest year) both ways — *The 7th Sense* (album 2018, earliest 2016 → pass) and
  *Let's Not Fall in Love* (album 2016, earliest 2015 → fail).

## Open decisions (captured from the ask — resolve on resume)

1. **Provider auth — RESOLVED (2026-08-04): Spotify API not planned.** Shipped lookup path:
   **MusicBrainz** (default) + **Wikipedia** fallback on miss or compilation trap. Do not
   suggest Spotify credentials. Open: CSV bulk enrichment, Airtable sync (separate plan).

2. **Deluxe / album-edition handling — CHOSEN: bonus-track rule.**
   - `earliestReleaseDate` = earliest release of the *original recording*.
   - **Exception:** a track that is genuinely NEW on a deluxe/repackage (a bonus track) counts
     by the *deluxe* date — that IS its true earliest. So the rule is "earliest real appearance
     of THIS recording," which naturally handles bonus tracks.
   - `albumReleaseDate` = the specific album the row points to; `albumEdition` ∈
     `standard | deluxe | repackage | reissue | compilation`.
   - **Detection:** Spotify `album_type` + title keywords (`Deluxe`, `Repackage`, `Reissue`,
     `Special`, year-in-title). Bonus-track detection = recording's earliest release IS the
     deluxe (no earlier release exists on MusicBrainz).

## Plan

### Phase 1 — cache schema + spec
- Write `spec/release-dates.md`: the two-date model, `albumEdition` vocab, the bonus-track
  rule, confidence levels (`verified | album-date | fuzzy | needs-review`), and the
  no-grep-JSON note (mirror the CSV rule).
- Add a `_doc` + versioned shape to `data/ref/release-dates.json` (already has `_doc`).
- Support a second key space for rows without a Spotify id (see Phase 3): normalized
  `artist|title` → record, with per-album sub-entries for album date/edition.

### Phase 2 — finish + test the fetch providers
- Live-test `--fetch` on a small round with the chosen provider(s). Add rate-limit/backoff and
  a `--limit N` guard. Cache every result. Add a regression test with a mocked fetch so the
  gate/emit path stays covered offline (extend `tests/`).

### Phase 3 — CSV enrichment (all-songs + scrobbles)
- `all-songs-no-inst.csv` is the Airtable songs export; it has a mostly-empty `Release Year`
  column, an `Albums` column, and *Pandora* `Open URL` ids (NOT Spotify). Scrobble CSVs
  (`data/ref/lastfm/tracks-literal.csv` = artist,track,album,scrobbles; `track-titles.csv`)
  have no ids. So enrichment matches by `artist + title (+ album)` via Spotify **search** —
  fuzzy. 
- `scripts/enrich-release-dates.mjs`:
  - Read distinct `(artist, title, album)` tuples from all-songs + tracks-literal.
  - Cache hit → use it. Miss + `--fetch` → Spotify search best match → album date/ISRC →
    MusicBrainz earliest. Tag `matchConfidence` (`exact | normalized | fuzzy`).
  - Only `exact/normalized` auto-write; `fuzzy` → a review file
    (`data/ref/release-dates.review.md`). Never overwrite `verified` by hand.
  - Output an enriched copy of the CSV (do not mutate the source export in place) +
    update the shared cache.
- Respect `no-grep-csvs.mdc`: read via a proper CSV parser (reuse whatever the lastfm/scan
  scripts use), extract only needed columns.

### Phase 4 — wire into the dispatcher
- Add `ml`/`just` recipes: `just gate <round> --year N`, `just enrich [--fetch]`. Update
  `scripts/cli-help.mjs` + the parse-scores-pipeline skill.

## Verify
- `npm test` (add mocked-fetch gate test + enrichment matcher test).
- Re-run the bg-2016 gate offline → still 14 pass / 2 fail, combined == music.

## Refs
- Round gate + cache: `scripts/release-year-gate.mjs`, `data/ref/release-dates.json` (working tree).
- Airtable side: [release-date-airtable-sync.plan.md](release-date-airtable-sync.plan.md).
- Overlaps artist identity work in [lastfm-airtable-artist-merge.plan.md](lastfm-airtable-artist-merge.plan.md).
