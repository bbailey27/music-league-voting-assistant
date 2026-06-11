# Music League Voting Assistant

Turn a saved Music League round into a ranked table with a **draft vote allocation**.

The parsing and scoring are **deterministic** (a Node script — no LLM, no guessing).
The agent/you only step in to rebalance points or research tricky "fit" calls.

- **Input:** a saved Music League round HTML file.
- **Output:** a readable markdown report + a canonical JSON sidecar in `analysis/`.

## Setup (one-time)

```bash
npm install                  # installs linkedom (parser) + eslint
```

You'll also want [`just`](https://github.com/casey/just) on your PATH (`brew install just`).
Everything works without it too — see [Without `just`](#without-just) below.

## Workflow

The whole flow is driven by `just run <name>`, where `<name>` is a **fuzzy match**
on the round (e.g. `tarot` or `2026-06-09`). It always runs the next step for you.

1. **Drop the round HTML into `rounds/`.** In Music League, let the page autosave,
   **reload it**, confirm your comment/score boxes are pre-filled, then save the
   page (or copy the page source) into a file at:

   ```text
   rounds/<roundname>.html        e.g. rounds/2026-06-09-tarot-hanged-man.html
   ```

   `<roundname>` is your choice (dated slugs work well); every later file is derived
   from it. See [Getting a usable HTML export](#getting-a-usable-html-export-important)
   for why the reload matters.

2. **Parse it.** Run the next step:

   ```bash
   just run tarot
   ```

   This writes the deterministic report + JSON sidecar:

   ```text
   analysis/<roundname>.md        ranked table + raw-order vote table
   analysis/<roundname>.json      canonical data (source for the fit step)
   ```

   For a plain (non-thematic) round, **you're done** — open the `.md` and enter votes.

3. **(Thematic/lyric rounds only) Fit research.** This is the one manual/agent step
   `run` won't do for you. The agent researches how each song fits the prompt and
   writes a JSON sidecar:

   ```text
   analysis/<roundname>-fit.json
   ```

4. **Render the fit report.** Run the next step again — now it renders HTML:

   ```bash
   just run tarot                 # → analysis/<roundname>-fit.html
   ```

   Open that self-contained, mobile-friendly HTML to review fit + enter votes.

Check where any round stands at any time:

```bash
just status                      # one line per round: what's done + what's next
just status tarot                # full checklist + next step for one round
```

## Command reference

`just` recipes forward to the dispatcher (`scripts/ml.mjs`); extra flags pass straight
through to the underlying scripts.

| Command                     | Does                                                                              |
| --------------------------- | --------------------------------------------------------------------------------- |
| `just run <name>`           | Run the next scriptable step (parse, or render fit HTML).                         |
| `just status [name]`        | Pipeline checklist + next step (no name = every round).                           |
| `just parse <name> [flags]` | Force the parse step. Flags: `--mode objective\|subjective`, `--no-json`.         |
| `just fit <name> [flags]`   | Render the fit JSON to HTML. Flags: `--out <path>`, `--order fit\|combined\|raw`. |

- `--mode objective` (default): a comment with words but no number is **disqualified**.
- `--mode subjective`: a words-only comment is flagged **needs review** instead.
- **Fuzzy names** match exact → case-insensitive substring → subsequence. An ambiguous
  query (e.g. `2026` when two rounds match) lists the candidates instead of guessing.
- Blank score boxes (an incomplete export) show as a `⚠` warning, never a blocker.

### Without `just`

Use the npm script (note the `--` before args) or call the scripts directly:

```bash
npm run ml -- run tarot          # same dispatcher, no just needed
npm run ml -- status

node scripts/parse-round.mjs rounds/2026-06-09-tarot-hanged-man.html [--mode ...] [--no-json]
node scripts/render-fit-html.mjs analysis/2026-06-09-tarot-hanged-man-fit.json [--out ...] [--order ...]
```

### Linting

`just lint` (or `npm run lint`) checks both JS (ESLint) and Markdown
(markdownlint); `just fix` (or `npm run fix`) auto-fixes what it can. The
markdownlint config (`.markdownlint-cli2.jsonc`) is shared with the VS Code
markdownlint extension, so editor warnings and the CLI agree.

## Getting a usable HTML export (important)

Your scores live in the comment box, which is bound in-memory (Alpine `x-model`).
A plain "Save Page As" / DOM copy **does not** capture unsaved text — only comments that
have been **saved to the server and reloaded** appear in the HTML (as `data-comment`).

So before exporting: let the page autosave, **reload it**, confirm your comments are
pre-filled, then save the HTML. Otherwise most songs will come through as "needs a score".

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

Tiers come **solely from the spread of scores in that round** — there are no fixed
thresholds. Among eligible songs (scored, not disqualified, not awaiting a score):
`weight = score − lowest score present`, the budget is distributed by largest-remainder
on those weights, and each song is clamped to the per-song cap.

- **Tiebreaks** (equal scores / same boundary): higher score, then `play ≥ + > plain > -`.
- **Uncertainty:** a `?` song sitting right at a point boundary is surfaced under
  "Needs review" rather than being auto-pushed down.

Known limitation: when a round is densely scored and **oversubscribed** (more candidates
than points), the simple draft spreads `1`s across the top and can't form higher tiers.
That's expected — treat the allocation as a starting point and rebalance. A modal-centered
"bell curve" allocation that concentrates points is planned but not yet implemented.

## The report

`analysis/<roundname>.md` contains:

- a header with mode, budget, and counts (scored / disqualified / needs-score / needs-review),
- a **ranked table** (Rank · Title · Artist · Score · Votes · Flags · Comment),
- a **raw-order table** for entering votes back into Music League in song order,
- lists of songs that need a score, were disqualified, or need review.

## The fit report (HTML)

For lyric/theme rounds, the fit research lives in a JSON sidecar
(`analysis/<roundname>-fit.json`) that the agent produces (workflow step 3) —
that JSON is the source of truth. `just run <name>` renders it to HTML once it
exists; to (re)render explicitly:

```bash
just fit tarot [--out <path>] [--order fit|combined|raw]
# without just: node scripts/render-fit-html.mjs analysis/<roundname>-fit.json [...]
```

The HTML (not a markdown table) is the going-forward fit format: each candidate
is a **card** with a narrow identity column (raw-order # / title / artist
stacked) so the rationale/notes get the full width instead of being squeezed by
a wide table. Output is self-contained (inline CSS, no network), light/dark
aware, and collapses to a single column on mobile — handy for the eventual
client-side app.

- `--order fit` (default): sort cards by `fitScore` (raw-order # still shown on each).
- `--order combined`: sort by `combinedScore` (the music+fit blend), when music scores have been merged in.
- `--order raw`: keep Music League submission order.
- Optional `highlights` (string array) and `combine` (`{ note, options[] }`)
  fields in the JSON render as extra sections when present.
- When songs carry `draftVotes`, the report ends with a **vote-transfer table**: raw
  submission order with just `#` / title / artist / points + total, for copying votes
  back into Music League.

## Repo layout

- `scripts/ml.mjs` — friendly dispatcher (fuzzy names, `run`/`status`, next-step inference).
- `scripts/parse-round.mjs` — the deterministic parser + allocator (HTML → `.md` + `.json`).
- `scripts/render-fit-html.mjs` — renders a fit JSON sidecar to a self-contained HTML report.
- `justfile` — `run` / `status` / `parse` / `fit` recipes forwarding to `scripts/ml.mjs`.
- `rounds/` — your round HTML exports, `<roundname>.html` (git-ignored).
- `analysis/` — generated `<roundname>.md` / `.json` and `<roundname>-fit.json` / `.html` (git-ignored).
- `spec/` — the scoring/allocation rules in prose (`score-parsing`, `point-allocation`,
  `comments`, `uncertainty`, `fit-evaluation`, `fit-guidance`). `decisions.md` is the
  running log of how/why those rules changed.
- `tests/regressions/` — captured failure cases to guard against.
- `.cursor/rules/` — agent guidance mirroring the specs.
