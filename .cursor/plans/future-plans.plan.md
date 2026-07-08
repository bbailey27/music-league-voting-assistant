---
name: future-plans
overview: Living backlog — potential and deferred work without a dedicated active plan file
todos: []
isProject: false
---

# workPotential Future Plans

> **Active sequencing:** [remaining-work-master.plan.md](remaining-work-master.plan.md)

## Active partial plans

| Plan                                                                           | Remaining                                                                                     |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [followup-5-specs-and-tests.plan.md](followup-5-specs-and-tests.plan.md)       | Full spec sync, output snapshot regression test (diff-based), regression prose, extract tests |
| [split-score-core-into-modules.plan.md](split-score-core-into-modules.plan.md) | Phases 2–4: renderer dedup, split tests, helper dedup — full steps in plan                    |
| [improve-just-cli-and-docs.plan.md](improve-just-cli-and-docs.plan.md)         | Phase 3: `tests/ml.test.mjs`, e2e fixture — full spec in plan                                 |

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
    Rather than specifying a _number_ of tiers and getting odd tier-boundary choices, specify which songs make up a tier.

## Debug this output

Up # Song Music Fit Combined Mod A B C Comment  
 0 Love 74 90 84.1 · 2 1 3 74. 9. sentence end  
 5 To Forget 70 90 78.4 · 1 1 2 7. 9. good noun options like her smile or my …
6 Revolution 78 - 78 · 1 1 2 78  
 9 Time 75 83 77.9 · 1 1 1 75. 83. new sentence but adds opportunity for…
4 Something I Can Never H… 74.2 80 73.5 · 1 1 · 742. 8 fit. good for this sentence but what c…
8 Lost In The Light 75.5 77 72.6 + 1 1 · 755+. 77 creative. new sentence. wants someth…
7 Satisfaction 74.5 78 71.3 - 1 1 · 745- like the beat more than the words. 78 fi…
1 The girl who resembles … 75.5 76 71.0 · · 1 · 755. 76 fit. you. but optional sentence end a…
Total 8 8 8  
 A just pick 2026-07-04-story-7 A B just pick 2026-07-04-story-7 B C just pick 2026-07-04-story-7 C

Down # Song Music Fit Combined Mod cv cc Comment  
 1 The girl who resembles … 75.5 76 71.0 · -2 · 755. 76 fit. you. but optional sentence end an…
3 Another Day 77 70 66.7 · -2 -4 77. 7. check how easy 'to' was to fit next. th…
Total -4 -4  
 cv just pick 2026-07-04-story-7 A cv cc just pick 2026-07-04-story-7 A cc

Ballot # Song Music Fit Combined Mod Votes Comment  
 0 Love 74 90 84.1 · +2 74. 9. sentence end  
 1 The girl who resembles … 75.5 76 71.0 · -2 755. 76 fit. you. but optional sentence end and…
2 One Day — — — · — ·  
 3 Another Day 77 70 66.7 · -2 77. 7. check how easy 'to' was to fit next. thi…
4 Something I Can Never H… 74.2 80 73.5 · +1 742. 8 fit. good for this sentence but what com…
5 To Forget 70 90 78.4 · +1 7. 9. good noun options like her smile or my li…
6 Revolution 78 - 78 · +1 78  
 7 Satisfaction 74.5 78 71.3 - +1 745- like the beat more than the words. 78 fit.…
8 Lost In The Light 75.5 77 72.6 + +1 755+. 77 creative. new sentence. wants somethin…
9 Time 75 83 77.9 · +1 75. 83. new sentence but adds opportunity for s…
Total +8/-4

bridgetbailey@MacBook-Pro:~/dev/music-league-voting-assistant/data output=''
[main ≡ +8 ~2 -9]$ just pick A cv --pin 3:-1,7:-1,5:2
node scripts/ml.mjs pick A cv --pin 3:-1,7:-1,5:2
(current round: 2026-07-04-story-7)
Applied option A — 2 tiers, 2×1 / 1×6. (2 manual tweaks)
Wrote data/analysis/2026-07-04-story-7/music.md
Wrote data/analysis/2026-07-04-story-7/music.json

A + pin # Song Music Fit Combined Mod A (original) A (altered) Comment  
 0 Love 74 90 84.1 · 2 2 74. 9. sentence end  
 5 To Forget 70 90 78.4 · 1 2 7. 9. good noun options lik…
6 Revolution 78 - 78 · 1 1 78  
 9 Time 75 83 77.9 · 1 1 75. 83. new sentence but ad…
4 Something I Can Never H… 74.2 80 73.5 · 1 1 742. 8 fit. good for this s…
8 Lost In The Light 75.5 77 72.6 + 1 1 755+. 77 creative. new sent…
1 The girl who resembles … 75.5 76 71.0 · 1 · 755. 76 fit. you. but optio…
Total 8 8/4  
 #5 To Forget: 1 → 2
