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
| [release-date-enrichment.plan.md](release-date-enrichment.plan.md)             | Round year-gate shipped; open: fetch providers, CSV enrichment, deluxe schema/spec            |
| [release-date-airtable-sync.plan.md](release-date-airtable-sync.plan.md)       | Push release dates to Airtable + scrobble→Airtable reconciliation (access method TBD)         |


## Optional polish (no dedicated plan file)

- **Expand `[spec/diagrams/](../spec/diagrams/README.md)`** — workflow flowcharts (mermaid).
First diagram shipped: combined normalization contender pool (cutoff / DQ). Add diagrams
for: parse → merge → pick → final pipeline, fit-trust modes (manual-numeric vs LLM),
`tierKey` / `allocateBell`, comment parse / peel-first, gate + table visibility.
Rule: [workflow-diagrams.mdc](../rules/workflow-diagrams.mdc).

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
11. Move Votes column 2nd next to song column for ballots
12. **Opt-in CLI detail for tier/bucket knobs + extras.** Keep `parse`/`pick` output clean
  by default, but let me see the richer info (per-option `tierCount` / `bucketCount`,
    score-range per tier, the stuff currently only in `music.md`) without leaving the
    terminal. Two acceptable shapes: (a) a `--detail`/`--verbose` flag on `parse`/`pick`
    that prints the extra columns/labels inline after the normal output; or (b) a
    follow-up command like `just detail <round>` / `just explain <round>` that dumps the
    already-generated MD detail to stdout. Bucket/tier counts are today only in the JSON
    (`tradeoffs[].options[].bucketCount`) and the MD prose — never in the CLI table. Should work with
    --dry-run too to show more detail without fully running.
13. `**--group` clump shortcut → auto-generate options (no manual pinning). Accept rough
  directions like "keep these together" without me computing pins. Proposed:
    `--group 9,1,8` (raw-order indices) marks a set that must stay on the same tier, then
    the script auto-produces the sensible variants (e.g. the clump pinned at 1, at 2, at 3)
    and surfaces them as extra lettered options alongside A/B/C, each a full budget-exact
    ballot. Generalize later to other rough directions (caps, floors, "clear band above").
    Internally this is just the existing pin+reflow run once per clump level, deduped on the
    resulting distribution. Point: the tool generates the combos, I don't hand it numbers.
    (Origin: aaa-cars round — grouped Watch Out / 2 Baddies / Perfect Night by hand-pinning.)
    Needs to work alongside regular pins too. aaa-cars was effectively 2 single high and low pins + 2 3-song groups.
    I wanted to see what possibilities kept my highs and lows AND kept the groups together.
    Rather than specifying a *number* of tiers and getting odd tier-boundary choices, specify which songs make up a tier.
14. Start writing airtable scripts: Get data like links, release year, and theme summary from here into my airtable listings as well. Maybe add a tags field with a re-classify script instead of all the separarate rough formulas for checkboxes. Solidify scraping scripts or API connections to gather than data. Write merge scripts to get scrobbles into the same view as pandora songs and continue merging and splitting titles/versions/albums and artists properly. If it's too much to import supporting data from here (and those K-Pop databases I found) then maybe export to a raw file, run scripts to merge details without storing them as separate tables (keep the CSVs don't add them raw to airtable), then re-upload with a merge script in Airtable as well if needed.
15. Just run could also have a detail flag to output current state. I started on the agent window so it ran parse already and I don't want to mess up the flags. But just run (to see what comes next) only said picka distribution. It didn't show me the distributions to pick from.
16. Improve ballot output some mroe. On CLI I'd like to se votes right next to combined. mod should be next to the score it modifies. Currently not next to the music score. But also what if music and fit scores both were numeric with mods? would they share 1 mod column? is one silently dropped?
17. Decouple fit, gate, weights, etc flags from parse. add ability to use a shortcut like re-run or plain just run to alter combined score and weightings and output separate from the actual raw file parsing. May mean restructuring music vs fit json? output the table again after each alteration. also a command to manually adjust a raw score without editing or re-pasting the HTML. Similar to pin but update the actual music and fit jsons. if no re-parse of the raw using these new commands, it should stick.
  - **PARTIALLY SHIPPED (A + B + C):** `just rescore <round> [knobs]` re-weights/re-shapes and
    re-allocates from JSON (no HTML re-read), re-printing the menu and resetting any pick to
    draft (`scripts/rescore-round.mjs`; see decisions.md 2026-07-10). **(B) SHIPPED
    (2026-07-21):** `rescore --score <i>:<v>` / `--fit-score <i>:<v>` writes a single raw
    music/fit score (with `+`/`-`/`?` modifier) into `music.json`/`fit.json` by `rawOrderIndex`
    and re-allocates with no re-parse (see decisions.md 2026-07-21). **Still open (D):** any
    music-vs-fit JSON restructure — not needed for B as shipped.
