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
- **profile**: `{ rankBy, gate, shape, weights, overrides, downOverrides, leniency,
favoriteBand, tierCount, bucketCount }` plus downvote fields injected from the round
  budget via `enrichProfileWithBudget()`.
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
the opinion center. When `downvotesEnabled`, the two banks are allocated
**sequentially, upvotes first**:

1. **Upvotes** are shaped over the whole eligible field minus a minimal downvote
   reserve at the bottom. The reserve is the fewest bottom songs needed to
   physically hold the downvote bank at its per-song cap (uncapped ⇒ 1; it grows
   only when a tight down cap binds), which guarantees enough zero-upvote songs
   survive that a finite down cap can always be honored. The bell decides how far
   down upvotes actually reach and zeroes the rest — the zeros are a consequence
   of the curve, not a reserved band.
2. **Downvotes** are then shaped over **every zero-upvote song** the first pass
   left behind, plus any disqualified song (a DQ entry is always in the down
   pool). Worst songs → most downvotes. Up and down targets stay disjoint because
   a song that earned upvotes is never downvote-eligible.

The same mode-centered bell machinery shapes magnitudes on both sides of zero.
Disqualified/unrankable songs (no score) sort below all real scores via a finite
floor — a full spread under the lowest real score — so they pull the most
downvote weight without the degenerate math a literal `-Infinity` would cause.

Downvote tiers are usually fewer songs and lower magnitudes than the upvote side
(`-1` common, `-2`+ rare), reflecting the typical downvote-bank ratio.

### Downvote shape is its own axis (`downShape`)

The downvote curve is chosen independently of the upvote tier structure (A/B/C),
because no single rule fits every round — when the down cap is unbounded, dumping
the whole bank on the single worst/invalid song and spreading it across the worst
songs are both valid. Three shapes (over the down pool, worst-first; budget `B`,
cap `C`):

- **concentrated** — pile worst-first up to `C`; uncapped ⇒ all `B` on the single
  worst song.
- **flat** — even 1-each spread across the worst songs (round-robin), then 2-each, …
- **curved** _(default)_ — the graduated bell; worst gets the most, tapering.

`downShape` (CLI `--down-shape concentrated|flat|curved`) pins the shape. When it's
unset (`auto`), allocation defaults to **curved** and surfaces a `down-structure`
tradeoff proposing the distinct shapes (deduped on the resulting distribution, so
identical shapes collapse) with per-song previews, selectable per round. The
`relative` upvote shape keeps its proportional down pass unless `downShape` is set.

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
count (K)**; the label names tier count and bucket count separately. Record with
`just pick <round> <A|B|C>`, or force a curve with `just pick <round> A
--tier-count <n>` / `--bucket-count <n>`.

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
- **`gate`** — a hard boundary; below it a song earns 0 regardless of the other axis.
  Set explicitly via `--gate` / `--cutoff`, or **auto-activated** on parse: when
  `--fit gate` extracts any `pass`/`maybe`/`fail` word and no explicit gate was
  given, `applyManualFitScoring` sets `passFailMaybe` (any maybe) or `passFail` (only
  pass/fail). A parsed per-song `gate` is otherwise inert — `gateClass` treats every
  song as a pass — so this keeps a high-music `maybe`/`fail` from ranking at the top.
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
- **`downShape`** — the downvote curve, **independent of `shape`**: `concentrated`
  (whole bank on the worst, worst-first to cap), `flat` (even 1-each spread), or
  `curved` (graduated bell — default). Set via `--down-shape <…>`. When unset the
  allocator defaults to `curved` and surfaces a `down-structure` tradeoff proposing
  the distinct shapes (per-song previews, deduped); pinning it suppresses the
  proposal. See _Downvote shape is its own axis_.
- **`overrides`** — `{ rawOrderIndex: votes }` pins a song's **up**votes; the
  remaining budget is shaped around it (also how the web re-runs after a tradeoff
  pick). CLI: `--pin <i>:<v>`.
- **`downOverrides`** — `{ rawOrderIndex: magnitude }` pins a song's **down**votes.
  CLI: a **negative** `--pin` value (`--pin 6:-2` = two downvotes on song 6). A
  down-pinned song is forced off the upvote axis (zero upvotes), its pinned magnitude
  is committed first and is excluded from both the shaped pool and spill (never topped
  up past the pin), and the rest of the down bank is shaped around it.
