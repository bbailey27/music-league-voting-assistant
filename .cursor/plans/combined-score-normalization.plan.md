---
name: "Combined score: per-round normalization with asymmetric std floors"
overview: Replace the raw 0.7·fit + 0.3·music blend with a per-round z-score normalization (fit dampened via a high std floor, music adaptive via a low floor), remapped onto a 75-centered music-anchored scale; fold +/- into music; order scores.html by combined with a music tiebreak.
status: done
isProject: false
---

# Combined score: per-round normalization with asymmetric std floors

## Problem

`rankBy: combined` ranked on raw `0.7 × fit + 0.3 × music`. Fit (a made-up 0–100
AI number) ranges far wider than music, so the raw blend let a barely-meaningful
~8-point fit gap (e.g. `93` vs `85`) dwarf a decisive 1-point music gap — the
opposite of what the `0.7/0.3` weights imply. The owner wanted fit kept granular
for display/research, but its *mathematical impact* reduced and made comparable to
music. Secondary: `scores.html` ordered by fit alone, and `+`/`-` modifiers stayed
flat regardless of round tightness.

## Design (chosen)

Z-score each axis over the **contenders** (point-eligible songs — not DQ'd, blank,
or gated out), apply the weights to the standardized values, then remap the blend
onto a **75-centered, music-anchored** display scale. Reconciliation is
**asymmetric, via different std floors**:

- **Music floor low** (`MUSIC_STD_FLOOR = 2`): music adapts to the round — a tight
  field amplifies half-points and `+/-` exactly as the owner wants.
- **Fit floor high** (`FIT_STD_FLOOR = 14`): the imprecise AI fit number rides an
  effectively fixed, dampened scale; a tight good-fit cluster is never amplified,
  and fit only "adapts" when its real spread exceeds the floor.

Rejected: symmetric normalization (dropping low-fit outliers tightens the survivors,
which a round-relative std would then *amplify* — re-inflating the meaningless
`93` vs `85` gap). Rejected earlier: snapping fit to band anchors (loses granularity).

Remap is centered so the average contender ≈ 75 and a clear standout reaches ~80,
which keeps the staircase's 75/80 anchors and the `≥ 80` favorite-band merge valid
with **no allocator changes**.

`+`/`-` fold into the music value (`MODIFIER_MUSIC_DELTA = 0.34`) before
normalizing; combined `tierKey` keys on this modifier-folded music, so a `74+` can
out-tier a plain `74` (tightness-scaled). Below `MIN_NORM_CONTENDERS` (4) the pass
falls back to fixed reference anchors.

## Changes (all implemented)

- [`scripts/score-core.mjs`](../../scripts/score-core.mjs): `normalizeCombined`,
  `effectiveMusic`, `isContender` + constants; `mergeFit` runs the pass (gate-aware);
  `rankValue` (combined) reads the stored `combinedScore`; combined `tierKey` uses
  modifier-folded music.
- [`scripts/render-fit-html.mjs`](../../scripts/render-fit-html.mjs): combined sort
  adds an explicit music secondary tiebreak.
- [`scripts/ml.mjs`](../../scripts/ml.mjs): `ml scores` (and `run`) default to
  `--order combined`.
- [`tests/score.test.mjs`](../../tests/score.test.mjs): 7 new cases (rebalance,
  fit-floor dampening, music amplification, modifier fold-in, small-n fallback,
  contender exclusion, anchor placement).
- Specs: `spec/point-allocation.md` (combined rankBy, same-tier, modifiers),
  `spec/fit-evaluation.md`, `.cursor/skills/round-fit-research/fit-json-schema.md`,
  decision-log entry in `spec/decisions.md`.

## Result (The Devil round)

The Perfect Drug (fit 88 / music 70) dropped 2 → 1; UNKNOWN LOVERZ (85/76) and
Dancing On The Wall (84/75.5) rose to 2 — music now counts. Natural curve
`3/2/2/2/1`. All 78 tests pass.

## Tunable constants

`MODIFIER_MUSIC_DELTA`, `MUSIC_STD_FLOOR`, `FIT_STD_FLOOR`, `COMBINED_DISPLAY_CENTER`,
`COMBINED_DISPLAY_SD`, `MIN_NORM_CONTENDERS`, `FIT_REF_MEAN`, `MUSIC_REF_MEAN` in
`scripts/score-core.mjs`.
