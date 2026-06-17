---
name: allocator-fill-and-maybe-funding-fixes
overview: "Fix two real allocator bugs seen on kpop-solo: (1) waterfill over-raises the top tier and skips intermediate point levels ({4,1,0}); (2) maybe band is pre-funded before passes, letting a maybe beat a clear pass. Bug 1 implements the center-out integrated fill (R1); Bug 2 reorders passFailMaybe funding in allocate()."
status: pending
isProject: false
---

# Allocator fill + maybe-funding fixes

**Related plans.** **R1** (the center-out unit-step staircase) and **R2** (the ≥80
favorite-band merge) originated in
[`center-out-smooth-allocation.plan.md`](center-out-smooth-allocation.plan.md);
their full construction is now **inlined in this plan** (see _R1 + R2 — center-out
staircase construction_ below) so Bug 1 stands alone. `center-out` is retained as
the origin and for the deferred R3/R4 notes. Implement Bug 1 as R1 — do not patch
`waterfillLevels` in isolation unless R1 is explicitly deferred. Bug 2 is largely
orthogonal and ships first, **except its graduated maybe band (Q4), which reuses
the R1 staircase and therefore lands with R1** (see _Implementation order_). R3/R4
refinements stay deferred in
[`future-plans.plan.md`](future-plans.plan.md).

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
`allocateBell` (the `K = 1..Kmax` candidate loop plus `waterfillLevels`) with the
**R1 staircase enumerator**. The full construction, the R2 favorite-band merge, the
worked `3 3 3` example, preserved invariants, and the interim-patch fallback are
inlined in the **_R1 + R2 — center-out staircase construction_** section below.
Ship R2 in the same PR — the `3 3 3` → C2 regression depends on the ≥80 merge.

This fixes both owner requirements at once: **contiguity** (every step is `+1` by
construction) and **top-heaviness** (the top is only as tall as the promotion steps
the budget funds, never reaching for the cap). It also matches the owner's "promote
the next clump vs. split and promote a sub-tier" mental model — each step is either
a new boundary (split) or raising everything above an existing boundary (promote),
one `+1` at a time, top-down until the budget is spent.

### Edge cases (Bug 1)

| Case | Expected behavior |
|------|-------------------|
| Budget exactness | Staircase enumeration must hit `budget` exactly; nearest-feasible + `forced-spill` only for documented exceptions (indivisible unit, gated-out pool) |
| Ties / equal scores | Same `tierKey` unit never split across a boundary; indivisible remainder still via phase-3 spill + `tier-split` tradeoff |
| Single-tier round | One boundary (cutoff only) → all funded songs same point value |
| High cap, low budget | Top height emerges from promotion count, not cap — no `{4,1,0}` on tight cluster |
| `--bucket-count` / `--tier-count` pins | Map to boundary count / distinct point values per the R1 section; pins win over default preference |
| Bug 2 interaction | Pass-only pool fed to staircase; maybes never enter `allocateBell` (see below) |
| Downvotes | Mirror staircase below center in follow-up (`allocateBellDown`); not blocking for these bugs |

### Verification (Bug 1)

Add to [`tests/score.test.mjs`](../../tests/score.test.mjs):

1. **`kpop-solo-like contiguous curve`** — 10–16 songs, scores in 72–80, budget
   10, cap 5: assert distinct levels have gaps of exactly 1 (e.g. `{2,1,0}` not
   `{4,1,0}`); assert max tier ≤ 2 for this fixture (top-heaviness cap).
2. **Regression on `3 3 3`** — default auto curve matches **C2**
   (`3,3 / 2×2 / 1×5 / 0`) per the R1 worked example below.
3. **No-cap-reach** — high cap does not inflate top when a shorter staircase
   spends the budget exactly.
4. **Integration** — `node scripts/one-off/kpop-solo-versions.mjs` without the CAP=2
   workaround should produce contiguous curves; remove or raise the script cap once
   green.

Manual: `node scripts/parse-round.mjs rounds/2026-06-11-kpop-solo.html` (gate
profile) — spot-check no `{4,1,0}` and no cap-2 workaround needed.

