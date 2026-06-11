---
name: center-out-smooth-allocation
overview: "Rebuild the auto allocator around the owner's mental model: construct the point curve from the center outward by stacking unit (+1) steps on natural gaps, so adjacent tiers default to exactly 1 point apart and the top is only as tall as the budget naturally reaches — instead of targeting the cap and then trimming gaps. Plus: an 8+ favorite band collapses into one shared top tier by default."
status: pending
isProject: false
---

# Center-out smooth allocation (R1) + favorite top-band collapse (R2)

## Problem

The current `allocateBell` ([`scripts/score-core.mjs`](../../scripts/score-core.mjs))
builds the curve the wrong way round. It computes per-tier **bell targets** that
push the top tier toward the **cap**, fills with a monotonic waterfill, then runs a
`K = 1..n` clustering sweep and *rejects* candidates that violate smoothness. The
net effect on real rounds is a tall top tier with a hard cliff under it — e.g. the
`3 3 3` round (budget 15, cap 4, 22 songs) could only produce:

- `--bucket-count 2` → `4×2 / 1×7` — shares the top (90/84 at the cap) but a **4→1
  cliff**.
- `--bucket-count 8` → `3 / 2 / 1×10` — smooth, but **splits 90 and 84 apart**.

Neither matches how the owner actually scores. The owner's model (confirmed):

> Build from the middle and incrementally add tiers, where **adjacent tiers are by
> default only 1 point apart**. Don't fit up to the max and then remove gaps. The
> only exceptions to the 1-point step are when it's mathematically impossible or it
> would force points onto invalid / very-low songs — both rare. Prefer more
> granularity and a lower top over a big gap (`I'd rather ... lower max points than
> shove a bunch of songs down to 1 just to make a gap so the top can be at 4`).
>
> High scores aren't differentiated: **8+ = favorite = top tier** (90 vs 84 is not a
> meaningful difference). 75 = "actively like" (a clear funded delineator).

The hand-built target for `3 3 3` (applied to the round via pins, the shape this
plan should generate **automatically**) is curve **C2**:

```
90, 84 → 3   |   77+, 75.5 → 2   |   74, 73.5+, 73.5, 73?, 72.5 → 1   |   72? and below → 0
```

i.e. a shared 8+ top at 3, a smooth 3→2→1→0 descent (every step exactly 1), and the
cutoff at 72.5 (where it "landed in a good spot").

## Decisions (confirmed)

- **R1 — center-out unit-step construction.** Replace the bell-target + waterfill +
  reject-on-smoothness pipeline with a **constructive staircase**: assign each song
  `baseline(1 if at/above the 0/1 cutoff, else 0)` **plus** one extra point for each
  **promotion boundary** it sits above. Promotion boundaries are added **top-down**,
  one unit step at a time, until the budget is spent **exactly**. Every step is `+1`,
  so adjacent point-tiers are 1 apart **by construction**.
- **No reaching for the cap.** The top tier's height is an emergent result of how
  many promotion steps the budget funds, not a target. The per-song `cap`
  (`maxUpvotesPerSong`) is still a hard ceiling, but it is no longer an attractor.
- **Allowed exceptions to the 1-point step (rare).** A `>1` step (or a forced
  per-member split) is permitted **only** when (a) no all-unit-step staircase spends
  the budget exactly without funding gated-out / disqualified / clearly-low songs, or
  (b) the existing indivisible-remainder case inside an equal-score unit. Both surface
  as tradeoffs (reuse `forced-spill` / `tier-split`).
- **R2 — favorite top-band collapse (default on).** Scores **≥ 80** ("8+") are merged
  into a **single atomic top unit** so they share the top tier (90/84 together) by
  default. This is *looser than a strict majority*: when the band holds a
  **significant** number of songs, surface a `top-band-split` tradeoff offering to
  break it on its own internal gaps — but the default keeps them together.
- **Tradeoffs are the deliverable.** The close alternatives (different cutoff / how
  many songs get a 2) are surfaced exactly like the C1/C2/C3 options the owner picked
  from — "that's the kind of options I want it to see as my final tradeoffs."
