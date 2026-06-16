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
  --fit analysis/<name>/fit.json \
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

Authoritative model: [`spec/point-allocation.md`](../../../spec/point-allocation.md) —
_Allocation model_, _How the tiers are drawn_, _Smoothness_, _Standing shape preference_.

Quick reference:

- Mode-centered bell (`auto` default); `--tier-count` = final point tiers;
  `--bucket-count` = score clusters (wins if both set)
- Ckmeans.1d.dp clustering + smoothness rule (≤1 score apart → ≤1 point apart)
- Upvote bank spent exactly; `userAllocatedVotes` is a floor

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

| User wants                                     | Try                                              |
| ---------------------------------------------- | ------------------------------------------------ |
| More separation / taller tiers                 | `--shape auto` or `--shape balanced`             |
| Concentrate on favorites                       | `--shape top-heavy`                              |
| Flat / mostly 1s                               | `--shape compressed`                             |
| Fewer / more tiers                             | `--tier-count <n>` or accept `tier-structure`    |
| Force cluster count                            | `--bucket-count <n>`                             |
| Fit vs music balance                           | `--rank combined --weights <fit>:<music>`        |
| Off-theme gets nothing                         | `--cutoff fit:68` or `--gate passFail`           |
| Reward borderline fits                         | `--gate passFailMaybe` + `maybe-band` tradeoff     |
| Pin a song                                     | `--pin <index>:<votes>`                          |

Dense/oversubscribed rounds (below ~1:1) naturally push more songs to 0 — expected and on-preference; rebalance manually or adjust shape only if a field calls for it.

## One-off scripts (`story-rankings.mjs` pattern)

For rounds the profile engine doesn't model (multi-axis creative prompts), write a **standalone deterministic script** in `scripts/one-off/`:

1. **Hard-code inputs** — song list with axis scores as constants (no LLM, no randomness).
2. **Define axes + weights** — e.g. continuation / grammar / music with named presets.
3. **Composite** — weighted sum per preset.
4. **Allocate** — mirror the continuous-tier model: top slice up, bottom slice down, middle neutral; spend both banks exactly (see HARD CONSTRAINTS). For bespoke multi-axis rounds, use `scripts/one-off/story-rankings.mjs` as a one-off template.
5. **Print multiple presets** — let user pick; document floors/caps in header comments.
6. **Optional flags** — e.g. `--concentrated` for tier-stacking variant.

Run: `node scripts/one-off/story-rankings.mjs` / `node scripts/one-off/story-rankings.mjs --concentrated`

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
