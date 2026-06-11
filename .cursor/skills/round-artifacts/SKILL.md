---
name: round-artifacts
description: >-
  Round file naming, HTML/text capture conventions, and pipeline artifact paths
  for Music League rounds. Use when adding a new round export, naming analysis
  outputs, checking pipeline status, or troubleshooting missing scores in HTML.
disable-model-invocation: true
---

# Round artifacts

## Naming

Pick one **round basename** and reuse it everywhere:

```
rounds/<roundname>.html          primary input (preferred)
rounds/<roundname>.txt           pasted text fallback
analysis/<roundname>.md          parse report
analysis/<roundname>.json        canonical parse data
analysis/<roundname>-fit.json    fit research (thematic only)
analysis/<roundname>-fit.html    rendered fit report
```

Dated slugs work well: `2026-06-09-tarot-hanged-man`. The dispatcher fuzzy-matches substrings (`tarot`, `2026-06-09`).

## Pipeline checklist

```bash
just status <name>    # [input][parse][fit-json][fit-html] + next step
```

Stages:

1. **Input** — `.html` preferred; `.txt` when HTML unavailable (Live Text). If both exist, parse prefers HTML.
2. **Parse** — `.md` + `.json` must both exist.
3. **Fit research** — manual/advisory; only for thematic or subjective fit rounds.
4. **Fit HTML** — rendered from `-fit.json`; stale if JSON mtime > HTML mtime.

`just run <name>` executes the next **scriptable** step only (parse or render). Fit research is never auto-run.

## Capturing HTML (critical)

Music League binds comments in-memory (Alpine `x-model`). A plain save/copy **without reload** yields empty `data-comment` attributes.

Before export:

1. Let the page autosave.
2. **Reload** the page.
3. Confirm comment boxes are pre-filled.
4. Save page source to `rounds/<roundname>.html`.

Parser reads per `div.song` (skips `mine: true`):

- `data-comment` — your score/comment (only scoring source)
- `data-weight` — pre-allocated votes (floor in allocator)
- `h6` title, artist/album spans, submitter quote (`i.bi-quote`, context only)
- Budget from root `[x-data]` (`upvoteBankSize`, `maxUpvotesPerSong`, …)
- Round prompt from `<title>`: `Music League | <league> | <prompt>`

## Text capture

Use when in-app browser blocks selection; OS Live Text → paste to `rounds/<roundname>.txt`.

- **Strict:** `Album art` block delimiter + `N / 1000` comment-length footer per song.
- **Lenient:** auto when anchors missing; pass `--lenient` to force. Footer anchors comment line; rows flagged `needsReview`.

See **parse-scores-pipeline** for commands.

## Git

`rounds/` and `analysis/` are gitignored — local working data only.
