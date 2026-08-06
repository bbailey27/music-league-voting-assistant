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
    Rather than specifying a *number* of tiers and getting odd tier-boundary choices, specify which songs make up a tier.
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
20. Create a skill to corral excessive guessing and independent decision making. Agents should not make assumptions about implementation details that affect the outcome or handling of edge cases. There have been instances of large enough assumptions that they got codified in the decision log and taken as evidence of intent by future agents, without me signing off on them. Agents should consult me about any assumptions or edge cases. If it would be a small tweak to change, it is acceptable to pick the best option and then call it out for approval at the end of the step. If it's a larger rewrite to fix, always stop and ask. Either way, ALWAYS list any assumptions made or edge cases handled at the end. Example assumptions include: if the budget can't be met, it is acceptable to go under budget; always sort tables by music score even when combined score is present; manual cutoffs are only allowed on music scores. Even if you didn't make an intentional decision, check with fresh eyes if the code ENFORCES any such constraints that were not confirmed by the user.
21. Split out active vs concluded vs recurring leagues in the leagues.mjs file so context isn't bloated with outdated details. Also because these simplified slugs are likely to be reused. That's why dates are included in file names. So there needs to be logic about only matching a partial round name in CLI if it's a new or active round, not falling back to old rounds with similar names. And league notes and rules should probably save their active date range so they don't get applied to future leagues with similar names.
22. For combined scores, always print the current applied weights alongside the option table. I forget the defaults and then have to run manually to make sure it's using the fit weights I expect in CLI. Could do similar for all active pins, cutoffs, curve types, etc.
23. --reset flag. On rescore and other using the stored 'profile'. To clear the profile after testing out combinations of pins to get back to the original distributions. Currently no way to un-pin after trying things. maybe an interactive prompt, arg, or separate flag to reset just pins without resetting weights, or weights + pins but not --score and --fit-score. need to account for the other knobs as well.

## Bugs

