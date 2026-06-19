---
name: unified-ballot-and-down-pins
overview: Replace the deleted per-option raw tables with a single raw-order ballot that has one column per up-option x down-shape COMBO, each a complete signed ballot read straight down (no cross-referencing). Cells where the up option and down shape disagree for a song are flagged with a conflict marker for manual fix (no silent vote-dropping or total-shrinking). Identical combos are deduped. Then add downvote pins as a second phase.
todos:
  - id: ballot-builder
    content: Add pure buildComboBallot(tradeoffs, songs, ownSongs) in render-html-shared.mjs - one column per up-option x down-shape combo (full signed ballot); a song upvoted by the option AND downvoted by the shape becomes a conflict-marked cell (no silent drop); dedup identical columns, own-song dashes, per-column totals + conflict count; + comboBallotHtml renderer
    status: completed
  - id: wire-renderers
    content: Replace renderTransfer in render-fit-html.mjs and render-final-html.mjs with the shared combo ballot; handle degenerate (no tradeoffs / no downvotes) cases
    status: completed
  - id: cli-ballot
    content: Add printBallotCli in parse-round.mjs so the terminal shows the same combo ballot (monospace-aligned)
    status: completed
  - id: phase1-docs-tests
    content: Revise decisions.md + point-allocation.md (per-option columns retained, unified signed ballot); add buildBallot unit test; rerun suite
    status: completed
  - id: down-pins-parse
    content: "Phase 2: relax parsePins to accept signed values -> overrides (up) + downOverrides (down) (or add --pin-down)"
    status: completed
  - id: down-pins-engine
    content: "Phase 2: apply downOverrides in the downvote pass (pin finalDownvotes, reduce down budget, exclude from shaped pool, force pinned-down to zero up), add down preallocation-overflow tradeoff"
    status: completed
  - id: down-pins-writeback-docs
    content: "Phase 2: capture down tweaks in buildPickRecord; update usage string, point-allocation.md, decisions.md, point-allocation skill"
    status: completed
  - id: persist-plan
    content: Copy plan to .cursor/plans/unified-ballot-and-down-pins.plan.md
    status: completed
isProject: false
---

# Unified raw-order ballot + downvote pins

## Background / what went wrong

My last change deleted the per-option raw-submission-order sub-tables. Those were intentional: they let you transcribe any option without first running `--option`/`--down-shape`. The original ask was to _merge_ the separate up-raw and down-raw ballots into **one** signed table ("combine the two... not go through the list twice"), not delete them.

Key facts from the engine:

- The downvote curve is its own axis, independent of the upvote A/B/C structure (`scripts/score-core.mjs` lines 627-631); the down pool is computed once for the field. So up options and down shapes are orthogonal and can sit side-by-side as columns.
- Up pins already exist: `--pin <i>:<v>` -> `profile.overrides` -> applied to `finalVotes` at `scripts/score-core.mjs:466-468`. No downvote equivalent exists.

## Phase 1 - Combo ballot (one column per combo)

A single "Ballot (raw order)" section replaces the standalone transfer table in both reports and the (removed) per-axis raw sub-tables. The by-combined-score comparison tables stay as the judgment view; the ballot is the entry view.

Each column is one **up-option x down-shape combo** and is a complete signed ballot you read straight down — no tracking two disjoint columns at once. Sample (real story-4 data, 3 up x 2 down = 6 combos):

```
 #  Title                            A·cv   A·cc   B·cv   B·cc   C·cv   C·cc
 1  We Made A Pact                     +2     +2     +2     +2     +1     +1
 3  Shadows Of My Name                 -1      ·     -1      ·     -1      ·
 6  Stuffed With Secrets (DQ)          -1     -5     -1     -5     -1     -5
 7  Waiting For TAEMIN (yours)          —      —      —      —      —      —
13  Words                               ·      ·     +1     +1     +1     +1
    Total  ▲ / ▼                    10/-5  10/-5  10/-5  10/-5  10/-5  10/-5
Legend: A/B/C = upvote split; cv = curved down, cc = concentrated down.
  A·cv = --option A --down-shape curved ... C·cc = --option C --down-shape concentrated.
```

Column construction (conflict-marker approach): a combo column overlays up option X's upvotes (`+`) and down shape Y's downvotes (`-`) on the same raw-order rows. Y's down magnitudes are taken as-is (they were computed against the default up pool). The two axes can disagree for a song: X upvotes a song that Y also downvotes. We do **not** resolve that by recomputing the down distribution per option, and we do **not** silently drop the downvote or shrink the total (no hidden `8/-3`). Instead that cell shows a generic conflict marker (`!`), and the column footer notes the conflict count; the user resolves it by hand (or, later, via a Phase 2 downvote pin). Conflict-free columns — the common case — show clean `{up}/-{down}` totals. (Rejected alternative, per user: per-option recalc/redistribute of downvotes; too much machinery for an edge case.)

