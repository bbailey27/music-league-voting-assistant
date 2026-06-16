---
name: allocator-fill-and-maybe-funding-fixes
overview: "Fix two real allocator bugs seen on kpop-solo: (1) waterfill over-raises the top tier and skips intermediate point levels ({4,1,0}); (2) maybe band is pre-funded before passes, letting a maybe beat a clear pass. Bug 1 implements the center-out integrated fill (R1); Bug 2 reorders passFailMaybe funding in allocate()."
status: pending
isProject: false
---

# Allocator fill + maybe-funding fixes

**Related plans.** Bug 1 is the motivating example for
[`center-out-smooth-allocation.plan.md`](center-out-smooth-allocation.plan.md) **R1**
(center-out unit-step staircase). Implement Bug 1 as R1 — do not patch
`waterfillLevels` in isolation unless R1 is explicitly deferred. Bug 2 is
orthogonal and can ship first. R3/R4 refinements in
[`future-plans.plan.md`](future-plans.plan.md) stay deferred.

---

## Bug 1 — Top-heaviness + skipped point levels

### Problem statement

On real rounds with a modest budget and a tight score cluster, the allocator
produces a **tall top tier and a cliff**, skipping intermediate point values.

**Concrete example (kpop-solo-like field).** 10 songs scored
`80, 76, 76, 75.5, 75, 75, 74.5, 74, 74, 73.5…` with budget **10**, cap **5**:

```
4×1 / 1×6 / 0×3   →  distinct levels {4, 1, 0}  (4→1 gap of 3)
```

The kpop-solo driver currently works around this by capping at 2/song
(`scripts/one-off/kpop-solo-versions.mjs`, the `CAP` constant) until this fix lands. With cap 10
and the same field the allocator still top-loads (e.g. one song at 4, six at 1).

**Owner requirements (hard rules for the fix):**

1. **Contiguous point tiers** — distinct vote values in the final curve must be
   sequential integers exactly 1 apart: `{3,2,1,0}` ✓, `{4,1,0}` ✗. This is
   stronger than the existing *score-gap smoothness* check; it is a property of
   the **point curve itself**.
2. **Cap top-heaviness** — a lone `4` (or even `3`) is wrong for ~10 points
   spread across 75+ songs in a tight cluster; prefer more `1`s/`2`s and a lower
   max.
3. **Integrated greedy fill** — promotion decisions and bucket split/merge happen
   in **one pass**: “Do I have enough points to promote this next clump? If not,
   can I split the next bucket and promote that sub-tier?” Not a separate
   waterfill phase that repeatedly raises tier 0.

### Root-cause hypothesis (code)

In [`scripts/score-core.mjs`](../../scripts/score-core.mjs):

| Location | Role |
|----------|------|
| `allocateBell` ~971–1145 | Builds K score clusters via Ckmeans, assigns point levels via waterfill, picks smoothest candidate |
| `waterfillLevels` ~931–965 | **Phase 1:** raise the tier with the largest bell-target deficit (top tiers win). **Phase 2:** spend any remainder by repeatedly raising the **first** raiseable tier top-down — usually tier 0 again |
| Bell targets ~1051–1052 | `(weight/count/totalW) * budget` — top-weighted tiers target the cap, attracting fill |
| Smoothness check ~1079–1085 | Only rejects **score-adjacent** songs >1 point apart; a `{4,1,0}` cliff on a **real score gap** can pass |
| K-selection ~1152–1159 | Prefers **more distinct point tiers** (`b.distinct - a.distinct`) — can pick a clustering whose waterfill skips levels |

The failure mode: phase 1 pushes tier 0 toward the bell target (often near cap);
phase 2 dumps leftover budget into tier 0 because `canRaise(0)` is true while
tier 1 is already at 1 and tier 0 is at 3 — monotonicity allows another +1 on
tier 0 (4 > 1) but **cannot** insert a tier at 2 or 3 without restructuring
clusters. Skipped levels are structural, not a rounding bug.

### Proposed fix — implement R1 (center-out staircase)

**Do not extend `waterfillLevels`.** Replace the bell-target + waterfill core in
`allocateBell` with the **R1 staircase enumerator** already specified in
[`center-out-smooth-allocation.plan.md`](center-out-smooth-allocation.plan.md)
(sections “Model: stacked unit steps” and “Changes §1 · R1 construction”).

Summary of the integrated algorithm:

