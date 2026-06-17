# Point Allocation

Deterministic and profile-driven, not formulaic guesswork. The allocator in
[`scripts/score-core.mjs`](../scripts/score-core.mjs) (`allocate(songs, budget, cap, profile)`)
turns ranked songs into integer votes. This spec defines the model and the named,
testable rules it enforces; the LLM never does allocation, only fit research.

## Pre-allocation gate: resolve blocking inputs FIRST

**Before proposing, running, or presenting any allocation/distribution, surface
everything that needs user intervention and lead with it.** Allocation silently
treats unresolved inputs as 0/excluded, so a gap hidden below the distribution can
quietly drop a song that should have placed. The
parser already emits these signals (and `music.md` lists them under _Needs my
score_ / _Needs review_ / _Disqualified_ / _Needs your call_); the rule is to treat
them as **blocking** and report them up top.

Block on (highest-impact first):

1. **Blank score boxes** (`needsUserInput`) — **never invent a score.** A blank is
   excluded from ranking, so it sits at 0 in every curve. This is the single
   highest-impact gap: a blank on a song that plausibly scores near the field (and
   especially one that passes fit) would otherwise place. List every blank and ask
   for a score (or an explicit "leave it 0") **before** allocating.
2. **Parse-health flags** — anything suggesting the capture itself is off: HTML
   recovered from an escaped/rich-text paste, the lenient text fallback firing, an
   unusually high `needsUserInput` count (stale export — re-save after autosave +
   reload), or `0` songs. Confirm the parse looks right before trusting scores.
3. **Review flags** (`needsReview`) — `?` near a tier boundary, words-only comments
   in subjective mode, and similar judgment calls. Resolve or explicitly defer.

A bare `-` disqualification (`isDisqualified`) is **not** a blocker: it is the
user's own deliberate "won't place / low" note and already means 0 as intended —
do not flag it for intervention.

Only once these are surfaced (and blanks resolved or deferred) should you present
distributions. Borderline/fuzzy-boundary swaps are a separate, lower-priority
conversation that happens **after** the blocking gate is clear.

## Inputs

- **budget** = upvote bank size (`upvoteBankSize`); **cap** = max upvotes per
  song (`maxUpvotesPerSong`).
- When `downvotesEnabled`: **downvote bank** = `downvoteBankSize`; **downvote
  cap** = `maxDownvotesPerSong`.
- **profile**: `{ rankBy, gate, shape, weights, overrides, leniency, favoriteBand,
tierCount, bucketCount }` plus downvote fields injected from the round budget via
  `enrichProfileWithBudget()`.
- Each song carries a music `score` and an optional canonical fit signal
  (`fitScore` / `fitTier` / `gate`, see [fit-evaluation.md](fit-evaluation.md)).

## Allocation model: match the opinion curve to the point curve

Allocation fits two bell curves together:

- **Opinion curve** = the distribution of your scores for the round (music, fit,
  or combined). A large "solid but unimaginative" middle, a short tail of
  standouts, and a tail of duds (which the gate lops off the bottom).
- **Point curve** = how the budget can be shaped. Its center is the **average
  points per song = budget / eligible songs**; its width grows with the
  points-to-songs ratio.

**Anchor on the center (mode), not the floor.** Songs you consider unworthy get
`-`/words (no number), so they're excluded from the curve entirely — they are not
its bottom. The lowest _numeric_ score is therefore roughly the middle of the
bell, not the true floor. `estimateCenter()` uses the mode of the rounded scores
(median fallback), and the bell works **outward** from there.

**Map center → average, then spread by ratio.** Songs at the center get about the
average points/song; better step up, worse step down toward 0, conserving the
budget exactly (each step up paid by a step down). The ratio sets how many tiers
open up, roughly symmetric about the center:

- **~1:1** (the most common ratio): center ≈ 1 → tiers `{0,1,2}` (mostly 1s, a
  few 2s, and a handful of 0s). Handing out all 1s is useless, so a small downward
  skew carves some zeros and promotes a couple to 2.
- **~2:1**: `auto` _widens the bell as the ratio grows_ → tiers `{0,1,2,3,4…}`.
  The extra points build taller top tiers rather than nudging everyone up by one.
- **below 1:1** (more songs than points): center < 1, so most songs get 0 and
  only the top of the curve earns points.