- **Pins never legitimize an over-budget ballot.** Exceeding a bank is invalid in
  Music League, so a pin is **not** licensed to overspend. Two guards enforce this:
  - **`pinEligibilityError`** — `--pin` on own, disqualified, or unknown index is rejected at
    **pick**. Blank-score songs (`needsUserInput`) **may** be pinned — manual ballot slot
    without re-parsing.
  - **`--option` + `--pin` reflows** (`reconcileOptionPins`): a pin layered on a
    chosen option is reconciled at the margin so the bank stays exact — a net-positive
    pin (the song gets more than the option gave) **sheds** the surplus from the
    lowest-ranked unpinned funded songs; a net-negative pin **promotes** the next
    candidates (best-ranked unfunded unpinned first, then best-ranked below-cap). So
    `--option A --pin <topSong>:2` lifts that song and drops the bottom funded one,
    rather than printing a `+1`-over ballot.
  - **`budget-mismatch` is flagged** whenever any final allocation leaves a bank
    over- or under-filled (a bare pin that doesn't even out, an under-pinned down
    bank, etc.). The allocator emits a `budget-mismatch` tradeoff (so every report
    surfaces it) and the CLI prints a loud `⛔ OVER BUDGET` / `⚠️ Bank not fully
spent` line. There is no longer a silent overflow.
  - **A pin above a real per-song cap is rejected immediately.** `maxUpvotesPerSong`
    / `maxDownvotesPerSong` (Music League encodes "no limit" as `0` → unlimited); a
    pin exceeding a finite cap errors at the CLI (`pinCapError`) instead of being
    silently clamped.
- **`favoriteBand`** — controls the R2 favorite top-band merge (scores ≥ 80 share
  the top tier). Default merges at `80` **for raw-score rounds only**; it is **off by
  default when `rankBy = combined`** (the `80` floor is a raw-music anchor). `{ min }`
  / `--favorite-band <min>` overrides the floor on any scale; `false` /
  `--no-favorite-band` disables the merge.
- **`tierCount`** — forces the number of **distinct final point values** (counting
  the `0` band; `0–2 points` = 3 tiers). The allocator picks the best staircase with
  that many distinct values (nearest achievable if none). Set by `just pick
<round> <letter>` on a surfaced option, or via `--tier-count <n>` on **pick**
  (preview-only on parse/merge).
- **`bucketCount`** — forces **K**, the number of **funded** point tiers (promotion
  steps + 1, excluding the `0` band) — the lower-level knob beneath `tierCount`. Set
  via `--bucket-count <n>` on **pick**; wins over `tierCount` if both are given. Both
  suppress the `tier-structure` tradeoff.
- **`--option <A|B|C…>`** — record a `tier-structure` fork by column letter
  (**prefer `just pick <round> <letter>`** — JSON-only, never re-reads HTML). Still
  accepted on parse/merge for backward compatibility but deprecated there. Applies
  that exact distribution (deterministic sugar over per-song pins). Each option
  carries a `shape` signature (e.g. `2×4 / 1×2 / 0×5`) so labels stay distinguishable.
- **`--reason "why"`** — free-text rationale stored on the pick record (use with
  `just pick`, not parse). Picking writes a durable **pick record** to the round's JSON
  (`music.json` on music-only, `scores.json` on thematic with `--scores`) — chosen
  option, every option presented, the reason, and any **manual tweaks** — and appends
  one line to `analysis/picks.jsonl`. The report keeps alternatives visible: a focused
  **Your pick** table plus collapsed **Options considered** with the chosen column
  highlighted.