1. **Units** — group by `tierKey` (unchanged); optionally R2-merge ≥80 favorites
   (same plan, can land in same PR or immediately after).
2. **Boundaries** — candidate promotion/cutoff positions = gaps between units
   (Ckmeans-ranked, largest first) ∪ anchor positions at 75 and 80.
3. **Staircase** — nested boundaries top-down: baseline `1` at/above the 0/1
   cutoff, `+1` for each promotion boundary crossed. Adjacent point tiers differ
   by exactly **1 by construction**.
4. **Budget** — enumerate feasible boundary sets whose
   `Σ (#songs ≥ boundary) == budget` (exact); prefer pure unit-step solutions,
   boundaries on large gaps/anchors, then **shorter top** (fewer promotion steps).
5. **Fill = structure** — there is no separate waterfill; choosing boundaries
   *is* choosing both cluster splits and point levels in one decision.
6. **Tradeoffs** — top 2–3 distinct feasible staircases → existing
   `tier-structure` options (`candidates[]` shape unchanged).

This directly matches the owner’s “promote next clump vs split and promote
sub-tier” mental model: each promotion step is either a new boundary (split) or
raising all songs above an existing boundary (promote clump), one +1 at a time,
top-down until budget is spent.

**Preserved invariants** ([`spec/point-allocation.md`](../../spec/point-allocation.md)):

- Budget exactness — staircase sum equals budget; `spillRemainder` unchanged for
  cap-blocked / forced per-member remainder only.
- Monotonicity + equal-score units — still via `tierKey` and atomic units.
- No mixed targets — gate/maybe changes are Bug 2 only.
- Existing `--shape` bell presets — keep for opt-in; only `auto` routes to
  staircase (per center-out plan).

**If R1 must be split across PRs**, the only acceptable interim patch is to add a
**point-tier contiguity guard** to K-selection (reject candidates whose
`distinct levels` have gaps >1) *and* cap phase-2 waterfill so tier *i* cannot
be raised more than `levels[i-1]` times without first raising tier *i-1* — but
this is a band-aid; R1 is the real fix.

### Edge cases (Bug 1)

| Case | Expected behavior |
|------|-------------------|
| Budget exactness | Staircase enumeration must hit `budget` exactly; nearest-feasible + `forced-spill` only for documented exceptions (indivisible unit, gated-out pool) |
| Ties / equal scores | Same `tierKey` unit never split across a boundary; indivisible remainder still via phase-3 spill + `tier-split` tradeoff |
| Single-tier round | One boundary (cutoff only) → all funded songs same point value |
| High cap, low budget | Top height emerges from promotion count, not cap — no `{4,1,0}` on tight cluster |
| `--bucket-count` / `--tier-count` pins | Map to boundary count / distinct point values per center-out plan; pins win over default preference |
| Bug 2 interaction | Pass-only pool fed to staircase; maybes never enter `allocateBell` (see below) |
| Downvotes | Mirror staircase below center in follow-up (`allocateBellDown`); not blocking for these bugs |

### Verification (Bug 1)

Add to [`tests/score.test.mjs`](../../tests/score.test.mjs):

1. **`kpop-solo-like contiguous curve`** — 10–16 songs, scores in 72–80, budget
   10, cap 5: assert distinct levels have gaps of exactly 1 (e.g. `{2,1,0}` not
   `{4,1,0}`); assert max tier ≤ 2 for this fixture (top-heaviness cap).
2. **Regression on `3 3 3`** — default auto curve matches center-out **C2**
   (`3,3 / 2×2 / 1×5 / 0`) per center-out plan tests.
3. **No-cap-reach** — high cap does not inflate top when a shorter staircase
   spends the budget exactly.
4. **Integration** — `node scripts/one-off/kpop-solo-versions.mjs` without the CAP=2
   workaround should produce contiguous curves; remove or raise the script cap once
   green.

Manual: `node scripts/parse-round.mjs rounds/2026-06-11-kpop-solo.html` (gate
profile) — spot-check no `{4,1,0}` and no cap-2 workaround needed.

---

## Bug 2 — Maybes funded before passes

### Problem statement

On `passFailMaybe` rounds, **clear passes can receive 0 while maybes receive 1**
because `allocate()` reserves maybe points **before** shaping the pass band.

**Concrete example (kpop-solo V3/V4).** Budget 10, ~7 passes and several maybes.
Output includes entries like `1 Jay Park [maybe]` at music 76 while higher or
equal passes sit at 0. Reproducible minimal case:

