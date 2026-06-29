---
name: future-plans
overview: Living backlog — potential and deferred work without a dedicated active plan file
todos: []
isProject: false
---

# Potential Future Plans

> **Active sequencing:** [remaining-work-master.plan.md](remaining-work-master.plan.md)

## Active partial plans

| Plan                                                                           | Remaining                                                                                     |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [followup-5-specs-and-tests.plan.md](followup-5-specs-and-tests.plan.md)       | Full spec sync, output snapshot regression test (diff-based), regression prose, extract tests |
| [split-score-core-into-modules.plan.md](split-score-core-into-modules.plan.md) | Phases 2–4: renderer dedup, split tests, helper dedup — full steps in plan                    |
| [improve-just-cli-and-docs.plan.md](improve-just-cli-and-docs.plan.md)         | Phase 3: `tests/ml.test.mjs`, e2e fixture — full spec in plan                                 |

## Optional polish (no dedicated plan file)

Shipped 2026-06: parse / merge / pick stages, score-core Phase 1 split,
`scripts/parse/*` modules, `ml help` + README, R1/R2/Bug2 allocator, fit persist +
pure render, peel-first comment parse + `--fit-words` (2026-06-27). See `spec/decisions.md`.

- **Review `scripts/one-off/`** for fold-in candidates (also future-plans item 4)

Output snapshot regression test (diff-based): see
[followup-5-specs-and-tests.plan.md](followup-5-specs-and-tests.plan.md).

---

1. ~~Create a script to identify new round input files without a date in the title…~~ **Done** (2026-06-19) — `scripts/maintain-rounds.mjs` / `ml tidy`. See `spec/decisions.md`.
2. ~~Fix score parsing when extra numbers appear later in a comment~~ **Done** (2026-06-27) —
   peel-first parse + `--fit-words`; `76 fit bonus` → music 76 + fit shorthand (`strong`).
   See `spec/score-parsing.md`, `spec/scoring-comments.md`, `spec/decisions.md`.

3. ~~Improve agent documentation for allocation… user-facing guidance and help commands for CLI…~~ **Mostly done** (2026-06-26) — see [improve-just-cli-and-docs.plan.md](improve-just-cli-and-docs.plan.md) Phase 3 for remaining tests.
4. Periodically review `scripts/one-off/` for patterns or fixes worth folding into the main pipeline (`parse-round.mjs`, `score-core.mjs`, `ml.mjs`).
5. Create scripts or flags for post-draft tweaks so that quick nudges are easier to accomplish command line or in chat without trying to refactor the base scoring each time. As they build up, common ones can become potential refactors. E.g. make a compress function with a given cap and just have it take away points from the top one and distribute downwards until each tier has a 1-point gap. Or one to make the curve flatter - move some 1s to 2 or 0. or provide a manual tier score cutoff or pass/fail list.
6. Make music-only mode generate multiple score options as well. But not the weird single table AND choice table like it has now.
7. Clear documentation for available flags in command line mode and what they do. More CLI accessibility for re-runs etc. Both music only and fit rounds.
8. Surface the fit comment structure doc in the web app
9. Turn the commands + options into clear UI elements in the web app (likely collapsed until needed) since there's no CLI or LLM to rely on there.
10. ~~Improve pick CLI/docs~~ **Partially done** (2026-06-27) — `just pick` in tradeoff/ballot
    output, post-pick applied table, pin/single-dash warnings, prominent missing-score
    banners (head + tail), merge tradeoff tables, Mod/Comment columns + excluded songs
    (BLANK/DQ) in CLI tables. Still open: same columns in `music.md`, track-last-round
    default, pick-with-missing-scores hard block.

## Deferred (may not ship)

Not sequenced on [remaining-work-master](remaining-work-master.plan.md). Reopen only
when a real round proves the need.

| Plan                                                                                                                             | Summary                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [deferred-allocation-r3-r4.plan.md](deferred-allocation-r3-r4.plan.md)                                                           | Semantic 75/80 funded floors (R3); variance-aware gap compression (R4). R1/R2 already shipped. |
| [web-app-and-allocation-engine.plan.md](web-app-and-allocation-engine.plan.md) / [followup-2](followup-2-web-app-mobile.plan.md) | Browser UI — after specs stable                                                                |
| [followup-3-thematic-mode.plan.md](followup-3-thematic-mode.plan.md)                                                             | Thematic agent loop — largely covered by skills                                                |
| [uncertainty-band-allocation.plan.md](uncertainty-band-allocation.plan.md)                                                       | Widen `?` to ±2 pt band with smarter flags                                                     |
