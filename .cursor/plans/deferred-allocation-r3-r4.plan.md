---
name: deferred-allocation-r3-r4
overview: "Optional allocator refinements beyond the shipped R1 staircase + R2 favorite-band merge. Deferred indefinitely — implement only if real rounds show a recurring gap. May never ship."
status: deferred
isProject: false
---

# Deferred: allocation R3 / R4

**Status:** Not on any active wave. **May never be implemented.**

**Already shipped (2026-06-16):** R1 center-out unit-step staircase, R2 ≥80
favorite-band merge, Bug 2 passFailMaybe funding order. See `spec/decisions.md`
(2026-06-16 entries) and `scripts/score/allocate.mjs`.

R1 already prefers boundary positions at **75** and **80** when enumerating
staircases. R3 would go further — hard funded floors. R4 would compress perceived
gaps by distance from center — likely redundant now that R1 no longer turns a large
score gap into a large point jump.

---

## When to reconsider (all must be true)

Only reopen this plan if:

1. **A specific real round** (not a toy fixture) produces a curve that feels wrong
   *after* tuning with existing knobs (`--shape`, `--tier-count`, pins, gate profile).
2. The failure mode **matches R3 or R4** below — not a parse bug, gate misread, or
   fit-merge issue.
3. You can describe the expected output in a **regression test** before coding.

If none of the above, leave deferred.

---

## R3 — semantic score anchors at 75 / 80

**Idea:** Harden the owner's mental anchors into **first-class tier behavior**, not
just preferred staircase boundary positions.

| Score band | Intended meaning | R3 behavior (if built) |
| --- | --- | --- |
| **≥ 80** | Favorite | Top-tier **floor** — band clears at least 1 pt baseline (R2 already merges ≥80 into one unit) |
| **≥ 75** | Definitely actively like | **Funded floor** — song ≥ 75 gets ≥1 pt in most budgets; **74** "almost-there" groups with 75s when space allows |
| **76** | Tiebreak over plain 75 | Promote ahead of plain 75s when the band must split |
| **68–72** | Fuzzy / inconsistent | **Do not** drive fine-grained splits — acknowledge imprecision |

**Touch:** `scripts/score/allocate.mjs` staircase enumeration + preference rules;
`spec/point-allocation.md`; new regression fixtures.

**Risk:** Over-funding the 75 band on tight budgets; fighting user pins/tradeoffs.

---

## R4 — variance-aware gap compression

**Idea:** Score distances count for **less** the farther from the round's center, so
`77 → 84` reads as a smaller effective gap than 7 raw points ("precise near the
average, fuzzier farther out").

**Likely redundant** with R1: the unit-step staircase already limits point jumps to
+1 per boundary; a raw 7-point score gap no longer becomes a 7-point vote cliff.

**Revisit only if:** after R1/R2, curves still **over-react** to high-end gaps in
practice (e.g. one favorite still dominates the budget disproportionately).

**Touch:** gap weighting in boundary candidate scoring (`JUNK_GAP` / promotion
penalties in `allocate.mjs`); hard to test without subjective round review.

---

## Explicit non-goals

- Not a substitute for parse fixes (shipped — see `spec/score-parsing.md`)
- Not needed for pipeline stage work ([remaining-work-master](remaining-work-master.plan.md))
- Do not patch `waterfillLevels` — removed by R1; any new work extends the staircase

## If implemented later

1. Add failing regression test from the real round that motivated it.
2. One decision log entry per R3/R4 (or combined if shipped together).
3. Delete or mark this plan `done`; remove from deferred tracking in master plan.
