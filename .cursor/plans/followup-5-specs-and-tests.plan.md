---
name: "Follow-up 5: Specs, rules, and tests"
overview: Bring the spec/rules in line with implemented behavior and add a regression/test harness over the committed sample round.
status: pending
depends_on: MVP
isProject: false
---

# Follow-up 5: Specs, rules, and tests

## Spec / rule updates
- `spec/round-input-parsing.md` (new): schema-first; confirmed HTML selectors; text rules; the hard user-vs-submitter scoring contract (`userComment` is the sole scoring source; `submitterComment` is scoring-neutral context).
- `spec/score-parsing.md`: digit-count scaling (3-digit/10, 2-digit as-is, 1-digit x10); combined modifiers (`745+`, `75+?`, `73-`); score+freetext; alternate scales (`10/10`) ignored; disqualification — `isDisqualified` (`no` / `nope` / `invalid` keyword, and bare `-` which means a true DQ *or* an unspecified low score unlikely to place; words-only -> disqualified in objective, `needsReview` otherwise); empty box -> `needsUserInput`; `play` -> `playlistAdd` (tiebreak only, no floor); compressed-scale numbers (most 65-80, 80-90 strong/rare, 90+ almost never) are rough cross-league context only, NOT thresholds.
- `spec/point-allocation.md`: tiers derive solely from the round's own score distribution (modal score = center of the curve; floor = the round's own low end); cross-league numbers are context only; presets deferred to Follow-up 4.
- `spec/fit-evaluation.md`: three modes (objective gate / subjective music-primary / thematic fit-tiered) + the thematic ladder + confirm-mode-at-start.
- `spec/comments.md`: reaffirm the user vs submitter scoring contract.
- `.cursor/rules/parsing.mdc`, `output.mdc`, `allocation.mdc`: parse via extractor first; own-song skip; `data-weight` = the user's own vote; placeholder -> ask; two output tables (ranked w/ artist column; slim raw-order).

## Tests
- `tests/extract.test.mjs`: HTML (and later text) -> equivalent counts, own-skip, budget values, a few specific songs; optional golden JSON.
- `tests/score.test.mjs`: token parsing (`755`->75.5, `7`->70.0, `73-`, `74 soft punk`, `10/10` ignored); disqualified vs empty vs `play`; allocation sums to budget, respects cap, excludes own/disqualified.
- `tests/regressions/006.md`: prose expectations over the committed sample.
