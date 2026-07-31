---
name: "Follow-up 5: Specs, rules, and tests"
overview: Bring the spec/rules in line with implemented behavior and add regression tests — unit tests, prose fixtures, and output snapshot diffs over real round artifacts.
status: partial
depends_on: MVP
isProject: false

**Snapshot regression:** shipped 2026-07-08. **Spec slice:** `spec/round-input-parsing.md` added 2026-07-31; rules refreshed.
---

# Follow-up 5: Specs, rules, and tests

**Partial sync:** `spec/analysis-artifacts.md`, `spec/point-allocation.md`, `spec/decisions.md` updated for three-stage pipeline and pick invariants. **Sequence:** Waves 2–3 of [remaining-work-master.plan.md](remaining-work-master.plan.md).

## Spec / rule updates
- `spec/round-input-parsing.md` (new): schema-first; confirmed HTML selectors; text rules; the hard user-vs-submitter scoring contract (`userComment` is the sole scoring source; `submitterComment` is scoring-neutral context).
- `spec/score-parsing.md`: digit-count scaling (3-digit/10, 2-digit as-is, 1-digit x10); combined modifiers (`745+`, `75+?`, `73-`); score+freetext; alternate scales (`10/10`) ignored; disqualification — `isDisqualified` (`no` / `nope` / `invalid` keyword, and bare `-` which means a true DQ *or* an unspecified low score unlikely to place; words-only -> disqualified in objective, `needsReview` otherwise); empty box -> `needsUserInput`; `play` -> `playlistAdd` (tiebreak only, no floor); compressed-scale numbers (most 65-80, 80-90 strong/rare, 90+ almost never) are rough cross-league context only, NOT thresholds.
- `spec/point-allocation.md`: tiers derive solely from the round's own score distribution (modal score = center of the curve; floor = the round's own low end); cross-league numbers are context only; presets deferred to Follow-up 4.
- `spec/fit-evaluation.md`: three modes (objective gate / subjective music-primary / thematic fit-tiered) + the thematic ladder + confirm-mode-at-start.
- `spec/comments.md`: reaffirm the user vs submitter scoring contract.
- `.cursor/rules/parsing.mdc`, `output.mdc`, `allocation.mdc`: parse via extractor first; own-song skip; `data-weight` = the user's own vote; placeholder -> ask; two output tables (ranked w/ artist column; slim raw-order).

## Tests

### Unit / fixture tests

- `tests/extract.test.mjs`: HTML (and later text) → equivalent counts, own-skip, budget values, a few specific songs; optional committed JSON fixtures for regression checks.
- `tests/score.test.mjs`: token parsing (`755`→75.5, `7`→70.0, `73-`, `74 soft punk`, `10/10` ignored); disqualified vs empty vs `play`; allocation sums to budget, respects cap, excludes own/disqualified.
- `tests/regressions/006.md`: prose expectations over the committed sample round.

### Output snapshot regression test ✅ shipped 2026-07-08

Built as `scripts/regression-snapshot.mjs` + `just test-regression` + committed baseline under
`tests/fixtures/sample-round/snapshot/`, covered by `tests/regression-snapshot.test.mjs`
(fails `npm test` on drift). `--update` regenerates the baseline. `paths.mjs` gained an
`ML_DATA_DIR` override so the pipeline runs against a throwaway workspace. See
`spec/decisions.md` (2026-07-08) and [hands-off-orchestrator.plan.md](hands-off-orchestrator.plan.md)
Wave A. The original description is kept below for context.

**What this is:** a **regression test based on diffs**, not a separate product feature.
Before a risky refactor, run the full pipeline (parse → merge where applicable → render)
on real rounds and **save the outputs** (`music.json`, `music.md`, HTML, etc.) as a
baseline. After the change, regenerate the same artifacts and **`diff` the new output
against the baseline**. Any unexpected diff means behavior drift that unit tests
didn't catch.

Today this is a manual checklist (snapshot to `/tmp/ml-before`, then
`diff -r /tmp/ml-before data/analysis`). **Goal:** turn it into something repeatable —
e.g. `just test-regression`, a script under `scripts/`, or committed fixtures under
`tests/regressions/` — so refactors can't silently change vote tables or JSON shape.

Also useful: snapshot the public export list of `score-core.mjs` before/after module
splits (`/tmp/ml-exports-before.txt`).

See [split-score-core-into-modules.plan.md](split-score-core-into-modules.plan.md) Phase 0
for the manual steps used during the score-core split.
