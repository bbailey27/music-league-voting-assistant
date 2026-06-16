---
name: music-league-workspace
description: >-
  Maps the Music League Voting Assistant repo — round parsing, draft vote allocation,
  thematic fit research, and analysis outputs. Use when starting any task in this
  workspace, when unsure where rules or scripts live, or when chaining parse → fit → allocate.
---

# Music League workspace

Deterministic Node scripts turn a saved Music League round into ranked tables and draft vote allocations. The agent only steps in for **fit research** (thematic rounds) and **rebalancing** tradeoffs.

## What this repo does

| Stage                  | Who                     | Output                                       |
| ---------------------- | ----------------------- | -------------------------------------------- |
| Parse + score comments | `parse-round.mjs`       | `analysis/<round>/music.md` + `music.json`   |
| Fit research           | Agent / LLM             | `analysis/<round>/fit.json`                  |
| Merge fit + allocate   | `parse-round.mjs --fit` | `analysis/<round>/scores.json` (deliverable) |
| Fit report             | `render-fit-html.mjs`   | `analysis/<round>/fit.html` (fit-only)       |
| Scores report          | `render-fit-html.mjs`   | `analysis/<round>/scores.html` (deliverable) |

Plain (non-thematic) rounds stop after parse — open `analysis/<round>/music.md` for the draft allocation.

**Music-only command path:** save round HTML → `just parse <name>` (or `just run <name>` once) → done. No fit research, no `fit.json`, no `just fit`.

## Directory layout

```
rounds/          Saved round HTML or pasted text (<round>.html|.txt) — flat; archive/ ignored
analysis/        Per-round folders analysis/<round>/ — see spec/analysis-artifacts.md
scripts/         Pipeline code; one-off round drivers in scripts/one-off/
spec/            Domain rules (source of truth over .cursor/rules/)
tests/           node:test suites + tests/fixtures/sample-round/
.cursor/skills/  Project agent skills (this file + task-specific skills below)
```

When looking up a **previous** round, also check `rounds/archive/` and `analysis/archive/` (owner-moved; not scanned by default).

## Key scripts

| Script                | Role                                                                     |
| --------------------- | ------------------------------------------------------------------------ |
| `ml.mjs`              | Dispatcher: fuzzy round names, `run`/`status`/`parse`/`fit`/`scores`     |
| `paths.mjs`           | Shared analysis path helpers + artifact naming                           |
| `parse-round.mjs`     | HTML or text → score + allocate → `music.*`; `--fit` → `scores.json`     |
| `extract-html.mjs`    | DOM walker (shared with future web app); not a CLI                       |
| `parse-text.mjs`      | Strict or lenient text parser; not a CLI                                 |
| `score-core.mjs`      | `scoreComment`, `allocate`, `mergeFitJson` — shared core                 |
| `render-fit-html.mjs` | Fit or scores JSON → self-contained HTML cards + vote-transfer table     |
| `one-off/`            | Round-specific drivers (e.g. kpop-solo-versions.mjs) — not main pipeline |

## Common commands

Prefer `just` (forwards to `ml.mjs`); equivalent: `npm run ml -- <cmd>`.

```bash
just run tarot              # next scriptable step (parse, render scores/fit HTML)
just status                 # checklist for all rounds
just status tarot           # one round, full checklist + next step
just parse tarot            # force parse; flags: --mode objective|subjective, --no-json
just fit tarot              # render fit-only HTML from fit.json
just scores tarot           # render deliverable scores.html from scores.json
npm test                    # score + parse-text regression tests
just lint                   # eslint + markdownlint
```

Fuzzy `<name>` matches exact → substring → subsequence. Ambiguous queries list candidates and exit.

**HTML export rule:** comments live in Alpine `x-model`; only **saved + reloaded** comments appear as `data-comment`. Blank boxes → `needsUserInput`, never invented.

## Specs (read before judging)

| File                         | Covers                                                          |
| ---------------------------- | --------------------------------------------------------------- |
| `spec/analysis-artifacts.md` | Per-round folders, music/fit/scores naming, archive/            |
| `spec/score-parsing.md`      | Digit scaling, modifiers, manual fit tokens                     |
| `spec/comments.md`           | User vs submitter comments; ML slang                            |
| `spec/uncertainty.md`        | `?` handling at tier boundaries                                 |
| `spec/fit-evaluation.md`     | Fit research output + merge                                     |
| `spec/fit-guidance.md`       | Opt-in, league/style-scoped fit lenses (suggested, not default) |
| `spec/point-allocation.md`   | Allocator profiles, gates, tradeoffs                            |

If `.cursor/rules/` disagrees with `spec/`, follow **spec/**.

## Task-specific skills

Load these when the task matches (they are explicit-only):

| Skill                     | When                                                |
| ------------------------- | --------------------------------------------------- |
| **parse-scores-pipeline** | Parsing rounds, text vs HTML, verification          |
| **round-fit-research**    | Thematic/lyric rounds, writing `fit.json`           |
| **point-allocation**      | Rebalancing votes, profiles, one-off scripts        |
| **round-artifacts**       | Naming rounds, capturing inputs, pipeline checklist |

## Agent constraints

- **Never commit** unless the user explicitly asks (`.cursor/rules/no-auto-commit.mdc`).
- Scoring is deterministic — do not invent numeric scores for empty comment boxes.
- **Surface blockers before allocating.** Lead with blank scores (`needsUserInput`,
  never invented), parse-health issues, and `needsReview` flags before proposing any
  distribution — a blank sits at 0 in every curve. Full rule:
  `spec/point-allocation.md` → _Pre-allocation gate_.
- Submitter quotes are context only; never scored.
- LLM does fit research only; allocation is always `score-core.mjs`.
- **Allocation invariants:** spend the full upvote bank and full downvote bank (when enabled), exactly; never assign upvotes and downvotes to the same song (see **point-allocation**).
