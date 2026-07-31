# Release dates

How release dates are defined, stored, and gated for year-themed rounds. The shared cache
lives at [`data/ref/release-dates.json`](../data/ref/release-dates.json) (keyed by Spotify
track URI). **Do not grep that file for titles** — query it by URI or use
`scripts/release-year-gate.mjs`.

**Tools:** [`scripts/release-year-gate.mjs`](../scripts/release-year-gate.mjs) reads a parsed
round's `music.json`, resolves dates from the cache, and writes a pass/fail `fit.json`.
Offline by default; `--fetch` enriches cache misses (Spotify + MusicBrainz).

League-specific eligibility (boy groups, soloists, etc.) is in [`leagues.md`](leagues.md);
this doc is only about **which date** counts for a submission.

---

## Match the submitted version

The gate always tests the **specific recording the submitter linked** — not an earlier mix,
original, or unrelated version of the same song title.

| Situation                                                       | Counts for the gate                                                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A 2020 remix of a 2018 original                                 | **2020** (this remix's first official release)                                                                                        |
| An English ver. first released later than the Korean original   | The English ver.'s date                                                                                                               |
| A bonus track that only exists on a 2021 repackage              | **2021** (no earlier release of _that_ recording)                                                                                     |
| Spotify points at a compilation that repackages an older single | Earliest release of **this** track id / recording — often the original single year, not the compilation year (see audit fields below) |

When verifying, cite the release of **this version**. Note in the cache if an older title
share exists under a different recording.

---

## Gate rules (league-specific)

Different leagues count different moments. Each league descriptor in
[`scripts/leagues.mjs`](../scripts/leagues.mjs) names its rule in `releaseDateRule` (when
set). The gate script uses that rule when `--year` is passed; today only
`version-earliest` is implemented — others are documented here for manual review and future
automation.

### `version-earliest` — earliest release of this version

**Used by:** `bg-years` (Kpop Boy Group Years).

The target year must match the **first official release of the submitted recording** —
digital single, MV drop, album track debut, or version-specific promo all count. A pre-album
single **does** count if this version first appeared on that single.

Examples:

- AB6IX _SURREAL (Alternative Rock Mix)_ → Jan 2021 repackage date, not the 2020 original
  _Surreal_.
- ATEEZ _Fireworks (I'm The One)_ → March 2021 EP/single date.

### `earliest-album-release` — earliest release on an album body (singles excluded)

**Used by:** _(upcoming year-themed league — not wired in the gate script yet.)_

**Cache field:** `earliestAlbumReleaseDate`.

The target year is the **earliest official release of this song on an EP, mini album, or full
album**. Standalone singles, pre-release singles, and MV-only drops **before** that album/EP
**do not** count — even if the same recording later appears on the album.

Deluxe / repackage / reissue rows **do not** reset the date if the song already appeared on
the standard album. A track genuinely **new** on a deluxe counts from that deluxe's album date
(bonus-track rule). The gate is **not** the linked Spotify row — find the earliest qualifying
album-body release even when the submitter linked a later edition.

Examples:

- Digital single Mar 2022 → full album May 2022 → **May 2022** (single ignored).
- Submitter links Jul 2022 deluxe; song was on May 2022 standard album → **May 2022**.
- B-side that only exists on a repackage → repackage album date.
- Song never appeared on any album/EP (single-only career) → **fail** / ineligible for this
  league.

### Precision

| League need                        | Minimum stored precision               | Gate compares      |
| ---------------------------------- | -------------------------------------- | ------------------ |
| Year only (default, `bg-years`)    | `YYYY` acceptable; prefer `YYYY-MM-DD` | Calendar **year**  |
| Month (`YYYY-MM` leagues — future) | `YYYY-MM` or `YYYY-MM-DD`              | Calendar **month** |

Always record the **most precise date you can verify**. Year-only (`2021`) is a fallback
when month/day are unknown — flag with `confidence: fuzzy` or `needs-review`.

---

## Three dates per cache entry

Two gate fields (one per league family) plus a linked-row audit field:

| Field                       | Role      | Meaning                                                                                                                                 |
| --------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `earliestReleaseDate`       | **Gate**  | `version-earliest` (`bg-years`): first official release of **this recording** — **singles count**.                                      |
| `earliestAlbumReleaseDate`  | **Gate**  | `earliest-album-release` (upcoming): earliest release on an **EP / mini / full album** — **singles do not count**; not the linked row.  |
| `albumReleaseDate`          | **Audit** | **Linked album release date** — date on the exact album/EP/single row this Spotify URI points at. No gate opinion; no other versions.   |

**How the two leagues differ:** same song, single Mar 2022 → album May 2022:

- `version-earliest` → **Mar 2022** (`earliestReleaseDate`)
- `earliest-album-release` → **May 2022** (`earliestAlbumReleaseDate`)

Prose alias for the audit field: **linked album release date**. JSON key stays
`albumReleaseDate` for backward compatibility.

Only one gate field is tested per round — whichever matches the league's `releaseDateRule`.

`albumEdition` describes the **linked** row only:

`standard` · `deluxe` · `repackage` · `reissue` · `compilation`

Edition traps when setting gate fields:

- Linked row says 2018, `earliestReleaseDate` is 2016 → **pass** a 2016 gate under
  `version-earliest`.
- Linked row says 2016, `earliestReleaseDate` is 2015 → **fail** a 2016 gate.
- Single Mar 2022, album May 2022: `earliestAlbumReleaseDate` is **May 2022** regardless of
  linked row.
- Submitter links 2023 deluxe, song on 2022 standard album → `earliestAlbumReleaseDate` is
  **2022**, not the deluxe linked date.

---

## Cache schema (`data/ref/release-dates.json`)

Keyed by `spotify:track:…` (the URI from parsed `music.json`). Shape per track:

| Field                     | Required | Notes                                                                                          |
| ------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `artist`, `title`         | yes      | Echo for humans; not a lookup key.                                                             |
| `earliestReleaseDate`        | gate     | `version-earliest` leagues. ISO `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`. Prefer full date.     |
| `earliestAlbumReleaseDate`   | gate     | `earliest-album-release` leagues (when populated). Same ISO precision.                    |
| `earliestSource`             | yes*     | Citation for `earliestReleaseDate`.                                                       |
| `earliestAlbumSource`        | yes*     | Citation for `earliestAlbumReleaseDate`.                                                  |
| `albumTitle`              | audit    | Album name on the **linked** Spotify row.                                                      |
| `albumReleaseDate`        | audit    | **Linked album release date** — ISO date on that row only; never used as a gate by itself.     |
| `albumType`               | audit    | `single` · `ep` · `album` · `compilation` · … on the linked row.                               |
| `albumEdition`            | audit    | Edition of the **linked** row (see vocab above).                                               |
| `confidence`              | yes      | `verified` · `linked-album-date` · `fuzzy` · `needs-review` (see below).                       |
| `verifiedAt`              | yes      | `YYYY-MM-DD` when last checked.                                                                |
| `note`                    | optional | Version traps, remix vs original, manual overrides.                                            |

\*Required when a gate date is set.

Populated by `release-year-gate.mjs --fetch`, hand edits, or future CSV enrichment. Never
overwrite `confidence: verified` entries from automated fuzzy matches.

---

## Confidence levels

| Level          | Meaning                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------ |
| `verified`     | Human or strong primary source (label site, Wikipedia with date, official MV description). |
| `linked-album-date` | Only the **linked** row date is known; used as a gate fallback — unsafe (compilations, deluxes). Legacy value `album-date` may appear in older cache rows. |
| `fuzzy`        | Year-only or weak match — do not auto-pass a gate without review.                          |
| `needs-review` | Conflicting sources or version ambiguity.                                                  |

Cache miss or `fuzzy` / `needs-review` → gate emits `maybe` (NEEDS LOOKUP), never a silent pass.

---

## Workflow

```bash
just parse <round>
node scripts/release-year-gate.mjs <round> --year <N> [--fetch]
just merge <round> --rank music --gate passFail
```

Wrong-year picks in objective mode: a comment whose only number is the off year (e.g.
`2019`) DQs per [`score-parsing.md`](score-parsing.md) → _Years Are Not Scores_ — years are
never music scores.

---

## Related

- League registry + which rule each league uses: [`leagues.md`](leagues.md),
  [`scripts/leagues.mjs`](../scripts/leagues.mjs)
- Planned CSV bulk enrichment: `.cursor/plans/release-date-enrichment.plan.md`
