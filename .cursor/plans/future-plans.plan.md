---
name: future-plans
overview: Living backlog — potential and deferred work without a dedicated active plan file
todos: []
isProject: false
---

# Potential Future Plans

> **Active sequencing:** [remaining-work-master.plan.md](remaining-work-master.plan.md)

## Active partial plans

| Plan                                                                           | Remaining                                                                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| [followup-5-specs-and-tests.plan.md](followup-5-specs-and-tests.plan.md)       | Spec sync (`round-input-parsing.md`, rules refresh); snapshot regression **shipped** 2026-07-08                          |
| [split-score-core-into-modules.plan.md](split-score-core-into-modules.plan.md) | Phase 3 only: split `tests/score.test.mjs` by module (Phases 2 + 4 shipped 2026-07-08)                                   |
| [release-date-enrichment.plan.md](release-date-enrichment.plan.md)             | Round year-gate + `spec/release-dates.md` shipped; open: fetch providers, CSV enrichment                                 |
| [release-date-airtable-sync.plan.md](release-date-airtable-sync.plan.md)       | Push release dates to Airtable + scrobble→Airtable reconciliation (access method TBD)                                    |
| [followup-2-web-app-mobile.plan.md](followup-2-web-app-mobile.plan.md)         | Sections 1–3 shipped; **§4 next:** slug + ZIP export (`music.json`, `music.md`, `picks.jsonl` patch) + `just import-web` |

**Recently shipped (plan files deleted):**

- ~~improve-just-cli-and-docs~~ — all phases shipped 2026-07-08
- ~~menu-wide-pin-reflow~~ — exploreAllocate, rescore `--pin`, stored menu on pick (2026-07-28–31)

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
14. Start writing airtable scripts: Get data like links, release year, and theme summary from here into my airtable listings as well. Maybe add a tags field with a re-classify script instead of all the separarate rough formulas for checkboxes. Solidify scraping scripts or API connections to gather than data. Write merge scripts to get scrobbles into the same view as pandora songs and continue merging and splitting titles/versions/albums and artists properly. If it's too much to import supporting data from here (and those K-Pop databases I found) then maybe export to a raw file, run scripts to merge details without storing them as separate tables (keep the CSVs don't add them raw to airtable), then re-upload with a merge script in Airtable as well if needed.
15. Just run could also have a detail flag to output current state. I started on the agent window so it ran parse already and I don't want to mess up the flags. But just run (to see what comes next) only said pick a distribution. It didn't show me the distributions to pick from. < added the table in more places so this might be done. just run on a blank html state is still bad though. I uploaded html with no scores yet to run an agent check for fit. Then I added the scores and did `just run`, but it thought I should be past the parsing phase already. I assume because the file already existed? not sure. But it errored thinking I still had blank HTML when I didn't. Skipped parsing and jumped straight to merge.

```console
        just run 2021
        node scripts/ml.mjs run 2021
        archived 2026-07-25-lfm-neighbors (3d old)
        2026-07-28-bg-2021: merge fit + music → data/analysis/2026-07-28-bg-2021/scores.json (just merge 2026-07-28-bg-2021)
        ⚠ 17 songs missing a score — re-export after the page autosaves + reloads
        Wrote data/analysis/2026-07-28-bg-2021/scores.json (merged scores + draftVotes; fit source unchanged: data/analysis/2026-07-28-bg-2021/fit.json)
        ⚠️ Bank not fully spent: upvotes 0/15. rebalance so each bank totals exactly (pins, or caps × eligible slots, may block full spend).
        Notes
        ⚠️ Bank not fully spent: upvotes 0/15. rebalance so each bank totals exactly (pins, or caps × eligible slots, may block full spend).

```

1. Improve ballot and option table output some more.
   a. On ballot CLI I'd like to se votes right next to combined. mod should be next to the score it modifies. Currently not next to the music score. But also what if music and fit scores both were numeric with mods? would they share 1 mod column? is one silently dropped?
   b. I get a spaced out table on parse and a squished one with the up label on rescore, even when no downvotes are available
   c. options kicked out because of a cutoff should stay in the sort order with the others not sorted differently at the bottom. so i can visually see where the cutoff lands
