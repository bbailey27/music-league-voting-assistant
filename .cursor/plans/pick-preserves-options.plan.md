---
name: pick-preserves-options
overview: Guarantee that pick-round.mjs never destroys the option menu — chosen vs rejected distributions, shapes, and rationale stay visible in JSON, markdown, HTML, and picks.jsonl for future allocator training.
status: pending
isProject: false
related: split-pipeline-stages, improve-just-cli-and-docs
---

# Pick stage: preserve all options

Companion to [split-pipeline-stages.plan.md](split-pipeline-stages.plan.md). Pick is
**JSON-only** — it does not parse HTML and does not merge fit. This plan defines
what `pick-round.mjs` / `just pick` must preserve in output files.

## What you want to see later

For a round where you chose **A** over **B** (and maybe **C**):

| Artifact | Must show |
| --- | --- |
| `music.json` / `scores.json` | `pick.chosen = "A"`, `pick.reason`, full `pick.options[]` with A/B/C `perSong` votes + `shape` |
| `music.md` / deliverable markdown | Side-by-side options table + which you picked + why |
| `music.html` / `scores.html` | **Your pick** + collapsible **Options considered** (A/B/C comparison) |
| `picks.jsonl` | One row per round: every option's `votesByIndex`, `isChosen`, field snapshot |

Goal: enough signal to ask later *"why did the human take the flatter 2-tier split
instead of the 4-tier one?"*

## Scope boundary

**In scope:** behavior of `pick-round.mjs` and renderers reading `pick`.

**Out of scope:** parse overwriting `music.json` (that drops `pick` by design — you
`just pick` again after a fresh parse). No "preserve pick on re-parse" logic.

## Current state (audit)

### Already correct

- **`buildPickRecord()`** stores every presented option with `letter`, `shape`,
  `tierCount`, `bucketCount`, `isChosen`, and slim `perSong`.
- **`applyOptionPick()`** captures the menu from **unpinned** allocation before
  applying overrides.
- **`pickHtml()`** renders chosen distribution + **Options considered** table.
- **`picks.jsonl`** writes all options; idempotent replace per round.

Example: `data/analysis/2026-06-26-kpop-favorite/music.json` has full A/B in
`pick.options`.

### Gaps (fix in pick stage + renderers)

| Gap | Fix |
| --- | --- |
| **`buildMarkdown()` ignores `pick`** | `renderPickMarkdown(pick)` in pick's md refresh |
| **`buildComboBallot()` with empty tradeoffs** | Fall back to `pick.options` for ballot columns |
| **Pick coupled to parse** | Move to `pick-round.mjs` per split-pipeline-stages |

## Invariants (contract for `just pick`)

### P1 — Full menu frozen at pick time

`pick.options` MUST contain **every** `tier-structure` option presented (typically
2–3), each with complete `perSong` vote maps. Never chosen-only.

### P2 — Parse does not touch pick

`parse-round.mjs` never reads or writes `pick`. Only `pick-round.mjs` sets it.

### P3 — Human-visible alternatives everywhere

After pick: JSON `pick.options`, markdown **Options considered**, HTML `pickHtml` +
ballot fallback (P4).

### P4 — Ballot derives from `pick.options` when tradeoffs resolved

If `tradeoffs` has no `tier-structure` but `pick.options` exists, build combo ballot
columns from `pick.options`.

### P5 — Training log is complete

`picks.jsonl` always includes full `options[]`. Regression test required.

### P6 — Re-pick replaces, never merges partial

`just pick B` then `just pick A` → fresh full menu from unpinned replay, whole record
replaced.

## Implementation (pick stage)

### 1. `pick-round.mjs`

- Load target JSON (`music.json` or `scores.json`)
- Replay allocation from JSON (songs + budget + stored profile/tradeoffs)
- `applyOptionPick` → write JSON, regenerate md, `recordPickToTrainingLog`
- Flags: `--option`, `--reason`, `--pin`, `--down-shape`, `--dry-run`

### 2. Markdown pick section (`score-core.mjs`)

`renderPickMarkdown(pick)` — **Your pick** + always-visible **Options considered**
table (not collapsed — better for training review than HTML `<details>`).

Wire into md regeneration inside pick (not parse).

### 3. Combo ballot fallback (`render-html-shared.mjs`)

Pass `pick` into `buildComboBallot` when tradeoffs lack tier-structure.

### 4. CLI

| Flag | Purpose |
| --- | --- |
| `--reason "…"` | Rationale for chosen option |
| `--dry-run` | Print menu + would-be pick; no write |
| `--scores` | Pick against `scores.json` (thematic) instead of `music.json` |

No `--clear-pick` on parse — parse simply omits `pick` when rewriting `music.json`.

## Tests

| Test | Asserts |
| --- | --- |
| `pick preserves all options in music.json` | `pick.options.length >= 2`, rejected options have `isChosen: false` |
| `pick does not open HTML` | pick-round.mjs never reads `rounds/*.html` |
| `pick markdown includes options table` | md contains "Options considered" + option B shape |
| `combo ballot uses pick.options` | A/B columns when tradeoffs empty |
| `picks.jsonl has full options` | ≥2 options with distinct shapes |
| `applyOptionPick with --pin keeps full menu` | pin doesn't shrink `pick.options` |
| `parse output has no pick field` | fresh parse → `music.json` without `pick` |

## Spec / docs

- **`spec/point-allocation.md`** — pick invariants P1–P6; `--option` on parse
  deprecated → `just pick`
- **`spec/analysis-artifacts.md`** — stage ownership table (parse / merge / pick)
- **`spec/decisions.md`** — log when shipped

## Implementation order

1. Tests for P1, P5 (baseline on existing helpers)
2. `pick-round.mjs` extracted from parse (split-pipeline-stages)
3. Markdown pick section (P3)
4. Combo ballot fallback (P4)
5. `just pick` + docs (improve-just-cli-and-docs)

## Success criteria

```bash
just parse kpop-favorite
just pick kpop-favorite A --reason "flatter split fits the tight scores"
just final kpop-favorite
```

Verify:

- `music.json` → `pick.options` has A and B with different shapes
- `music.md` → "Your pick" + "Options considered"
- `music.html` → same + ballot A/B columns
- `picks.jsonl` → `"chosen":"A"` and both options in `options[]`
- `just parse kpop-favorite` again → new `music.json` without `pick` (then re-pick if needed)
