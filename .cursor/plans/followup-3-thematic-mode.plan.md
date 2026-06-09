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