```
7 passes (scores 76…69), 2 maybes, budget 10, cap 10
→ passes p6, p7 at 0; maybes m1, m2 at 1  ✗
```

**Owner rule:** *“Maybe should be leftovers. Do passes first.”* A clean pass must
**never lose to a maybe** — the maybe band sits strictly below passes in gate
order ([`spec/point-allocation.md`](../../spec/point-allocation.md) profile
`passFailMaybe`; [`spec/fit-evaluation.md`](../../spec/fit-evaluation.md)
gate vocabulary).

### Root-cause hypothesis (code)

In `allocate()` ~499–551:

```512:542:scripts/score-core.mjs
  // Decide how many 'maybe' (questionable) entries to reward. ...
  let includedMaybes = [];
  if (maybes.length) {
    const spare = Math.max(0, budget - passes.length);
    const includeCount =
      typeof len === 'number'
        ? Math.round(Math.max(0, Math.min(1, len)) * maybes.length)
        : Math.min(maybes.length, spare); // auto: only as many as there are clearly-spare points
    includedMaybes = maybes.slice(0, includeCount);
    // ... maybe-band tradeoff ...
  }

  // Each funded maybe takes a single bottom-tier point; the rest of the budget
  // is shaped across the clear passes.
  const primary = passes.length ? passes : includedMaybes;
  let primaryBudget = budget;
  if (passes.length && includedMaybes.length) {
    for (const m of includedMaybes) m.finalVotes = Math.min(1, cap);
    primaryBudget = budget - includedMaybes.reduce((a, m) => a + m.finalVotes, 0);
  }
  // ...
  allocateBell(primary, primaryBudget, cap, shape, profile, tradeoffs);
```

Problems:

1. **`spare = budget - passes.length`** treats one point per pass as “reserved,”
   then funds that many maybes **up front** (lines 539–541) — not leftover after
   pass shaping.
2. **Maybes are removed from the pass pool** but receive votes before
   `allocateBell` runs on passes with a reduced budget.
3. **No gate-order guard** — nothing enforces `min(pass votes) ≥ max(maybe votes)`
   when any maybe is funded.

`allocateBell` is innocent here; the bug is purely funding order and maybe
inclusion logic in `allocate()`.

### Proposed fix — passes first, maybes from verified surplus

**Phase A — shape passes (always).**

1. Do **not** assign `finalVotes` to maybes before bell/staircase.
2. Run `allocateBell` / R1 staircase on **`passes` only** with a tentative
   `passBudget` (see phase B).
3. If there are **no passes**, keep current behavior: shape `includedMaybes`
   directly (unchanged fallback at line 537).

**Phase B — maybe inclusion (leftovers only).**

Compute `includedMaybes` and `passBudget` together:

```
candidateMaybeCount =
  leniency knob (0…maybes.length) OR auto heuristic (see below)

passBudget = budget - candidateMaybeCount   // each included maybe will get exactly 1

Run staircase/bell on passes with passBudget

gateOrderOk =
  candidateMaybeCount == 0
  OR min(pass.finalVotes) >= 1          // strict: no maybe funded while any pass at 0
  // (stronger invariant: min(pass) >= max(maybe) when maybes funded — same for 1pt maybes)

If !gateOrderOk:
  retry with candidateMaybeCount = 0, passBudget = budget   // passes first, always

If gateOrderOk:
  assign includedMaybes each 1 pt (cap), most-defensible first (existing sort)
```

**Auto heuristic (replace `spare = budget - passes.length`):**

- Start with `candidateMaybeCount = 0`.
- Only increase if a **trial run** shows `gateOrderOk` after pass shaping — e.g.
  binary search or decrement from `min(maybes.length, budget - passFloor)` where
  `passFloor` is the minimum budget to give every pass ≥1 (usually `passes.length`,
  but bell may still zero the bottom pass — see open question below).
- Surface the `maybe-band` tradeoff **after** the trial, listing counts that
  actually satisfy gate order (0, …, max feasible).

**Hard invariant (enforce in code and tests):**

> If any maybe has `finalVotes > 0`, then every pass must have
> `finalVotes >= that value` (equivalently: no pass at 0 while any maybe is funded).