#1 The girl who resembles you (feat. Ha Yea Song): 1 → 0
#3 Another Day: -1
#7 Satisfaction: -1

Applied # Song Music Fit Combined Mod Votes Comment  
 0 Love 74 90 84.1 · +2 74. 9. sentence end  
 1 The girl who resembles … 75.5 76 71.0 · -2 755. 76 fit. you. but optional sentence end and…
2 One Day — — — · — ·  
 3 Another Day 77 70 66.7 · -1 77. 7. check how easy 'to' was to fit next. thi…
4 Something I Can Never H… 74.2 80 73.5 · +1 742. 8 fit. good for this sentence but what com…
5 To Forget 70 90 78.4 · +2 7. 9. good noun options like her smile or my li…
6 Revolution 78 - 78 · +1 78  
 7 Satisfaction 74.5 78 71.3 - -1 745- like the beat more than the words. 78 fit.…
8 Lost In The Light 75.5 77 72.6 + +1 755+. 77 creative. new sentence. wants somethin…
9 Time 75 83 77.9 · +1 75. 83. new sentence but adds opportunity for s…
Total +8/-4  
Logged pick to data/analysis/picks.jsonl
bridgetbailey@MacBook-Pro:~/dev/music-league-voting-assistant/data output=''

THe girl who... was at 0 points in A and -2 in cv. Yet pick A cv registered a change from 1>0 out of nowhere. The 'original' table does not match the original A. Ah I see it took song 7 out since I pinned that negative. Change should have been Satisfaction +1 to -1, and then the girl goes from - to -2. Instead it redid A and then calculated the diff from the new one. And didn't show the original downvotes. It also showed 1 > 0 for the girl but didn't acknowledge anywhere that it was actually negative not 0. I guess the downvote side didn't register a 'change' since that one didn't change in cv. Only upvote with the reflow registered a 'change'. Just weird overall.
The initial up table should show all songs except mine (so it's clear which get 0 in all cases).
The alterations list from bins should handle the combo like A + cv, not make up scores for the downvote changes. I guess it should also output the combo A+cv as the original. part of the weirdness was from recalculating A partially from the pins, and part was from not displaying the downvotes at all. Much harder to spot what happened when you're missing half the picture AND it's making up new numbers.
Should have called out my missing fit score. If we're going purely on manual numbers then a missing fit score needs the same callout as a missing music score.

## Bugs

Confirmed defects (repro'd on real rounds). Fix independently of the feature backlog above.

1. `**--weights` on `pick` is inert for ranking (`fixWeightOnPicks`).** `pick` ranks off the
   `combinedScore` already stored in `music.json`, so `just pick … --weights <f>:<m>` does
   **not** re-rank — it only nudges tie-grouping (`tierKey` recomputes the raw blend). The
   blend is only (re)computed at `parse` (`applyManualFitScoring` → `normalizeCombined`).
   Repro (aaa-cars): `pick A --weights 3:7` leaves the 5:5 order intact; you must
   `just parse … --weights 3:7` first. Fix: either recompute `combinedScore` in `pick` when
   `--weights` is passed, or **remove `--weights` from `pick` and document that weights are
   a parse-time knob. (My lean: drop it from `pick`.)
2. `**pickWithBucketOrTierCount` errors with "0 options". `just pick A

--bucket-count `(and`--tier-count `) fails: forcing a curve suppresses the` tier-structure`tradeoff (guard in`allocateBell`,` if (!profile.tierCount &&
!profile.bucketCount)`), but`pick`still needs a letter to resolve against that now-empty menu (`resolveOptionPick`→`pickUsageError`). So the documented "force a curve" path is unreachable on` pick`; adding a` --pin`doesn't help either. Repro (aaa-cars):` pick A --tier-count 3`and`pick A --pin … --bucket-count 3`both error` Option "A" is not available (this round has 0 option(s))`. Fix: when a count is forced,    bypass the letter requirement (synthesize a single committed option), or keep emitting the    menu with the forced curve as option A. 3.` **bucketCount `semantics vs. intent (`bucketCountIsJustTiersMinusOne`).** Today`    bucketCount`(K) = number of **funded** point tiers =`tierCount − 1`(the 0 band), which makes it a near-duplicate of`tierCount` and not independently useful. Expectation:
bucket should control the \*_pre-merge K-means cluster count_ (the number of natural-break
groupings \*before the near-tier merge decision that collapses two adjacent clusters into
one point tier), so I can tell it "cut the field into K clusters, then you decide merges,"
rather than just "make tiers − 1." Revisit what the knob controls / rename accordingly.
(Ties into backlog #12: whatever K really means, surface it in the CLI.)

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