2. Decouple fit, gate, weights, etc flags from parse. add ability to use a shortcut like re-run or plain just run to alter combined score and weightings and output separate from the actual raw file parsing. May mean restructuring music vs fit json? output the table again after each alteration. also a command to manually adjust a raw score without editing or re-pasting the HTML. Similar to pin but update the actual music and fit jsons. if no re-parse of the raw using these new commands, it should stick.
   a. **PARTIALLY SHIPPED (A + B + C):** `just rescore <round> [knobs]` re-weights/re-shapes and
   re-allocates from JSON (no HTML re-read), re-printing the menu and resetting any pick to
   draft (`scripts/rescore-round.mjs`; see decisions.md 2026-07-10). **(B) SHIPPED
   (2026-07-21):** `rescore --score <i>:<v>` / `--fit-score <i>:<v>` writes a single raw
   music/fit score (with `+`/`-`/`?` modifier) into `music.json`/`fit.json` by `rawOrderIndex`
   and re-allocates with no re-parse (see decisions.md 2026-07-21). **Still open (D):** any
   music-vs-fit JSON restructure — not needed for B as shipped.
3. Testing dry-run / scratch-pad. Agents (and the owner) sometimes need to exercise parse/pick/rescore against a real round to verify behavior, but doing so today overwrites the round's `music.json`/`music.md` (and can silently change weights, as happened when a test re-parse dropped 0.7/0.3 → 0.5/0.5). Provide a safe scratch mode — e.g. a `--scratch`/`--sandbox` flag or a temp working copy — that runs the full pipeline and prints the tables/output WITHOUT writing back to the round's real files (or writes to a throwaway path). Goal: never mutate the owner's committed analysis as a side effect of testing.
4. Finish splitting up test files and audit tests. Check for unnecessary tests e.g. checking 3rd party libraries or basic code features. Check for assumptions and logical leaps. E.g. compare to the decision file and see if it mentions the explicit edge case or if the agent likely just wrote a test to confirm what it had already assumed. Even the decision file may not be full evidence. Surface anything potentially sketchy, contradictory, or inconsistent in the tests or the decision log.
5. Create a skill to corral excessive guessing and independent decision making. Agents should not make assumptions about implementation details that affect the outcome or handling of edge cases. There have been instances of large enough assumptions that they got codified in the decision log and taken as evidence of intent by future agents, without me signing off on them. Agents should consult me about any assumptions or edge cases. If it would be a small tweak to change, it is acceptable to pick the best option and then call it out for approval at the end of the step. If it's a larger rewrite to fix, always stop and ask. Either way, ALWAYS list any assumptions made or edge cases handled at the end. Example assumptions include: if the budget can't be met, it is acceptable to go under budget; always sort tables by music score even when combined score is present; manual cutoffs are only allowed on music scores. Even if you didn't make an intentional decision, check with fresh eyes if the code ENFORCES any such constraints that were not confirmed by the user.
6. Split out active vs concluded vs recurring leagues in the leagues.mjs file so context isn't bloated with outdated details. Also because these simplified slugs are likely to be reused. That's why dates are included in file names. So there needs to be logic about only matching a partial round name in CLI if it's a new or active round, not falling back to old rounds with similar names. And league notes and rules should probably save their active date range so they don't get applied to future leagues with similar names.
7. For combined scores, always print the current applied weights alongside the option table. I forget the defaults and then have to run manually to make sure it's using the fit weights I expect in CLI. Could do similar for all active pins, cutoffs, curve types, etc.
8. --reset flag. On rescore and other using the stored 'profile'. To clear the profile after testing out combinations of pins to get back to the original distributions. Currently no way to un-pin after trying things. maybe an interactive prompt, arg, or separate flag to reset just pins without resetting weights, or weights + pins but not --score and --fit-score. need to account for the other knobs as well.
16. Improve ballot and option table output some more.
  a. On ballot CLI I'd like to se votes right next to combined. mod should be next to the score it modifies. Currently not next to the music score. But also what if music and fit scores both were numeric with mods? would they share 1 mod column? is one silently dropped?
    b. I get a spaced out table on parse and a squished one with the up label on rescore, even when no downvotes are available
    c. options kicked out because of a cutoff should stay in the sort order with the others not sorted differently at the bottom. so i can visually see where the cutoff lands
17. Decouple fit, gate, weights, etc flags from parse. add ability to use a shortcut like re-run or plain just run to alter combined score and weightings and output separate from the actual raw file parsing. May mean restructuring music vs fit json? output the table again after each alteration. also a command to manually adjust a raw score without editing or re-pasting the HTML. Similar to pin but update the actual music and fit jsons. if no re-parse of the raw using these new commands, it should stick.
  a. **PARTIALLY SHIPPED (A + B + C):** `just rescore <round> [knobs]` re-weights/re-shapes and
    re-allocates from JSON (no HTML re-read), re-printing the menu and resetting any pick to
    draft (`scripts/rescore-round.mjs`; see decisions.md 2026-07-10). **(B) SHIPPED
    (2026-07-21):** `rescore --score <i>:<v>` / `--fit-score <i>:<v>` writes a single raw
    music/fit score (with `+`/`-`/`?` modifier) into `music.json`/`fit.json` by `rawOrderIndex`
    and re-allocates with no re-parse (see decisions.md 2026-07-21). **Still open (D):** any
    music-vs-fit JSON restructure — not needed for B as shipped.