---

## R1 + R2 — center-out staircase construction (inlined)

The full fix for Bug 1, lifted from
[`center-out-smooth-allocation.plan.md`](center-out-smooth-allocation.plan.md) so
this plan stands alone. That plan remains the origin and holds the deferred R3/R4
notes.

### R1 — model: stacked unit steps

Group the eligible, ranked, gated-in songs into the existing atomic `tierKey`
units (equal opinion never splits). A **staircase** is a nested set of boundaries
`t0 > t1 > t2 > …` (in rank value), read top-down:

- `t0` = the **0/1 cutoff**: songs at/above it get the baseline `1`; below it, `0`.
- each higher boundary `t1, t2, …` is a **promotion step**: songs above it get `+1`.

So `votes(song) = [score ≥ t0] + Σ_k [score ≥ t_k]`. The curve is automatically
monotonic, every adjacent point tier differs by exactly **1 by construction**, and

```
budget = (#songs ≥ t0) + Σ_k (#songs ≥ t_k)
```

### R1 — construction (replaces bell-target + waterfill)

1. **Boundary positions** = the natural gaps between units (Ckmeans-ranked,
   largest first) ∪ the **anchor positions 75 and 80** (so a step can prefer to
   land on a meaningful score rather than in the fuzzy 68–72 band).
2. **Enumerate** feasible staircases (cutoff × promotion-step positions, each on a
   boundary, bounded by `cap` steps and `#units`) whose song-sum **equals budget**.
   When none is exact, the nearest feasible marks the documented exception path
   (`forced-spill`).
3. **Choosing boundaries is the fill** — there is no separate waterfill phase; one
   decision picks both the cluster splits and the point levels.
4. Among feasible staircases, prefer in order:
   1. **No exception used** (pure unit steps; no forced spill into gated-out /
      disqualified / clearly-low songs).
   2. **Boundaries on the largest real gaps and on the 75 / 80 anchors.**
   3. **The shorter top** (fewer/lower promotion steps) — encodes "lower max points
      over a forced gap."
   4. Existing tiebreakers (cleanest break placement / GVF).
5. The top 2–3 distinct feasible staircases become the `tier-structure` tradeoff
   (deduped on the final point distribution, as today).

### R2 — favorite top-band merge (default on)

After grouping by `tierKey`, merge every unit whose rank value is **≥ 80** into one
synthetic atomic top unit (so `90` and `84` share the top tier). Gate behind a
`profile.favoriteBand` config (default `{ min: 80, splitAt: significant }`). When
the merged band is "significant" (proposed `≥ ceil(fundedSongs / 3)` **or** `≥ 4`,
whichever is smaller — tune in impl), also retain the unmerged boundaries as an
alternative and emit a `top-band-split` tradeoff. `--no-favorite-band` disables the
merge; `--favorite-band <min>` overrides the threshold.

### Worked example — `3 3 3` (budget 15, cap 4, 22 songs)

Units (desc): `[90,84]` (R2-merged) · `77+` · `75.5` · `74` · `73.5+` · `73.5` ·
`73?` · `72.5` · `72?` · … Pure unit-step staircases summing to 15 include:

- **C1**: cutoff at 72?, one promotion (≥77) → `3,3 / 2 / 1×7`.
- **C2** ✅ default: cutoff at 72.5, promotions at ≥75.5 and ≥80 → `3,3 / 2×2 / 1×5`
  (boundaries land on the 75 anchor + the 84→77 gap; the top stays at 3).
- **C3**: cutoff at 73?, promotions at ≥74 and ≥80 → `3,3 / 2×3 / 1×3`.

All three surface as the `tier-structure` tradeoff; the allocator defaults to C2.

### Knobs + preserved candidate plumbing (unchanged)

- Keep producing the same `candidates[]` shape (`runs`, `distinct`, `voteKey`,
  `tiers`, `levels`) so tradeoff surfacing, the `--tier-count` / `--bucket-count`
  selection, and the renderer are all unchanged.
- `--bucket-count` maps to "number of boundary positions used"; `--tier-count`
  stays "number of distinct point values."
