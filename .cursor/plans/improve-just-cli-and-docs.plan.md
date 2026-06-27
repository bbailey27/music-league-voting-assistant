---
name: improve-just-cli-and-docs
overview: Make the three-stage pipeline (parse → merge → pick → render) discoverable from the command line with guided next steps and local help.
status: partial
depends_on: split-pipeline-stages
isProject: false
related: pick-preserves-options
---

> **Architecture:** [split-pipeline-stages.plan.md](split-pipeline-stages.plan.md) splits
> HTML parse, JSON merge, and pick recording into separate scripts **first**. This plan
> adds `just` recipes, `ml help`, README, and status guidance on top of that split.
> Pick invariants: [pick-preserves-options.plan.md](pick-preserves-options.plan.md).

# Improve just commands and user instructions

## Problem

The pipeline works but **stage boundaries are invisible**:

| Stage | Today | Should be |
| --- | --- | --- |
| HTML → music | `just parse` (+ hidden `--option`, `--fit`) | `just parse` only |
| music + fit → scores | raw `node parse-round.mjs … --fit` | `just merge` |
| Record choice | `just parse --option B` (re-reads HTML) | `just pick B` (JSON only) |
| Render | `just final` | unchanged |

Docs describe a monolithic parse; users can't tell parse from pick from merge.

## Target workflow

**Music-only** (parse once after voting is complete):

```bash
just parse kpop-favorite
just pick kpop-favorite B --reason "2×2 cluster feels right"
just final kpop-favorite
```

**Thematic:**

```bash
just parse tarot
# agent writes fit.json
just merge tarot
just pick tarot C --reason "..."
just final tarot
```

Re-parse (`just parse` again) only when you **replace the HTML export**. It writes
fresh `music.json` without a pick — run `just pick` again afterward.

## Command surface

| Command | Script | Reads HTML? |
| --- | --- | --- |
| `just parse <name> [flags]` | `parse-round.mjs` | Yes |
| `just merge <name> [flags]` | `merge-scores.mjs` | No |
| `just pick <name> <A\|B\|C> [--reason …] [flags]` | `pick-round.mjs` | No |
| `just fit <name>` | render `fit.html` | No |
| `just scores <name>` | render `scores.html` | No |
| `just final <name>` | smart render | No |
| `just status [name]` | checklist | — |
| `just run <name>` | next scriptable step | — |
| `just help [cmd]` | flag list + examples | — |
| `just tidy` | archive / date-slug | — |

### Flag ownership (by stage)

| Flags | Stage |
| --- | --- |
| `--mode`, `--shape`, `--tier-count`, `--bucket-count`, `--pin` (explore) | **parse** |
| `--rank`, `--weights`, `--gate`, `--cutoff` | **merge** |
| `--option`, `--reason`, `--pin`, `--down-shape` | **pick** |
| `--order`, `--out` | **render** |

Deprecated on parse (warn → remove): `--fit`, `--option`, `--reason`.

## `just run` / `just status`

### Next steps

```text
no input              → export HTML to rounds/
no music.json         → just parse
thematic, no fit.json → fit research (manual)
thematic, no scores   → just merge
no pick on JSON       → just pick <name> <letter> (see music.md)
html stale/missing    → just final
done
```

### Checklist rows

```text
[ ] Round input
[ ] Parse (music.json)
[ ] Fit research     (thematic only)
[ ] Merge (scores.json)
[ ] Pick recorded    pick.chosen=B (N options kept)
[ ] Final HTML
```

`just run` prints pick/final commands; never auto-picks.

## Documentation

### README.md

1. **Three-stage pipeline** diagram (parse / merge / pick / render)
2. **Quick reference** table of `just` commands
3. **Recording your pick** — `just pick` example; what lands in `pick` + `picks.jsonl`
4. **When to re-parse** — one paragraph: new HTML export only; pick is separate
5. Fix empty fit-research bullet; replace raw merge one-liner with `just merge`

### justfile

Doc comment on each recipe (visible in `just --list`).

### `ml help`

- `ml help` — workflow overview
- `ml help parse` | `merge` | `pick` | `final` — flags + copy-paste example

### `music-league-workspace` skill

Update command table and music-only path.

## Implementation plan

### Phase 0 — Stage split (prerequisite)

From [split-pipeline-stages.plan.md](split-pipeline-stages.plan.md):

- [ ] `merge-scores.mjs`, `pick-round.mjs`
- [ ] Slim `parse-round.mjs` (no `--fit` / `--option`)
- [ ] `ml merge`, `ml pick`; deprecation warnings on old parse flags
- [ ] Pick preservation fixes from [pick-preserves-options](pick-preserves-options.plan.md)

### Phase 1 — Docs + help (can start in parallel with Phase 0 drafts)

- [ ] README three-stage section
- [ ] justfile doc comments
- [ ] `ml help`
- [ ] Skill update

### Phase 2 — Status / run guidance

- [ ] `hasPick`, pick row in status
- [ ] `nextStep` for pick + final
- [ ] `just` recipes wired

### Phase 3 — Tests

- [ ] `tests/ml.test.mjs` — dispatch + stage errors ("parse first")
- [ ] End-to-end fixture: parse → pick → final

## Non-goals

- Re-parse / half-blank round workflows
- Auto-run `final` after pick
- Web UI picking
- Changing `picks.jsonl` schema

## Answer card (README)

> **I parsed a music-only round. How do I record my final choice?**
>
> 1. Open `data/analysis/<round>/music.md` — note option letters (A/B/C).
> 2. `just pick <round> <letter> --reason "optional note"` — updates JSON only; does not re-read HTML.
> 3. `just final <round>` — refresh `music.html`.
>
> Stored in `<round>/music.json` (`pick`) and `data/analysis/picks.jsonl`.

## Verification

```bash
npm test && just lint
just parse sample-round
just pick sample-round A --reason "test"
just final sample-round
just status sample-round
```
