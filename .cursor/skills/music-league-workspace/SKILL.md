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

| Stage                  | Who                     | Output                             |
| ---------------------- | ----------------------- | ---------------------------------- |
| Parse + score comments | `parse-round.mjs`       | `analysis/<round>.md` + `.json`    |
| Fit research           | Agent / LLM             | `analysis/<round>-fit.json`        |
| Merge fit + allocate   | `parse-round.mjs --fit` | updates fit JSON with `draftVotes` |
| Fit report             | `render-fit-html.mjs`   | `analysis/<round>-fit.html`        |

Plain (non-thematic) rounds stop after parse — open `analysis/<round>.md` for the draft allocation.

**Music-only command path:** save round HTML → `just parse <name>` (or `just run <name>` once) → done. No fit research, no `-fit.json`, no `just fit`.

## Directory layout

```
rounds/          Saved round HTML or pasted text (<roundname>.html|.txt) — gitignored
analysis/        Generated .md, .json, -fit.json, -fit.html — gitignored
scripts/         All pipeline code (ESM, linkedom for HTML)
spec/            Domain rules (source of truth over .cursor/rules/)
tests/           node:test suites + tests/regressions/ fixtures
.cursor/skills/  Project agent skills (this file + task-specific skills below)
```

## Key scripts

| Script                | Role                                                                     |
| --------------------- | ------------------------------------------------------------------------ |
| `ml.mjs`              | Dispatcher: fuzzy round names, `run`/`status`/`parse`/`fit`              |
| `parse-round.mjs`     | HTML or text → score + allocate → `.md`/`.json`; `--fit` merges fit JSON |
| `extract-html.mjs`    | DOM walker (shared with future web app); not a CLI                       |
| `parse-text.mjs`      | Strict or lenient text parser; not a CLI                                 |
| `score-core.mjs`      | `scoreComment`, `allocate`, `mergeFitJson` — shared core                 |
| `render-fit-html.mjs` | Fit JSON → self-contained HTML cards + vote-transfer table               |
| `story-rankings.mjs`  | One-off multi-axis allocation example (not in main pipeline)             |

## Common commands

Prefer `just` (forwards to `ml.mjs`); equivalent: `npm run ml -- <cmd>`.

```bash
just run tarot              # next scriptable step (parse, or render fit HTML)
just status                 # checklist for all rounds
just status tarot           # one round, full checklist + next step
just parse tarot            # force parse; flags: --mode objective|subjective, --no-json
just fit tarot              # render fit JSON; flags: --out, --order fit|combined|raw
npm test                    # score + parse-text regression tests
just lint                   # eslint + markdownlint
```

Fuzzy `<name>` matches exact → substring → subsequence. Ambiguous queries list candidates and exit.

**HTML export rule:** comments live in Alpine `x-model`; only **saved + reloaded** comments appear as `data-comment`. Blank boxes → `needsUserInput`, never invented.

## Specs (read before judging)

| File                       | Covers                                                          |
| -------------------------- | --------------------------------------------------------------- |
| `spec/score-parsing.md`    | Digit scaling, modifiers, manual fit tokens                     |
| `spec/comments.md`         | User vs submitter comments; ML slang                            |
| `spec/uncertainty.md`      | `?` handling at tier boundaries                                 |
| `spec/fit-evaluation.md`   | Fit research output + merge                                     |
| `spec/fit-guidance.md`     | Opt-in, league/style-scoped fit lenses (suggested, not default) |
| `spec/point-allocation.md` | Allocator profiles, gates, tradeoffs                            |

If `.cursor/rules/` disagrees with `spec/`, follow **spec/**.

## Task-specific skills

Load these when the task matches (they are explicit-only):

| Skill                     | When                                                |
| ------------------------- | --------------------------------------------------- |
| **parse-scores-pipeline** | Parsing rounds, text vs HTML, verification          |
| **round-fit-research**    | Thematic/lyric rounds, writing `-fit.json`          |
| **point-allocation**      | Rebalancing votes, profiles, one-off scripts        |
| **round-artifacts**       | Naming rounds, capturing inputs, pipeline checklist |

## Agent constraints

- **Never commit** unless the user explicitly asks (`.cursor/rules/no-auto-commit.mdc`).
- Scoring is deterministic — do not invent numeric scores for empty comment boxes.
- Submitter quotes are context only; never scored.
- LLM does fit research only; allocation is always `score-core.mjs`.
- **Allocation invariants:** spend the full upvote bank and full downvote bank (when enabled), exactly; never assign upvotes and downvotes to the same song (see **point-allocation**).
