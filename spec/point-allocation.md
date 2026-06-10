# Point Allocation

Adaptive rather than formulaic.

Consider:

- total points
- number of songs
- quality spread
- score density
- fit weighting
- points-to-songs ratio

Example:
10 points across 20 songs implies a 0.5 average and often leads to many 0s and 1s.

Distributions may be:

- compressed
- balanced
- top-heavy

Avoid artificial equality.

## Tiering (how points become tiers)

Allocate by **tiers**, not by reading raw decimals off a blended score. The blended/combined
number orders candidates; the _tier boundaries_ are a judgment about where real gaps are.

1. Group candidates into point tiers by natural gaps in the ordering.
2. Songs that are effectively tied **share a tier and get the same points** — never split a
   near-tie across tiers just because a formula produced a fractional difference.
   - Equal music score with only a small fit gap (≈≤3 points) ⇒ same tier (see `ranking.mdc`).
3. Keep the spread modest: the top tier should not dwarf the next (≈2-3× at most), and avoid
   flat "everyone gets the same" equality.
4. Respect the per-song cap and the total budget exactly.

## Fit-weighted (blended) rounds

For lyric/theme rounds where fit carries weight:

1. **Qualifier gate first.** Set a fit cutoff (typically "good fit" = solid and above). Songs
   below the cutoff earn **no points regardless of music** — bad fit is disqualifying for
   points. A song you love musically but that fits poorly only takes a _leftover_ point if the
   qualifiers don't already consume the budget.
2. **Combined score** = `wFit × fit + wMusic × music` (record the weights). Fit-heavy by
   default; lean more thematic or more balanced by moving the split.
3. **Tier the qualifiers** by the rules above: primarily by fit band, then music to break ties
   _within_ a band. Do not let a small fit gap override an equal music score.
4. **Judgment overlay (document it):** a song whose tier placement is carried purely by fit
   while its music lags the rest of that tier may be set one tier lower (and vice versa). Note
   the call so it's reproducible.