**Interaction with Bug 1 / R1:** Maybes never enter the staircase unit list.
Pass pool → staircase with `passBudget`; maybe points are assigned after, outside
`allocateBell`. `spillRemainder` still runs on the full song set for exact bank
spend.

**Spec alignment:** Updates the *behavior* of “conditional tier below passes” to
match the owner rule. When implemented, update
[`spec/point-allocation.md`](../../spec/point-allocation.md) gate section and add
a [`spec/decisions.md`](../../spec/decisions.md) entry — **not in this plan PR**
(decision log rule applies at implementation time).

### Edge cases (Bug 2)

| Case | Expected behavior |
|------|-------------------|
| Budget == passes.length | No maybes funded; passes shaped with full budget (existing tight test stays) |
| All passes naturally ≥1 after shaping | Maybes can receive 1 each from deducted budget if gate-order trial passes |
| Bottom pass at 0 (natural bell zero band) | **No maybe funded** under strict rule — zeros stay in the pass band, not given to maybes |
| `leniency = 1` | Still subject to gate-order guard unless owner explicitly opts to weaken it (open question) |
| All-maybe (no passes) | Shape maybes with full budget (unchanged) |
| All-pass | No maybe logic runs |
| Pinned overrides | Maybes still last; pins on passes consume budget before maybe trial |
| Combined with Bug 1 | Pass-only staircase; same gate-order rules |
| `spillRemainder` | Must not fund maybes via spill while passes at 0 — spill targets best **passes** first |

### Verification (Bug 2)

Add / update in [`tests/score.test.mjs`](../../tests/score.test.mjs):

1. **`pass-never-loses-to-maybe`** — repro fixture (7 passes, 2 maybes, budget 10):
   assert no maybe has votes unless every pass has ≥ that many votes; specifically
   assert no `(pass=0, maybe>0)` pairs.
2. **Update `passFailMaybe: questionable band funded only when budget is generous`**
   — generous case (5 passes, 4 maybes, budget 12) will likely fund **zero**
   maybes under strict gate-order (passes-only bell gives bottom pass 0). Revise
   expectations OR use a fixture where all passes reach ≥1 before maybe funding
   (e.g. 3 passes, budget 10, 2 maybes — expect 2 maybes at 1, all passes ≥1).
3. **kpop-solo regression** — V3/V4 gate profiles: no maybe in the awarded list
   unless every pass is strictly above the maybe band (or all passes ≥1).
4. **Tradeoff** — `maybe-band` options only list counts feasible under gate-order
   guard.

---

## Implementation order

1. **Bug 2 first** (small, isolated `allocate()` change) — immediately stops
   pass-below-maybe regressions on gate rounds.
2. **Bug 1 via R1** (larger `allocateBell` rewrite per center-out plan) — fixes
   contiguity and top-heaviness for all `auto` rounds.

Both can land in one PR or two; Bug 2 has no dependency on R1.

## Files to touch (implementation — not this plan)

| File | Bug 1 | Bug 2 |
|------|-------|-------|
| `scripts/score-core.mjs` | Replace waterfill/K-loop with staircase (R1) | Reorder maybe funding in `allocate()` |
| `tests/score.test.mjs` | Contiguity + kpop-like fixtures | Gate-order + revised maybe tests |
| `spec/point-allocation.md` | Allocation model → center-out (with R1) | Gate maybe band wording |
| `spec/decisions.md` | At R1 landing | At maybe-order landing |
| `scripts/one-off/kpop-solo-versions.mjs` | Remove CAP=2 workaround when green | — |

## Open design questions (owner input)

1. **Maybe “leftovers” vs generous budget.** Strict gate-order (`no maybe if any
   pass at 0`) means many real rounds (bottom pass naturally 0) will **never** fund
   maybes even with budget 12+. Is that intended, or should “passes first” mean
   passes get the full bell/staircase on the **entire** budget first and maybes
   only receive points if we **demote** the lowest pass tier to fund them?

2. **Leniency knob.** Should `leniency > 0` override the gate-order guard (old
   behavior for max leniency), or is the guard absolute?

3. **R1 vs interim patch.** Confirm implementing full R1 now (preferred) vs a
   short-term waterfill guard while R1 is in progress.

4. **Maybe point level.** Confirm maybes stay at exactly 1 when funded (current
   spec) or can receive staircase tiers when budget is very large.

5. **R2 favorite-band merge.** Ship with Bug 1/R1 in the same PR, or immediately
   after? kpop-solo benefits from contiguity even without R2.
