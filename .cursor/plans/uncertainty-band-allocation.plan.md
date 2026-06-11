---
name: uncertainty-band-allocation
overview: "Widen the `?` uncertainty model in the allocator: treat `?` as a tunable score band (default ±2 points), and only raise a review flag when a song's band could plausibly cross a point boundary and swap with a named nearby song; stay silent when it sits comfortably inside its tier."
status: pending
isProject: false
---

# Uncertainty band in allocation

## Problem

`?` is currently treated as a near-zero marker: [`flagUncertainBoundaries`](../../scripts/score-core.mjs) flags an uncertain song only when another candidate sits within a fixed `±0.5` score window with a different vote count, and emits a generic reason. Per the request, `?` means the true score could be a full point or two off (where the line was drawn on earlier tracks), so the comparison window must widen and the flag should be raised only when a plausible swing could actually change the point allocation — naming the nearby song(s) it could reorder with, and staying quiet when the song sits in the interior of its tier.

## Decisions (confirmed)

- Surface via the existing **visual review flag** (`needsReview` / `reviewReason`) — no new interactive tradeoff. It already renders in markdown "Needs review", `render-final-html.mjs`, and the JSON payload, so no rendering changes are needed.
- Band width is a **configurable profile knob**, `--uncertainty-band <n>`, defaulting to `2`.

## Changes

### 1. `scripts/score-core.mjs` — rewrite `flagUncertainBoundaries` (around line 1307)

- Read the band: `const band = Number.isFinite(profile.uncertaintyBand) && profile.uncertaintyBand > 0 ? profile.uncertaintyBand : 2;`
- The band is in **music-score units** (`?` attaches to the music score). Compare on `c.score`, falling back to `rankValue` when `score` is null (fit-only fields).
- For each uncertain candidate `c`, collect neighbors `d` where `Math.abs(d.score - c.score) <= band` **and** `d.finalVotes !== c.finalVotes`. These are the only songs a `±band` swing could reorder into a different point tier.
  - **No such neighbor → no flag** (the "fits neatly in the middle of the tier's range / not worth bringing up" case; also covers same-points neighbors, where a swap can't change the allocation).
  - **Otherwise → flag** `needsReview = true` with a specific reason naming the nearest different-vote neighbor and the point delta, e.g. `uncertain (?) within 2 pts of "Title" (74 → 2 pts vs this 1 pt) — possible reorder`. Pick the closest-in-score different-vote neighbor for the message (mention count if several).

### 2. `scripts/parse-round.mjs` — CLI knob

- Add `uncertaintyBand: null` to `parseArgs` defaults and handle `--uncertainty-band` / `--uncertainty-band=`.
- Export `parseUncertaintyBand(spec)`: returns `undefined` for empty input; otherwise a **positive finite number** (decimals allowed, e.g. `1.5`); throw on non-positive / non-numeric (mirrors `parseWeights`-style validation, not the integer-only `parseCountFlag`).
- Thread it into the `profile` passed to `enrichProfileWithBudget(...)` and update the usage string.

### 3. Tests — `tests/score.test.mjs`

- Interior `?` (no different-vote neighbor within band) is **not** flagged.
- Boundary `?` (a different-vote neighbor within band) **is** flagged, and `reviewReason` names the neighbor.
- Band is tunable: a field that flags at the default band stays unflagged at a smaller band (and/or vice versa) via `profile.uncertaintyBand`.
- `parseUncertaintyBand`: accepts `2`, `1.5`; `''`/`null` → `undefined`; throws on `0`, `-1`, `x`.

### 4. Spec + skill docs

- [`spec/uncertainty.md`](../../spec/uncertainty.md): document the band semantics (configurable, default `±2`), interior-tier → silent vs near-boundary → flagged-with-named-neighbor, the "don't flag if it can't change points" rule, and the `--uncertainty-band` knob.
- [`spec/point-allocation.md`](../../spec/point-allocation.md): expand the Modifiers line (`?` near a point boundary…) and the Profile section to describe the band + neighbor-aware flag and `uncertaintyBand`.
- [`spec/score-parsing.md`](../../spec/score-parsing.md): note `?` is an uncertainty band (cross-ref `uncertainty.md`), not a near-zero marker.
- [`.cursor/skills/point-allocation/SKILL.md`](../skills/point-allocation/SKILL.md): add `--uncertainty-band` to the knobs/modifiers notes.

## Out of scope

- No new interactive tradeoff kind. No changes to how tiers are drawn or to budget exactness — only the review-flag heuristic and its inputs change.

## Verify

- `npm test` (extends `tests/score.test.mjs`).
- Spot-check a real round, e.g. `node scripts/parse-round.mjs rounds/2026-06-10-pisces.html` and `... --uncertainty-band 1`, confirming the "Needs review" section changes as expected.