The `tier-structure` and `down-structure` tradeoffs render as a song×option
comparison in **combined-score order only** (for judgment). The raw submission-order
ballot lives once, in the **Ballot (raw order)** section, as **one column per
up-option × down-shape combo** — each column a complete signed ballot (upvotes
positive, downvotes **negative**) you transcribe straight down without committing to
`--option`/`--down-shape` first. Each combo is built independently (apply the up
option, then that down shape); a song the up option upvotes **and** the down shape
downvotes is a `!` **conflict** cell — never silently dropped or netted, and the
per-column totals still report each axis's intended budget plus a conflict count, so
you resolve it by hand (or with a downvote pin). Identical full-ballot columns are
deduped (one header lists the equivalent selectors). Own (unvotable) songs render a
dash in every column so no submission slot is skipped. Downvotes always display as
negative everywhere (comparison tables, cards, ballot, markdown).

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
- **Combined / numeric fit**: depends on **fit trust** (`profile.fitTrust`):
  - **`manual`** — parse with owner-typed fit: `applyManualFitScoring` calls
    `normalizeCombined` with adaptive fit std floor (rank/sort uses normalized
    `combinedScore`); `tierKey` buckets on **quantized raw weighted blend** (0.5
    steps) so equal owner intent (e.g. 90/77 vs 77/90 → raw 83.5) ⇒ equal votes.
  - **LLM fit** (`fitTrust: llm` — `fit.json` merge, no manual numerics):
    **identical modifier-folded music** _and_ the **same coarse fit band** ⇒ same
    tier. The made-up AI fit number is collapsed to its graded tier
    (`fitTierForScore`) for the comparison, so tiny fit gaps never split a tier;
    music (the real axis) must match exactly, but with the `+`/`-` modifier
    **folded in** — a `74+` and a plain `74` are now **different** combined tiers,
    because in combined mode the modifier is a real (round-tightness-scaled)
    contributor to the normalized blend, not just an indivisible-split tiebreak.

## Budget exactness

Per-song caps (`maxUpvotesPerSong`, `maxDownvotesPerSong`) are **hard limits** — the
allocator never exceeds them. When caps and eligible slots cannot physically hold the
full bank (e.g. budget 6 / cap 3 with only one up-eligible song), spill stops at the
cap and `budget-mismatch` flags the under-spent remainder.

Otherwise the upvote bank should be spent exactly: the sum of allocated upvotes equals
`upvoteBankSize`. If per-song caps leave a remainder among the chosen songs,
`spillRemainder` distributes it as a last resort: bell-style promotion (best zero,
then weakest tier) among eligible songs — and surfaces a `forced-spill` tradeoff when
it has to dip into the gated/invalid pool. (Casting every vote is required by Music
League when the caps allow it.)

**Leftover budget keeps the curve before it raises the floor.** The staircase is
enumerated to spend the budget **exactly** when a budget-exact staircase exists
(choosing the boundaries is the fill), so the descending shape is preserved without
flattening into all-1s. Only a **forced remainder** — when no budget-exact staircase
fits (very high points vs. a low per-song cap, or an indivisible split inside a tie)
— is spent one point at a time, best songs first (by rank, so the spill stays
monotonic) and modifier-aware within an equal-score unit, up to the hard cap. That is
the only path that can split an equal-score unit, and it fires only because Music
League requires every point to be cast when caps permit. Worked example:
budget 22 / cap 2 over 12 songs → `[2×11, 0]` (the bank only fits at the cap).
Very-high-budget extremes (e.g. budget 50 / cap 5) are atypical; real rounds are
roughly 10–30 songs and 10–30 points.

When `downvotesEnabled`, the downvote bank is also spent exactly **when caps and
zero-up slots allow**. Skipping downvotes because the upvote side is done is invalid.

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

1. **Spend both banks when caps allow.** Use the entire upvote bank and the entire
   downvote bank (when enabled) whenever per-song caps and eligible slots can hold
   them. When they cannot, stop at the cap and surface `budget-mismatch` — never
   exceed a per-song limit to force exactness.
2. **No mixed targets.** A single song may receive upvotes, downvotes, or
   neither — never both. The sequenced passes enforce this by construction:
   downvotes only target songs the upvote pass left at zero (plus DQ songs).

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
- `forced-spill` — leftover upvote points had to land on gated-out, blank-score, or
  disqualified songs (own submission never). Order: scored/gated pool first, then
  blanks, then DQ — all still capped.
- `forced-spill-down` — leftover downvote points spilled outside the primary down slice.
- `tier-split-down` — equal low-tier group can't split downvotes evenly.
- `down-structure` — which **downvote shape** (concentrated / flat / curved), with
  per-song previews; selectable via `--down-shape`. Surfaced only when the shapes
  diverge and `downShape` isn't pinned.
- `budget-mismatch` — a final allocation does **not** spend a bank exactly (a pin
  over/under-filled it). Carries `over` (true when a bank was exceeded) and an
  empty `options` list — it's a hard warning, not a choice. The CLI echoes it loudly;
  reports render it alongside the budget line.

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