The zeros are a **consequence of the curve**, not a target in themselves — at the
typical (low) ratios they fall out naturally; see _Standing shape preference_.

**0 is the neutral band; downvotes extend the tier spectrum below it.** Without
downvotes the point curve runs from 0 upward — positive tiers only, anchored on
the opinion center. When `downvotesEnabled`, allocation is **one continuous
ranked tier spectrum**: the top slice receives positive upvote tiers (best songs →
most upvotes), the bottom slice receives negative downvote tiers (worst songs →
most downvotes), and the middle earns neither. The same mode-centered bell
machinery shapes magnitudes on both sides of zero; downvotes are not a separate
ad-hoc pass bolted onto upvotes.

Downvote tiers are usually fewer songs and lower magnitudes than the upvote side
(`-1` common, `-2`+ rare), reflecting the typical downvote-bank ratio.

**Match the variance too:** a tightly-clustered opinion curve uses fewer tiers; a
widely-spread one uses more. `auto` reads both the ratio (point-curve width) and
the score spread (opinion-curve width).

### How the tiers are drawn: a center-out staircase of unit steps

Concretely, the allocator builds the point curve as a **staircase of `+1` steps**,
read top-down over the ranked, gated-in songs:

- Group songs into the atomic **`tierKey` units** (equal opinion never splits).
- A **staircase** is a `0/1` **cutoff** (songs at/above it get the baseline `1`,
  below it `0`) plus a nested set of **promotion steps** (each lifts everyone above
  it by `+1`). So `votes(song) = [score ≥ cutoff] + #{promotions below the song}`
  and `budget = (#songs ≥ cutoff) + Σ_steps (#songs ≥ step)`.

Because each tier is reached by stacking whole `+1` steps, **adjacent point tiers
differ by exactly 1 by construction** — the curve is contiguous and monotonic with
no skipped levels (no `{4,1,0}` cliffs) and a higher score never earns fewer points.

- **Enumerate budget-exact staircases.** Every cutoff × promotion-step combination
  (steps bounded by `cap` and `#units`) whose song-sum **equals the budget** is a
  candidate; choosing the boundaries _is_ the fill (no separate waterfill phase).
  When no staircase hits the budget exactly (e.g. budget exceeds total capacity, or
  is smaller than the top tie group), the tallest curve under budget is built and
  phase 3 spills the remainder via the documented `forced-spill` exception.
- **Boundaries prefer real gaps and the owner anchors.** A boundary earns its
  **score gap** plus a bonus for landing on the **80 (favorite)** or **75
  (actively-like)** anchor, so steps fall where the owner's scoring is meaningful
  rather than in a fuzzy mid-band.
- **Top-heaviness is capped by the budget, not the cap.** A promotion that lands on
  neither an anchor nor a real gap (a sub-1-point gap in a fuzzy cluster) is a
  **junk** step; the selector minimizes junk steps first, so a tight cluster stays
  low-topped (a lone `80` over a `73–76` cluster gets `2`, never a lone `3`/`4`).
  Each genuine step also carries a small height cost, so a uniform field takes the
  **shortest** staircase that spends the budget — a high `cap` can't inflate the top.
  A real favorite gap or anchor band still pays for a taller, graduated top.

### R2 — favorite top-band merge (raw-score rounds only)

Scores **≥ 80** are "favorites," and `90` vs `84` is not a meaningful difference, so
every unit at/above the favorite floor is **merged into one synthetic atomic top
unit** — the favorites share the top tier. When the merged band is a meaningful
share of the funded field (`≥ ceil(funded / 3)` or `≥ 4`, whichever is smaller), the
allocator also surfaces a **`top-band-split`** tradeoff so the owner can instead
break the favorites onto their own gaps. `--favorite-band <min>` overrides the
floor; `--no-favorite-band` disables the merge.

**The `80` floor is a raw-music anchor ("8+") and does not apply to the normalized
combined score.** When `rankBy = combined`, the 75-centered z-remap pushes
above-average songs over `80` regardless of their raw fit/music (a music-7.5 song
can land at `80.9`), so the merge is **off by default** for combined rounds —
natural-gap clustering and the tier/bucket-count tradeoffs control top-flattening
instead. An explicit `--favorite-band <min>` is still honored if the owner opts in.

### Contiguity + smoothness (structural)

