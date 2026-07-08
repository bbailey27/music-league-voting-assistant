---
name: release-date-airtable-sync
overview: >-
  Push enriched release dates back to the Airtable songs DB, and reconcile Last.fm scrobbles
  into Airtable (match/create songs, update play counts). Consumes the shared release-date
  cache from release-date-enrichment.
status: pending
isProject: false
---

# Airtable sync (release dates + scrobble merge)

Two writers on top of the shared cache (`data/ref/release-dates.json`) built in
[release-date-enrichment.plan.md](release-date-enrichment.plan.md).

## Open decisions (resolve on resume)

1. **Airtable access — user chose "other" (freeform, text not captured).** Re-confirm the
   intended method before building. Candidate approaches:
   - Personal Access Token (`AIRTABLE_TOKEN`) + `AIRTABLE_BASE_ID` + table/field names via env
     (most direct; batch PATCH 10 records/request).
   - Auto-discover schema via the Airtable Meta API (still needs PAT + base id).
   - No live writes — emit an import-ready CSV the user pastes/upserts by hand.
   - **Action:** capture the user's preferred method, then pick the matching path below.
2. **Match key Airtable ↔ cache.** No Spotify id in the export. Options: Pandora track id from
   `Open URL` (stable if present), else normalized `artist|title(+album)`. Decide primary +
   fallback; low-confidence matches go to a review list, never auto-written.
3. **New columns** to add in Airtable (names to confirm): `Earliest Release Date`,
   `Album Release Date`, `Album Edition` (single-select), plus the existing `Release Year`
   (fill from earliest). Keep `Release Year` = YEAR(earliest).

## Plan

### Phase A — release-date push (smaller, do first)
- `scripts/airtable-push-dates.mjs`:
  - Load cache; load Airtable songs (API list or a fresh CSV export).
  - Match rows (decision #2). For matched + `confidence=verified` rows, compute the field diff.
  - **Dry-run by default** (print what would change). `--apply` PATCHes in batches of 10.
    Idempotent: skip rows already equal. `--limit N` guard.
  - Emits an unmatched/low-confidence review file.
- If access decision = CSV-only, emit `data/ref/airtable-release-dates.import.csv` instead of
  API writes, keyed for an Airtable CSV upsert.

### Phase B — scrobble → Airtable reconciliation (larger)
- Goal: every scrobbled song either matches an Airtable row (update play count) or is surfaced
  as a candidate to add. Overlaps artist-identity work — reuse `merge-rules.json` canonical
  artists (see lastfm-airtable-artist-merge).
- `scripts/airtable-merge-scrobbles.mjs`:
  - Source scrobbles from `data/ref/lastfm/tracks-versions.csv` (default profile) or
    `tracks-literal.csv`; canonicalize artist via merge-rules; normalize title.
  - Match to Airtable songs (artist canonical + title). Report:
    - matched → optional play-count / last-played update;
    - unmatched scrobbles → "songs to add" candidate list (with scrobble counts) → review;
    - Airtable songs with zero scrobbles → informational.
  - Creation of new rows is **opt-in** (`--create`), batched, dry-run first. Feed release dates
    for created rows from the cache (enrich first if missing).
- Honor partial/uncertain artist flags (`Unsplit Collab?`, `Uncertain Artists`) — never create
  or merge on unfinished identities.

### Phase C — glue + docs
- One driver so the flow is `enrich → push-dates → merge-scrobbles`, each dry-run-able.
- Secrets via env only; never commit tokens (add to `.gitignore`/docs). Document required env
  and the review-file workflow in `spec/` + a data-side README note.

## Risks
- Fuzzy matching without ids: keep everything dry-run + review-gated; verified-only auto-writes.
- Airtable rate limits (5 req/s) + 10-record batch cap: throttle.
- Compilation/deluxe dates (see enrichment plan bonus-track rule) must be resolved BEFORE
  pushing `Release Year`, or the DB inherits album-year errors.

## Refs
- Shared cache + enrichment: [release-date-enrichment.plan.md](release-date-enrichment.plan.md).
- Artist identity: [lastfm-airtable-artist-merge.plan.md](lastfm-airtable-artist-merge.plan.md).
- all-songs schema notes: that plan's "Inputs" section (Artist Record canonical key, etc.).
