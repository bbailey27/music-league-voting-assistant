---
name: point-allocation
description: >-
  Rebalances Music League draft votes using score-core.mjs profiles, tradeoffs,
  and one-off deterministic scripts. Use when adjusting vote distribution, choosing
  compressed/balanced/top-heavy shapes, resolving allocator tradeoffs, or custom rounds.
disable-model-invocation: true
---

# Point allocation

Vote assignment is **always deterministic** in `scripts/score-core.mjs` (`allocate`). The LLM never allocates — only researches fit.

Rules: `spec/point-allocation.md` (authoritative over `.cursor/rules/allocation.mdc`).

## HARD CONSTRAINTS — reject invalid allocations

**Violating either invariant is a bug.** Do not skip downvotes, leave votes unspent, or mix up+down on one song.

1. **Spend both banks exactly.** Σ upvotes = `upvoteBankSize`; when `downvotesEnabled`, Σ downvotes = `downvoteBankSize`. Neither bank may be partially used or left unspent — Music League requires casting every vote.
2. **No mixed targets.** Each song is an upvote target, a downvote target, or neither — **never both** on the same song.

## Continuous tier spectrum (up + down)

One ranked opinion curve, not two independent passes:

- **Top slice** → positive upvote tiers (`finalVotes` / `draftVotes`)
- **Middle** → neither (0 / 0)
- **Bottom slice** → negative downvote tiers (`finalDownvotes` / `draftDownvotes`; display as `-N`)

`allocate()` partitions the spectrum (`spectrumTargets`), runs the same bell/relative tier machinery on the top slice for upvotes and the bottom slice for downvotes (inverted rank), then spills remainders within each slice (cap relax as last resort). `enrichProfileWithBudget()` injects `downvotesEnabled`, `downvoteBudget`, `downvoteCap` from the round budget.

## Quick paths

**Standard round (music only):**

```bash
just parse <name> --shape auto          # default bell-centered draft
just parse <name> --shape balanced      # neutral mode-centered bell
just parse <name> --shape top-heavy     # skew points upward
just parse <name> --shape compressed    # tight tiers (mostly 1s + a couple 2s + some 0s)
just parse <name> --shape relative      # legacy floor-anchored (avoid default)
just parse <name> --tier-count 3        # force 3 final point tiers (e.g. 0/1/2)
just parse <name> --bucket-count 4       # force K=4 score clusters (lower-level knob)
```

**Thematic (fit merged):**

```bash
node scripts/parse-round.mjs rounds/<name>.html \
  --fit analysis/<name>-fit.json \
  --rank combined \
  --weights 0.6:0.4 \
  --shape auto \
  --gate passFailMaybe \
  --cutoff fit:68
```

`--weights <fit>:<music>` overrides the default `0.7:0.3` blend (normalized to
sum 1, so `3:2` ≡ `0.6:0.4`). Raise the music share when fit is compressed across
the field and music should do more of the separating; keep fit ≥ music to stay
fit-led.

Re-run with different flags when the user asks for a different balance — same inputs, reproducible output.

## Profile knobs

| Field         | Purpose                                                                                |
| ------------- | -------------------------------------------------------------------------------------- |
| `rankBy`      | `music` (default plain), `fit`, `combined` (default with `--fit`)                      |
| `weights`     | Combined blend; default `{ fit: 0.7, music: 0.3 }`; set via `--weights <fit>:<music>`  |
| `shape`       | `auto` (mode-centered bell), `bell`, `compressed`, `balanced`, `top-heavy`, `relative` |
| `gate`        | Hard cutoff before tiering — see below                                                 |
| `overrides`   | `{ rawOrderIndex: votes }` pin a song; rebalance rest. Set via `--pin <index>:<votes>` |
| `tierCount`   | Force the number of final point tiers (distinct point values); via `--tier-count <n>`  |
| `bucketCount` | Force K, the number of score clusters (buckets); via `--bucket-count <n>`              |
| `leniency`    | Funds more `maybe`-band songs when gate allows                                         |

### Gates

| Type          | CLI                                      | Effect                             |
| ------------- | ---------------------------------------- | ---------------------------------- |
| Graded cutoff | `--cutoff fit:68` or `--cutoff music:70` | Below min → 0 votes                |
| Binary        | `--gate passFail`                        | `fail` → 0                         |
| Three-state   | `--gate passFailMaybe`                   | `fail`→0; `maybe` conditional band |

### Same score = same tier

Enforced structurally — depends on `rankBy`:

- **music:** identical music score → identical points; `+`/`-` only break indivisible splits
- **combined:** identical music **and** same coarse fit band
- **gate rounds:** same music **and** same gate class

## Opinion curve ↔ point curve