Songs **≤ 1 score apart never end > 1 point apart**, and distinct point tiers are
**always exactly 1 apart** — both hold by construction, because the curve is a
stack of `+1` steps over contiguous, descending units. A `>1`-point jump can only
exist across a real score gap (a unit boundary), and monotonicity is automatic.

### Ambiguous tier counts are surfaced

When the split is genuinely a judgment call (several clusterings are close, or a
small score range leaves it open), the allocator emits a **`tier-structure`
tradeoff** listing distinct candidate curves. Options dedupe on the **final point
distribution**, not tier count — two bucket counts that yield the same tier count
but different distributions both appear. Each option's `value` is the **bucket
count (K)**; the label names tier count and bucket count separately. Pick one and
re-run with `--bucket-count`; `--tier-count <n>` is the friendly "n point tiers"
knob.

Each option also carries structured `tiers`
(`{ points, count, scoreHi, scoreLo, scores }`) so the report renders it as a
skimmable, column-aligned **points / songs / score-range table** — one row per
point tier — instead of a `3×2`-style shorthand that can be misread ("4 songs at
1 point" vs "1 song at 4 points"). When any score in the round carries a `+`/`-`/`?`
modifier, an extra **Scores** column lists the precise raw scores rolled into each
tier (e.g. `73-`, `73+?`, `74?`), so you can see exactly which modified entries
landed where.

### Forced splits land where a modifier resolves them

The budget rarely divides evenly across whole tiers, so one equal-score group
usually has to absorb the odd remainder (an **indivisible split**). When that's
unavoidable, K-selection prefers a clustering whose split lands on a group a `+`/`-`
modifier can break (so the extra point goes to the song that earned it) over one
that **coin-flips an unmodified tie** — e.g. it keeps two plain `76`s equal and
spends the remainder on a `75+?`/`75` pair instead. An arbitrary split (two
same-modifier songs forced apart) is only chosen when no candidate avoids it, and
it then surfaces as a `tier-split` tradeoff.

**Two knobs, different levels.** `--tier-count <n>` sets the number of **distinct
final point values**, counting the `0` band (e.g. `0–2 points` = 3 tiers).
`--bucket-count <n>` forces **K**, the number of **funded** point tiers (promotion
steps + 1, excluding the `0` band) — the lower-level knob. A single integer knob
can't always reproduce one specific staircase (two staircases can share both counts
yet differ in size), so the surfaced `tier-structure` option carries both and the
allocator picks the nearest achievable. `--bucket-count` wins if both are given.

### Standing shape preference (owner default)

The repo owner's default voting style, applied unless a round dictates otherwise.
**The curve is the point.** Everything below serves keeping a graduated bell;
zeros and tier heights are consequences of that shape, not goals to enforce on
their own.

- **Don't flatten the curve — at either end.** Two failure modes, equally bad:
  - _Flat bottom:_ handing (almost) every song a `1`. That just **raises the
    field floor and dilutes your vote** vs. players who concentrate. Don't fill
    the zero band with `1`s when you could **promote a couple of `2`s and leave
    some `0`s** instead.
  - _Flat top:_ parking every song at the cap to manufacture zeros. The middle of
    the curve (`3`s, `4`s) is what separates songs; don't collapse it.
- **Zeros are a natural consequence, not a quota.** At the typical (low) ratios a
  proper bell simply _has_ a zero band, so most rounds end with some `0`s — but
  the allocator does **not** force a fixed number of them. Where the curve bottoms
  out doesn't matter; if keeping a graduated, multi-tier shape means the lowest
  tier lands at `2` rather than `0` (only in very point-rich rounds), that's fine.
- **Score gaps gate where tiers open up.** Boundaries fall on natural gaps
  (clustering); see _Smoothness_ for the hard rule on point jumps between close
  scores. A tightly-clustered field gets a graduated curve instead of a cliff; a
  wide spread earns taller, more separated tiers from the same budget.
- **As points open up, build taller tiers** (`3`s, `4`s…) where the spread
  supports it — don't spread the extra points flatly across everyone. `auto`
  widens the bell as the points-to-songs ratio grows, and more points let the
  clustering open more (still-smooth) levels rather than nudging everyone up by one.
