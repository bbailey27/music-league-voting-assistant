---
name: music-league-workspace
description: >-
  Maps the Music League Voting Assistant repo — round parsing, draft vote allocation,
  thematic fit research, and analysis outputs. Use when starting any task in this
  workspace, when unsure where rules or scripts live, or when chaining parse → merge → pick → final.
---

# Music League workspace

Deterministic Node scripts turn a saved Music League round into ranked tables and draft vote allocations. The agent only steps in for **fit research** (thematic rounds) and **rebalancing** tradeoffs.

## What this repo does

| Stage        | Who / script        | Output                                          |
| ------------ | ------------------- | ----------------------------------------------- |
| Parse        | `parse-round.mjs`   | `data/analysis/<round>/music.md` + `music.json` |
| Fit research | Agent / LLM         | `data/analysis/<round>/fit.json`                |
| Merge        | `merge-scores.mjs`  | `data/analysis/<round>/scores.json`             |
| Pick         | `pick-round.mjs`    | `pick` on JSON + `data/analysis/picks.jsonl`    |
| Render       | `render-*-html.mjs` | `music.html`, `scores.html`, or `fit.html`      |

**Music-only path:**

```bash
just parse <name> → just pick <name> <A|B|C> → just final <name>
```

**Thematic path:** parse → fit research → `just merge` → pick → final.

Re-parse only when replacing the HTML export. Pick never reads HTML.

## Directory layout

```
data/            PRIVATE submodule (music-league-data); not in the public repo:
  rounds/        Saved round HTML or pasted text (<round>.html|.txt) — flat; archive/ ignored
  analysis/      Per-round folders + picks.jsonl — see spec/analysis-artifacts.md
  ref/           Reference data (fav-songs.csv, song-topic-summaries.csv) — agent research only
scripts/         Pipeline code; one-off round drivers in scripts/one-off/
  score/         Allocation core (allocate.mjs, merge.mjs, render.mjs, …)
spec/            Domain rules (source of truth over .cursor/rules/)
tests/           node:test suites + tests/fixtures/sample-round/
.cursor/skills/  Project agent skills (this file + task-specific skills below)
```

Round inputs/outputs live in the private `data/` submodule; path constants are centralized in `scripts/paths.mjs` (`DATA_DIR`, `ROUNDS_DIR`, `ANALYSIS_DIR`, `REF_DIR`). When looking up a **previous** round, also check `data/rounds/archive/` and `data/analysis/archive/` (moved there by `just tidy` once >2 days old; not scanned by default).

## Key scripts

| Script                       | Role                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `ml.mjs`                     | Dispatcher: fuzzy names, `run`/`status`/`help`, next-step inference          |
| `parse-round.mjs`            | HTML or text → `music.*` (parse stage only)                                  |
| `merge-scores.mjs`           | `music.json` + `fit.json` → `scores.json` (no HTML)                          |
| `pick-round.mjs`             | JSON-only pick + `picks.jsonl` (no HTML)                                     |
| `paths.mjs`                  | Shared analysis path helpers + artifact naming                               |
| `maintain-rounds.mjs`        | Date-slug undated rounds + archive stale ones (`ml tidy`; auto on `run`)     |
| `score-core.mjs`             | Re-export barrel for `scripts/score/*`                                       |
| `render-fit-html.mjs`        | Fit or scores JSON → self-contained HTML cards + vote-transfer table         |
| `render-final-html.mjs`      | Music JSON → music.html (pure read)                                          |
| `title-prefix-scan.mjs`      | Story-chain: anchor title-prefix searches across ref CSVs                    |
| `title-complement-check.mjs` | Story-chain: structural complement tags by `--slot` (default `copular`)      |
| `title-candidate-score.mjs`  | Story-chain: weighted engagement score (scrobbles + Pandora playlist fields) |
| `one-off/`                   | Round-specific drivers (e.g. kpop-solo-versions.mjs) — not main pipeline     |

## Common commands

Prefer `just` (forwards to `ml.mjs`); equivalent: `npm run ml -- <cmd>`.

```bash
just help                   # workflow overview
just help pick              # per-stage flags + example
just run tarot              # next scriptable step
just status                 # checklist for all rounds
just status tarot           # one round, full checklist + next step
just parse tarot            # HTML → music.*
just merge tarot            # music + fit → scores.json
just pick tarot B --reason "…"
just final tarot            # render deliverable HTML
just tidy --dry-run         # preview date-slug naming + archiving
npm test                    # score + parse-text regression tests
just lint                   # eslint + markdownlint
```

Fuzzy `<name>` matches exact → substring → subsequence. Ambiguous queries list candidates and exit.

**HTML export rule:** comments live in Alpine `x-model`; only **saved + reloaded** comments appear as `data-comment`. Blank boxes → `needsUserInput`, never invented.

## Specs (read before judging)

| File                         | Covers                                                          |
| ---------------------------- | --------------------------------------------------------------- |
| `spec/analysis-artifacts.md` | Per-round folders, stage ownership, music/fit/scores naming     |
| `spec/score-parsing.md`      | Digit scaling, modifiers, manual fit tokens                     |
| `spec/comments.md`           | User vs submitter comments; ML slang                            |
| `spec/uncertainty.md`        | `?` handling at tier boundaries                                 |
| `spec/fit-evaluation.md`     | Fit research output + merge                                     |
| `spec/fit-guidance.md`       | Opt-in, league/style-scoped fit lenses (suggested, not default) |
| `spec/point-allocation.md`   | Allocator profiles, gates, tradeoffs, pick invariants           |

If `.cursor/rules/` disagrees with `spec/`, follow **spec/**.

## Task-specific skills

Load these when the task matches (they are explicit-only):

| Skill                      | When                                                                            |
| -------------------------- | ------------------------------------------------------------------------------- |
| **parse-scores-pipeline**  | Parsing rounds, text vs HTML, verification                                      |
| **submission-song-search** | Finding songs to SUBMIT for a themed round (mine fav-songs.csv / discographies) |
| **title-chain**            | Story/sentence-chain rounds — prefix scans + `title-complement-check.mjs`       |
| **round-fit-research**     | Thematic/lyric rounds, writing `fit.json`                                       |
| **point-allocation**       | Rebalancing votes, profiles, one-off scripts                                    |
| **round-artifacts**        | Naming rounds, capturing inputs, pipeline checklist                             |

## Agent constraints

- **Never commit** unless the user explicitly asks (`.cursor/rules/no-auto-commit.mdc`).
- Scoring is deterministic — do not invent numeric scores for empty comment boxes.
- **Surface blockers before allocating.** Lead with blank scores (`needsUserInput`,
  never invented), parse-health issues, and `needsReview` flags before proposing any
  distribution — a blank sits at 0 in every curve. Full rule:
  `spec/point-allocation.md` → _Pre-allocation gate_.
- Submitter quotes are context only; never scored.
- LLM does fit research only; allocation is always `scripts/score/allocate.mjs`.
- **Parse never writes pick; pick never reads HTML; merge never picks.**
- **Allocation invariants:** spend the full upvote bank and full downvote bank (when enabled), exactly; never assign upvotes and downvotes to the same song (see **point-allocation**).
