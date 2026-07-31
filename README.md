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

### Status and help

```bash
just status                      # one line per round: what's done + what's next
just status tarot                # full checklist + next step for one round
just help                        # workflow overview
just help pick                   # flags + example for one stage
just help flags                  # all flags × which commands accept them
```

## Command reference

`just` recipes forward to the dispatcher (`scripts/ml.mjs`); extra flags pass straight
through to the underlying scripts. Run `just --list` or `just help` for the overview;
`just help <cmd>` for every flag on a command (`parse`, `merge`, `pick`, `final`, `fit`,
`scores`, `pin`, `flags`, `tidy`, `config`).

| Command                      | Stage                                     | Reads HTML? |
| ---------------------------- | ----------------------------------------- | ----------- |
| `just parse <name>`          | HTML → `music.json`                       | Yes         |
| `just merge <name>`          | `music.json` + `fit.json` → `scores.json` | No          |
| `just pick <name> <A\|B\|C>` | record distribution choice                | No          |
| `just rescore <name>`        | re-weight/re-allocate from JSON           | No          |
| `just fit <name>`            | render `fit.html` from `fit.json`         | No          |
| `just scores <name>`         | render `scores.html` from `scores.json`   | No          |
| `just final <name>`          | render deliverable HTML                   | No          |
| `just run <name>`            | next scriptable step                      | varies      |
| `just status [name]`         | pipeline checklist                        | —           |
| `just help [cmd]`            | workflow / per-command flags              | —           |
| `just tidy`                  | date-slug + archive stale rounds          | —           |
| `just config`                | local CLI preferences                     | —           |

`<name>` is optional after the first explicit use — the current round is stored in
`data/.current-round` (e.g. `just pick B --reason "…"` continues the same round).

### CLI flags

Full prose for each flag: `just help flags` or `just help <cmd>`. Summary:

**Allocation / profile** (parse, merge, pick, rescore — explore on parse/merge; pick
replays then records your letter; rescore re-blends/re-allocates from JSON):