- Anchor on **mode/center** of numeric scores, not the floor (`-`/words excluded entirely)
- **Owner default shape (see `spec/point-allocation.md` → _Standing shape
  preference_):**
  - **The curve is the point.** Keep a graduated bell; don't flatten either end —
    not all-1s (raises the field floor, dilutes the vote) and not everything parked
    at the cap. Don't fill the zero band with `1`s when you could promote a couple
    of `2`s and leave some `0`s.
  - **Zeros are a consequence, not a quota.** At typical (low) ratios a proper bell
    just _has_ zeros; the allocator doesn't force a fixed count. Where it bottoms
    out doesn't matter — a graduated multi-tier shape beats manufacturing a `0`.
  - **Tiers are drawn by 1-D clustering on natural gaps** (Ckmeans.1d.dp over the
    equal-opinion `tierKey` units); the budget then fills them via the monotonic
    waterfill. Tier count is a **soft** choice (smoothest, most-graduated feasible
    clustering), not a hard cap — clustered fields with scarce points stay coarse,
    but the same field with generous points opens more tiers to keep close songs
    close.
  - **Smoothness is the one hard rule.** Songs `≤1` score apart never end `>1`
    point apart; a `>1` jump may only land on a real gap. So a meh field gets a
    graduated `3/2/2/1/0`, never a `3/3/0/0` cliff.
  - **Monotonic + tier-clean.** Higher score never earns fewer points (contiguous
    clusters, descending values); equal-score units get equal points unless an
    indivisible remainder forces a 1-point split.
  - **Taller top as points open up** (`3`s/`4`s) where the spread supports it, not
    a flat spread of the extra points. `auto` widens its bell as the ratio grows.
  - Prefer plain `auto`; reach for `--tier-count` / `--pin` / other shapes only
    when a field needs it. When the tier count is ambiguous the allocator surfaces a
    `tier-structure` choice — accept one to pin it.
  - **Two tiering knobs:** `--tier-count <n>` sets the number of **final point
    tiers** (distinct point values; `0–2 points` = 3 tiers). `--bucket-count <n>`
    is the lower-level knob — it forces **K**, the number of score clusters; budget
    - smoothness still decide how many point values result (`--bucket-count` wins if
      both are set).
- Upvote bank spent **exactly** (see HARD CONSTRAINTS); per-song cap (`maxUpvotesPerSong`) enforced
- `userAllocatedVotes` (`data-weight`) is a **floor** — overflow surfaces tradeoff

## Covers / duplicate recordings

Different recordings of the same song are separate entries and **may differ in
points** — but the gap comes from the **music score**, not fit (their fit is
usually identical). Don't fabricate a fit gap, and don't artificially pin
stylistically-distinct recordings together. Keep the split **proportional to the
music gap**: a 1-point difference (e.g. `71` vs `70`) is noise — allocate those
equally rather than letting the bell concentrate (e.g. `3/3/1`); use `--pin` to
flatten a tied top to `2/2/2/2`. Optional consolidation onto one recording is a
`combine` choice. (See `spec/point-allocation.md`.)

## Tradeoffs (needs human call)

Allocator emits `tradeoffs[]` instead of silent guesses:

| kind                     | Meaning                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `tier-split`             | Equal tier can't split points evenly; no modifier tiebreak                                                                                    |
| `tier-structure`         | Point split is ambiguous; options are distinct distributions keyed by bucket count (re-run with `--bucket-count`; `--tier-count` for a count) |
| `maybe-band`             | How many questionable entries to fund                                                                                                         |
| `preallocation-overflow` | Floors exceed budget                                                                                                                          |
| `forced-spill`           | Upvote remainder landed outside primary up slice                                                                                              |
| `forced-spill-down`      | Downvote remainder spilled within down slice                                                                                                  |
| `tier-split-down`        | Equal low tier can't split downvotes evenly                                                                                                   |

Printed by CLI after parse/merge; listed in markdown "Needs your call". Re-run with overrides once user chooses.

## User-requested balancing

Map natural language → profile:

| User wants                                     | Try                                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| "Spread points more" / "more separation"       | `--shape auto` (owner default: taller tiers as the ratio grows) or `--shape balanced` for a neutral bell                              |
| "Concentrate on favorites" / "top-heavy"       | `--shape top-heavy`                                                                                                                   |
| "Flat / conservative" / "mostly 1s"            | `--shape compressed` (tight tiers — mostly 1s + a couple 2s + some 0s)                                                                |
| "Fewer / more tiers" / pick a tier structure   | `--tier-count <n>` (final point tiers; or accept a surfaced `tier-structure` option); `--bucket-count <n>` to force the cluster count |
| "More zeros" / "stop raising the floor"        | `--shape auto` already carves zeros from the curve; for tighter, use `--shape compressed` or `--pin`                                  |
| "Fit matters more" / "music should count more" | `--rank combined --weights <fit>:<music>` (e.g. `0.6:0.4` to give music more pull while staying fit-led)                              |
| "Off-theme gets nothing"                       | `--cutoff fit:68` or `--gate passFail`                                                                                                |
| "Reward borderline fits when budget allows"    | `--gate passFailMaybe` + resolve `maybe-band` tradeoff                                                                                |

Dense/oversubscribed rounds (below ~1:1) naturally push more songs to 0 — expected and on-preference; rebalance manually or adjust shape only if a field calls for it.

## One-off scripts (`story-rankings.mjs` pattern)

For rounds the profile engine doesn't model (multi-axis creative prompts), write a **standalone deterministic script** in `scripts/`:

1. **Hard-code inputs** — song list with axis scores as constants (no LLM, no randomness).
2. **Define axes + weights** — e.g. continuation / grammar / music with named presets.
3. **Composite** — weighted sum per preset.
4. **Allocate** — mirror the continuous-tier model: top slice up, bottom slice down, middle neutral; spend both banks exactly (see HARD CONSTRAINTS). For bespoke multi-axis rounds, use `story-rankings.mjs` as a one-off template.
5. **Print multiple presets** — let user pick; document floors/caps in header comments.
6. **Optional flags** — e.g. `--concentrated` for tier-stacking variant.

Run: `node scripts/story-rankings.mjs` / `node scripts/story-rankings.mjs --concentrated`

Not wired to `ml.mjs` — intentional one-off. For repeatable logic, extend `score-core.mjs` + tests instead.

## Verify allocation

```bash
npm test    # tests/score.test.mjs — 23+ cases on gates, same-tier, budget exactness
```

After merge, confirm `draftVotes` sum to `upvoteBankSize`; when downvotes enabled, confirm downvote total matches `downvoteBankSize` and no song has both.

## Related skills

- **parse-scores-pipeline** — CLI flags and merge command
- **round-fit-research** — fit JSON before merge
- **music-league-workspace** — overview
