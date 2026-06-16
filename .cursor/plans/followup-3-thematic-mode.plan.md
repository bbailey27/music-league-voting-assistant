---
name: "Follow-up 3: Thematic mode + fit research loop"
overview: Add the fit-dominant round mode and the agent research loop for fit determination that requires outside knowledge.
status: pending
depends_on: MVP (mode flag)
isProject: false
---

# Follow-up 3: Thematic mode + fit research loop

## Scope
- Add `--mode thematic`: fit tier dominates ranking, music is the within-tier tiebreak.
- Fit-tier ladder (high to low): very accurate / potentially unique interpretation; strong but straightforward; reasonable but not fantastic (gets points if music is strong or the field is weak); title/keyword only (technically correct, no creativity); borderline (explained but unconvincing / vague); nope (does not match).
- Words-only comments in thematic mode map to a fit tier instead of auto-disqualified; if no tier is provided, flag `needsResearch`.
- Research loop: copy-as-prompt includes only `needsResearch` songs; the agent returns tiers/deltas that are re-fed into the scorer.

## Done when
- A thematic round ranks by tier with music tiebreaks and clearly lists the songs needing research.

## Current state (carried over from cleanup Wave C-1)

The scorer already has thematic plumbing; the CLI is what's missing. Captured here
so the thematic work has a single home and the code-cleanup plan can be retired.

- **Scoring branch exists but is CLI-unreachable.** `scoreComment` sets
  `needsResearch = true` when `mode === 'thematic'` and a song has a music score but
  no fit signal yet (`scripts/score-core.mjs`, the `if (mode === 'thematic' …)`
  line). But `parse-round.mjs` rejects any `--mode` other than `objective|subjective`
  (`if (!['objective','subjective'].includes(args.mode))`), so the branch can never
  run from the CLI today.
- **`needsResearch` now persists.** `buildJsonPayload` writes `needsResearch` on each
  `music.json` song (decision 2026-06-15, commit `14b531b`), so once the CLI accepts
  `--mode thematic` the research loop can filter `music.json` directly — no extra
  persistence work needed here.
- **Decision made:** keep the thematic branch and wire it from the CLI here (the
  cleanup pass considered deleting it as dead code and chose deferral over removal).

### To ship (CLI wiring)

1. Add `thematic` to the `--mode` validation + usage string in `parse-round.mjs`;
   update the `ml parse` usage text in `scripts/ml.mjs` and any `--mode` docs in
   `justfile` / `README.md`.
2. Confirm `mode` threads through both parsers (`extract-html.mjs`, `parse-text.mjs`)
   into `scoreComment` for HTML and text inputs.
3. Implement the thematic ranking: fit tier dominates, music score is the
   within-tier tiebreak (see Scope ladder above).
4. Copy-as-prompt: emit only `needsResearch` songs; re-feed returned tiers/deltas.

### Tests already in place

- `scoreComment('76 music', 'thematic')` → `needsResearch: true` (`tests/score.test.mjs`).
- `buildJsonPayload` persists `needsResearch` per song (`tests/score.test.mjs`).
- Still needed: `--mode thematic` accepted end-to-end; thematic tier ranking with
  music tiebreaks.