- Reuse the per-song smoothness check only as a guard/label — it must never trip
  for a pure unit-step staircase.

### Preserved invariants ([`spec/point-allocation.md`](../../spec/point-allocation.md))

- **Budget exactness** — staircase sum equals budget; `spillRemainder` unchanged
  for cap-blocked / forced per-member remainder only.
- **Monotonicity + equal-score units** — via `tierKey` atomic units.
- **No mixed targets** — gate/maybe changes are Bug 2 only.
- **`--shape` presets** (`bell` / `compressed` / `balanced` / `top-heavy` /
  `relative`) stay selectable; only `auto` routes to the staircase — which changes
  the `auto` default for every round.
- **Downvotes** mirror the staircase below center (`allocateBellDown`) as a
  fast-follow; not blocking for these bugs.

### Interim patch (only if R1 must split across PRs)

The sole acceptable stopgap is a **point-tier contiguity guard** in K-selection
(reject candidates whose distinct levels have gaps > 1) *plus* a cap on phase-2
waterfill (tier *i* can't be raised more than `levels[i-1]` times before tier
*i-1*). This is a band-aid — it fixes contiguity but **not** top-heaviness — so R1
remains the real fix.

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

### Proposed fix — passes first, maybes capped below passes

**Governing rule (owner, confirmed — Q1/Q2/Q4).** The hard constraint is *not*
"never fund a maybe." It is: **a maybe never receives more points than the
lowest-funded pass** — `max(maybe finalVotes) ≤ min(funded pass finalVotes)`.
Within that ceiling a `leniency` dial may reach **further down the maybe list and
grant the first few (most-defensible) maybes a bottom-tier point**, *without ever
re-ranking a maybe among the passes on music* (no "promote to pass" — a high music
score must not let a maybe climb to multiple points as if it were a solid pass).
See _Phase B_ below for how this is constructed.

**Phase A — shape passes (always).**

1. Do **not** assign `finalVotes` to maybes before bell/staircase.
2. Run `allocateBell` / R1 staircase on **`passes` only** with a tentative
   `passBudget` (see phase B).
3. If there are **no passes**, keep current behavior: shape `includedMaybes`
   directly (unchanged fallback at line 537).

**Phase B — maybe inclusion (capped below passes).**

`includedMaybes`, their point levels, and `passBudget` are decided together so the
governing rule holds by construction:

```
candidateMaybeCount =
  leniency dial (0…maybes.length)          // explicit knob; default = auto
  OR auto heuristic (verified surplus; see below)

passBudget = budget − (points reserved for the maybe band)

Run R1 staircase / bell on PASSES only with passBudget
passFloor = min(pass.finalVotes)           // lowest funded pass tier

Fund the first candidateMaybeCount maybes (most-defensible first, existing sort),
each at a bottom level ≤ passFloor:
  - default: 1 point each (requires passFloor ≥ 1)
  - low-pass round (few passes, large maybe band): the maybe band may take its OWN
    graduated staircase, but every maybe ≤ passFloor and the top passes stay
    strictly highest — this is "go further down the list," NOT "move the pass line"

gateOrderOk = max(maybe.finalVotes) ≤ passFloor
If !gateOrderOk:
  reduce candidateMaybeCount (down to 0) and re-shape passes on the full budget
  — passes first, always.
```

**Auto heuristic (replaces `spare = budget − passes.length`).** Start at
`candidateMaybeCount = 0`; only increase while a **trial run** keeps `gateOrderOk`
after passes are shaped (decrement from `min(maybes.length, budget − passFloor)`).
The `leniency` dial sets the *target* count directly (still clamped by the trial),
so the owner can say "go a few further down" without code changes.

**Surface as a `maybe-band` tradeoff with concrete candidate allocations** (maybes
get **0 / 1 / a graduated band**) so the leniency is chosen by picking an option,
never by hand-tweaking (Q4). Each option lists only counts/levels that satisfy the
governing rule.

**Hard invariant (enforce in code and tests):**

