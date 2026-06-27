# Music League Voting Assistant

Turn a saved Music League round into a ranked table with a **draft vote allocation**.

The parsing and scoring are **deterministic** (a Node script — no LLM, no guessing).
The agent/you only step in to rebalance points or research tricky "fit" calls.

- **Input:** a saved Music League round HTML file.
- **Output:** per-round folder under `data/analysis/<roundname>/` — see [spec/analysis-artifacts.md](spec/analysis-artifacts.md).

## Setup (one-time)

```bash
# if you don't have them already (just is optional)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install just
# for this project
npm install                  # installs linkedom (parser) + eslint
```

You'll want `[just](https://github.com/casey/just)` on your PATH (`brew install just`).
Everything works without it too — see [Without `just](#without-just)` below.

### Private data

Round inputs, analysis outputs, and reference data are **not** stored in this repo.
They live in a separate **private** git repository (`music-league-data`) mounted as a
git submodule at `**data/`\*\* (`data/rounds/`, `data/analysis/`, `data/ref/`). This keeps
the code public as a portfolio while exact round comments and personal lists stay private.

Note: The original device needs the github-personal alias referenced in .gitmodules. On other devices, set a local alias for the correct url:

```bash
git config submodule.data.url https://github.com/bbailey27/music-league-data.git
# or, with ssh
git config submodule.data.url git@github.com:bbailey27/music-league-data.git
```

Clone with the data (if you have access to the private repo):

```bash
git clone --recurse-submodules <this-repo-url>
# or, in an existing clone:
git submodule update --init
```

Without access to the private repo, `data/` stays empty and the scripts have nothing to
operate on — the code still builds, lints, and passes tests (which use the synthetic
`tests/fixtures/sample-round/`).

## Workflow

The pipeline has **four stages**. Only **parse** reads HTML; everything else is JSON.

```text
parse → (merge) → pick → final
  │        │        │       └─ music.html or scores.html
  │        │        └─ pick record + picks.jsonl
  │        └─ scores.json (thematic only)
  └─ music.md + music.json
```

`<name>` is a **fuzzy match** on the round (e.g. `tarot` or `2026-06-09`). Prefer
`just run <name>` to run the next scriptable step, or `just status <name>` for a
checklist.

### Music-only

After voting is complete and comments are saved in the HTML export:

```bash
just parse my-round          # HTML → music.md + music.json
just pick my-round B --reason "flatter split feels right"
just final my-round          # → music.html
```

Open `data/analysis/<round>/music.md` for the ranked table and option letters before
picking. Re-parse (`just parse`) **only** when you replace the HTML export — pick is
always a separate JSON step.

### Thematic / lyric rounds

```bash
just parse tarot
# agent researches fit → writes data/analysis/tarot/fit.json
just merge tarot             # music.json + fit.json → scores.json
just pick tarot C --reason "thematic standouts on the 75 anchor"
just final tarot             # → scores.html
```

Fit research is the one step `just run` cannot do for you.

### Getting a usable HTML export

In Music League, let the page autosave, **reload it**, confirm your comment/score boxes
are pre-filled, then save the page (or copy the page source) into
`data/rounds/<roundname>.html`. Unsaved in-memory comments (`x-model`) are not
captured; only server-saved comments appear as `data-comment`. See
[Getting a usable HTML export](#getting-a-usable-html-export-important) below.

### Status

```bash
just status                      # one line per round: what's done + what's next
just status tarot                # full checklist + next step for one round
just help                        # workflow overview
just help pick                   # flags + example for one stage
```

## Recording your pick

> **I parsed a music-only round. How do I record my final choice?**
>
> 1. Open `data/analysis/<round>/music.md` — note the option letters (A/B/C) in the
>    tier-structure tradeoff.
> 2. `just pick <round> <letter> --reason "optional note"` — updates JSON only; does
>    **not** re-read HTML. Full A/B/C menu is preserved in `pick.options`.
> 3. `just final <round>` — refresh `music.html`.
>
> Stored in `<round>/music.json` (`pick`) and `data/analysis/picks.jsonl` (training log).

## Command reference

`just` recipes forward to the dispatcher (`scripts/ml.mjs`); extra flags pass straight
through to the underlying scripts. Run `just --list` or `just help` for the full set.

| Command                      | Stage                                     | Reads HTML? |
| ---------------------------- | ----------------------------------------- | ----------- |
| `just parse <name>`          | HTML → `music.json`                       | Yes         |
| `just merge <name>`          | `music.json` + `fit.json` → `scores.json` | No          |
| `just pick <name> <A\|B\|C>` | record distribution choice                | No          |
| `just fit <name>`            | render `fit.html` from `fit.json`         | No          |
| `just scores <name>`         | render `scores.html` from `scores.json`   | No          |
| `just final <name>`          | render deliverable HTML                   | No          |
| `just run <name>`            | next scriptable step                      | varies      |
| `just status [name]`         | pipeline checklist                        | —           |
| `just help [cmd]`            | workflow / per-command flags              | —           |
| `just tidy`                  | date-slug + archive stale rounds          | —           |

**Flag ownership:** explore allocation with `--shape`, `--tier-count`, `--pin` on
**parse**; thematic profile with `--rank`, `--weights`, `--gate` on **merge**; record
the choice with `--option`/`--reason`/`--pin` on **pick** (via `just pick`).

Deprecated on parse (warns): `--fit`, `--option`, `--reason` — use `just merge` and
`just pick` instead.

### Without `just`

Use the npm script (note the `--` before args) or call the scripts directly:

```bash
npm run ml -- run tarot
npm run ml -- help pick

node scripts/parse-round.mjs data/rounds/<round>.html
node scripts/merge-scores.mjs <round-id>
node scripts/pick-round.mjs <round-id> B --reason "…"
node scripts/render-final-html.mjs data/analysis/<round>/music.json
node scripts/render-fit-html.mjs data/analysis/<round>/scores.json
```

Docs and tests use the synthetic fixture at `tests/fixtures/sample-round/` instead of live round files.

Retired rounds may live in `data/rounds/archive/` or `data/analysis/archive/` (ignored by parsing; check there when looking up old rounds).

### Linting

`just lint` (or `npm run lint`) checks both JS (ESLint) and Markdown
(markdownlint); `just fix` (or `npm run fix`) auto-fixes what it can. The
markdownlint config (`.markdownlint-cli2.jsonc`) is shared with the VS Code
markdownlint extension, so editor warnings and the CLI agree.

## Getting a usable HTML export (important)

See **Workflow step 1** — autosave, reload, confirm pre-filled comments, then save the
HTML. Unsaved in-memory comments (`x-model`) are not captured; only server-saved comments
appear as `data-comment`.

## What the parser reads (per song)

From each `div.song`, skipping your own submissions (`mine: true`):

- `title`, `artist`, `album`
- **your comment** (`data-comment`) — the only source of scoring signals
- the submitter's quote — preserved for context, **never scored**
- Spotify URI, and any pre-allocated weight
- the round's vote budget (`upvoteBankSize`, `maxUpvotesPerSong`) from the page config

## How comments are scored (your comment only)

**Full guide:** [spec/scoring-comments.md](spec/scoring-comments.md) — how to write
comments (music first, fit on the remainder, tier/gate tables, `--fit-words`).

| You wrote             | Interpreted as                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `755`                 | 75.5 (3 digits → ÷10)                                                                      |
| `73`                  | 73 (2 digits → as-is)                                                                      |
| `7`                   | 70 (1 digit → ×10)                                                                         |
| `74 soft punk`        | 74, with the text kept as the comment                                                      |
| `73+` / `73=`         | 73, `+` up-nudge tiebreak                                                                  |
| `73-`                 | 73, `-` down-nudge tiebreak                                                                |
| `74?`                 | 74, score-uncertain (`?` on the number)                                                    |
| `75+?` / `7-?`        | modifier applies; `?` qualifies the `+` or `-`, not the score                              |
| `74 play`             | 74, playlist-add (positive tiebreak)                                                       |
| `74 play?`            | 74, playlist nudge; `?` qualifies `play`, not the score                                    |
| `-` (bare)            | disqualified — true DQ _or_ an unspecified low score unlikely to place; either way no vote |
| words only, no number | disqualified (objective) / needs review (subjective)                                       |
| empty box             | needs a score (you'll be prompted, never invented)                                         |

Use `just parse <round> --fit-words` when comments include tier/gate words or a bare
second fit number — see [spec/scoring-comments.md](spec/scoring-comments.md).

## How the draft allocation works

Tiers come from the **spread of scores in that round** — no fixed thresholds. Among
eligible songs (scored, not disqualified, not awaiting a score), the allocator builds
a **center-out staircase**: a baseline 1/0 cutoff plus `+1` promotion steps on natural
score gaps (and 75/80 anchors), so adjacent point tiers differ by exactly 1 by
construction.

1. **1-D clustering** (Ckmeans.1d.dp) finds natural score gaps; equal scores stay in
   the same tier (`tierKey`). Scores ≥ 80 merge into one shared favorite top tier by
   default (R2).
2. **`auto` shape** enumerates budget-exact staircases and prefers the shortest top
   that lands on real gaps — no cap-reaching waterfill.
3. **Gate rounds** (`passFailMaybe`): passes are shaped first; maybes fund only at or
   below the lowest pass tier.
4. Budget is spent exactly; per-song caps enforced. Ambiguous splits surface as
   `tier-structure` tradeoffs — record your choice with `just pick`.

Dense or oversubscribed rounds naturally push more songs to 0 — treat the output as a
starting point and rebalance. Full model: [spec/point-allocation.md](spec/point-allocation.md).

## The report

`data/analysis/<roundname>/music.md` contains:

- a header with mode, budget, and counts (scored / disqualified / needs-score / needs-review),
- a **ranked table** (Rank · Title · Artist · Score · Votes · Flags · Comment),
- a **raw-order table** for entering votes back into Music League in song order,
- lists of songs that need a score, were disqualified, or need review.

## The fit report (HTML)

For lyric/theme rounds, fit research lives in `data/analysis/<roundname>/fit.json`
(workflow step above). Merge with:

```bash
just merge tarot
just scores tarot   # deliverable HTML from scores.json
```

Card layout, sort orders, optional `highlights`/`combine`, and the vote-transfer table
are documented in [spec/fit-evaluation.md](spec/fit-evaluation.md) → Output.

## Repo layout

- `scripts/ml.mjs` — dispatcher (fuzzy names, `run`/`status`/`help`, next-step inference).
- `scripts/paths.mjs` — shared analysis folder + artifact naming.
- `scripts/parse-round.mjs` — HTML/text → `music.*` (parse stage only).
- `scripts/merge-scores.mjs` — `music.json` + `fit.json` → `scores.json`.
- `scripts/pick-round.mjs` — JSON-only distribution pick + `picks.jsonl`.
- `scripts/render-fit-html.mjs` — renders `fit.json` or `scores.json` to HTML.
- `scripts/render-final-html.mjs` — renders `music.json` to `music.html`.
- `scripts/score/` — allocation core (`allocate.mjs`, `merge.mjs`, `render.mjs`, …).
- `scripts/one-off/` — round-specific drivers (not the main pipeline).
- `justfile` — `parse` / `merge` / `pick` / `final` / `status` / `help` recipes.
- `data/` — **private** submodule (`music-league-data`); not part of this public repo.
  - `data/rounds/` — flat round HTML exports; optional `data/rounds/archive/`.
  - `data/analysis/` — per-round folders `data/analysis/<roundname>/`; optional `data/analysis/archive/`.
  - `data/ref/` — reference data (e.g. personal favorites list).
- `spec/analysis-artifacts.md` — naming convention for music / fit / scores files.
- `tests/fixtures/sample-round/` — synthetic round for docs and tests.
- `spec/` — the scoring/allocation rules in prose (`score-parsing`, `scoring-comments`,
  `point-allocation`, `comments`, `uncertainty`, `fit-evaluation`, `fit-guidance`). `decisions.md` is the
  running log of how/why those rules changed.
- `tests/regressions/` — captured failure cases to guard against.
- `.cursor/rules/` — agent guidance mirroring the specs.