Confirmed defects (repro'd on real rounds). Fix independently of the feature backlog above.

1. ~~`**--weights` on `pick` is inert for ranking (`fixWeightOnPicks`).~~ **RESOLVED
  (2026-07-10).** `--weights` was removed from `pick` (it now errors with a pointer to
   `rescore`); re-weighting lives in `just rescore <round> --weights <f>:<m>`, which re-blends
   `combinedScore` from the stored `score`/`fitScore` without a re-parse. See decisions.md.
2. `**pickWithBucketOrTierCount` errors with "0 options". `just pick A --bucket-count` (and`--tier-count` ) fails: forcing a curve suppresses the `tier-structure`tradeoff (guard in`allocateBell`,` if (!profile.tierCount &&

!profile.bucketCount)`), but`pick`still needs a letter to resolve against that now-empty menu (`resolveOptionPick`→`pickUsageError`). So the documented "force a curve" path is unreachable on` pick`; adding a` --pin`doesn't help either. Repro (aaa-cars):` pick A --tier-count 3`and`pick A --pin … --bucket-count 3`both error` Option "A" is not available (this round has 0 option(s))`. Fix: when a count is forced,    bypass the letter requirement (synthesize a single committed option), or keep emitting the    menu with the forced curve as option A. 3. ~~`**bucketCount `semantics vs. intent (`bucketCountIsJustTiersMinusOne`).~~ **RESOLVED (2026-07-21).`** --bucket-count K `now does real k-means (`ckmeans1dWeighted`into K natural-break clusters), then assigns a budget-exact monotonic point value per cluster (adjacent clusters may merge to one level; low clusters may be 0) — "cut the field into K clusters, then decide merges," not`tierCount − 1`. See decisions.md 2026-07-21. (Original note: today bucketCount (K) = number of **funded** point tiers =` tierCount − 1`(the 0 band), a near-duplicate of`tierCount`; expectation was pre-merge K-means cluster count before the near-tier merge decision.) 4. **Tied combined score in different vote tiers gets no callout.** When two songs share the same combined score but land in different vote bands (one funded/downvoted, the other not), the allocator picks one arbitrarily with no tie-split notice. There is a`tier-split`tradeoff for the up axis, but the **down** axis (and possibly the CLI surfacing) doesn't flag it — repro on`2026-07-07-story-8`, two songs at 69.0 where the flat down bank downvoted one and not the other silently. Fix: emit a tie-split/notice when equal combined scores straddle a vote-tier boundary on either axis. Workaround today:` --pin i:0` to force one out (now supported).

1. First Love in bg-2017. No number at the beginning. Intended as words-only = disqualified (that's my comment to the submitter about why it's not valid). But the words included '2016' because this league is all about years. So that got counted as 20.1 and threw off the numbers. Need a clearer flag - either music score must be the very first thing, or a clear DQ or similar line that I can include to get rid of that. Maybe also a manual 'mark that one as a fail' so that it DOES reflow the points, unlike pinning it to 0 or adding a gate above it would do in rescore. < think we reworked to ignore years
2. always print all songs in the output tables, or at least in the upvote table - shouldn't have to check between up and down to figure out the overlap if a couple songs don't appear in up but do appear in down. want to visually see how many blanks are at the bottom to match up with the downvote pool. Also missing downvote table entirely after rescore. And arbitrary pin on rescore didn't work. Wanted to force the top song to 4 points to see what that would do to the distributions but it was ignored.

[main ↓ +0 ~~1 -0]$ just parse story
node scripts/ml.mjs parse story
Wrote data/analysis/2026-07-20-story-10/[music.md](http://music.md)
Wrote data/analysis/2026-07-20-story-10/music.json
League: story-~~~~ — Collaborative sentence/story built by chaining song TITLES (lyrics do not matter).
⚠ Judge the TITLE only. Grammar of the attach and an interesting next beat are co-primary; music is a bonus (guidance profile `story-continuation`).
⚠ Never grep the song CSVs — use the title scan scripts (they parse only the title column).
$ node scripts/title-prefix-scan.mjs ~~~~ [...]
Find candidate titles that start with the anchor word(s).
$ node scripts/title-complement-check.mjs --slot ~~~~
Tag structural complements for the running stem (default slot: copular).
$ node scripts/title-candidate-score.mjs
Weighted engagement score (scrobbles + Pandora playlist fields) for candidate titles.
See: spec/[leagues.md](http://leagues.md)
Up # Song Music Fit Combined Mod A B C D E Comment~~
~~0 What If It’s Right? 90 90 93.1 · 3 2 2 3 2 9 9~~
~~7 For I Am The Light (And… 65 85 75.5 · 2 1 2 2 2 65 85~~
~~5 Put Me Down 70 75 75.5 · 2 1 2 1 1 7 75~~
~~1 Without a Face 76.5 60 74.8 · 1 1 1 1 1 765 6~~
~~4 You Can't Help Me Now 66 80 74.5 · · 1 1 1 1 66 8 nice enough but sooo r…
6 I Got Lies 75 60 73.8 · · 1 · · 1 75 6~~
~~8 Fly Away 72 60 71.9 · · 1 · · · 72 6+~~
~~Total 8 8 8 8 8~~
~~A. 4 tiers (bucket-count 3) — 3×1 / 2×2 / 1×1 / 0×3
B. 2 tiers (bucket-count 2) — 2×1 / 1×6
C. 3 tiers (bucket-count 2) — 2×3 / 1×2 / 0×2
D. 4 tiers (bucket-count 3) — 3×1 / 2×1 / 1×3 / 0×2
E. 3 tiers (bucket-count 2) — 2×2 / 1×4 / 0×1
Down # Song Music Fit Combined Mod cv cc Comment~~
~~4 You Can't Help Me Now 66 80 74.5 · · · 66 8 nice enough but sooo repeti…
6 I Got Lies 75 60 73.8 · -1 · 75 6~~
~~8 Fly Away 72 60 71.9 · -1 · 72 6+~~
~~2 We're All To Blame 65 40 61.0 · -1 -3 65 4~~
~~Total -3 -3~~
~~just pick <a|b|c> [cv|fl|cc] [--pin ~~~~:~~~~] [--cutoff music:~~~~] [--reason "…"]
Ballot # Song Music Fit Combined Mod Votes Comment~~
~~0 What If It’s Right? 90 90 93.1 · +3 9 9~~
~~1 Without a Face 76.5 60 74.8 · +1 765 6~~
~~2 We're All To Blame 65 40 61.0 · -1 65 4~~
~~3 Let Her Go - Acoustic — — — · — ·~~
~~4 You Can't Help Me Now 66 80 74.5 · · 66 8 nice enough but sooo repe…
5 Put Me Down 70 75 75.5 · +2 7 75~~
~~6 I Got Lies 75 60 73.8 · -1 75 6~~
~~7 For I Am The Light (And… 65 85 75.5 · +2 65 85~~
~~8 Fly Away 72 60 71.9 · -1 72 6+~~
~~Total +8/-3~~
~~bridgetbailey@MacBook-Pro:~~/dev/music-league-voting-assistant output=''
[main ≡ +0 ~~1 -0]$ just rescore --pin 0:4
node scripts/ml.mjs rescore --pin 0:4
(current round: 2026-07-20-story-10)
Wrote data/analysis/2026-07-20-story-10/[music.md](http://music.md)
Wrote data/analysis/2026-07-20-story-10/music.json
Up # Song Music Fit Combined Mod A B C D E Comment~~
~~0 What If It’s Right? 90 90 93.1 · 3 2 2 3 2 9 9~~
~~7 For I Am The Light (And… 65 85 75.5 · 2 1 2 2 2 65 85~~
~~5 Put Me Down 70 75 75.5 · 2 1 2 1 1 7 75~~
~~1 Without a Face 76.5 60 74.8 · 1 1 1 1 1 765 6~~
~~4 You Can't Help Me Now 66 80 74.5 · · 1 1 1 1 66 8 nice enough but sooo r…
6 I Got Lies 75 60 73.8 · · 1 · · 1 75 6~~
~~8 Fly Away 72 60 71.9 · · 1 · · · 72 6+~~
~~Total 8 8 8 8 8~~
~~A. 4 tiers (bucket-count 3) — 3×1 / 2×2 / 1×1 / 0×3
B. 2 tiers (bucket-count 2) — 2×1 / 1×6
C. 3 tiers (bucket-count 2) — 2×3 / 1×2 / 0×2
D. 4 tiers (bucket-count 3) — 3×1 / 2×1 / 1×3 / 0×2
E. 3 tiers (bucket-count 2) — 2×2 / 1×4 / 0×1
Down # Song Music Fit Combined Mod cv cc Comment~~
~~4 You Can't Help Me Now 66 80 74.5 · · · 66 8 nice enough but sooo repeti…
6 I Got Lies 75 60 73.8 · -1 · 75 6~~
~~8 Fly Away 72 60 71.9 · -1 · 72 6+~~
~~2 We're All To Blame 65 40 61.0 · -1 -3 65 4~~
~~Total -3 -3~~
~~just pick <a|b|c> [cv|fl|cc] [--pin ~~~~:~~~~] [--cutoff music:~~~~] [--reason "…"]
Ballot # Song Music Fit Combined Mod Votes Comment~~
~~0 What If It’s Right? 90 90 93.1 · +3 9 9~~
~~1 Without a Face 76.5 60 74.8 · +1 765 6~~
~~2 We're All To Blame 65 40 61.0 · -1 65 4~~
~~3 Let Her Go - Acoustic — — — · — ·~~
~~4 You Can't Help Me Now 66 80 74.5 · · 66 8 nice enough but sooo repe…
5 Put Me Down 70 75 75.5 · +2 7 75~~
~~6 I Got Lies 75 60 73.8 · -1 75 6~~
~~7 For I Am The Light (And… 65 85 75.5 · +2 65 85~~
~~8 Fly Away 72 60 71.9 · -1 72 6+~~
~~Total +8/-3~~
~~bridgetbailey@MacBook-Pro:~~/dev/music-league-voting-assistant output=''
[main ≡ +0 ~1 -0]$ just rescore --weights 6:4
node scripts/ml.mjs rescore --weights 6:4
(current round: 2026-07-20-story-10)
Wrote data/analysis/2026-07-20-story-10/[music.md](http://music.md)
Wrote data/analysis/2026-07-20-story-10/music.json
Up # Song Music Fit Combined Mod A B C D E Comment
0 What If It’s Right? 90 90 92.2 · 2 3 2 3 2 9 9
7 For I Am The Light (And… 65 85 77.5 · 1 2 2 2 2 65 85
5 Put Me Down 70 75 76.2 · 1 1 1 2 2 7 75
4 You Can't Help Me Now 66 80 76.0 · 1 1 1 1 1 66 8 nice enough but sooo r…
1 Without a Face 76.5 60 73.7 · 1 1 1 · 1 765 6
6 I Got Lies 75 60 72.9 · 1 · 1 · · 75 6
8 Fly Away 72 60 71.4 · 1 · · · · 72 6+
Total 8 8 8 8 8
A. 2 tiers (bucket-count 2) — 2×1 / 1×6
B. 4 tiers (bucket-count 3) — 3×1 / 2×1 / 1×3 / 0×2
C. 3 tiers (bucket-count 2) — 2×2 / 1×4 / 0×1
D. 4 tiers (bucket-count 3) — 3×1 / 2×2 / 1×1 / 0×3
E. 3 tiers (bucket-count 2) — 2×3 / 1×2 / 0×2
just pick <a|b|c> [--pin :] [--cutoff music:] [--reason "…"]
Ballot # Song Music Fit Combined Mod Votes Comment
0 What If It’s Right? 90 90 92.2 · +2 9 9
1 Without a Face 76.5 60 73.7 · +1 765 6
2 We're All To Blame 65 40 60.1 · -3 65 4
3 Let Her Go - Acoustic — — — · — ·
4 You Can't Help Me Now 66 80 76.0 · +1 66 8 nice enough but sooo repe…
5 Put Me Down 70 75 76.2 · +1 7 75
6 I Got Lies 75 60 72.9 · +1 75 6
7 For I Am The Light (And… 65 85 77.5 · +1 65 85
8 Fly Away 72 60 71.4 · +1 72 6+
Total +8/-3

---

Bug: --score and --fit-score should use the usual normalization e.g. 7+ > 70 mod: +
This should have transformed 9 to 90, not taken it as a literal 9
❯ just rescore --score 4:9
node scripts/ml.mjs rescore "$@"
(current round: 2026-08-04-aaa-window)
Wrote data/analysis/2026-08-04-aaa-window/music.md
Wrote data/analysis/2026-08-04-aaa-window/music.json

Up # Song Music Fit Combined Mod A B C D E Comment  
 1 革命を覚えた日 90 92 84.7 · 5 4 5 4 6 9 92  
 5 走 85 91 83.5 · 4 4 4 3 5 85 91  
 0 Hitchcoke 60 90 80.8 · 4 3 3 3 4 6 9  
 4 Sky Over Tokyo 9 90 76.8 · 3 3 2 3 3 85 9  
 6 TANK 70 74 69.7 · 2 2 2 3 2 7 74  
 7 THE FINAL 60 70 65.9 · 1 2 2 2 · 6 7  
 3 The fifth season (SSFWL) 80 65 63.7 · 1 2 2 2 · 8 65  
 Total 20 20 20 20 20  
 A. 5 tiers (bucket-count 5) — 5×1 / 4×2 / 3×1 / 2×1 / 1×2
B. 3 tiers (bucket-count 3) — 4×2 / 3×2 / 2×3
C. 4 tiers (bucket-count 4) — 5×1 / 4×1 / 3×1 / 2×4
D. 3 tiers (bucket-count 3) — 4×1 / 3×4 / 2×2
E. 6 tiers (bucket-count 5) — 6×1 / 5×1 / 4×1 / 3×1 / 2×1 / 0×2 · merges a tier (2→0 jump, no tiebreak)

---

Not properly re-parsing or showing options on just run. I uploaded the html before scoring to check years. After pasting in the new html, it still thought the scores were blank. And then did the thing I thought we fixed: prompted me to pick without showing any options to pick from. That should NEVER happen. Pick prompts should always appear with an option table. And just run should pretty much always output the current options. Not sure why it didn't see the new html contents. Maybe skipped parse and assumed music.json was ready. Need to add 'intentional blank early upload' to the run sequence possibly so it doesn't get confused like this. Or prevent creating whatever file confuses it.  
Also shouldn't have printed that bank warning twice, and should have had an option table there too.  
[main ↑]$$ just run 2022

node scripts/ml.mjs run "$@"

  archived 2026-07-29-kpop-bside (3d old)

2026-07-31-bg-2022: merge fit + music → data/analysis/2026-07-31-bg-2022/scores.json (just merge 2026-07-31-bg-2022)

  ⚠ 18 songs missing a score — re-export after the page autosaves + reloads

Wrote data/analysis/2026-07-31-bg-2022/scores.json (merged scores + draftVotes; fit source unchanged: data/analysis/2026-07-31-bg-2022/fit.json)

⚠️ Bank not fully spent: upvotes 0/15. rebalance so each bank totals exactly (pins, or caps × eligible slots, may block full spend).

Notes

  ⚠️ Bank not fully spent: upvotes 0/15. rebalance so each bank totals exactly (pins, or caps × eligible slots, may block full spend).

bridgetbailey@MacBook-Pro:~/dev/music-league-voting-assistant/data output=''

[main ≡ +3 ~2 -3]$$ just run 2022

node scripts/ml.mjs run "$@"

2026-07-31-bg-2022: pick a distribution → just pick 2026-07-31-bg-2022 <A|B|C> --reason "…"

bridgetbailey@MacBook-Pro:~/dev/music-league-voting-assistant/data output=''

---

^Same round as above but now in the pick phase. Listed the 3 lowest songs as changing from 0 to 1, when they were already 1 in the original E curve. Looks like it printed and (partially) compared C as the original even though I picked E and it did end up at E's shape with my pins, not what C would have become with my pins. Actually not quite. The song I pinned to 1 it put as DQ'd instead. It didn't reflow that point. Ended up with 14 points instead of 15 and didn't call that out as a problem.

  
Up

     #  Song                 Score  Mod   A   B   C   D   E  Comment                              

    11  BTBT                    90    ·   3   2   4   3   2  9                                    

    18  Wildfire                85    ·   3   2   4   3   2  85                                   

    17  HOT                     76    ·   2   1   3   2   2  76                                   

    13  Gasoline                75    -   2   1   2   1   2  75-                                  

    12  Too Bad               74.5    ·   1   1   1   1   1  745                                  

     3  Good Boy Gone Bad     74.2    ·   1   1   1   1   1  742                                  

     5  Celebrate               74    ·   1   1   ·   1   1  74                                   

     0  Do It Like This         74    ·   1   1   ·   1   1  74                                   

    16  MANIAC                73.7    ·   1   1   ·   1   1  737                                  

    15  Polaroid Love         73.6    ·   ·   1   ·   1   1  736                                  

     9  Walking on the moon   73.5    ·   ·   1   ·   ·   1  735                                  

     8  CASE 143                73    ·   ·   1   ·   ·   ·  73                                   

     7  CIRCUS                  73    ·   ·   1   ·   ·   ·  73                                   

     1  Guerrilla             72.5    ·   ·   ·   ·   ·   ·  725                                  

    14  March                   72    ·   ·   ·   ·   ·   ·  72                                   

     2  Yet To Come             71    ·   ·   ·   ·   ·   ·  71                                   

     4  2 Baddies                -   DQ   -   -   -   -   -  -                                    

     6  U MAD                    -   DQ   -   -   -   -   -  2021                                 

        Total                            15  15  15  15  15                                       

    A. 4 tiers (bucket-count 3) — 3×2 / 2×2 / 1×5 / 0×7

    B. 3 tiers (bucket-count 2) — 2×2 / 1×11 / 0×3

    C. 5 tiers (bucket-count 4) — 4×2 / 3×1 / 2×1 / 1×2 / 0×10

    D. 4 tiers (bucket-count 3) — 3×2 / 2×1 / 1×7 / 0×6

    E. 3 tiers (bucket-count 2) — 2×4 / 1×7 / 0×5

just pick <a|b|c> [--pin <song>:<v>] [--cutoff music:<n>] [--reason "…"]

Ballot

     #  Song                 Score  Mod  Votes  Comment                                           

     0  Do It Like This         74    ·      1  74                                                

     1  Guerrilla             72.5    ·      ·  725                                               

     2  Yet To Come             71    ·      ·  71                                                

     3  Good Boy Gone Bad     74.2    ·      1  742                                               

     4  2 Baddies                -   DQ      -  -                                                 

     5  Celebrate               74    ·      1  74                                                

     6  U MAD                    -   DQ      -  2021                                              

     7  CIRCUS                  73    ·      ·  73                                                

     8  CASE 143                73    ·      ·  73                                                

     9  Walking on the moon   73.5    ·      ·  735                                               

    10  Save our lives           —    ·      —  ·                                                 

    11  BTBT                    90    ·      3  9                                                 

    12  Too Bad               74.5    ·      1  745                                               

    13  Gasoline                75    -      2  75-                                               

    14  March                   72    ·      ·  72                                                

    15  Polaroid Love         73.6    ·      ·  736                                               

    16  MANIAC                73.7    ·      1  737                                               

    17  HOT                     76    ·      2  76                                                

    18  Wildfire                85    ·      3  85                                                

        Total                               15                                                    

bridgetbailey@MacBook-Pro:~/dev/music-league-voting-assistant/data output=''

[main ≡ +3 ~4 -3]$$ just pick E --pin 11:3,13:1

node scripts/ml.mjs pick "$@"

(current round: 2026-07-31-bg-2022)

Applied option E — 3 tiers, 2×4 / 1×7 / 0×5. (2 manual tweaks)

Wrote data/analysis/2026-07-31-bg-2022/scores.json

E + pin

     #  Song                 Music  Fit  Combined  Mod  Original  Altered  Comment                     

    11  BTBT                    90    -        90    ·        +4       +3  9                           

    18  Wildfire                85    -        85    ·        +3       +2  85                          

    17  HOT                     76    -        76    ·        +2       +2  76                          

    12  Too Bad               74.5    -      74.5    ·        +1       +1  745                         

     3  Good Boy Gone Bad     74.2    -      74.2    ·        +1       +1  742                         

     5  Celebrate               74    -        74    ·        +1       +1  74                          

     0  Do It Like This         74    -        74    ·        +1       +1  74                          

    16  MANIAC                73.7    -      73.7    ·         ·       +1  737                         

    15  Polaroid Love         73.6    -      73.6    ·         ·       +1  736                         

     9  Walking on the moon   73.5    -      73.5    ·         ·       +1  735                         

     8  CASE 143                73    -        73    ·         ·        ·  73                          

     7  CIRCUS                  73    -        73    ·         ·        ·  73                          

     1  Guerrilla             72.5    -      72.5    ·         ·        ·  725                         

    14  March                   72    -        72    ·         ·        ·  72                          

     2  Yet To Come             71    -        71    ·         ·        ·  71                          

    13  Gasoline                75    -         -    -         -        -  75-                         

     4  2 Baddies                -    -         -   DQ         -        -  -                           

     6  U MAD                    -    -         -   DQ         -        -  2021                        

        Total                                                +13      +14                              

    #11 BTBT: +4 → +3

    #18 Wildfire: +3 → +2

    #16 MANIAC: 0 → +1

    #15 Polaroid Love: 0 → +1

    #9 Walking on the moon: 0 → +1

Applied

     #  Song                 Music  Fit  Combined  Mod  Votes  Comment                            

     0  Do It Like This         74    -        74    ·      1  74                                 

     1  Guerrilla             72.5    -      72.5    ·      ·  725                                

     2  Yet To Come             71    -        71    ·      ·  71                                 

     3  Good Boy Gone Bad     74.2    -      74.2    ·      1  742                                

     4  2 Baddies                -    -         -   DQ      -  -                                  

     5  Celebrate               74    -        74    ·      1  74                                 

     6  U MAD                    -    -         -   DQ      -  2021                               

     7  CIRCUS                  73    -        73    ·      ·  73                                 

     8  CASE 143                73    -        73    ·      ·  73                                 

     9  Walking on the moon   73.5    -      73.5    ·      1  735                                

    10  Save our lives           —    —         —    ·      —  ·                                  

    11  BTBT                    90    -        90    ·      3  9                                  

    12  Too Bad               74.5    -      74.5    ·      1  745                                

    13  Gasoline                75    -         -    -      -  75-                                

    14  March                   72    -        72    ·      ·  72                                 

    15  Polaroid Love         73.6    -      73.6    ·      1  736                                

    16  MANIAC                73.7    -      73.7    ·      1  737                                

    17  HOT                     76    -        76    ·      2  76                                 

    18  Wildfire                85    -        85    ·      2  85                                 

        Total                                              14                         

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

