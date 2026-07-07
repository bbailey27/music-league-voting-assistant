# Last.fm data: aggregation, variant dimensions, and grouping profiles

Objective reference for the Last.fm scrobble pipeline: the scripts, the pre-aggregated
files, the column schema, and how to regenerate and choose them. **Personal preferences**
(which table a given script reads for the owner's workflow) live in the data submodule at
`data/ref/lastfm/README.md` + `data/ref/lastfm/table-map.json` — not here — so a fork of
this public repo doesn't inherit them.

## Scripts

| Script                                | Purpose                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| `scripts/lastfm-export.mjs`           | Shared lib: CSV parse, variant/artist parsing, rules, rollups, table resolution.            |
| `scripts/lastfm-aggregate.mjs`        | Read a raw export → write all pre-aggregated CSVs + `_meta.json`.                           |
| `scripts/lastfm-merge-candidates.mjs` | Flag raw Last.fm strings that are probably one song (a "fix on Last.fm" list). Never edits. |
| `scripts/lastfm-add-rule.mjs`         | Interactive wizard to add merge rules.                                                      |

### Get an export

Download **Recent Tracks** as CSV from <https://lastfm.ghan.nl/export/>. One row per
scrobble; columns: `uts,utc_time,artist,artist_mbid,album,album_mbid,track,track_mbid`.

### Regenerate everything

```
node scripts/lastfm-aggregate.mjs [--input <export.csv>] [--rules <rules.json>] [--outdir data/ref/lastfm]
```

## The core idea: version info lives in columns, not the title

Each scrobble is parsed into a **stripped base title** plus **dimension columns**. Grouping
is then just choosing which columns form the key.

### Columns (`tracks-variants.csv`, the finest base)

| Column         | Meaning                                                                                 |
| -------------- | --------------------------------------------------------------------------------------- |
| `mainArtist`   | lead artist (feat/&/,-collaborators removed); the ranking key                           |
| `title`        | base title with all recognized markers stripped                                         |
| `album`        | kept here (dropped by most rollups); lets album-aware rules/other sources differentiate |
| `language`     | `Korean`/`Chinese`/`English`/… or empty. From title labels, abbrevs, EXO-K/-M, or rules |
| `remix`        | specific remix / custom-version name (`Steve Aoki Remix`, `Voice Version`) or empty     |
| `live`         | `live` or empty                                                                         |
| `instrumental` | `instrumental` or empty                                                                 |
| `collab`       | `collab` if any feat/&/, collaborator was present                                       |
| `scrobbles`    | play count at this granularity                                                          |

Markers are **auto-extracted** from the title; parentheses are never significant on their
own (only the words inside matter). What code can't infer (e.g. EXO's raw `Growl` is Korean
or Chinese depending on album) is fixed with **rules** (below).

## Grouping profiles — which to use for which job

| Profile / file                     | Key columns                        | Live/Inst             | Use it for                                                                                                                                                                                                   |
| ---------------------------------- | ---------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `affinity` — `tracks-affinity.csv` | mainArtist, title                  | folded                | **Rough "how much do I like this song."** Fuzziest match that still separates artists.                                                                                                                       |
| `versions` — `tracks-versions.csv` | mainArtist, title, language, remix | **folded to nearest** | **Default.** Splits language versions, remixes, and custom versions (Voice Version, Sun Ver, Hotter Remix); live/instrumental collapse into their nearest sibling (a live-of-a-remix folds into that remix). |
| `pandora` — `tracks-pandora.csv`   | +live, +instrumental               | split                 | Split **everything** — live, instrumental, mashup all separate (parity with album-based sources).                                                                                                            |
| `title` — `track-titles.csv`       | title (artist shown)               | folded                | **Matching a title across different artists.** Fully stripped title.                                                                                                                                         |
| `chart` — `tracks-chart.csv`       | raw (artist, track)                | —                     | **Exact Last.fm replica.** Album-merged, title case-insensitive, artist case-SENSITIVE, symbol/CJK titles INCLUDED. No dimensioning.                                                                         |
| `literal` — `tracks-literal.csv`   | raw (artist, track, album)         | —                     | Rawest audit layer; no merging.                                                                                                                                                                              |
| `artists` — `artists.csv`          | —                                  | —                     | Artist-level plays, crediting **every** listed artist (a feature bumps the featured artist too).                                                                                                             |

Rule of thumb: **fuzziest that still keeps artists correct = `affinity`.** Everyday personal
stats = `versions`. Cross-artist title work = `title`. Anything comparing to Last.fm's own
numbers = `chart`.

All dimensioned files roll up from `tracks-variants.csv`; `rollup(baseRows, keys)` in the
shared lib re-aggregates by any column list, so new profiles are cheap.

## Custom rules (`merge-rules.json`)

Applied to the dimensioned layers, **never** to `chart`. Only needed for what code can't
infer. Matches are EXACT and case-SENSITIVE.

| Rule            | Shape                                                                          | Does                                                           |
| --------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `artistAliases` | `{ canonical, aliases[] }`                                                     | fold artist spelling variants into one                         |
| `titleAliases`  | `{ artist, canonical, aliases[] }`                                             | fold title variants code can't (different script/romanization) |
| `overrides`     | `{ match:{artist,track,album}, as?, set?:{language,remix,live,instrumental} }` | relabel one (artist,track,album) and/or set its dimensions     |
| `albumRules`    | `{ match:{artist,album}, set:{…} }`                                            | set dimensions for EVERY track on an album (e.g. a live album) |

Dimension precedence: `override.set` > `albumRule.set` > title auto-extraction.

Add rules interactively (no need to hand-edit JSON):

```
node scripts/lastfm-add-rule.mjs
```

## Merge-candidate report

```
node scripts/lastfm-merge-candidates.mjs [--reason case|accent|parens|label|artist|language|instrumental] [--fuzzy] [--inst-min 5]
```

Flags clusters of raw Last.fm strings that are probably one song, tagged by why they differ
(`case`, `accent`, `parens`, `label`, `artist`, `language`), plus a trailing `instrumental`
section for instrumentals with real play counts. It never edits — act on it via rules or by
correcting tracks on Last.fm (curated corrections: `data/ref/lastfm/lastfm-fixes.md`).

## Choosing a table from a script (table-map)

Consumers resolve their input CSV via `resolveTable(consumerName, opts)`:

- Reads `data/ref/lastfm/table-map.json` (`{ "<script>": "<profile|path>", "default": "versions" }`).
- **Defaults are baked into code**, so scripts work fork-safe when the file is absent.
- Runtime overrides (no edit to the committed map): `--table <profile|csv>` forces one
  table for the run; `--table-map <path>` uses an alternate mapping file.

The map's _values_ (personal choices) are documented in `data/ref/lastfm/README.md`.