18. Testing dry-run / scratch-pad. Agents (and the owner) sometimes need to exercise parse/pick/rescore against a real round to verify behavior, but doing so today overwrites the round's `music.json`/`music.md` (and can silently change weights, as happened when a test re-parse dropped 0.7/0.3 → 0.5/0.5). Provide a safe scratch mode — e.g. a `--scratch`/`--sandbox` flag or a temp working copy — that runs the full pipeline and prints the tables/output WITHOUT writing back to the round's real files (or writes to a throwaway path). Goal: never mutate the owner's committed analysis as a side effect of testing.
19. Finish splitting up test files and audit tests. Check for unnecessary tests e.g. checking 3rd party libraries or basic code features. Check for assumptions and logical leaps. E.g. compare to the decision file and see if it mentions the explicit edge case or if the agent likely just wrote a test to confirm what it had already assumed. Even the decision file may not be full evidence. Surface anything potentially sketchy, contradictory, or inconsistent in the tests or the decision log.
20. Create a skill to corral excessive guessing and independent decision making. Agents should not make assumptions about implementation details that affect the outcome or handling of edge cases. There have been instances of large enough assumptions that they got codified in the decision log and taken as evidence of intent by future agents, without me signing off on them. Agents should consult me about any assumptions or edge cases. If it would be a small tweak to change, it is acceptable to pick the best option and then call it out for approval at the end of the step. If it's a larger rewrite to fix, always stop and ask. Either way, ALWAYS list any assumptions made or edge cases handled at the end. Example assumptions include: if the budget can't be met, it is acceptable to go under budget; always sort tables by music score even when combined score is present; manual cutoffs are only allowed on music scores. Even if you didn't make an intentional decision, check with fresh eyes if the code ENFORCES any such constraints that were not confirmed by the user.

## Bugs

Confirmed defects (repro'd on real rounds). Fix independently of the feature backlog above.

1. ~~`**--weights` on `pick` is inert for ranking (`fixWeightOnPicks`).~~ **RESOLVED
  (2026-07-10).** `--weights` was removed from `pick` (it now errors with a pointer to
   `rescore`); re-weighting lives in `just rescore <round> --weights <f>:<m>`, which re-blends
   `combinedScore` from the stored `score`/`fitScore` without a re-parse. See decisions.md.
2. `**pickWithBucketOrTierCount` errors with "0 options". `just pick A

--bucket-count `(and`--tier-count `) fails: forcing a curve suppresses the` tier-structure`tradeoff (guard in`allocateBell`,` if (!profile.tierCount &&
!profile.bucketCount)`), but`pick`still needs a letter to resolve against that now-empty menu (`resolveOptionPick`→`pickUsageError`). So the documented "force a curve" path is unreachable on` pick`; adding a` --pin`doesn't help either. Repro (aaa-cars):` pick A --tier-count 3`and`pick A --pin … --bucket-count 3`both error` Option "A" is not available (this round has 0 option(s))`. Fix: when a count is forced,    bypass the letter requirement (synthesize a single committed option), or keep emitting the    menu with the forced curve as option A. 3. ~~`**bucketCount` semantics vs. intent (`bucketCountIsJustTiersMinusOne`).~~ **RESOLVED
   (2026-07-21).** `--bucket-count K` now does real k-means (`ckmeans1dWeighted` into K natural-break
   clusters), then assigns a budget-exact monotonic point value per cluster (adjacent clusters may
   merge to one level; low clusters may be 0) — "cut the field into K clusters, then decide merges,"
   not `tierCount − 1`. See decisions.md 2026-07-21. (Original note: today bucketCount (K) = number of
   **funded** point tiers = `tierCount − 1` (the 0 band), a near-duplicate of `tierCount`; expectation
   was pre-merge K-means cluster count before the near-tier merge decision.) 4. **Tied combined score in different vote tiers gets no callout.** When two songs share the same combined score but land in different vote bands (one funded/downvoted, the other not), the allocator picks one arbitrarily with no tie-split notice. There is a`tier-split`tradeoff for the up axis, but the **down** axis (and possibly the CLI surfacing) doesn't flag it — repro on`2026-07-07-story-8`, two songs at 69.0 where the flat down bank downvoted one and not the other silently. Fix: emit a tie-split/notice when equal combined scores straddle a vote-tier boundary on either axis. Workaround today:` --pin i:0` to force one out (now supported).

First Love in bg-2017. No number at the beginning. Intended as words-only = disqualified (that's my comment to the submitter about why it's not valid). But the words included '2016' because this league is all about years. So that got counted as 20.1 and threw off the numbers. Need a clearer flag - either music score must be the very first thing, or a clear DQ or similar line that I can include to get rid of that. Maybe also a manual 'mark that one as a fail' so that it DOES reflow the points, unlike pinning it to 0 or adding a gate above it would do in rescore.

## Deferred (may not ship)

Not sequenced on [remaining-work-master](remaining-work-master.plan.md). Reopen only
when a real round proves the need.


| Plan                                                                                                                             | Summary                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [deferred-allocation-r3-r4.plan.md](deferred-allocation-r3-r4.plan.md)                                                           | Semantic 75/80 funded floors (R3); variance-aware gap compression (R4). R1/R2 already shipped.                                                     |
| [web-app-and-allocation-engine.plan.md](web-app-and-allocation-engine.plan.md) / [followup-2](followup-2-web-app-mobile.plan.md) | Browser UI — after specs stable                                                                                                                    |
| [followup-3-thematic-mode.plan.md](followup-3-thematic-mode.plan.md)                                                             | Thematic agent loop — largely covered by skills                                                                                                    |
| [uncertainty-band-allocation.plan.md](uncertainty-band-allocation.plan.md)                                                       | Widen `?` to ±2 pt band with smarter flags                                                                                                         |
| [lastfm-airtable-artist-merge.plan.md](lastfm-airtable-artist-merge.plan.md)                                                     | Import Airtable artist tagging → `merge-rules.json` artistAliases (needs artist-table export). Last.fm aggregation tooling itself already shipped. |


