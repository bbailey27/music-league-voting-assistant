# Music League Voting Assistant

Turn a saved Music League round into a ranked table with a **draft vote allocation**.

The parsing and scoring are **deterministic** (a Node script — no LLM, no guessing).
The agent/you only step in to rebalance points or research tricky "fit" calls.

- **Input:** a saved Music League round HTML file.
- **Output:** a readable markdown report + a canonical JSON sidecar in `analysis/`.

## Quick start

```bash
npm install                  # one-time: installs linkedom (parser) + eslint
node scripts/parse-round.mjs rounds/2026-06-08-pride.html
```

CLI:

```bash
node scripts/parse-round.mjs <round.html> [--mode objective|subjective] [--no-json]
```

- `--mode objective` (default): a comment with words but no number is treated as **disqualified**.
- `--mode subjective`: a words-only comment is flagged **needs review** instead (the words may carry fit meaning).
- `--no-json`: skip the JSON sidecar, write only the markdown report.

Outputs are written to `analysis/<roundname>.md` and `analysis/<roundname>.json`
(`<roundname>` = the input filename without its extension).

There is also `npm run parse -- <round.html> [flags]` and `npm run lint`.

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

## Repo layout

- `scripts/parse-round.mjs` — the deterministic parser + allocator.
- `analysis/` — generated reports (git-ignored).
- `rounds/` — your round exports (git-ignored).
- `spec/` — the scoring/allocation rules in prose (`score-parsing`, `point-allocation`,
  `comments`, `uncertainty`, `fit-evaluation`).
- `tests/regressions/` — captured failure cases to guard against.
- `.cursor/rules/` — agent guidance mirroring the specs.