> `max(maybe finalVotes) ≤ min(funded pass finalVotes)` — a maybe never earns more
> points than any funded pass. (With 1-point maybes this reduces to "no pass at 0
> while any maybe is funded"; equality at the 1-point floor is allowed — a 1-point
> maybe may sit alongside 1-point passes, ordered below them by defensibility.)

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
| All passes naturally ≥1 after shaping | Maybes can receive 1 each from deducted budget if the gate-order trial passes (`passFloor ≥ 1`) |
| Bottom pass at 0 (natural bell zero band) | **No maybe funded** — funding one would break `max(maybe) ≤ min(pass)`; zeros stay in the pass band |
| `leniency` dialled up | Funds the first `⌈leniency·maybes⌉` defensible maybes at `≤ passFloor`, never above a funded pass; auto-reduces the count if a pass would drop to 0. The dial reaches further down the list — it does **not** override the governing rule |
| Low-pass round (few passes, many maybes) | Passes take the top tiers; the maybe band gets its own graduated staircase capped at `passFloor`, top passes strictly highest. Surfaced as a `maybe-band` tradeoff (0 / 1 / graduated) |
| All-maybe (no passes) | Shape maybes with full budget (unchanged fallback) |
| All-pass | No maybe logic runs |
| Pinned overrides | Maybes still last; pins on passes consume budget before the maybe trial |
| Combined with Bug 1 | Pass-only staircase; maybe band assigned after, capped at `passFloor` |
| `spillRemainder` | Must not lift a maybe above `passFloor`; spill targets best **passes** first |

### Verification (Bug 2)

Add / update in [`tests/score.test.mjs`](../../tests/score.test.mjs):

1. **`maybe-never-outranks-a-pass`** — repro fixture (7 passes `76…69`, 2 maybes,
   budget 10): assert `max(maybe finalVotes) ≤ min(funded pass finalVotes)`;
   specifically no `(pass < maybe)` pairs and no `(pass=0, maybe>0)` pairs.
2. **Generous surplus funds maybes at the floor** — 3 passes, 2 maybes, budget 10:
   with `passBudget = 8` the passes shape to e.g. `3,3,2` (all ≥1), so both maybes
   fund at **1** (total `8 + 2 = 10`); assert maybes never exceed `1` here even
   though budget is generous (Q4 default).
3. **Leniency reaches further down** — 6 passes (all ≥1 after shaping), 4 maybes,
   leniency dialled up: assert the first N (most-defensible) maybes fund at
   `≤ passFloor`, ordered by `fitScore` (not re-ranked among passes on music), and
   that the count auto-reduces if a pass would hit 0.
4. **Low-pass round graduated band** — 2 passes, 8 maybes, budget 10: passes take
   the top; the maybe band gets a graduated curve capped at `passFloor`; assert top
   passes are strictly highest and every maybe `≤ passFloor`.
5. **kpop-solo regression** — V3/V4 gate profiles: no maybe outranks any funded
   pass; FINAL-style outcome (8 passes, budget 10) funds zero maybes with spare
   points deepening the pass curve.
6. **Tradeoff** — `maybe-band` options list concrete `0 / 1 / graduated`
   allocations, each satisfying `max(maybe) ≤ min(pass)`.

---

## Implementation order

1. **Step 1a — Bug 2 funding order** (small, isolated `allocate()` change; ships
   first, no R1 dependency). Shape passes before any maybe; enforce
   `max(maybe) ≤ min(funded pass)`; fund maybes at the **1-point floor** only —
   auto from verified surplus, or via the `leniency` dial — capped below passes.
   This is the common case and immediately stops a maybe outranking a pass.
2. **Step 2 — Bug 1 via full R1 + R2 in one PR** (Q3, Q5). Replace the bell-target
   / `waterfillLevels` core with the center-out staircase **and** the ≥80
   favorite-band merge together — the headline regression (`3 3 3` → C2) depends on
   the merge. Intentionally changes the default `auto` curve for every round, so
   existing `score.test.mjs` allocation expectations are rewritten to the new shapes
   (documented, not chased to green).
