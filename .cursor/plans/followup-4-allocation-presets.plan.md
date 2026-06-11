---
name: "Follow-up 4: Deterministic allocation engine — DONE"
overview: Superseded by the consolidated web-app-and-allocation-engine plan and now implemented in scripts/score-core.mjs. Kept as a record of what shipped.
status: done
depends_on: MVP (relative draft allocator)
isProject: false
---

# Follow-up 4: Deterministic allocation engine (implemented)

This follow-up was absorbed into
[web-app-and-allocation-engine.plan.md](web-app-and-allocation-engine.plan.md)
(Plan A) and is now built + tested in `scripts/score-core.mjs`
(`tests/score.test.mjs`, 23 cases). What shipped:

## Profile-driven allocator
- `allocate(songs, budget, cap, profile)` with `rankBy` (music / fit / combined),
  `gate` (graded `cutoff`, `passFail`, three-state `passFailMaybe` with
  budget-driven leniency for the questionable band), and `shape`
  (`auto` default = ratio + spread driven, `bell`, presets `compressed` /
  `balanced` / `top-heavy`, legacy `relative`).
- **Mode-centered bell** anchored on the round's center (`estimateCenter`), not
  the floor; widens at/below the common ~1:1 ratio to avoid flat-1s.

## Same score = same tier (scoring-type aware)
- Music-only: identical music → identical points; `+/-` only break an indivisible
  split. Gate rounds: same music **and** same gate class. Combined: identical
  music **and** same coarse fit band (made-up AI fit numbers snapped to tiers).

## Budget, floors, overrides, downvotes
- Budget spent **exactly**; `spillRemainder` spills cap-blocked points to
  gated-out/invalid as a last resort and flags it.
- `userAllocatedVotes` honored as a floor; overflow surfaces a tradeoff.
- Manual per-song `overrides` pin votes and rebalance the rest.
- Downvotes remain MVP-skippable (rarely needed).

## Interactive tradeoffs
- Emits `tradeoffs[]` (`tier-split`, `maybe-band`, `preallocation-overflow`,
  `forced-spill`) for CLI / web / markdown to resolve instead of deciding silently.

See [spec/point-allocation.md](../../spec/point-allocation.md) for the codified,
named rules.
