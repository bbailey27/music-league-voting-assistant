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

### `album-body` — album / EP body only (singles disregarded)

**Used by:** _(none wired yet — document for rounds that say "from a {year} album".)_

The target year is the release of the **album or EP** the track belongs to. Standalone
singles, pre-release drops, or MV-only dates **before** that album/EP do **not** count — even
if the same recording later appears on the album.

Use when the league prompt is about albums/eras, not "anything that existed in {year}".

### Precision

| League need                        | Minimum stored precision               | Gate compares      |
| ---------------------------------- | -------------------------------------- | ------------------ |
| Year only (default, `bg-years`)    | `YYYY` acceptable; prefer `YYYY-MM-DD` | Calendar **year**  |
| Month (`YYYY-MM` leagues — future) | `YYYY-MM` or `YYYY-MM-DD`              | Calendar **month** |

Always record the **most precise date you can verify**. Year-only (`2021`) is a fallback
when month/day are unknown — flag with `confidence: fuzzy` or `needs-review`.

---

## Two dates per cache entry

Every cached track carries two concepts:

| Field                 | Meaning                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `earliestReleaseDate` | What the active **gate rule** tests (see above). For `version-earliest`, the first official release of **this** recording.                            |
| `albumReleaseDate`    | Release date of the **specific album/EP/single** this Spotify track row sits on. Audit only — a repackage, deluxe, or compilation can be years later. |

`albumEdition` describes that specific album row:

`standard` · `deluxe` · `repackage` · `reissue` · `compilation`

A compilation trap in either direction still needs human judgment:

- Album says 2018, earliest release of this recording is 2016 → **pass** a 2016 year gate
  under `version-earliest`.
- Album says 2016, earliest release is 2015 → **fail** a 2016 year gate.

---

## Cache schema (`data/ref/release-dates.json`)

Keyed by `spotify:track:…` (the URI from parsed `music.json`). Shape per track:

| Field                 | Required | Notes                                                     |
| --------------------- | -------- | --------------------------------------------------------- |
| `artist`, `title`     | yes      | Echo for humans; not a lookup key.                        |
| `earliestReleaseDate` | gate     | ISO `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`. Prefer full date. |
| `earliestSource`      | yes      | URL or citation for the gate date.                        |
| `albumTitle`          | audit    | Album name on this Spotify row.                           |
| `albumReleaseDate`    | audit    | ISO date of that album row.                               |
| `albumType`           | audit    | `single` · `ep` · `album` · `compilation` · …             |
| `albumEdition`        | audit    | See vocab above.                                          |
| `confidence`          | yes      | `verified` · `album-date` · `fuzzy` · `needs-review`      |
| `verifiedAt`          | yes      | `YYYY-MM-DD` when last checked.                           |
| `note`                | optional | Version traps, remix vs original, manual overrides.       |

Populated by `release-year-gate.mjs --fetch`, hand edits, or future CSV enrichment. Never
overwrite `confidence: verified` entries from automated fuzzy matches.

---

## Confidence levels

| Level          | Meaning                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------ |
| `verified`     | Human or strong primary source (label site, Wikipedia with date, official MV description). |
| `album-date`   | Only the Spotify/album row date is known; earliest may differ (compilations).              |
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