Rows: union of `rawOrderIndex` across scored songs + own songs, sorted by raw index. Own songs render `—` across all combo columns so no submission slot is skipped.

Dedup: identical full-ballot columns are collapsed (one header listing the equivalent selectors). No cap — every distinct combo is shown; HTML scrolls horizontally, CLI/markdown stays monospace-aligned.

### Implementation

- Add a pure builder + renderer in [scripts/render-html-shared.mjs](scripts/render-html-shared.mjs):
  - `buildComboBallot(tradeoffs, songs, ownSongs)` -> `{ combos, rows }` (pure, unit-testable). `combos[]` = `{ up, down, label, selector, perIndex: Map<rawOrderIndex, cell>, totals: { up, down, conflicts } }`, deduped by the cell-vector signature. Up options come from the `tier-structure` tradeoff `perSong` (fallback: single default-`finalVotes` option). Down shapes from the `down-structure` tradeoff `perSong` (fallback: single default-`finalDownvotes` shape; none if downvotes absent). For each (up, down) and song: `cell` = `+upVotes` if only upvoted, `-downVotes` if only downvoted, `'conflict'` if both, else 0/blank.
  - `comboBallotHtml(...)` renders rows x combo columns; reuse `.transfer td.votes` / `.transfer td.votes.down` styles (RENDER_HTML_BASE_STYLE ~line 245) for green `+` / red `-`, plus a `conflict` cell style (`!`); add minimal CSS for a wide scrollable table + a compact selector legend; footer shows `{up}/-{down}` and a conflict count when any.
- [scripts/render-fit-html.mjs](scripts/render-fit-html.mjs): replace `renderTransfer` (~line 217) with the combo ballot, fed `data.tradeoffs`, `data.songs`, `data.ownSongs`.
- [scripts/render-final-html.mjs](scripts/render-final-html.mjs): replace `renderTransfer` (~line 310) with the combo ballot, fed `model.tradeoffs`, `model.songs`, `model.ownSongs`.
- [scripts/parse-round.mjs](scripts/parse-round.mjs): add `printBallotCli(tradeoffs, songs, ownSongs)` after `printTradeoffCli`, reusing `buildComboBallot` + `printTextTable`.
- Keep downvotes-always-negative everywhere (already done): comparison tables, card badges, `tier-split-down` label, `formatVoteAllocation`.

### Degenerate cases

- No tradeoffs at all -> a single combo column (default up + default down), i.e. today's simple signed ballot.
- Downvotes disabled -> combos collapse to the up options only (one column per up option, no `-` cells).

### Docs / tests

- Revise the just-added decision entry and `spec/point-allocation.md` (lines ~355) to say: the raw-order ballot is one column per up x down combo (each a full signed ballot, deduped); comparison tables stay by-combined-score.
- Add a unit test for `buildComboBallot` (combo enumeration, conflict cell when a song is upvoted by the option and downvoted by the shape, dedup, signs, own-song dashes, totals + conflict count) in [tests/score.test.mjs](tests/score.test.mjs); rerun full suite.

## Phase 2 - Downvote pins

Mirror upvote pins on the down axis.

- Syntax (recommended): extend `--pin` to accept signed values, e.g. `--pin 6:-2` = 2 downvotes on song 6; positive stays upvotes. `parsePins` ([scripts/parse-round.mjs](scripts/parse-round.mjs) line 131) currently rejects `v < 0` - relax it and split into `overrides` (>=0) and `downOverrides` (<0 -> magnitude). Alternative: a separate `--pin-down <i>:<v>` flag.
- Engine: add `profile.downOverrides`; in the downvote pass (`allocateDownvotes` ~line 648 / `finishDownvotes`), pin `finalDownvotes` for those indices before shaping the rest, subtract from the down budget, exclude pinned songs from the shaped pool - mirroring the up override at `scripts/score-core.mjs:466-468`. Add a down analogue of the `preallocation-overflow` tradeoff when pinned downvotes exceed the down budget.
- Cross-axis: a pinned-down song is forced to zero upvotes (removed from the up pool); a pinned-up song is removed from the down pool.
- Pick writeback (`buildPickRecord`): capture downvote deviations in `tweaks` too.
- Update usage string (line ~368), `spec/point-allocation.md`, `spec/decisions.md`, and the point-allocation skill.

## Plan persistence

Per the save-plans-in-repo rule, copy this plan into `.cursor/plans/unified-ballot-and-down-pins.plan.md` during execution.