18. Testing dry-run / scratch-pad. Agents (and the owner) sometimes need to exercise parse/pick/rescore against a real round to verify behavior, but doing so today overwrites the round's `music.json`/`music.md` (and can silently change weights, as happened when a test re-parse dropped 0.7/0.3 → 0.5/0.5). Provide a safe scratch mode — e.g. a `--scratch`/`--sandbox` flag or a temp working copy — that runs the full pipeline and prints the tables/output WITHOUT writing back to the round's real files (or writes to a throwaway path). Goal: never mutate the owner's committed analysis as a side effect of testing.
19. Finish splitting up test files and audit tests. Check for unnecessary tests e.g. checking 3rd party libraries or basic code features. Check for assumptions and logical leaps. E.g. compare to the decision file and see if it mentions the explicit edge case or if the agent likely just wrote a test to confirm what it had already assumed. Even the decision file may not be full evidence. Surface anything potentially sketchy, contradictory, or inconsistent in the tests or the decision log.
20. ~~Create a skill to corral excessive guessing and independent decision making.~~ **Done** (2026-10-13) — shipped as always-applied rule `.cursor/rules/clarify-assumptions.mdc` (owner asked for it to always apply, so it became a rule instead of a skill; synced into AGENTS.md). Complemented by `.cursor/rules/avoidable-mistakes.mdc` (end-of-session mistake retro → propose rules/tests/skill tweaks as guards) and `.cursor/rules/sandbox-runs.mdc` (ML_DATA_DIR sandbox guard from the smoke-test incident). Agents should not make assumptions about implementation details that affect the outcome or handling of edge cases. There have been instances of large enough assumptions that they got codified in the decision log and taken as evidence of intent by future agents, without me signing off on them. Agents should consult me about any assumptions or edge cases. If it would be a small tweak to change, it is acceptable to pick the best option and then call it out for approval at the end of the step. If it's a larger rewrite to fix, always stop and ask. Either way, ALWAYS list any assumptions made or edge cases handled at the end. Example assumptions include: if the budget can't be met, it is acceptable to go under budget; always sort tables by music score even when combined score is present; manual cutoffs are only allowed on music scores. Even if you didn't make an intentional decision, check with fresh eyes if the code ENFORCES any such constraints that were not confirmed by the user.
21. Split out active vs concluded vs recurring leagues in the leagues.mjs file so context isn't bloated with outdated details. Also because these simplified slugs are likely to be reused. That's why dates are included in file names. So there needs to be logic about only matching a partial round name in CLI if it's a new or active round, not falling back to old rounds with similar names. And league notes and rules should probably save their active date range so they don't get applied to future leagues with similar names.
22. For combined scores, always print the current applied weights alongside the option table. I forget the defaults and then have to run manually to make sure it's using the fit weights I expect in CLI. Could do similar for all active pins, cutoffs, curve types, etc.
23. --reset flag. On rescore and other using the stored 'profile'. To clear the profile after testing out combinations of pins to get back to the original distributions. Currently no way to un-pin after trying things. maybe an interactive prompt, arg, or separate flag to reset just pins without resetting weights, or weights + pins but not --score and --fit-score. need to account for the other knobs as well.
24. Visual representations of the curves so I can quickly compare how well each option aligns with my vote distribution.
25. Command shortcuts like s for save-round, r for rescore and -w for --weights and -c m:x for music cutoff. Can still use both versions. Appear in help. Cutoff would be nice to assume music if I don't specify, especially if there are no fit scores in use - I shouldn't have to get an error about it being ambiguous.
26. ~~save-round should update current round pointer so I can do just run next without specifying~~ **Done** (2026-10-13) — `scripts/save-round.mjs` writes the dated id to `data/.current-round` and prints the `just parse <dated-id>` hint. Also fixed the root cause: save-round is self-dating (reuses the round's dated id instead of creating a second undated export), and bare-slug round names snap to their dated sibling on resolve. See `spec/decisions.md` 2026-10-13.
27. Just command to list recently-active league slugs in case I forget the exact format when saving a round. If no round within 2 weeks, mark inactive for this purpose.