- **This changes the default `auto` shape.** Legacy `bell` / `compressed` /
  `balanced` / `top-heavy` / `relative` presets stay selectable via `--shape` but are
  no longer the default path. *(Open for confirmation on review: default vs. a new
  `--shape smooth` opt-in. Recommendation: make it the default — it is how the owner
  always wants it.)*

## Model: stacked unit steps (the construction)

Let the eligible, ranked, gated-in songs be grouped into the existing atomic
`tierKey` units (equal opinion never splits). Define a small set of **boundary
positions** = the natural gaps between units (Ckmeans-ranked, largest first) plus the
**anchor positions** at 75 and 80 (R3 makes anchors first-class later; for R1 they
are just additional candidate boundary positions so a step can prefer to land there).

A **staircase** is a chosen nested set of boundaries `t0 > t1 > t2 > …` (in rank
value), read top-down:

- `t0` = the **0/1 cutoff**: songs at/above it get the baseline `1`; below it get `0`.
- each higher boundary `t1, t2, …` is a **promotion step**: songs above it get `+1`.

So `votes(song) = [score ≥ t0] + Σ_k [score ≥ t_k]`. The curve is automatically
monotonic, every adjacent tier differs by exactly 1, and

```
budget = (#songs ≥ t0)  +  Σ_k (#songs ≥ t_k)
```

Enumerate feasible staircases (cutoff position × promotion-step positions, each on a
boundary, respecting `cap` and the R2 top-band merge) whose sum **equals the budget**.
Among feasible staircases prefer, in order:

1. **No exception used** (pure unit steps, no forced spill into low/invalid songs).
2. **Boundaries on the largest real gaps and on the 75 / 80 anchors** (so steps fall
   where the owner's scoring is meaningful, not in the fuzzy 68–72 band).
3. **The shorter top** (fewer/lower promotion steps) when two staircases tie — encodes
   "lower max points over a forced gap."
4. Existing tiebreakers (cleanest break placement / GVF).

The top 2–3 distinct feasible staircases become the `tier-structure` tradeoff options
(deduped on the final point distribution, as today).

### Worked example — `3 3 3` (budget 15, cap 4, 22 songs)

Units (desc): `[90,84]` (R2-merged) · `77+` · `75.5` · `74` · `73.5+` · `73.5` ·
`73?` · `72.5` · `72?` · … Feasible unit-step staircases summing to 15 include:

- **C1**: cutoff at 72?, one promotion (≥77) → `3,3 / 2 / 1×7`.
- **C2** ✅ default-preferred: cutoff at 72.5, promotions at ≥75.5 and ≥80 →
  `3,3 / 2×2 / 1×5` (boundaries land on the 75 anchor + the 84→77 gap; top stays at 3).
- **C3**: cutoff at 73?, promotions at ≥74 and ≥80 → `3,3 / 2×3 / 1×3`.

All three are pure unit-step staircases; the allocator surfaces them as the tradeoff
and defaults to C2.

## Changes

### 1. `scripts/score-core.mjs`

- **R2 unit merge.** In the unit-building step of `allocateBell` (around lines
  983–1000), after grouping by `tierKey`, merge all units whose rank value is `≥ 80`
  into one synthetic top unit (carry combined members/count/value). Gate behind a
  `profile.favoriteBand` config (default `{ min: 80, splitAt: <significant> }`).
  - When the merged band's member count is "significant" (proposed default:
    `≥ ceil(fundedSongs / 3)` **or** `≥ 4`, whichever is smaller — tune during impl),
    also retain the **unmerged** boundaries as an alternative and emit a
    `top-band-split` tradeoff.
- **R1 construction.** Replace the bell-target/`waterfillLevels` core (lines ~931–965
  and the `K = 1..Kmax` candidate loop ~1046–1145) with the **staircase enumerator**:
  - Candidate boundary positions = unit gaps (already have `unitVals`) ∪ anchor
    positions (75, 80) that fall between units.
  - Enumerate cutoff × promotion-step combinations (bounded: ≤ `cap` steps, ≤ units),
    compute each curve's sum, keep those `== budget` (and the nearest feasible when
    none is exact → marks the "exception" path / forced spill).
  - Score each feasible curve by the preference order above; reuse the existing
    per-song smoothness check only as a **guard/label** (it should never trip for a
    pure unit-step staircase).
  - Keep producing the same `candidates[]` shape (`runs`, `distinct`, `voteKey`,
    `tiers`, `levels`) so the **tradeoff surfacing, `--tier-count` / `--bucket-count`
    selection, and renderer are unchanged**. `--bucket-count` maps to "number of
    boundary positions used"; `--tier-count` stays "number of distinct point values".
