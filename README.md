# Music League Voting Assistant

Turn a saved Music League round into a ranked table with a **draft vote allocation**.

The parsing and scoring are **deterministic** (a Node script — no LLM, no guessing).
The agent/you only step in to rebalance points or research tricky "fit" calls.

- **Input:** a saved Music League round HTML file.
- **Output:** per-round folder under `data/analysis/<roundname>/` — see [spec/analysis-artifacts.md](spec/analysis-artifacts.md).

## Setup (one-time)

```bash
npm install                  # installs linkedom (parser) + eslint
```

You'll also want [`just`](https://github.com/casey/just) on your PATH (`brew install just`).
Everything works without it too — see [Without `just`](#without-just) below.

### Private data

Round inputs, analysis outputs, and reference data are **not** stored in this repo.
They live in a separate **private** git repository (`music-league-data`) mounted as a
git submodule at **`data/`** (`data/rounds/`, `data/analysis/`, `data/ref/`). This keeps
the code public as a portfolio while exact round comments and personal lists stay private.

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

The whole flow is driven by `just run <name>`, where `<name>` is a **fuzzy match**
on the round (e.g. `tarot` or `2026-06-09`). It always runs the next step for you.

1. **Drop the round HTML into `data/rounds/`.** In Music League, let the page autosave,
   **reload it**, confirm your comment/score boxes are pre-filled, then save the
   page (or copy the page source) into a file at:

   ```text
   data/rounds/<roundname>.html        e.g. data/rounds/2026-06-09-tarot-hanged-man.html
   ```

   `<roundname>` is your choice (dated slugs work well); every later file is derived
   from it. Reload after autosave so comments appear as `data-comment` (see
   [Getting a usable HTML export](#getting-a-usable-html-export-important)).

2. **Parse it.** Run the next step:

   ```bash
   just run tarot
   ```

   This writes the music-only report + JSON:

   ```text
   data/analysis/<roundname>/music.md        ranked table + raw-order vote table (+ round description)
   data/analysis/<roundname>/music.json      canonical data (source for the fit step)
   ```

   For a plain (non-thematic) round, **you're done** — open `music.md` and enter votes.

3. **(Thematic/lyric rounds only) Fit research.** This is the one manual/agent step
   `run` won't do for you. The agent researches how each song fits the prompt and
   writes:

   ```text
   data/analysis/<roundname>/fit.json
   ```

4. **Merge fit + music, then render.** Merge (manual or agent):

   ```bash
   node scripts/parse-round.mjs data/rounds/<roundname>.html --fit data/analysis/<roundname>/fit.json
   ```

   That writes **`scores.json`** (deliverable — merged `draftVotes`; `fit.json` stays fit-only).
   Then:

   ```bash
   just run tarot                 # → scores.html when scores.json exists
   just scores tarot              # force re-render deliverable HTML
   just fit tarot                 # fit-only HTML from fit.json
   ```

Check where any round stands at any time:

```bash
just status                      # one line per round: what's done + what's next
just status tarot                # full checklist + next step for one round
```

## Command reference

`just` recipes forward to the dispatcher (`scripts/ml.mjs`); extra flags pass straight
through to the underlying scripts.

- **`just run <name>`** — run the next scriptable step (parse, render scores/fit HTML).
- **`just status [name]`** — pipeline checklist + next step (no name = every round).
- **`just parse <name> [flags]`** — force parse; flags: `--mode objective|subjective`, `--no-json`.
- **`just fit <name> [flags]`** — render fit-only HTML from `fit.json`.
- **`just scores <name> [flags]`** — render deliverable HTML from `scores.json`.
- **`just final <name> [flags]`** — render scores or music HTML (whichever applies).

- **`--mode`**, **fuzzy names**, and **blank score boxes** — same rules as [Workflow](#workflow) step 1 and [How comments are scored](#how-comments-are-scored-your-comment-only) below.

### Without `just`

Use the npm script (note the `--` before args) or call the scripts directly:

```bash
npm run ml -- run tarot          # same dispatcher, no just needed
npm run ml -- status

node scripts/parse-round.mjs data/rounds/2026-06-09-tarot-hanged-man.html [--mode ...] [--no-json]
node scripts/parse-round.mjs data/rounds/2026-06-09-tarot-hanged-man.html --fit data/analysis/2026-06-09-tarot-hanged-man/fit.json
node scripts/render-fit-html.mjs data/analysis/2026-06-09-tarot-hanged-man/scores.json [--out ...] [--order ...]
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

| You wrote                 | Interpreted as                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `755`                     | 75.5 (3 digits → ÷10)                                                                      |
| `73`                      | 73 (2 digits → as-is)                                                                      |
| `7`                       | 70 (1 digit → ×10)                                                                         |
| `74 soft punk`            | 74, with the text kept as the comment                                                      |
| `73+` / `73=`             | 73, `+` up-nudge tiebreak                                                                  |
| `73-`                     | 73, `-` down-nudge tiebreak                                                                |
| `74?`                     | 74, `?` uncertainty flag (not negative)                                                    |
| `74 play`                 | 74, playlist-add (positive tiebreak)                                                       |
| `no` / `nope` / `invalid` | disqualified (no vote)                                                                     |
| `-` (bare)                | disqualified — true DQ _or_ an unspecified low score unlikely to place; either way no vote |
| words only, no number     | disqualified (objective) / needs review (subjective)                                       |
| empty box                 | needs a score (you'll be prompted, never invented)                                         |

## How the draft allocation works

Tiers come from the **spread of scores in that round** — no fixed thresholds. Among
eligible songs (scored, not disqualified, not awaiting a score), the allocator matches
your **opinion curve** (score distribution) to a **point curve** (budget ÷ eligible
songs), anchored on the **mode** (most common score), not the floor — disqualified
entries are excluded entirely.

1. **1-D clustering** (Ckmeans.1d.dp) finds natural score gaps; equal scores stay in
   the same tier (`tierKey`).
2. A **mode-centered bell** sets tier point targets; **`auto`** widens the curve as the
   points-to-songs ratio grows.
3. **Smoothness rule:** songs ≤1 score apart never end >1 point apart; big jumps only
   on real gaps (>1 score).
4. Budget is spent exactly via monotonic waterfill; per-song caps enforced.

- **Tiebreaks** (equal scores): higher score, then `play ≥ + > plain > -`.
- **Uncertainty:** `?` at a tier boundary surfaces under "Needs review."
- **Ambiguous splits:** may emit `tier-structure` tradeoffs; pin with `--tier-count` or
  `--bucket-count`.

Dense or oversubscribed rounds naturally push more songs to 0 — treat the output as a
starting point and rebalance. Full model: [spec/point-allocation.md](spec/point-allocation.md).

## The report

`data/analysis/<roundname>/music.md` contains:

- a header with mode, budget, and counts (scored / disqualified / needs-score / needs-review),
- a **ranked table** (Rank · Title · Artist · Score · Votes · Flags · Comment),
- a **raw-order table** for entering votes back into Music League in song order,
- lists of songs that need a score, were disqualified, or need review.

## The fit report (HTML)

For lyric/theme rounds, fit research lives in **`data/analysis/<roundname>/fit.json`**
(workflow step 3). Merge with music scores to produce **`scores.json`** /
**`scores.html`** — the deliverable.

```bash
just fit tarot [--out <path>] [--order fit|combined|raw]
just scores tarot   # deliverable HTML from scores.json
```

Card layout, sort orders, optional `highlights`/`combine`, and the vote-transfer table
are documented in [spec/fit-evaluation.md](spec/fit-evaluation.md) → Output.

## Repo layout

- `scripts/ml.mjs` — friendly dispatcher (fuzzy names, `run`/`status`, next-step inference).
- `scripts/paths.mjs` — shared analysis folder + artifact naming.
- `scripts/parse-round.mjs` — deterministic parser + allocator (HTML → `music.*`; `--fit` → `scores.json`).
- `scripts/render-fit-html.mjs` — renders `fit.json` or `scores.json` to HTML.
- `scripts/one-off/` — round-specific drivers (not the main pipeline).
- `justfile` — `run` / `status` / `parse` / `fit` / `scores` recipes forwarding to `scripts/ml.mjs`.
- `data/` — **private** submodule (`music-league-data`); not part of this public repo.
  - `data/rounds/` — flat round HTML exports; optional `data/rounds/archive/`.
  - `data/analysis/` — per-round folders `data/analysis/<roundname>/`; optional `data/analysis/archive/`.
  - `data/ref/` — reference data (e.g. personal favorites list).
- `spec/analysis-artifacts.md` — naming convention for music / fit / scores files.
- `tests/fixtures/sample-round/` — synthetic round for docs and tests.
- `spec/` — the scoring/allocation rules in prose (`score-parsing`, `point-allocation`,
  `comments`, `uncertainty`, `fit-evaluation`, `fit-guidance`). `decisions.md` is the
  running log of how/why those rules changed.
- `tests/regressions/` — captured failure cases to guard against.
- `.cursor/rules/` — agent guidance mirroring the specs.