- **Allocation is monotonic and tier-clean.** A higher score never earns fewer
  points than a lower one (contiguous clusters with descending values — see
  _Smoothness_), and equal-score units get **equal** points unless an indivisible
  remainder forces a one-point split.

Manual analogue (how the owner does it by hand): start near the tier split, give
the upper half `1`, then use the leftover to promote a few `2`s (or, if points are
scarce and the next score down is crowded, start at the top and work down) —
leaning on tiebreaks to decide marginal promotes/demotes. Net shape across ratios:
below ~1:1, mostly `1`s and `0`s; around ~1:1, mostly `1`s with a couple `2`s and
a few `0`s; above ~1:1, the curve widens into a graduated `3`/`4`… top **if** the
spread justifies it. Tune per round with `--shape` / `--tier-count` / `--pin` when
a specific field calls for it.

## Profile

- **`rankBy`** — the axis a song is ranked + tiered by:
  - `music` (default): music primary, fit as tiebreak.
  - `fit`: fit primary, music as tiebreak.
  - `combined`: a **per-round normalized** blend, not the raw
    `weights.fit × fit + weights.music × music`. `mergeFit` z-scores each axis over
    the **contenders** (point-eligible songs — not DQ'd, blank, or gated out),
    applies the weights to the standardized values, and remaps the blend onto a
    **75-centered, music-anchored** `combinedScore` (so the staircase's gap / 75-80
    anchor machinery still applies; the **favorite-band merge is off** for combined
    rounds — see R2). Each axis is also exposed remapped onto the same scale as
    `fitNorm` / `musicNorm`, so `combinedScore = w.fit·fitNorm + w.music·musicNorm`
    explains every jump. The reconciliation is asymmetric,
    via different std floors: **music floor low** (≈ 2 — a tight music field
    amplifies half-points and `+/-`) and **fit floor high** (≈ 14 — the imprecise AI
    fit number rides a fixed, dampened scale, so a tight good-fit cluster is never
    amplified and only adapts when fit is genuinely wide). A field below ~4
    contenders falls back to fixed reference anchors. Weights default to
    `{ fit: 0.7, music: 0.3 }` (override with `--weights <fit>:<music>`, normalized
    to sum 1) and now act on **comparable scales**, so a decisive music gap is no
    longer drowned by a wide-but-fuzzy fit gap. See the
    [decision log](decisions.md) for the rationale.
  - Tiebreak chain always ends: higher score, then modifier rank
    (`play ≥ + > plain > -`), then title.
- **`gate`** — a hard boundary; below it a song earns 0 regardless of the other axis:
  - `{ type: 'cutoff', axis: 'fit'|'music', min }` — graded cutoff.
  - `{ type: 'passFail' }` — binary; `fail` → 0, allocate among passes.
  - `{ type: 'passFailMaybe', leniency }` — three-state. `fail` → 0. **Passes are
    shaped first, always**, and the governing rule is `max(maybe) ≤ min(funded
pass)`: a `maybe` never earns more points than the lowest-funded pass. By
    default funded maybes take the **1-point floor** (ahead of fails), ordered by
    **how defensible the read is** (fitScore), music only as a secondary tiebreak;
    `leniency` (0…1) reaches further down the maybe list at that floor. In a
    **low-pass round** (few clear passes, many maybes — the prompt was hard or
    widely misread) the maybe band may instead take its **own graduated staircase**
    capped at the lowest pass, so the top maybes are rewarded above the rest without
    crossing the pass line. The choice surfaces as a `maybe-band` tradeoff
    (none / flat 1-point / graduated).
- **`shape`** — how ranked candidates become point tiers:
  - `auto` (default): the **center-out staircase** — enumerate budget-exact
    staircases of `+1` steps and pick the one with the fewest junk steps, then the
    best boundary worth (real gaps + 75/80 anchors), then the shortest top. The top
    climbs only as a real spread (or the favorite band) justifies it, so a high
    `cap` never inflates it (see _How the tiers are drawn_).
  - `bell`: explicit mode-centered curve with a fixed width.
  - presets `compressed` / `balanced` / `top-heavy`: width/skew overrides.
  - `relative` (legacy): `score − lowest numeric score`. Anchors on the floor
    (wrong, per above); kept selectable but not default.
- **`overrides`** — `{ rawOrderIndex: votes }` pins a song's votes; the remaining
  budget is shaped around it (also how the web re-runs after a tradeoff pick).
- **`favoriteBand`** — controls the R2 favorite top-band merge (scores ≥ 80 share
  the top tier). Default merges at `80` **for raw-score rounds only**; it is **off by
  default when `rankBy = combined`** (the `80` floor is a raw-music anchor). `{ min }`
  / `--favorite-band <min>` overrides the floor on any scale; `false` /
  `--no-favorite-band` disables the merge.
- **`tierCount`** — forces the number of **distinct final point values** (counting
  the `0` band; `0–2 points` = 3 tiers). The allocator picks the best staircase with
  that many distinct values (nearest achievable if none). Set by accepting a
  surfaced option or via `--tier-count <n>`.
- **`bucketCount`** — forces **K**, the number of **funded** point tiers (promotion
  steps + 1, excluding the `0` band) — the lower-level knob beneath `tierCount`. Set
  via `--bucket-count <n>`; wins over `tierCount` if both are given. Both suppress
  the `tier-structure` tradeoff.
- **`--option <A|B|C…>`** — picks a `tier-structure` fork by its column letter and
  applies that exact distribution (deterministic sugar over per-song pins), so a
  pick is one clean flag even when two options share a tier/bucket-count label. Each
  option also carries a `shape` signature (e.g. `2×4 / 1×2 / 0×5`) so the legend and
  labels are always distinguishable.
- **`--reason "why"`** — attaches a free-text rationale to an `--option` pick (no-op
  without `--option`). Picking writes a durable **pick record** to `fitData.pick`
  (chosen option, every option that was presented, the reason, and any **manual
  tweaks** — final votes that deviate from the chosen option's canonical
  distribution, e.g. an extra `--pin`) and appends one line to the global
  `analysis/picks.jsonl` training log (round, options-shown, chosen, reason, tweaks,
  field score snapshot). The report keeps the alternatives visible after the pick: a
  focused **Your pick** table plus a collapsed **Options considered** comparison with
  the chosen column highlighted.

The `tier-structure` tradeoff renders as a song×option comparison in **two orders** —
by combined score (judgment) and by **raw submission order** (app entry) — and the
raw-order view (plus the `Vote transfer` table) interleaves the owner's own
(unvotable) song so every submission slot is present and the ballot can't misalign.

## Same score = same tier (scoring-type aware)

Songs of effectively equal opinion **share a tier and get equal points** — this is
enforced structurally (`tierKey`), not left to judgment. What counts as "equal"
depends on the scoring type:

- **Music-only** (`rankBy: music`): **identical music score** ⇒ same tier ⇒ the
  **same exact final points whenever possible**. A `+`/`-` modifier never splits
  songs into different tiers; it only decides who takes an **indivisible extra
  point** when a tier's points don't divide evenly.
- **Music-heavy gate rounds** (`passFail` / `passFailMaybe`): same music score
  **and** same gate class (both passing, or both `maybe`) ⇒ same points. A `75`
  pass and a `75` maybe are in **different fit tiers**, so the matching
  requirement does not apply.
- **Combined / numeric fit**: **identical modifier-folded music** _and_ the **same
  coarse fit band** ⇒ same tier. The made-up AI fit number is collapsed to its
  graded tier (`fitTierForScore`) for the comparison, so tiny fit gaps never split a
  tier; music (the real axis) must match exactly, but with the `+`/`-` modifier
  **folded in** — a `74+` and a plain `74` are now **different** combined tiers,
  because in combined mode the modifier is a real (round-tightness-scaled)
  contributor to the normalized blend, not just an indivisible-split tiebreak.

## Budget exactness

The upvote bank is **always spent exactly**: the sum of allocated upvotes must
equal `upvoteBankSize`. If per-song caps leave a remainder among the chosen
songs, `spillRemainder` distributes it as a last resort: best chosen songs first,
then gated-out/below-cutoff, disqualified last — and surfaces a `forced-spill`
tradeoff when it has to dip into the gated/invalid pool. (Casting every vote is
required by Music League even when few songs qualify.)

**Leftover budget keeps the curve before it raises the floor.** The staircase is
enumerated to spend the budget **exactly** (choosing the boundaries is the fill),
so the descending shape is preserved without flattening into all-1s. Only a
**forced remainder** — when no budget-exact staircase fits (very high points vs. a
low per-song cap, or an indivisible split inside a tie) — is spent one point at a time,
best songs first (by rank, so the spill stays monotonic) and modifier-aware within
an equal-score unit, up to the hard cap. That is the only path that can split an
equal-score unit, and it fires only because Music League requires every point to be
cast. Worked example:
budget 22 / cap 2 over 12 songs → `[2×11, 0]` (the bank only fits at the cap).
Very-high-budget extremes (e.g. budget 50 / cap 5) are atypical; real rounds are
roughly 10–30 songs and 10–30 points.

When `downvotesEnabled`, the downvote bank is also **always spent exactly**: the
sum of allocated downvotes must equal `downvoteBankSize`. Skipping downvotes
because the upvote side is done is invalid.

## Duplicate songs and covers

Different recordings of the same song (covers, live versions, remasters) are
**separate entries** and may receive **different points**. Their _fit_ is
typically identical (same lyric/meaning), so any divergence should come from the
**music score**, not fit — a higher-rated recording earns more. Do not invent a
fit gap to separate them, and do not artificially pin them together when the
recordings genuinely differ (e.g. a stylistically distinct cover).

A point split should be **proportional to the music gap**: a negligible
difference (e.g. `71` vs `70`) is noise and should _not_ drive a large vote split
between otherwise-tied leaders — prefer equal points there. Reserve real splits
for meaningful music differences. When the deterministic curve over-concentrates
on a tied pair, flatten it with a manual pin (`--pin <index>:<votes>`).
(Consolidating onto one preferred recording is a legitimate manual choice,
surfaced as a `combine` option, not an allocator rule.)

## Hard invariants

These apply to every allocation — deterministic allocator, manual rebalance, or
one-off script:

1. **Spend both banks.** Use the entire upvote bank and the entire downvote bank
   (when enabled), exactly. Neither bank may be partially used or left unspent.
2. **No mixed targets.** A single song may receive upvotes, downvotes, or
   neither — never both. The continuous spectrum partition (top slice / middle /
   bottom slice) enforces this by construction.

## Output fields

Per song after allocation:

- `finalVotes` — allocated upvotes (≥ 0)
- `finalDownvotes` — allocated downvotes (≥ 0 count; render/copy as `-N`)

Fit merge writeback mirrors these as `draftVotes` / `draftDownvotes` on the fit
JSON. Markdown uses `formatVoteAllocation()` (`2`, `-1`, `0` — never both).

## Pre-allocation floors

A song's `userAllocatedVotes` (your own `data-weight`) is a **floor**. When the
floors exceed the budget, the allocator surfaces a `preallocation-overflow`
tradeoff listing candidates to lower rather than silently rebalancing.

## Interactive tradeoffs

At genuine forks the allocator emits a `tradeoffs` list instead of silently
deciding. Each is `{ kind, question, options: [{ label, value }] }`:

- `tier-split` — an equal-score tier can't split its points evenly **and no
  modifier breaks the tie**. (If a `+`/`play` resolves it, no tradeoff fires.)
- `maybe-band` — how to reward the questionable band: none, a flat 1-point floor,
  or (in a low-pass round) its own graduated staircase capped at the lowest pass.
- `preallocation-overflow` — floors exceed budget.
- `forced-spill` — leftover upvote points had to land on gated-out/invalid songs.
- `forced-spill-down` — leftover downvote points spilled outside the primary down slice.
- `tier-split-down` — equal low-tier group can't split downvotes evenly.

Consumers: CLI prints them (and `--pick`/overrides re-run), the web app renders
choice cards, markdown lists a "Needs your call" section.

## Modifiers

`?` near a point boundary is surfaced for review; `play` is a positive tiebreak;
bare `-` / `no` / `invalid` disqualify in `scoreComment`.

`+`/`-` behavior is **scoring-type aware**:

- **Music-only / fit / gate rounds**: within-tier nudges that only break an
  **indivisible split** (who takes the odd extra point); they never move a song to a
  different tier.
- **Combined**: the modifier is **folded into the music value** (`± 0.34`) before
  per-round normalization, so its impact **scales with how tight the round is** — in
  a tightly-clustered music field a `+` becomes a real fraction of a standard
  deviation and can lift a song into a higher combined tier; in a wide field it
  stays negligible. (The allocator's tiebreak still applies as a final fallback for
  any exact remaining tie.)
