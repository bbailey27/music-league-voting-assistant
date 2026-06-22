---
name: submission-song-search
description: >-
  Find candidate songs to SUBMIT for a themed/lyric Music League round by searching the
  favorites CSV + artist discographies, verifying meaning against real lyrics. Use when the
  user wants help picking what to submit for a prompt (e.g. a tarot archetype), asks to mine
  fav-songs.csv / a mood CSV / an artist's catalog for theme fits, or to research song meanings.
  This is the PRE-round "what should I submit" task — distinct from round-fit-research, which
  scores the songs already in a round's vote page.
---

# Submission song search

Mine the user's library + target discographies for songs that fit a round prompt, verify by
**lyrics not titles**, and record results so future rounds don't re-search the same songs.

This task burns web searches, so the whole method is about **searching less**: reuse prior
research, scan without truncation, prune the candidate list with the user, do a cheap
meaning pass before any deep lyric dive, and work in chunks.

## Inputs & outputs

| Thing                                | Location                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Prompt + theme keywords              | from the user                                                                                            |
| Favorites                            | `data/ref/fav-songs.csv` (cols: Track, Artist, All Playlists, …)                                         |
| Mood/extra CSVs                      | e.g. `data/ref/chill-minor-rock-etc-search.csv` (BOM + extra `Playlist name` col before `All Playlists`) |
| **Prior research (check FIRST)**     | `data/ref/song-topic-summaries.csv` — neutral topic summaries; reuse before searching                    |
| Per-round writeup (fit analysis)     | `data/analysis/<round>/candidates.md`                                                                    |
| Candidate shortlist for user pruning | `data/analysis/<round>/shortlist.md`                                                                     |

Two record types, kept separate:

- **`ref/song-topic-summaries.csv`** — `track,artist,summary,lyrics_url,analysis_url,verify`.
  **Neutral topic summary only** (what the song is about), no round-specific fit judgment. Reusable
  across all rounds. Append every song you look up or already know. Quote any field containing a
  comma (some lyrics/translation URLs have commas in them).
  - **`lyrics_url` vs `analysis_url` are different things — keep them in the right column:**
    - `lyrics_url` = a page that actually shows the **words** (English lyrics, a line-by-line
      translation, or romanization). Prefer English-bearing: Genius `*-english-translation`,
      `lyricstranslate.com/en/...`, matchlyric/lyricsfa/kgasa/letras "english" pages, or an
      English-original song's lyrics. A romanization/Hangul-only page (most `colorcodedlyrics.com`,
      `letras.mus.br`, `versuri.org`) is still lyrics — keep it, but it can't confirm meaning.
    - `analysis_url` = a page that explains the **meaning** but has no lyrics — reviews, interviews,
      track-by-track breakdowns, wikis (e.g. `seoulbeats.com`, `rollingstoneindia.com`,
      `thebiaslist.com`, `kpopofficial.com`, `*.fandom.com`, `en.wikipedia.org`).
    - A single site can be **both** (e.g. a Genius page with annotations, or a
      translation+meaning blog) — then `lyrics_url` alone is enough and `analysis_url` stays empty.
    - **Never leave a row with only an analysis link.** If the meaning source has no lyrics, put it
      in `analysis_url` AND add a real `lyrics_url` (do a direct lyrics search — see step 5).
  - `verify` column is an honesty tag for how the summary's meaning is grounded:
    - `en` — English lyrics/translation (or solid English analysis) is reachable from the links; a reader can click and check.
    - `rom` — only a romanization/Hangul lyrics link exists (no English anywhere); the summary rests on the search-engine synthesis and/or your own Korean reading. Use sparingly, only after confirming no English translation exists.
    - `none` — no link (a song you already knew, or only lightly checked). Treat these summaries as lowest-confidence.
- **`analysis/<round>/candidates.md`** — round-specific ranking + fit rationale + caveats +
  drops. The deliverable for this round only.

## Workflow

### 1. Frame the theme

Restate prompt keywords and the _distinction_ that kills false positives (e.g. The Hermit =
chosen/contented solitude & inner guidance, **not** sad loneliness or romantic longing). Apply
any `spec/fit-guidance.md` lens (e.g. `traits-over-symbols`: judge lyric meaning, not title/symbol).

Get the user's **skip lists**: songs already used in prior rounds, and songs they've rejected.

### 2. Reuse prior research

Grep `data/ref/song-topic-summaries.csv` for the candidate artists/titles first. Anything with a
summary there does **not** need a new search — judge fit from the stored summary.

### 3. Scan candidates WITHOUT truncation (the #1 failure mode)

Large CSV/discography lists overflow tool output and the **tail gets silently cut** — that is
how real candidates get missed. Defend against it:

- Don't read big CSVs raw (they blow the read limit). Write a small Node scan script
  (`scripts/hermit-scan.mjs` is a working template) that parses the CSV (handle quotes + BOM)
  and prints a **count** plus the list.
- **Always print and check the total** ("159 promising rows"). If the printed list looks shorter
  than the count, it was truncated — re-run writing output to a file and read the file, or page
  through with offset/limit. Never trust that a long inline list is complete.
- Score/filter to a promising subset: title keywords + introspective artists + mood-playlist
  tags (e.g. "Oh It's Minor"). Sort, but **process the whole list**, tail included.

### 4. Hand the user a prune-able shortlist (saves the most searches)

Write the promising subset to `data/analysis/<round>/shortlist.md` as a checklist the user can
edit, e.g.:

```markdown
# <Round> — candidate shortlist (delete any you already know are irrelevant)

- [ ] Song A — Artist
- [ ] Song B — Artist
```

Ask the user to delete rows they already know don't fit (already used, obviously off-theme,
remakes, etc.). Only the survivors go to the deep pass. State this explicitly so they know
pruning = fewer searches.

### 5. Cheap meaning pass before deep lyric dive

For survivors, run quick **"<song> meaning"** web searches in **batches of ~6** (parallel tool
calls in one message). One synthesis line per song is enough to drop the romantic/breakup ones.
Only the songs that survive the cheap pass get a full-lyric verification search. Append every
result to `song-topic-summaries.csv` as you go.

**Capture a real English source, not just a search-result link.** The search synthesis aggregates
meaning from translations elsewhere — when you save the row, link the page that actually shows the
English (or, if none exists, the rom-only link), and set `verify` accordingly (see the `verify`
column above).

**A `meaning` search alone often misses the lyrics page.** `"<song> meaning"` is great for the
cheap pass, but it surfaces reviews/interviews (analysis) and frequently buries or omits the Genius
lyrics. To fill `lyrics_url`, run a **separate, direct** search — `"<song> <artist> lyrics english"`
(this reliably surfaces the Genius `*-english-translation` page that a `meaning` search buries) —
and save the lyrics page in `lyrics_url`, keeping the analysis page (if useful) in `analysis_url`.
Don't settle for an analysis-only link, and don't conclude "no English translation exists" from a
`meaning` search alone.

### 6. Chunk + pull candidates after each batch

Work in chunks of ~6 and write findings into `candidates.md` after **each** chunk (don't hold
everything in context). Update a TODO list per chunk so progress survives truncation/compaction.

### 7. Write up

- Append neutral summaries to `ref/song-topic-summaries.csv` (all looked-up songs).
- In `analysis/<round>/candidates.md`: rank solids → moderates → borderline → checked-and-dropped
  (with one-line reasons) → excluded (skip list). Note artist patterns and audience prefs
  (e.g. "league dislikes BTS → de-prioritize BTS fits").

## Hard-won lessons

- **Verify "in/not in library" by TITLE across BOTH CSVs, not by artist.** Two real misses:
  a solo song can be credited to the **group** (`Boy in time (HUI Solo)` is filed under artist
  _PENTAGON_, so an artist=HUI lookup wrongly said "not in favorites"), and a **common title
  collides** across artists (`Zombie` in `fav-songs.csv` is EVERGLOW / Bad Wolves — DAY6's "Zombie"
  is in the mood CSV, not favorites). When you stamp a provenance line, grep the **title** in both
  `fav-songs.csv` and the mood CSV(s) and confirm the artist on that row; never conclude from an
  artist-name miss alone, and never assume a title hit is the right artist.
- **Titles lie.** "Loner / Insomnia / Empty / Compass / Coordinates" routinely turn out to be
  breakup/romantic songs. Verify lyrics before recommending.
- **Artist tendencies repeat:** LUCY skews upbeat/communal; ONEWE skews cosmic-love; TXT cuts
  trend romantic. Use these priors to prioritize, but still verify.
- **Instrumentals** (e.g. The Rose "Dawn"/"Dusk") have no lyrics — don't rank them.
- A strong-looking _album concept_ (e.g. "Identity") often isn't the _song's_ actual lyric.
- Record the why-dropped, so the next round's research doesn't re-litigate it.

## Don't

- Don't rely on inline output for lists > ~100 rows without verifying against a printed count.
- Don't deep-search before the user prunes the shortlist (wastes searches).
- Don't put fit/round judgement in `song-topic-summaries.csv` — summaries must stay reusable.
- Don't commit `data/` outputs unless the user asks (`.cursor/rules/no-auto-commit.mdc`).

```

```
