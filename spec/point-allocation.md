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
- **profile**: `{ rankBy, gate, shape, weights, overrides, leniency, tierCount,
bucketCount }` plus downvote fields injected from the round budget via
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

### How the tiers are drawn: 1-D clustering on natural breaks

Concretely, the allocator treats the round's scores as a **1-D distribution** and
allocation as **drawing vertical lines at the natural gaps** (the tier
boundaries), then giving each tier a point value so that `Σ (tier size × points) =
budget`, monotonic and capped.

- **Boundaries land on real gaps.** Tier boundaries are placed by
  **Ckmeans.1d.dp** (Wang & Song, 2011) — optimal univariate _k_-means by dynamic
  programming, the provably-optimal successor to Jenks natural breaks — which
  minimizes within-tier variance, i.e. cuts at the largest score gaps. The unit of
  clustering is the **atomic `tierKey` group** (equal-opinion songs, see below), so
  equal scores can never be split across a boundary.
- **The budget decides how many levels appear.** Candidate clusterings are built
  for every `K = 1..#units`; each is point-filled by the **monotonic per-member
  waterfill** (budget-exact, capped, whole-tier). A clustering can repeat a level
  (e.g. `3/2/2/1/0`), so the smooth, graduated curve is preferred over a coarse one
  with the same distinct values.
- **Tier count is a soft, opinion/points-aware choice — not a hard cap.** The
  default picks the smoothest, most-graduated feasible clustering (then the fewest
  tiers, then the cleanest break placement). A clustered "all-meh" field with
  scarce points stays coarse; the same field with generous points opens more tiers
  to **keep close songs close** rather than forcing one big gap.

### Smoothness (the one hard rule)

After the bell/clustering attempt, songs **≤ 1 score apart must never end > 1
point apart.** A `>1`-point jump may only land on a **real gap** (`> 1` score). The
allocator enforces this during tier selection (a candidate whose boundary forces a
big jump on a tiny gap is rejected in favor of a smoother clustering), and because
tiers are contiguous clusters with descending values, monotonicity is structural —
a higher score can never earn fewer points. This is why a clustered field gets a
graduated `3/2/2/1/0`-style curve (every step ≤ 1) instead of a `3/3/0/0`-style
cliff: the cliff would put 1-apart songs 3 points apart.

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

**Two knobs, different levels.** `--tier-count <n>` sets the number of **final
point tiers** (distinct point values — e.g. `0–2 points` = 3 tiers); the allocator
picks the best (smoothest) clustering that yields that many tiers. `--bucket-count
<n>` is the lower-level knob: it forces **K**, the number of score clusters the
1-D clustering produces — the budget and smoothness still decide how many distinct
point values those buckets collapse to (so 2 buckets can still finalize to 3 point
tiers once leftover budget is spent). `--bucket-count` wins if both are given.

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
  - `combined`: weighted blend `weights.fit × fit + weights.music × music`
    (default `{ fit: 0.7, music: 0.3 }`; override on the CLI with
    `--weights <fit>:<music>`, normalized to sum 1).
  - Tiebreak chain always ends: higher score, then modifier rank
    (`play ≥ + > plain > -`), then title.
- **`gate`** — a hard boundary; below it a song earns 0 regardless of the other axis:
  - `{ type: 'cutoff', axis: 'fit'|'music', min }` — graded cutoff.
  - `{ type: 'passFail' }` — binary; `fail` → 0, allocate among passes.
  - `{ type: 'passFailMaybe' }` — three-state. `fail` → 0. `maybe` (questionable)
    is a **conditional tier below the passes**: skipped when budget is tight,
    funded (one point each, ahead of fails) when budget is plentiful or
    `leniency` is dialled up. The `maybe` band is ordered by **how defensible the
    read is** (fitScore), music only as a secondary tiebreak.
- **`shape`** — how ranked candidates become point tiers:
  - `auto` (default): mode-centered bell whose **width grows with the
    points-to-songs ratio** (so the top climbs as points open up), plus a
    ratio-scaled **downward skew** near/below ~1:1 to keep the top flat and carve
    zeros when points are tight. The bell sets per-tier point _targets_; the tier
    **boundaries** come from 1-D clustering on natural gaps and the budget-exact
    monotonic waterfill, subject to the smoothness rule (see _How the tiers are
    drawn_).
  - `bell`: explicit mode-centered curve with a fixed width.
  - presets `compressed` / `balanced` / `top-heavy`: width/skew overrides.
  - `relative` (legacy): `score − lowest numeric score`. Anchors on the floor
    (wrong, per above); kept selectable but not default.
- **`overrides`** — `{ rawOrderIndex: votes }` pins a song's votes; the remaining
  budget is shaped around it (also how the web re-runs after a tradeoff pick).
- **`tierCount`** — forces the number of **final point tiers** (distinct point
  values; `0–2 points` = 3 tiers). The allocator picks the smoothest clustering
  with that many tiers (nearest achievable if none). Set by accepting a surfaced
  option or via `--tier-count <n>`. Distinct from the (separate, planned) `--tiers`
  knob for tier _sizes_.
- **`bucketCount`** — forces **K**, the number of score clusters (buckets) the
  clustering produces — the lower-level knob beneath `tierCount`. Budget +
  smoothness still decide how many distinct point values result. Set via
  `--bucket-count <n>`; wins over `tierCount` if both are given. Both suppress the
  `tier-structure` tradeoff.

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
- **Combined / numeric fit**: **identical music** _and_ the **same coarse fit
  band** ⇒ same tier. The numeric fit scores are made-up AI values, not precise
  enough to differentiate song-by-song when many songs land on the same final
  points — so fit is collapsed to its graded tier (`fitTierForScore`) for the
  comparison, while music (the real axis) must match exactly.

## Budget exactness

The upvote bank is **always spent exactly**: the sum of allocated upvotes must
equal `upvoteBankSize`. If per-song caps leave a remainder among the chosen
songs, `spillRemainder` distributes it as a last resort: best chosen songs first,
then gated-out/below-cutoff, disqualified last — and surfaces a `forced-spill`
tradeoff when it has to dip into the gated/invalid pool. (Casting every vote is
required by Music League even when few songs qualify.)

**Leftover budget keeps the curve before it raises the floor.** `allocateBell`
fills whole tiers (top-down, monotonic, the chosen clustering) to spend the budget,
so the descending shape is preserved without flattening into all-1s. Only a
**forced remainder** — when no whole-tier step fits (very high points vs. a low
per-song cap, or an indivisible split inside a tie) — is spent one point at a time,
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
- `maybe-band` — how many questionable entries to reward.
- `preallocation-overflow` — floors exceed budget.
- `forced-spill` — leftover upvote points had to land on gated-out/invalid songs.
- `forced-spill-down` — leftover downvote points spilled outside the primary down slice.
- `tier-split-down` — equal low-tier group can't split downvotes evenly.

Consumers: CLI prints them (and `--pick`/overrides re-run), the web app renders
choice cards, markdown lists a "Needs your call" section.

## Modifiers

`+`/`-` are within-tier nudges and break indivisible splits; `?` near a point
boundary is surfaced for review; `play` is a positive tiebreak; bare `-` / `no` /
`invalid` disqualify in `scoreComment`.