- **Preserve invariants.** `tierKey` equal-tier grouping, modifier-breaks-indivisible
  -split (`+`/`-`), `spillRemainder` budget exactness, `flagUncertainBoundaries`, and
  the **downvote** mirror (`allocateBellDown`) all stay; the downvote side gets the
  same center-out treatment (steps below center) in a follow-up sub-task if needed.
- Keep `allocateRelative` and the `SHAPE_PRESETS` bell path intact for `--shape`
  opt-in; only `auto` routes to the staircase.

### 2. `scripts/parse-round.mjs`

- No new required flags. Optionally add `--favorite-band <min>` (default 80) and
  `--no-favorite-band` to disable R2; thread into `profile`. Update the usage string.

### 3. Tests — `tests/score.test.mjs`

- **R1**: a wide field (like `3 3 3`) auto-produces a pure unit-step staircase
  (no adjacent-tier point gap `> 1`); assert the default equals **C2**
  (`3,3 / 2×2 / 1×5 / 0`) and that C1/C3 appear as surfaced `tier-structure` options.
- **R1 no-cap-reach**: with a high cap, the top tier does **not** inflate to the cap
  when a shorter top spends the budget.
- **R1 exception**: a budget that no unit-step staircase can hit exactly falls back to
  the documented exception (forced spill) and surfaces a tradeoff — and this is rare
  (most 10–30 song / 10–30 point rounds have an exact unit-step solution).
- **R2**: two `≥80` songs share the top tier by default; a field with many `≥80`
  songs emits a `top-band-split` tradeoff; `--no-favorite-band` disables the merge.
- **Regression**: existing `score.test.mjs` allocation cases updated to the new
  default curves (document the intended new shapes; don't just chase green).

### 4. Spec + docs

- [`spec/point-allocation.md`](../../spec/point-allocation.md): rewrite "Allocation
  model" and "Standing shape preference" to describe **center-out unit-step
  construction** (replacing "match the bell, fill toward the cap, trim gaps"); the
  default-1-point-step rule and its two exceptions; the 8+ favorite top-band merge and
  its `top-band-split` tradeoff.
- [`spec/decisions.md`](../../spec/decisions.md): add a newest-first entry when this
  lands (per the decision-log rule) — "Allocator builds the curve center-out in unit
  steps; 8+ collapses to a shared top tier."
- [`.cursor/skills/point-allocation/SKILL.md`](../skills/point-allocation/SKILL.md):
  update the model summary and any `--shape`/band knob notes.

## Potential refinements (R3 / R4 — deferred)

See [`future-unscoped-plans.plan.md`](future-unscoped-plans.plan.md) "Potential
refinements (allocation)". Try R1 + R2 first and revisit only if needed:

- **R3 — semantic anchors at 75 / 80 as first-class boundaries** (75 = "actively
  like", funded floor with ≥1 pt when budget allows; 80 = favorite floor). R1 already
  treats them as preferred boundary *positions*; R3 would harden them into floors.
- **R4 — variance-aware gap compression** (distances far from the center count for
  less, so 77→84 reads as a smaller gap than its raw 7 points). Likely **redundant**
  once R1 + R2 ship, since the staircase no longer turns a big gap into a big point
  jump.

## Out of scope

- Gate logic (`passFail` / `passFailMaybe` / cutoff), fit merge, parsing, and
  rendering are unchanged except where the candidate/tradeoff shape is reused.
- Downvote center-out parity is a fast-follow if the upvote staircase lands cleanly.

## Verify

- `npm test` (extended `tests/score.test.mjs`).
- `node scripts/parse-round.mjs rounds/2026-06-11-lfm-stats-333.html` (no `--pin`)
  should now auto-default to **C2** and surface C1/C3 as the tradeoff options.
- Spot-check `rounds/2026-06-10-pisces.html` and a tightly-clustered field to confirm
  smooth descents and sensible cutoffs without manual pins.