| Flag                 | Values                                                                      | Effect                                                                                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--rank`             | `combined` \| `fit` \| `music`                                              | Ranking axis for tiers and tradeoff tables. Default: `combined` on merge and thematic pick; `music` on music-only parse/pick; parse auto-switches to `combined` when comments carry manual fit scores. |
| `--weights`          | `<fit>:<music>` e.g. `3:2`                                                  | Blend ratio for combined ranking (normalized to sum 1). **Not on `pick`** — use `just rescore` to re-weight. Default: **7:3** merge/thematic, **5:5** parse w/ manual fit.                             |
| `--gate`             | `passFail` \| `passFailMaybe`                                               | Thematic pass/maybe/fail gate model.                                                                                                                                                                   |
| `--cutoff`           | `<axis>:<min>` e.g. `fit:70`                                                | Numeric cutoff gate on fit or music instead of word gate.                                                                                                                                              |
| `--shape`            | `auto` \| `bell` \| `balanced` \| `top-heavy` \| `compressed` \| `relative` | Upvote curve preset (`auto` = default).                                                                                                                                                                |
| `--down-shape`       | `concentrated` \| `flat` \| `curved`                                        | Downvote curve when downs are enabled. Pick also accepts positional `cv` / `fl` / `cc`.                                                                                                                |
| `--tier-count`       | positive integer                                                            | Force exactly _n_ distinct upvote point tiers.                                                                                                                                                         |
| `--bucket-count`     | positive integer                                                            | Force _n_ funded score-cluster tiers.                                                                                                                                                                  |
| `--pin`              | `<index>:<votes>`                                                           | Pin a song's votes (`9:2` up, `6:-2` down). Comma-separate multiples. See `just help pin`.                                                                                                             |
| `--favorite-band`    | score e.g. `80`                                                             | Merge raw music scores ≥ floor into one shared top tier.                                                                                                                                               |
| `--no-favorite-band` | —                                                                           | Disable favorite-band merge.                                                                                                                                                                           |

**Parse only:**

| Flag                 | Values                      | Effect                                                                                                                                 |
| -------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `--mode`             | `objective` \| `subjective` | Blank comments: needsUserInput vs needsReview.                                                                                         |
| `--no-json`          | —                           | Skip `music.json`.                                                                                                                     |
| `--lenient`          | —                           | Tolerate Live Text / pasted round text.                                                                                                |
| `--fit [tier\|gate]` | —                           | Scan tier words (default) or gate words. A bare 2nd number as fit is auto-detected round-wide (no flag). `--fit-words` = `--fit tier`. |

Deprecated on parse (warns): `--option`, `--reason` — use `just merge` and
`just pick` instead.

**Pick only:**

| Flag                     | Values        | Effect                                                           |
| ------------------------ | ------------- | ---------------------------------------------------------------- |
| `--reason`               | quoted string | Rationale stored in the pick record.                             |
| `--scores`               | —             | Write pick to `scores.json` (default when `fit.json` exists).    |
| `--dry-run`              | —             | Resolve and print pick without writing files.                    |
| `<A\|B\|C> [cv\|fl\|cc]` | positional    | Option letter; optional down-shape shorthand when downs enabled. |

**Rescore only** (`just rescore` — re-blend/re-allocate from JSON, resets any pick to
draft; never reads HTML): takes the shared allocation/profile flags above (`--weights`,
`--shape`, `--rank`, `--gate`, `--down-shape`, `--tier-count`, `--bucket-count`,
`--pin`, `--favorite-band`) plus:

| Flag          | Values            | Effect                                                                                                     |
| ------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `--score`     | `<index>:<value>` | Write a music score to `music.json` (modifiers `+`/`-`/`?` OK). Clears `needsUserInput`; no HTML re-parse. |
| `--fit-score` | `<index>:<value>` | Write fit score to `fit.json` (thematic) or song record (music-only).                                      |
| `--dry-run`   | —                 | Preview re-score without writing files.                                                                    |

See `just help rescore` for examples. Vote pins (`--pin`) and raw score overrides
(`--score`) are different — use `--score` to fill a blank box and re-tier normally.

**Render** (`just fit`, `just scores`, `just final`):

| Flag      | Values    | Effect                              |
| --------- | --------- | ----------------------------------- |
| `--out`   | path      | Output HTML path.                   |
| `--order` | see below | Card sort order in the HTML report. |

`--order` values by command:

- **fit:** `fit` (default), `combined`, `music`, `raw`
- **scores / final (scores.json):** `combined` (default), `fit`, `raw`, `votes`, `score`
- **final (music.json):** `votes` (default), `score`, `raw`

**Other:**

| Command       | Flags                                                                   |
| ------------- | ----------------------------------------------------------------------- |
| `just tidy`   | `--dry-run` / `-n`, `--no-name`, `--no-archive`, `--age <days>`         |
| `just config` | `comment-width [auto\|<n>\|unset]` — Comment column width in CLI tables |

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
>
> **I want to change the fit:music weights without re-parsing the HTML.**
>
> `just rescore <round> --weights 5:5` re-blends `combinedScore` from the stored
> `score`/`fitScore`, re-runs the draft menu, and rewrites `music.md`/`music.json`.
> To set or fix a raw music score without re-parsing HTML:
> `just rescore <round> --score <i>:<v>` (e.g. `--score 17:78+`).
> It resets any committed pick to draft (re-run `just pick`) and never touches
> `picks.jsonl`. `pick --weights` is inert and now errors with this pointer.

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
comments (music first, fit on the remainder, tier/gate tables, `--fit`).

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

Use `just parse <round> --fit` (or `--fit gate`) when comments include tier/gate words;
a bare second fit number is auto-detected — see [spec/scoring-comments.md](spec/scoring-comments.md).

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
