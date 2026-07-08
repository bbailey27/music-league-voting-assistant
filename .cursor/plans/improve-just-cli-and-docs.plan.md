---
name: improve-just-cli-and-docs
overview: Three-stage pipeline CLI/docs — Phases 0–2 shipped (parse/merge/pick, ml help, README, status). Remaining Phase 3 tests.
status: partial
isProject: false
todos:
  - id: ml-dispatcher-tests
    content: tests/ml.test.mjs — dispatch + stage errors ("parse first")
    status: completed
  - id: e2e-fixture
    content: End-to-end fixture parse → pick → final (beyond pipeline-stages.test.mjs invariants)
    status: completed
---

# Improve just commands and user instructions

**Phases 0–2 shipped** (2026-06-26): stage split, `ml help` + `just help`, README
three-stage workflow, justfile doc comments, status pick row + next steps, workspace
skill. See `spec/decisions.md`.

**Phase 3 shipped** (2026-07-08): `tests/ml.test.mjs` (dispatch + stage errors +
deprecated-flag redirects) and `tests/pipeline-e2e.test.mjs` (parse→pick→final). Landed with
Wave A of [hands-off-orchestrator.plan.md](hands-off-orchestrator.plan.md). See
`spec/decisions.md`. Nothing open — this plan can be deleted once the orchestrator effort
finishes.

## Target workflow (shipped — reference for tests)

**Music-only:**

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

Re-parse only when replacing the HTML export; pick is always a separate JSON step.

## Command surface (reference)

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
| `--mode`, `--shape`, `--tier-count`, `--bucket-count`, `--pin` | **parse** (preview draft in `music.md` only — does not record pick) |
| `--rank`, `--weights`, `--gate`, `--cutoff` | **merge** |
| `--option`, `--reason`, `--pin`, `--down-shape`, `--tier-count`, `--bucket-count` | **pick** (record allocation) |
| `--order`, `--out` | **render** |

Deprecated on parse (warn → remove): `--fit`, `--option`, `--reason`.

## Status / next steps (shipped)

```text
no input              → export HTML to rounds/
no music.json         → just parse
thematic, no fit.json → fit research (manual)
thematic, no scores   → just merge
no pick on JSON       → just pick <name> <letter> (see music.md)
html stale/missing    → just final
done
```

Checklist includes **Pick recorded** row with `pick.chosen` + option count.

---

## Phase 3 — Tests (remaining)

### `tests/ml.test.mjs`

Dispatcher coverage for `ml parse|merge|pick|final|status|run|help`:

- Correct script invoked per subcommand
- Stage errors when prerequisites missing (e.g. pick without `music.json` → "parse first")
- Deprecated flags on parse surface helpful redirect messages

Mirror style of existing `tests/ml-status.test.mjs`.

### End-to-end fixture

Beyond `tests/pipeline-stages.test.mjs` (unit/invariant tests):

- Fixture round: `just parse` → `just pick` → `just final` (or node equivalents)
- Assert artifacts exist and pick block present
- Optional: thematic path with merge

## Non-goals

- Re-parse / half-blank round workflows
- Auto-run `final` after pick
- Web UI picking
- Changing `picks.jsonl` schema

## Verification (when Phase 3 done)

```bash
npm test && just lint
just parse sample-round
just pick sample-round A --reason "test"
just final sample-round
just status sample-round
```
