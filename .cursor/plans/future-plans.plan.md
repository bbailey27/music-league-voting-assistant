---
name: future-plans
overview: Make note of potential future changes without a fully-scoped plan file
todos: []
isProject: false
---

# Potential Future Plans

1. ~~Create a script to identify new round input files without a date in the title. Add today's date following the existing naming pattern. Caveat if run before 5am, add yesterday's date instead. Also run this script at the start of the `run` workflow so names are cleaned up before the associated files are generated.~~ **Done** (2026-06-19) — `scripts/maintain-rounds.mjs` / `ml tidy`, auto-run by `ml run`; also archives rounds >2 days old. See `spec/decisions.md`.
2. Fix score parsing when extra numbers appear later in a comment. Core bug: "76 fit bonus" reads `76` as a *fit* score and finds no music score, because fit-keyword/score detection is too eager.
   - Treat the first number as the music score; read later numbers as fit only when the round expects numeric fit (or the comment explicitly says "fit"). Consider a CLI flag for numeric-fit rounds.
   - Only look for fit-tier / pass-fail keywords ("strong", "maybe") when explicitly requested.
   - Possibly standardize comment format (e.g. a period or blank line separating music score from fit notes / ignorable text) and follow it going forward.
3. Improve agent documentation for allocation to cut down on research and misunderstandings. And user-facing guidance and help commands for CLI that explain what the flags do.
4. Periodically review `scripts/one-off/` for patterns or fixes worth folding into the main pipeline (`parse-round.mjs`, `score-core.mjs`, `ml.mjs`).
5. Create scripts or flags for post-draft tweaks so that quick nudges are easier to accomplish command line or in chat without trying to refactor the base scoring each time. As they build up, common ones can become potential refactors. E.g. make a compress function with a given cap and just have it take away points from the top one and distribute downwards until each tier has a 1-point gap. Or one to make the curve flatter - move some 1s to 2 or 0. or provide a manual tier score cutoff or pass/fail list.

## Potential refinements (allocation)

Deferred refinements to the center-out smooth allocator (see
`[center-out-smooth-allocation.plan.md](center-out-smooth-allocation.plan.md)`).
Ship R1 + R2 first; only pick these up if real rounds show they're needed.

1. **R3 — semantic score anchors at 75 / 80.** Harden the owner's mental anchors into
   first-class tier behavior rather than just preferred boundary positions:

   - `75` = "definitely actively like the song" → a **funded floor**: a song ≥ 75
     should get at least 1 point in most cases (2 if budget allows). `74` is
     "almost-there" — group it with the 75s when there's space.
   - `76` reads as a **tiebreak** score: clearly clears 75, so promote it ahead of the
     plain 75s when the band has to be split.
   - `80` = "favorite" → the top-tier floor (R2 already merges ≥80; R3 would also
     guarantee the band clears the 1-point baseline).
     Acknowledge that 68–72 is intentionally **fuzzy** — exact scores there are
     inconsistent and shouldn't drive fine-grained tier splits.

2. **R4 — variance-aware gap compression.** Make score distances count for less the
   farther they sit from the center (so `77 → 84` reads as a smaller gap than its raw
   7 points, matching "precise around the average, fuzzier the farther out you get").
   Likely **redundant** once R1 + R2 ship — the unit-step staircase no longer converts
   a large gap into a large point jump — so revisit only if the curve still over-reacts
   to high-end gaps in practice.