3. **Step 1b — graduated maybe band** (Q4; lands **with or just after** Step 2).
   The low-pass-round behavior (few passes, many maybes → the maybe band takes its
   own graduated staircase capped at `passFloor`) **reuses the R1 staircase**, so it
   cannot precede Step 2. Until it ships, low-pass rounds fall back to the 1-point
   floor from Step 1a.

**Ordering rationale.** Step 1a is pure funding-order logic, independent of the
allocator rewrite, so it ships first for an immediate correctness win. Step 1b is
*labelled* part of Bug 2 but **depends on R1** (it needs the staircase to build a
graduated maybe band), so it is sequenced after Step 2 rather than bundled with 1a
— the earlier "Bug 2 before R1" wording could not hold for this piece. R2 ships
with R1, never after.

## Files to touch (implementation — not this plan)

Columns map to the steps: **Step 1a + 1b** = Bug 2 (1b lands with R1), **Step 2** =
Bug 1 (R1 + R2).

| File | Step 2 (Bug 1: R1 + R2) | Steps 1a / 1b (Bug 2) |
|------|-------------------------|-----------------------|
| `scripts/score-core.mjs` | Replace waterfill/K-loop with staircase (R1); add R2 ≥80 merge | 1a: reorder maybe funding in `allocate()`; 1b: graduated maybe band over the R1 staircase (capped at `passFloor`) |
| `tests/score.test.mjs` | Contiguity + kpop-like + `3 3 3`→C2 + R2 fixtures | 1a: gate-order + 1-point maybe tests; 1b: low-pass graduated-band test |
| `spec/point-allocation.md` | Allocation model → center-out (R1 + R2 + top-band-split) | Gate maybe band: `max(maybe) ≤ min(pass)`, leniency, graduated band |
| `spec/decisions.md` | At R1/R2 landing | 1a: at maybe-order landing; 1b: at graduated-band landing |
| `scripts/one-off/kpop-solo-versions.mjs` | Remove CAP=2 workaround when green | — |

## Resolved design decisions (owner, 2026-06-15)

The five open questions are settled. The governing maybe rule and the Phase B
algorithm above already reflect these.

1. **Passes first (Q1) — confirmed.** Passes are always shaped before any maybe is
   funded; a clean pass can never lose to a maybe. A maybe is funded only from
   verified surplus (or via the `leniency` dial), never by demoting a pass below
   it. *Callback:* matches the real kpop-solo FINAL (8 passes, budget 10 → all
   maybes 0, spare points promoted passes to `2`), and *decision 2026-06-10
   curve-is-the-point* (a naturally-zero bottom band is fine).

2. **Leniency dial, but the guard is the corrected invariant (Q2).** The hard rule
   is **`max(maybe) ≤ min(funded pass)`**, *not* "never fund a maybe." A `leniency`
   knob reaches further down the maybe list to grant the first few high-defensibility
   maybes a **bottom-tier** point, ordered by `fitScore` and **never re-ranked among
   passes on music** (no "promote to pass" — the rejected framing). Leniency tunes
   *how far down*, never *above a funded pass*.

3. **Full R1 now (Q3) — confirmed.** Implement the center-out staircase, not the
   interim waterfill band-aid (which leaves top-heaviness unsolved). Land Bug 2
   first as its own isolated change. *Callback:* mirrors *decision 2026-06-10
   "Tiers are drawn by 1-D clustering"* that **Overruled** the old bell+`levelCap`
   core; R1 similarly overrules the bell-target/waterfill core (own `Overruled`
   entry at landing).

4. **Maybe point level: usually 1, graduated only when surfaced (Q4).** Default is
   1 point per funded maybe. A maybe band **may** take a graduated curve in
   **low-pass rounds** (few clear passes, many maybes — implying a hard/misread
   prompt where the owner leans lenient), always capped at `passFloor` with the top
   passes strictly highest. The `0 / 1 / graduated` choice is offered as a
   `maybe-band` tradeoff with concrete candidate allocations, never a hidden
   "very-large-budget" threshold or hand-tweak.

5. **R2 ships with R1 (Q5) — confirmed.** The ≥80 favorite-band merge lands in the
   same PR as R1 because the `3 3 3` → **C2** regression test depends on the merge.
