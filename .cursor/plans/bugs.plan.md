# Bugs

Confirmed defects (repro'd on real rounds). Fix independently of the feature backlog in future-plans.plan.md.

1. ~~`**--weights` on `pick` is inert for ranking (`fixWeightOnPicks`).~~ **RESOLVED
   (2026-07-10).** `--weights` was removed from `pick` (it now errors with a pointer to
   `rescore`); re-weighting lives in `just rescore <round> --weights <f>:<m>`, which re-blends
   `combinedScore` from the stored `score`/`fitScore` without a re-parse. See decisions.md.
2. ~~`pickWithBucketOrTierCount` errors with "0 options".~~ **RESOLVED (2026-07-31).** Forced
   `--tier-count` / `--bucket-count` now always emits a pickable option A. See decisions.md 2026-07-31.
3. ~~`bucketCount` semantics vs. intent.~~ **RESOLVED (2026-07-21).** `--bucket-count K` now does
   real k-means clustering. See decisions.md 2026-07-21.
4. **Tied combined score in different vote tiers gets no callout.** Two songs at same
   `combinedScore` but different `tierKey` can land in different vote bands silently.
   Repro: `2026-07-07-story-8`, two songs at 69.0. **DEFERRED** — `--pin i:0` workaround is sufficient.

5. First Love in bg-2017. No number at the beginning. Intended as words-only = disqualified (that's my comment to the submitter about why it's not valid). But the words included '2016' because this league is all about years. So that got counted as 20.1 and threw off the numbers. Need a clearer flag - either music score must be the very first thing, or a clear DQ or similar line that I can include to get rid of that. Maybe also a manual 'mark that one as a fail' so that it DOES reflow the points, unlike pinning it to 0 or adding a gate above it would do in rescore. < think we reworked to ignore years
6. always print all songs in the output tables, or at least in the upvote table - shouldn't have to check between up and down to figure out the overlap if a couple songs don't appear in up but do appear in down. want to visually see how many blanks are at the bottom to match up with the downvote pool. ~~Also missing downvote table entirely after rescore.~~ **Down table fix (2026-08-13):** `down-structure` tradeoff now always emits (even when all shapes collapse to one distribution), mirroring the forced tier-count fix for the up table. And arbitrary pin on rescore didn't work. Wanted to force the top song to 4 points to see what that would do to the distributions but it was ignored.

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

~~Bug: --score and --fit-score should use the usual normalization e.g. 7+ > 70 mod: +~~
~~This should have transformed 9 to 90, not taken it as a literal 9~~
**RESOLVED (2026-08-13).** `parseScoreOverrides` now runs through `scaleScoreToken` (same as comment parsing).
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

~~Not properly re-parsing or showing options on just run.~~
**RESOLVED (2026-08-13).** (a) `just run` now auto-re-parses when input HTML/txt is newer
than music.json (mtime check in `pipelineState`/`nextStep`). (b) Pick step now prints the
stored option tables instead of a bare label. (c) Budget warning now appears at pick time
(added `warnBudgetMismatch` to `pick-round.mjs`).  
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

~~^Same round as above but now in the pick phase. Wrong Original/Altered baseline + budget 14/15 not called out.~~
**PARTIALLY RESOLVED.** (a) Pin comparison baseline fixed 2026-07-31 (decisions.md — baseline now
from display menu, not unpinned option). (b) Budget mismatch warning at pick time added 2026-08-13
(`warnBudgetMismatch` in `pick-round.mjs`). Original repro detail below.

Up

```
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
```

just pick <a|b|c> [--pin :] [--cutoff music:] [--reason "…"]

Ballot

```
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
```

bridgetbailey@MacBook-Pro:~/dev/music-league-voting-assistant/data output=''

[main ≡ +3 ~4 -3]$$ just pick E --pin 11:3,13:1

node scripts/ml.mjs pick "$@"

(current round: 2026-07-31-bg-2022)

Applied option E — 3 tiers, 2×4 / 1×7 / 0×5. (2 manual tweaks)

Wrote data/analysis/2026-07-31-bg-2022/scores.json

E + pin

```
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
```

Applied

```
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
```

---

~~how does dry-run work? does it not have the current round shortcut?~~
~~`--pins` (typo for `--pin`) not caught; its value `4:3` consumed as round name.~~
**RESOLVED (2026-08-13).** `splitRoundArgs`/`splitPickArgs` now reject unrecognized `--` flags
with fuzzy suggestion (edit distance). `--pins` → `Unknown flag "--pins". Did you mean --pin?`

---

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

---

instead of erroring when just run targets an ambiguous round name, suggest non-archived rounds that match and allow user interaction (e.g. type 1,2,3) to choose.

---

never suggest a ballot where every song gets exactly the same score. A should be invalid here:
Up # Song Score Mod A B C D E Comment  
 4 REDRED 77 · 1 2 2 3 3 77  
 1 RUN TO YOU 77 · 1 2 2 3 3 77  
 9 NASA 76.5 · 1 2 2 2 3 765  
 12 Mmchk 75.5 · 1 1 2 1 2 755  
 2 Skiii 75.5 · 1 1 2 1 2 755  
 10 Summer Blue 75 · 1 1 1 1 2 75  
 14 Eye-Poppin’ 74 · 1 1 1 1 · 74  
 3 Stick With You 74 · 1 1 1 1 · 74  
 15 This & That 74 · 1 1 1 1 · 74  
 6 YOUNGCREATORCREW 74 · 1 1 1 1 · 74  
 7 Aura 73.8 · 1 1 · · · 738  
 13 SWIM 73.7 · 1 1 · · · 737  
 0 Do your dance 73.5 · 1 · · · · 735  
 8 FARMING 73.5 · 1 · · · · 735  
 11 Promise 73.5 - 1 · · · · 735-  
 Total 15 15 15 15 15

---

my pin caused the reflow to split 2 same-score groups arbitrarily. should have at least called that out. better: ask me which song should go up or down for the tiebreak instead of choosing for me if ther's no - flag or anything to guide that choice.

Ballot # Song Score Mod Votes Comment  
 0 Do your dance 73.5 · 1 735  
 1 RUN TO YOU 77 · 1 77  
 2 Skiii 75.5 · 1 755  
 3 Stick With You 74 · 1 74  
 4 REDRED 77 · 1 77  
 5 Adrenaline — · — ·  
 6 YOUNGCREATORCREW 74 · 1 74  
 7 Aura 73.8 · 1 738  
 8 FARMING 73.5 · 1 735  
 9 NASA 76.5 · 1 765  
 10 Summer Blue 75 · 1 75  
 11 Promise 73.5 - 1 735-  
 12 Mmchk 75.5 · 1 755  
 13 SWIM 73.7 · 1 737  
 14 Eye-Poppin’ 74 · 1 74  
 15 This & That 74 · 1 74  
 Total 15  
❯ just rescore --pin 12:2
node scripts/ml.mjs rescore "$@"
(current round: 2026-08-17-bg-2026)
Wrote data/analysis/2026-08-17-bg-2026/music.md
Wrote data/analysis/2026-08-17-bg-2026/music.json

Up # Song Score Mod A B C D E Comment  
 4 REDRED 77 · 1 2 2 3 3 77  
 1 RUN TO YOU 77 · 1 2 2 3 3 77  
 9 NASA 76.5 · 1 2 2 2 3 765  
 12 Mmchk 75.5 · 2 2 2 2 2 755  
 2 Skiii 75.5 · 1 1 2 1 2 755  
 10 Summer Blue 75 · 1 1 1 1 2 75  
 14 Eye-Poppin’ 74 · 1 1 1 1 · 74  
 3 Stick With You 74 · 1 1 1 1 · 74  
 15 This & That 74 · 1 1 1 1 · 74  
 6 YOUNGCREATORCREW 74 · 1 1 1 · · 74  
 7 Aura 73.8 · 1 1 · · · 738  
 13 SWIM 73.7 · 1 · · · · 737  
 0 Do your dance 73.5 · 1 · · · · 735  
 8 FARMING 73.5 · 1 · · · · 735  
 11 Promise 73.5 - · · · · · 735-  
 Total 15 15 15 15 15  
 A. 1 tier (bucket-count 1) — 1×3 / 2×1 / 1×10 / 0×1
B. 3 tiers (bucket-count 2) — 2×4 / 1×7 / 0×4
C. 3 tiers (bucket-count 2) — 2×5 / 1×5 / 0×5
D. 4 tiers (bucket-count 3) — 3×2 / 2×2 / 1×5 / 0×6
E. 3 tiers (bucket-count 2) — 3×3 / 2×3 / 0×9 · merges a tier (2→0 jump, no tiebreak)

Also pins should be additive. My 2nd pin here replaced the old one. should keep both.

❯ just rescore --pin 2:2
node scripts/ml.mjs rescore "$@"
(current round: 2026-08-17-bg-2026)
Wrote data/analysis/2026-08-17-bg-2026/music.md
Wrote data/analysis/2026-08-17-bg-2026/music.json

Up # Song Score Mod A B C D E Comment  
 4 REDRED 77 · 1 2 2 3 3 77  
 1 RUN TO YOU 77 · 1 2 2 3 3 77  
 9 NASA 76.5 · 1 2 2 2 3 765  
 12 Mmchk 75.5 · 1 1 2 1 2 755  
 2 Skiii 75.5 · 2 2 2 2 2 755  
 10 Summer Blue 75 · 1 1 1 1 2 75  
 14 Eye-Poppin’ 74 · 1 1 1 1 · 74  
 3 Stick With You 74 · 1 1 1 1 · 74  
 15 This & That 74 · 1 1 1 1 · 74  
 6 YOUNGCREATORCREW 74 · 1 1 1 · · 74  
 7 Aura 73.8 · 1 1 · · · 738  
 13 SWIM 73.7 · 1 · · · · 737  
 0 Do your dance 73.5 · 1 · · · · 735  
 8 FARMING 73.5 · 1 · · · · 735  
 11 Promise 73.5 - · · · · · 735-  
 Total 15 15 15 15 15  
 A. 1 tier (bucket-count 1) — 1×4 / 2×1 / 1×9 / 0×1
B. 3 tiers (bucket-count 2) — 2×3 / 1×1 / 2×1 / 1×6 / 0×4
C. 3 tiers (bucket-count 2) — 2×5 / 1×5 / 0×5
D. 4 tiers (bucket-count 3) — 3×2 / 2×1 / 1×1 / 2×1 / 1×4 / 0×6
E. 3 tiers (bucket-count 2) — 3×3 / 2×3 / 0×9 · merges a tier (2→0 jump, no tiebreak)

just pick <a|b|c> [--pin <song>:<v>] [--cutoff music:<n>] [--reason "…"]

And the pick + pin output is still broken. based diffs off of A even though I picked D.

just pick d --pin 2:2,12:2,6:1,14:1
node scripts/ml.mjs pick "$@"
(current round: 2026-08-17-bg-2026)
Applied option D — 4 tiers, 3×2 / 2×1 / 1×7 / 0×5. (4 manual tweaks)
Wrote data/analysis/2026-08-17-bg-2026/music.md
Wrote data/analysis/2026-08-17-bg-2026/music.json

D + pin # Song Score Mod Original Altered Comment  
 4 REDRED 77 · +1 +3 77  
 1 RUN TO YOU 77 · +1 +3 77  
 9 NASA 76.5 · +1 +2 765  
 12 Mmchk 75.5 · +1 +2 755  
 2 Skiii 75.5 · +1 +2 755  
 10 Summer Blue 75 · +1 +1 75  
 14 Eye-Poppin’ 74 · +1 +1 74  
 3 Stick With You 74 · +1 · 74  
 15 This & That 74 · +1 · 74  
 6 YOUNGCREATORCREW 74 · +1 +1 74  
 7 Aura 73.8 · +1 · 738  
 13 SWIM 73.7 · +1 · 737  
 0 Do your dance 73.5 · +1 · 735  
 8 FARMING 73.5 · +1 · 735  
 11 Promise 73.5 - +1 · 735-  
 Total +15 +15  
 #4 REDRED: +1 → +3
#1 RUN TO YOU: +1 → +3
#9 NASA: +1 → +2
#12 Mmchk: +1 → +2
#2 Skiii: +1 → +2
#3 Stick With You: +1 → 0
#15 This & That: +1 → 0
#7 Aura: +1 → 0
#13 SWIM: +1 → 0
#0 Do your dance: +1 → 0
#8 FARMING: +1 → 0
#11 Promise: +1 → 0

---

fit or music score of '10' in my raw comment' means 100 not literally 10. I don't bother to write scores below 5/50 usually so it's safe to hardcode that case. I'd never write an actual 10, I'd just disqualify the song.

---

Different weights on ballot vs choice table
[main ≡ +0 ~1 -0]$$ just rescore --weights 2:8
node scripts/ml.mjs rescore "$@"
(current round: 2026-08-10-aaa-fire)
Wrote data/analysis/2026-08-10-aaa-fire/music.md
Wrote data/analysis/2026-08-10-aaa-fire/music.json

Up
    #  Song                Music  Fit  Combined  Mod   A   B   C   D   E  Comment                                  
    3  No diggity             87   90      91.0    ·   5   4   5   4   5  87 9                                     
    6  HWAA                   84   90      79.5    ·   4   4   4   4   4  84 9                                     
    4  SPARK-AGAIN            83   92      76.7    ·   4   4   4   4   4  83 92                                    
    5  Operation Mosquito     82   90      71.8    ·   3   3   3   4   4  82 9                                     
    1  プリズム               81   90      68.0    ·   2   3   3   3   2  81 9                                     
    2  火ノ鳥                 81   80      62.9    ·   2   2   1   1   1  81 8                                     
       Total                                          20  20  20  20  20                                           
    A. 4 tiers (bucket-count 4) — 5×1 / 4×2 / 3×1 / 2×2
    B. 3 tiers (bucket-count 3) — 4×3 / 3×2 / 2×1
    C. 4 tiers (bucket-count 4) — 5×1 / 4×2 / 3×2 / 1×1 · merges a tier (3→1 jump, no tiebreak)
    D. 3 tiers (bucket-count 3) — 4×4 / 3×1 / 1×1 · merges a tier (3→1 jump, no tiebreak)
    E. 4 tiers (bucket-count 4) — 5×1 / 4×3 / 2×1 / 1×1 · merges a tier (4→2 jump, no tiebreak)

just pick <a|b|c> [--pin <song>:<v>] [--cutoff music:<n>] [--reason "…"]

Ballot
    #  Song                Music  Fit  Combined  Mod  Votes  Comment                                               
    0  DETERMINADO             —    —         —    ·      —  ·                                                     
    1  プリズム               81   90      68.0    ·      2  81 9                                                  
    2  火ノ鳥                 81   80      62.9    ·      2  81 8                                                  
    3  No diggity             87   90      91.0    ·      5  87 9                                                  
    4  SPARK-AGAIN            83   92      76.7    ·      4  83 92                                                 
    5  Operation Mosquito     82   90      71.8    ·      3  82 9                                                  
    6  HWAA                   84   90      79.5    ·      4  84 9                                                  
       Total                                             20   


       [main ≡ +0 ~1 -0]$$ just pick a
node scripts/ml.mjs pick "$@"
(current round: 2026-08-10-aaa-fire)
Applied option A — 4 tiers, 5×1 / 4×2 / 3×1 / 2×2.
Wrote data/analysis/2026-08-10-aaa-fire/music.md
Wrote data/analysis/2026-08-10-aaa-fire/music.json

Applied
    #  Song                Music  Fit  Combined  Mod  Votes  Comment                                               
    0  DETERMINADO             —    —         —    ·      —  ·                                                     
    1  プリズム               81   90      68.0    ·      2  81 9                                                  
    2  火ノ鳥                 81   80      62.9    ·      2  81 8                                                  
    3  No diggity             87   90      91.0    ·      5  87 9                                                  
    4  SPARK-AGAIN            83   92      76.7    ·      4  83 92                                                 
    5  Operation Mosquito     82   90      71.8    ·      3  82 9                                                  
    6  HWAA                   84   90      79.5    ·      4  84 9                                                  
       Total                                             20                                                        
Logged pick to data/analysis/picks.jsonl
---
Why are none of the curves using the max votes? When I pinned a song to 6, it didn't bring back the E option with 654320 even though that was valid with the pins. It condensed all the way down to 1 option. I'd expect an attempt to reflow and produce more curves at that point.

[main ≡ +0 ~2 -0]$$ just run circle
node scripts/ml.mjs run "$@"
  named aaa-circle → 2026-08-23-aaa-circle
  ! skip archive of data/rounds/2026-07-16-kpop-under-appreciated.html: data/rounds/archive/2026-07-16-kpop-under-appreciated.html already exists
  ! skip archive of data/analysis/2026-07-16-kpop-under-appreciated: data/analysis/archive/2026-07-16-kpop-under-appreciated already exists
Wrote data/analysis/2026-08-23-aaa-circle/music.md
Wrote data/analysis/2026-08-23-aaa-circle/music.json

League: aaa-<topic> — AAA league themed rounds (aaa-<topic>).
  See: spec/leagues.md

Up
    #  Song           Music  Fit  Combined  Mod   A   B   C   D   E  Comment                                       
    0  Always You        90   80      85.9    ·   5   4   5   5   6  9 8                                           
    5  Love in Bloom     75   78      79.3    ·   5   4   4   4   5  75 78                                         
    6  I Want You        72   80      78.6    ·   4   4   4   3   4  72 8                                          
    4  午夜宣言          70   75      76.4    ·   3   3   3   3   3  7 75                                          
    1  プルミエール      60   80      73.8    ·   2   3   2   3   2  6 8                                           
    3  BiiiG             50   30      56.0    ·   1   2   2   2   ·  5 3                                           
       Total                                     20  20  20  20  20                                                
    A. 5 tiers (bucket-count 5) — 5×2 / 4×1 / 3×1 / 2×1 / 1×1
    B. 3 tiers (bucket-count 3) — 4×3 / 3×2 / 2×1
    C. 4 tiers (bucket-count 4) — 5×1 / 4×2 / 3×1 / 2×2
    D. 4 tiers (bucket-count 4) — 5×1 / 4×1 / 3×3 / 2×1
    E. 6 tiers (bucket-count 5) — 6×1 / 5×1 / 4×1 / 3×1 / 2×1 / 0×1 · merges a tier (2→0 jump, no tiebreak)

just pick <a|b|c> [--pin <song>:<v>] [--cutoff music:<n>] [--reason "…"]

Ballot
    #  Song                      Music  Fit  Combined  Mod  Votes  Comment                                         
    0  Always You                   90   80      85.9    ·      5  9 8                                             
    1  プルミエール                 60   80      73.8    ·      2  6 8                                             
    2  Waves (feat. Simon Domi…      —    —         —    ·      —  ·                                               
    3  BiiiG                        50   30      56.0    ·      1  5 3                                             
    4  午夜宣言                     70   75      76.4    ·      3  7 75                                            
    5  Love in Bloom                75   78      79.3    ·      5  75 78                                           
    6  I Want You                   72   80      78.6    ·      4  72 8                                            
       Total                                                   20                                                  
bridgetbailey@MacBook-Pro:~/dev/music-league-voting-assistant output=''
[main ≡ +0 ~2 -0]$$ just rescore --weights 8:2
node scripts/ml.mjs rescore "$@"
(current round: 2026-08-23-aaa-circle)
Wrote data/analysis/2026-08-23-aaa-circle/music.md
Wrote data/analysis/2026-08-23-aaa-circle/music.json

Up
    #  Song           Music  Fit  Combined  Mod   A   B   C   D   E  Comment                                       
    0  Always You        90   80      82.5    ·   4   5   5   5   6  9 8                                           
    6  I Want You        72   80      79.6    ·   4   4   5   4   5  72 8                                          
    5  Love in Bloom     75   78      79.2    ·   4   3   4   4   4  75 78                                         
    1  プルミエール      60   80      77.6    ·   3   3   3   3   3  6 8                                           
    4  午夜宣言          70   75      77.1    ·   3   3   2   2   2  7 75                                          
    3  BiiiG             50   30      54.1    ·   2   2   1   2   ·  5 3                                           
       Total                                     20  20  20  20  20                                                
    A. 3 tiers (bucket-count 3) — 4×3 / 3×2 / 2×1
    B. 4 tiers (bucket-count 4) — 5×1 / 4×1 / 3×3 / 2×1
    C. 5 tiers (bucket-count 5) — 5×2 / 4×1 / 3×1 / 2×1 / 1×1
    D. 4 tiers (bucket-count 4) — 5×1 / 4×2 / 3×1 / 2×2
    E. 6 tiers (bucket-count 5) — 6×1 / 5×1 / 4×1 / 3×1 / 2×1 / 0×1 · merges a tier (2→0 jump, no tiebreak)

just pick <a|b|c> [--pin <song>:<v>] [--cutoff music:<n>] [--reason "…"]

Ballot
    #  Song                      Music  Fit  Combined  Mod  Votes  Comment                                         
    0  Always You                   90   80      82.5    ·      4  9 8                                             
    1  プルミエール                 60   80      77.6    ·      3  6 8                                             
    2  Waves (feat. Simon Domi…      —    —         —    ·      —  ·                                               
    3  BiiiG                        50   30      54.1    ·      2  5 3                                             
    4  午夜宣言                     70   75      77.1    ·      3  7 75                                            
    5  Love in Bloom                75   78      79.2    ·      4  75 78                                           
    6  I Want You                   72   80      79.6    ·      4  72 8                                            
       Total                                                   20                                                  
bridgetbailey@MacBook-Pro:~/dev/music-league-voting-assistant output=''
[main ≡ +0 ~2 -0]$$ just rescore --weights 6:4
node scripts/ml.mjs rescore "$@"
(current round: 2026-08-23-aaa-circle)
Wrote data/analysis/2026-08-23-aaa-circle/music.md
Wrote data/analysis/2026-08-23-aaa-circle/music.json

Up
    #  Song           Music  Fit  Combined  Mod   A   B   C   D   E  Comment                                       
    0  Always You        90   80      84.7    ·   4   5   5   4   5  9 8                                           
    5  Love in Bloom     75   78      79.2    ·   4   4   4   4   4  75 78                                         
    6  I Want You        72   80      78.9    ·   4   4   4   4   4  72 8                                          
    4  午夜宣言          70   75      76.6    ·   3   3   3   4   4  7 75                                          
    1  プルミエール      60   80      75.1    ·   3   2   3   3   3  6 8                                           
    3  BiiiG             50   30      55.4    ·   2   2   1   1   ·  5 3                                           
       Total                                     20  20  20  20  20                                                
    A. 3 tiers (bucket-count 3) — 4×3 / 3×2 / 2×1
    B. 4 tiers (bucket-count 4) — 5×1 / 4×2 / 3×1 / 2×2
    C. 4 tiers (bucket-count 4) — 5×1 / 4×2 / 3×2 / 1×1 · merges a tier (3→1 jump, no tiebreak)
    D. 3 tiers (bucket-count 3) — 4×4 / 3×1 / 1×1 · merges a tier (3→1 jump, no tiebreak)
    E. 4 tiers (bucket-count 3) — 5×1 / 4×3 / 3×1 / 0×1 · merges a tier (3→0 jump, no tiebreak)

just pick <a|b|c> [--pin <song>:<v>] [--cutoff music:<n>] [--reason "…"]

Ballot
    #  Song                      Music  Fit  Combined  Mod  Votes  Comment                                         
    0  Always You                   90   80      84.7    ·      4  9 8                                             
    1  プルミエール                 60   80      75.1    ·      3  6 8                                             
    2  Waves (feat. Simon Domi…      —    —         —    ·      —  ·                                               
    3  BiiiG                        50   30      55.4    ·      2  5 3                                             
    4  午夜宣言                     70   75      76.6    ·      3  7 75                                            
    5  Love in Bloom                75   78      79.2    ·      4  75 78                                           
    6  I Want You                   72   80      78.9    ·      4  72 8                                            
       Total                                                   20                                                  
bridgetbailey@MacBook-Pro:~/dev/music-league-voting-assistant output=''
[main ≡ +0 ~2 -0]$$ just rescore --pin 0:5
node scripts/ml.mjs rescore "$@"
(current round: 2026-08-23-aaa-circle)
Wrote data/analysis/2026-08-23-aaa-circle/music.md
Wrote data/analysis/2026-08-23-aaa-circle/music.json
  Pins merged 2 identical up option(s).

Up
    #  Song           Music  Fit  Combined  Mod   A   B   C  Comment                                               
    0  Always You        90   80      84.7    ·   5   5   5  9 8                                                   
    5  Love in Bloom     75   78      79.2    ·   4   4   4  75 78                                                 
    6  I Want You        72   80      78.9    ·   4   4   4  72 8                                                  
    4  午夜宣言          70   75      76.6    ·   3   3   4  7 75                                                  
    1  プルミエール      60   80      75.1    ·   3   2   3  6 8                                                   
    3  BiiiG             50   30      55.4    ·   1   2   ·  5 3                                                   
       Total                                     20  20  20                                                        
    A. 3 tiers (bucket-count 3) — 5×1 / 4×2 / 3×2 / 1×1
    B. 4 tiers (bucket-count 4) — 5×1 / 4×2 / 3×1 / 2×2
    C. 3 tiers (bucket-count 3) — 5×1 / 4×3 / 3×1 / 0×1 · merges a tier (3→1 jump, no tiebreak)

just pick <a|b|c> [--pin <song>:<v>] [--cutoff music:<n>] [--reason "…"]

Ballot
    #  Song                      Music  Fit  Combined  Mod  Votes  Comment                                         
    0  Always You                   90   80      84.7    ·      5  9 8                                             
    1  プルミエール                 60   80      75.1    ·      3  6 8                                             
    2  Waves (feat. Simon Domi…      —    —         —    ·      —  ·                                               
    3  BiiiG                        50   30      55.4    ·      1  5 3                                             
    4  午夜宣言                     70   75      76.6    ·      3  7 75                                            
    5  Love in Bloom                75   78      79.2    ·      4  75 78                                           
    6  I Want You                   72   80      78.9    ·      4  72 8                                            
       Total                                                   20                                                  
bridgetbailey@MacBook-Pro:~/dev/music-league-voting-assistant output=''
[main ≡ +0 ~2 -0]$$ just rescore --pin 0:5,3:0
node scripts/ml.mjs rescore "$@"
(current round: 2026-08-23-aaa-circle)
Wrote data/analysis/2026-08-23-aaa-circle/music.md
Wrote data/analysis/2026-08-23-aaa-circle/music.json
  Pins merged 4 identical up option(s).

Up
    #  Song           Music  Fit  Combined  Mod   A  Comment                                                       
    0  Always You        90   80      84.7    ·   5  9 8                                                           
    5  Love in Bloom     75   78      79.2    ·   4  75 78                                                         
    6  I Want You        72   80      78.9    ·   4  72 8                                                          
    4  午夜宣言          70   75      76.6    ·   4  7 75                                                          
    1  プルミエール      60   80      75.1    ·   3  6 8                                                           
    3  BiiiG             50   30      55.4    ·   ·  5 3                                                           
       Total                                     20                                                                
    A. 3 tiers (bucket-count 3) — 5×1 / 4×3 / 3×1 / 0×1

just pick <a|b|c> [--pin <song>:<v>] [--cutoff music:<n>] [--reason "…"]

Ballot
    #  Song                      Music  Fit  Combined  Mod  Votes  Comment                                         
    0  Always You                   90   80      84.7    ·      5  9 8                                             
    1  プルミエール                 60   80      75.1    ·      3  6 8                                             
    2  Waves (feat. Simon Domi…      —    —         —    ·      —  ·                                               
    3  BiiiG                        50   30      55.4    ·      ·  5 3                                             
    4  午夜宣言                     70   75      76.6    ·      4  7 75                                            
    5  Love in Bloom                75   78      79.2    ·      4  75 78                                           
    6  I Want You                   72   80      78.9    ·      4  72 8                                            
       Total                                                   20                                                  
bridgetbailey@MacBook-Pro:~/dev/music-league-voting-assistant output=''
[main ≡ +0 ~2 -0]$$ just rescore --pin 0:6,3:0
node scripts/ml.mjs rescore "$@"
(current round: 2026-08-23-aaa-circle)
Wrote data/analysis/2026-08-23-aaa-circle/music.md
Wrote data/analysis/2026-08-23-aaa-circle/music.json
  Pins merged 3 identical up option(s).

Up
    #  Song           Music  Fit  Combined  Mod   A   B  Comment                                                   
    0  Always You        90   80      84.7    ·   6   6  9 8                                                       
    5  Love in Bloom     75   78      79.2    ·   4   4  75 78                                                     
    6  I Want You        72   80      78.9    ·   4   4  72 8                                                      
    4  午夜宣言          70   75      76.6    ·   3   4  7 75                                                      
    1  プルミエール      60   80      75.1    ·   3   2  6 8                                                       
    3  BiiiG             50   30      55.4    ·   ·   ·  5 3                                                       
       Total                                     20  20                                                            
    A. 3 tiers (bucket-count 3) — 6×1 / 4×2 / 3×2 / 0×1
    B. 3 tiers (bucket-count 3) — 6×1 / 4×3 / 2×1 / 0×1 · merges a tier (3→1 jump, no tiebreak)

just pick <a|b|c> [--pin <song>:<v>] [--cutoff music:<n>] [--reason "…"]

Ballot
    #  Song                      Music  Fit  Combined  Mod  Votes  Comment                                         
    0  Always You                   90   80      84.7    ·      6  9 8                                             
    1  プルミエール                 60   80      75.1    ·      3  6 8                                             
    2  Waves (feat. Simon Domi…      —    —         —    ·      —  ·                                               
    3  BiiiG                        50   30      55.4    ·      ·  5 3                                             
    4  午夜宣言                     70   75      76.6    ·      3  7 75                                            
    5  Love in Bloom                75   78      79.2    ·      4  75 78                                           
    6  I Want You                   72   80      78.9    ·      4  72 8                                            
       Total                                                   20             

---
I think we already forbid all-same-score candidates. But all 1s with a single 2 is also bad and should not be allowed. and it would be common with the admins who set the point limit equal to the number of participants (the point you can't give to your own song goes to the extra one). one strong negative is assigning a point to every song - effectively cancels each other out. And the other is lack of tiers, too close to flat.

Wrote data/analysis/2026-10-06-vim-26-jan/music.json

Up
     #  Song                      Score   Mod   A   B   C   D   E  Comment
     4  Will We Be There             78     ·   2   2   2   2   3  78
    14  make you mine                77  play   2   1   2   2   3  77 play
    17  Yalla Habibi               76.5     ·   2   1   2   1   3  765
     1  Quicksand Heart              76     ·   2   1   1   1   2  76
    15  Day at the soccer fields   75.7     ·   2   1   1   1   2  757
     2  Magic Touch                75.7     ·   2   1   1   1   2  757
    12  Bruised Sky                75.2     ·   2   1   1   1   2  752 great except for the screaming
     8  Enough                     74.9     ·   1   1   1   1   1  749
     6  Ev'ry Portal Past          74.7     ?   1   1   1   1   1  747? cool instrumental. kinda weird but cool
     5  Good Things Will Come A…   74.7     ·   1   1   1   1   1  747 smooth
    20  I OWE IT TO YOU            74.5     ·   1   1   1   1   1  745
     7  Crash Down Feeling         73.7     ·   1   1   1   1   ·  737
     0  Savage Sword               73.7     ·   1   1   1   1   ·  737
    19  Zig Zag                    73.7     ?   1   1   1   1   ·  737? rap. actually pretty nice chill vibe. repetitive but not painful even after 7 minutes
    10  Biograph                   73.5     +   ·   1   1   1   ·  735+ don't love the vocals or guitar. but fun energy
    18  Saia-Amarela               73.5     ?   ·   1   1   1   ·  735? weird but not bad? 7 minutes though. Fun to have not english. mildly annoying bits
    16  Crows                        73     ·   ·   1   1   1   ·  73
    11  Oranj                        73     ·   ·   1   1   1   ·  73 nice enough but doesn't go anywhere
     3  No Touch                     70     ·   ·   1   ·   1   ·  7
    13  Stainless Steel              67     ?   ·   1   ·   ·   ·  67? like the instrumental but hate the talking
        Total                                  21  21  21  21  21
    A. 3 tiers (bucket-count 2) — 2×7 / 1×7 / 0×6
    B. 2 tiers (bucket-count 2) — 2×1 / 1×19
    C. 3 tiers (bucket-count 2) — 2×3 / 1×15 / 0×2
    D. 3 tiers (bucket-count 2) — 2×2 / 1×17 / 0×1
    E. 4 tiers (bucket-count 3) — 3×3 / 2×4 / 1×4 / 0×9
    ---
    Wwe've clarified this before. A random number hidden in a sentence is not a score. If the first thing in the text box is not a number, there is no score and that's just a DQ comment. I know it may be adjustable to have like 'music 8, fit 7' as a format. But that's not really a format I use. I'll type the word fit maybe but never music. Tighten up this parsing logic.

    Wrote data/analysis/2026-10-12-sm-bridge/music.json

Up
     #  Song                      Score  Mod   A   B   C   D   E  Comment
     4  Broken Melodies              78    ·   3   3   3   2   3  78
     5  Make A Wish (Birthday S…   76.5    ·   2   3   2   2   3  765
     0  100                          76    ·   2   2   2   2   3  76
    10  Love In The Ice            75.5    ·   2   2   2   2   2  755
     8  Drama                      74.5    ·   1   1   2   2   2  745
     2  Beatbox                      74    ·   1   1   1   1   1  74
     6  Chain                        74    ·   1   1   1   1   1  74
     7  Armageddon                   73    ·   1   1   1   1   ·  73
     1  Everybody                    73    ·   1   1   1   1   ·  73
     9  Monster                      30    ·   1   ·   ·   1   ·  Great song, but it already got 3rd place in the vocal round
---
ignored the cutoff and didn't even call out that it did so.
also could have used full width of the terminal instead of chopping song titles off. The longest line wasn't even using 2/3 of the space. truncating title is better than truncating comment. but if they both fit no need to truncate either one.
would be great to add more tier knobs like 2 minimum or 4 maximum. Caps like max points 3. Things to nudge it in the right direction. Again like I've said in other notes - ideally this would re-generate more options matching the constraints. Not just filter the existing ones. Another knob could be "include scores 77 and higher in favorite tier and assign that tier 3 points each", to cut down on individual pinning when trying things out. Or shortcuts like I give you the 2×5 / 1×11 / 0×2 notation and you apply that set of scores to the songs (again faster than individual pins)
And it would be awesome when there are lots of tied scores like this to propose alternative options based on the modifiers (e.g. try a question mark in the group above and the group below) or hypothetical "if you can pick 1 73.5 song to promote, here's a better point spread option". Ideally with an interactive prompt to quickly capture which one to promote, or a comma-separated list if it wants multiple.

     ❯ just rescore --cutoff music:73
node scripts/ml.mjs rescore "$@"
(current round: 2026-10-12-vim-26-feb)
Wrote data/analysis/2026-10-12-vim-26-feb/music.md
Wrote data/analysis/2026-10-12-vim-26-feb/music.json

Up
     #  Song                      Score    Mod   A   B   C   D   E  Comment
     7  Djinê Mogo Tiki              78   play   2   2   3   4   4  78 play
     1  On & On                      78  play?   2   2   3   4   4  78 play? Gina?
    10  Sugar Clouds                 78   play   2   2   3   4   4  78 play
     2  Major Threat                 76      ·   2   1   3   3   3  76
     4  Your Good Time             75.5      ·   2   1   3   3   2  755
     0  Feed My Head - Acoustic    74.5      ·   1   1   2   2   1  745
    15  Think About It               74      ·   1   1   2   1   1  74
    13  Damp                       73.7      +   1   1   1   ·   1  737+
     9  Wait Up (feat. I'm With…   73.6      ·   1   1   1   ·   1  736
    12  Orange County (feat. Bi…   73.5     +?   1   1   ·   ·   ·  735+?
    18  The Wire                   73.5     +?   1   1   ·   ·   ·  735+?
    14  Anywhere                   73.5      ·   1   1   ·   ·   ·  735 cute. pleasant. tiny bit annoying
     6  promise                    73.5      ?   1   1   ·   ·   ·  735? not bad punk I guess but kinda too loud or dischordant
    11  That White Cat             73.5      ?   1   1   ·   ·   ·  735? like some choral parts but too talky overall
     8  Norf Side (feat. Tierra…   73.5      -   1   1   ·   ·   ·  735-
    16  Clean Living               73.3      ·   1   1   ·   ·   ·  733
     3  messer                       73      ·   ·   1   ·   ·   ·  73
    19  w-w-w-w-w                    73      -   ·   1   ·   ·   ·  73-
     5  After I'm Gone                -     DQ   -   -   -   -   -  no
        Total                                   21  21  21  21  21
    A. 3 tiers (bucket-count 2) — 2×5 / 1×11 / 0×2
    B. 2 tiers (bucket-count 2) — 2×3 / 1×15
    C. 4 tiers (bucket-count 3) — 3×5 / 2×2 / 1×2 / 0×9
    D. 5 tiers (bucket-count 4) — 4×3 / 3×2 / 2×1 / 1×1 / 0×11
    E. 5 tiers (bucket-count 4) — 4×3 / 3×1 / 2×1 / 1×4 / 0×9

    The tiers at the bottom didn't update after pinning changed their values.

    ❯ just rescore --pin 7:3,1:3,10:3 --cutoff music:73.5
node scripts/ml.mjs rescore "$@"
(current round: 2026-10-12-vim-26-feb)
Wrote data/analysis/2026-10-12-vim-26-feb/music.md
Wrote data/analysis/2026-10-12-vim-26-feb/music.json

Up
     #  Song                      Score    Mod   A   B   C   D   E  Comment
     7  Djinê Mogo Tiki              78   play   3   3   3   3   3  78 play
     1  On & On                      78  play?   3   3   3   3   3  78 play? Gina?
    10  Sugar Clouds                 78   play   3   3   3   3   3  78 play
     2  Major Threat                 76      ·   3   3   3   2   3  76
     4  Your Good Time             75.5      ·   3   3   2   2   3  755
     0  Feed My Head - Acoustic    74.5      ·   2   2   1   2   3  745
    15  Think About It               74      ·   2   1   1   1   2  74
    13  Damp                       73.7      +   1   1   1   1   1  737+
     9  Wait Up (feat. I'm With…   73.6      ·   1   1   1   1   ·  736
    12  Orange County (feat. Bi…   73.5     +?   ·   1   1   1   ·  735+?
    18  The Wire                   73.5     +?   ·   ·   1   1   ·  735+?
    14  Anywhere                   73.5      ·   ·   ·   1   1   ·  735 cute. pleasant. tiny bit annoying
     6  promise                    73.5      ?   ·   ·   ·   ·   ·  735? not bad punk I guess but kinda too loud or dischordant
    11  That White Cat             73.5      ?   ·   ·   ·   ·   ·  735? like some choral parts but too talky overall
     8  Norf Side (feat. Tierra…   73.5      -   ·   ·   ·   ·   ·  735-
     3  messer                       73      ·   -   -   -   -   -  73
     5  After I'm Gone                -     DQ   -   -   -   -   -  no
    16  Clean Living               73.3      ·   -   -   -   -   -  733
    19  w-w-w-w-w                    73      -   -   -   -   -   -  73-
        Total                                   21  21  21  21  21
    A. 4 tiers (bucket-count 3) — 3×5 / 2×2 / 1×2 / 0×6
    B. 5 tiers (bucket-count 4) — 3×5 / 2×1 / 1×4 / 0×5
    C. 5 tiers (bucket-count 4) — 3×4 / 2×1 / 1×7 / 0×3
    D. 2 tiers (bucket-count 2) — 3×3 / 2×3 / 1×6 / 0×3
    E. 4 tiers (bucket-count 3) — 3×6 / 2×1 / 1×1 / 0×7

    Now it forgot my previous pins. Do I have to resend them all each time?

    ❯ just rescore --pin 14:0

    Up
     #  Song                      Score    Mod   A   B   C   D   E  Comment
     7  Djinê Mogo Tiki              78   play   3   4   4   2   3  78 play
     1  On & On                      78  play?   3   4   4   2   3  78 play? Gina?
    10  Sugar Clouds                 78   play   3   4   4   2   3  78 play
     2  Major Threat                 76      ·   3   3   3   2   3  76
     4  Your Good Time             75.5      ·   3   3   2   2   3  755
     0  Feed My Head - Acoustic    74.5      ·   2   2   1   2   3  745
    15  Think About It               74      ·   2   1   1   2   2  74
    13  Damp                       73.7      +   1   ·   1   1   1  737+
     9  Wait Up (feat. I'm With…   73.6      ·   1   ·   1   1   ·  736
    12  Orange County (feat. Bi…   73.5     +?   ·   ·   ·   1   ·  735+?
    18  The Wire                   73.5     +?   ·   ·   ·   1   ·  735+?
    14  Anywhere                   73.5      ·   ·   ·   ·   ·   ·  735 cute. pleasant. tiny bit annoying
     6  promise                    73.5      ?   ·   ·   ·   1   ·  735? not bad punk I guess but kinda too loud or dischordant
    11  That White Cat             73.5      ?   ·   ·   ·   1   ·  735? like some choral parts but too talky overall
     8  Norf Side (feat. Tierra…   73.5      -   ·   ·   ·   1   ·  735-
     3  messer                       73      ·   -   -   -   -   -  73
     5  After I'm Gone                -     DQ   -   -   -   -   -  no
    16  Clean Living               73.3      ·   -   -   -   -   -  733
    19  w-w-w-w-w                    73      -   -   -   -   -   -  73-
        Total                                   21  21  21  21  21
    A. 4 tiers (bucket-count 3) — 3×5 / 2×2 / 1×2 / 0×6
    B. 5 tiers (bucket-count 4) — 4×3 / 3×2 / 2×1 / 1×1 / 0×8
    C. 5 tiers (bucket-count 4) — 4×3 / 3×1 / 2×1 / 1×4 / 0×6
    D. 2 tiers (bucket-count 2) — 2×7 / 1×4 / 0×1 / 1×3
    E. 4 tiers (bucket-count 3) — 3×6 / 2×1 / 1×1 / 0×7

    Extra misleading to print the wrong bucket count and curve shape when the pick is only in ballot form so it's hard to count and double check the shape myself.

    ❯ just pick d
node scripts/ml.mjs pick "$@"
(current round: 2026-10-12-vim-26-feb)
Applied option D — 2 tiers, 2×6 / 1×9.
Wrote data/analysis/2026-10-12-vim-26-feb/music.md
Wrote data/analysis/2026-10-12-vim-26-feb/music.json

Applied
     #  Song                      Score    Mod  Votes  Comment
     0  Feed My Head - Acoustic    74.5      ·      2  745
     1  On & On                      78  play?      3  78 play? Gina?
     2  Major Threat                 76      ·      2  76
     3  messer                       73      ·      ·  73
     4  Your Good Time             75.5      ·      2  755
     5  After I'm Gone                -     DQ      -  no
     6  promise                    73.5      ?      ·  735? not bad punk I guess but kinda too loud or dischordant
     7  Djinê Mogo Tiki              78   play      3  78 play
     8  Norf Side (feat. Tierra…   73.5      -      ·  735-
     9  Wait Up (feat. I'm With…   73.6      ·      1  736
    10  Sugar Clouds                 78   play      3  78 play
    11  That White Cat             73.5      ?      ·  735? like some choral parts but too talky overall
    12  Orange County (feat. Bi…   73.5     +?      1  735+?
    13  Damp                       73.7      +      1  737+
    14  Anywhere                   73.5      ·      ·  735 cute. pleasant. tiny bit annoying
    15  Think About It               74      ·      2  74
    16  Clean Living               73.3      ·      ·  733
    17  Still Rose                    —      ·      —  ·
    18  The Wire                   73.5     +?      1  735+?
    19  w-w-w-w-w                    73      -      ·  73-
        Total                                      21
    ---


---
pins and cutoffs should have the same shorthand parsing as everywhere else.
[main ≡ +0 ~2 -0]$$ just rescore --cutoff music:737
node scripts/ml.mjs rescore "$@"
(current round: 2026-09-21-5th-gen-gg)
Wrote data/analysis/2026-09-21-5th-gen-gg/music.md
Wrote data/analysis/2026-09-21-5th-gen-gg/music.json

Notes
  Awarded 10 leftover point(s) to gated-out, blank-score, or disqualified songs so the votes total the budget (10). Reassign if you'd rather place them elsewhere.

Ballot
     #  Song                     Score   Mod  Votes  Comment                                                       
     0  Magnetic                    73     ·      1  73                                                            
     1  404 (New Era)               70     ·      ·  7                                                             
     2  Dopamine(UNIS Ver.)       75.5     ·      1  755                                                           
     3  NAIL (feat. Lolo Zouaï)     77     ·      1  77                                                            
     4  VISA                        74     ?      1  74?? don't love the rap but do like some parts                
     5  Blue Blood                  75     +      1  75+                                                           
     6  Starlight                   75     ·      1  75                                                            
     7  DROP TOP                    73     +      1  73+                                                           
     8  OXY                         76  play      1  76 play                                                       
     9  Plot Twist                74.5     ·      1  745                                                           
    10  FOCUS                     73.5     ·      1  735 like everything except the chorus                         
    11  BADVILLAIN                   —     ·      —  ·                                                             
    12  Pinball                     73     ·      ·  73                                                            
        Total                                    10                                                                
Warning: no upvote option menu surfaced — budget may be unallocatable.
bridgetbailey@MacBook-Pro:~/dev/music-league-voting-assistant output=''
[main ≡ +0 ~2 -0]$$ 
---
adding a score should also clear the DQ qualifier that was only there because the song had no score. I wouldn't manually add a score unless I wanted to count the song. --score is precisely for this case where I forgot or want to adjust a score but don't want to re-export the full thing. I should also be able to set a song to DQ via --score.
Then I did export and ran save-round but it didn't save the new version. Parse produced the old blank score.
Other commands failing. Odd over budget message.
ah part of the problem is save-round using the plain slug not the date version. it made 2 copies (one with date and one without) and confused things.

[main ≡ +0 ~2 -0]$$ just rescore --score 10:75.5
node scripts/ml.mjs rescore "$@"
(current round: 2026-09-27-lfm-4)
Wrote data/analysis/2026-09-27-lfm-4/music.md
Wrote data/analysis/2026-09-27-lfm-4/music.json
Reset committed pick to draft — re-run just pick to commit a distribution.

Up
     #  Song                      Score  Mod   A   B   C   D   E  Comment
    16  Heathens                     77    ·   2   3   3   3   4  77
     5  The Lonely One               77    ·   2   3   3   3   4  77
     0  Easy On Me                   76    ·   1   2   3   1   2  76
    12  HAYABUSA                     76    ·   1   2   3   1   2  76
     6  Turbine Blue                 76    ·   1   2   3   1   2  76
     7  Coming Undone                75    -   1   1   ·   1   1  75-
    11  Happier Than Ever          74.7    ·   1   1   ·   1   ·  747
     1  Holy Fucking Shit: 40,0…   74.7    ·   1   1   ·   1   ·  747
    18  Walk, Don't Run              74    +   1   ·   ·   1   ·  74+
     2  Letting Go                   74    ·   1   ·   ·   1   ·  74 inoffensive but boring and long
     3  Pieces                       74    ?   1   ·   ·   1   ·  74? not sure if better or worse than the boring one. definitely punk. meh vocals
    19  I'm Not Okay (I Promise)   73.9    ·   1   ·   ·   ·   ·  739
     4  Sunday - Remastered 2026   73.6    ·   1   ·   ·   ·   ·  736
     9  Human Nature                 73    ·   ·   ·   ·   ·   ·  73
    13  Night Fever - From "Sat…     73    ?   ·   ·   ·   ·   ·  73?
    15  Please, Please, Please,…     73    ?   ·   ·   ·   ·   ·  73? made no impression
    17  PRIDE.                       73    ·   ·   ·   ·   ·   ·  73
    14  Stress Builds Character      70    ·   ·   ·   ·   ·   ·  7
    10  Gymnopédie No. 1. Lent …   75.5   DQ   -   -   -   -   -  One of the few songs I actually know on this list. It's in a lot of soundtracks
        Total                                 15  15  15  15  15
    A. 3 tiers (bucket-count 2) — 2×2 / 1×11 / 0×5
    B. 4 tiers (bucket-count 3) — 3×2 / 2×3 / 1×3 / 0×10
    C. 2 tiers (bucket-count 1) — 3×5 / 0×13 · merges a tier (3→0 jump, no tiebreak)
    D. 3 tiers (bucket-count 2) — 3×2 / 1×9 / 0×7 · merges a tier (3→1 jump, no tiebreak)
    E. 4 tiers (bucket-count 3) — 4×2 / 2×3 / 1×1 / 0×12 · merges a tier (4→2 jump, no tiebreak)

    also favorite-band isn't working and getting an odd over budget warning

    [main ≡ +0 ~2 -0]$$ just parse lfm-4
node scripts/ml.mjs parse "$@"
  ! skip merge data/rounds/lfm-4.html: data/rounds/2026-09-27-lfm-4.html already exists
  merged lfm-4 → 2026-09-27-lfm-4
Wrote data/analysis/2026-09-27-lfm-4/music.md
Wrote data/analysis/2026-09-27-lfm-4/music.json

League: lfm-<topic> — Last.fm listening-stats prompts (top tracks, alliteration, curses, …).
  ⚠ Query the generated Last.fm tables with the scan scripts, never raw grep (spec/lastfm-data.md, no-grep-csvs rule).
  $ node scripts/lastfm-aggregate.mjs
      Regenerate the Last.fm reference tables in data/ref/lastfm/ (title-table via table-map.json).
  $ node scripts/lastfm-export.mjs
      Export raw Last.fm scrobble data feeding the aggregate tables.
  See: spec/leagues.md

⛔ OVER BUDGET: upvotes 18/15. Exceeding a bank is never a valid ballot — rebalance so each bank totals exactly (pins, or caps × eligible slots, may block full spend).

Up
     #  Song                      Score  Mod   A   B   C   D   E  Comment
    16  Heathens                     77    ·   2   3   2   3   4  77
     5  The Lonely One               77    ·   2   3   2   3   4  77
     0  Easy On Me                   76    ·   1   2   2   3   2  76
    12  HAYABUSA                     76    ·   1   2   2   3   2  76
     6  Turbine Blue                 76    ·   1   2   2   3   2  76
    10  Gymnopédie No. 1. Lent …   75.5    ·   1   2   2   ·   1  75.5
     7  Coming Undone                75    -   1   1   1   ·   ·  75-
    11  Happier Than Ever          74.7    ·   1   ·   1   ·   ·  747
     1  Holy Fucking Shit: 40,0…   74.7    ·   1   ·   1   ·   ·  747
    18  Walk, Don't Run              74    +   1   ·   ·   ·   ·  74+
     2  Letting Go                   74    ·   1   ·   ·   ·   ·  74 inoffensive but boring and long
     3  Pieces                       74    ?   1   ·   ·   ·   ·  74? not sure if better or worse than the boring one. definitely punk. meh vocals
    19  I'm Not Okay (I Promise)   73.9    ·   1   ·   ·   ·   ·  739
     4  Sunday - Remastered 2026   73.6    ·   ·   ·   ·   ·   ·  736
     9  Human Nature                 73    ·   ·   ·   ·   ·   ·  73
    13  Night Fever - From "Sat…     73    ?   ·   ·   ·   ·   ·  73?
    15  Please, Please, Please,…     73    ?   ·   ·   ·   ·   ·  73? made no impression
    17  PRIDE.                       73    ·   ·   ·   ·   ·   ·  73
    14  Stress Builds Character      70    ·   ·   ·   ·   ·   ·  7
        Total                                 15  15  15  15  15
    A. 3 tiers (bucket-count 2) — 2×2 / 1×11 / 0×6
    B. 4 tiers (bucket-count 3) — 3×2 / 2×4 / 1×1 / 0×12
    C. 3 tiers (bucket-count 2) — 2×6 / 1×3 / 0×10
    D. 2 tiers (bucket-count 1) — 3×5 / 0×14 · merges a tier (3→0 jump, no tiebreak)
    E. 4 tiers (bucket-count 3) — 4×2 / 2×3 / 1×1 / 0×13 · merges a tier (4→2 jump, no tiebreak)

just pick <a|b|c> [--pin <song>:<v>] [--cutoff music:<n>] [--reason "…"]

Notes
  ⛔ OVER BUDGET: upvotes 18/15. Exceeding a bank is never a valid ballot — rebalance so each bank totals exactly (pins, or caps × eligible slots, may block full spend).

Ballot
     #  Song                      Score  Mod  Votes  Comment
     0  Easy On Me                   76    ·      1  76
     1  Holy Fucking Shit: 40,0…   74.7    ·      1  747
     2  Letting Go                   74    ·      1  74 inoffensive but boring and long
     3  Pieces                       74    ?      1  74? not sure if better or worse than the boring one. definitely punk. meh vocals
     4  Sunday - Remastered 2026   73.6    ·      ·  736
     5  The Lonely One               77    ·      2  77
     6  Turbine Blue                 76    ·      1  76
     7  Coming Undone                75    -      1  75-
     8  View                          —    ·      —  ·
     9  Human Nature                 73    ·      ·  73
    10  Gymnopédie No. 1. Lent …   75.5    ·      1  75.5
    11  Happier Than Ever          74.7    ·      1  747
    12  HAYABUSA                     76    ·      1  76
    13  Night Fever - From "Sat…     73    ?      ·  73?
    14  Stress Builds Character      70    ·      ·  7
    15  Please, Please, Please,…     73    ?      ·  73? made no impression
    16  Heathens                     77    ·      2  77
    17  PRIDE.                       73    ·      ·  73
    18  Walk, Don't Run              74    +      1  74+
    19  I'm Not Okay (I Promise)   73.9    ·      1  739
        Total                                    15
bridgetbailey@MacBook-Pro:~/dev/music-league-voting-assistant output=''
[main ≡ +0 ~2 -0]$$ just rescore --favorite-band 76
node scripts/ml.mjs rescore "$@"
(current round: lfm-4)
Could not read data/analysis/lfm-4/music.json: ENOENT: no such file or directory, open 'data/analysis/lfm-4/music.json'. Run just parse first.
error: recipe `rescore` failed on line 35 with exit code 1
bridgetbailey@MacBook-Pro:~/dev/music-league-voting-assistant output=''
[main ≡ +0 ~2 -0]$$ just pick c
node scripts/ml.mjs pick "$@"
(current round: lfm-4)
Could not read data/analysis/lfm-4/music.json: ENOENT: no such file or directory, open 'data/analysis/lfm-4/music.json'. Run just parse first.
error: recipe `pick` failed on line 31 with exit code 1
bridgetbailey@MacBook-Pro:~/dev/music-league-voting-assistant output=''

---
Still not a great experience trying to nudge the curve options towards what I want. If I pin something like tier-count, I expect it to reflow and give me more options, not just cut all the ones that don't already match that tiercount. If the one I wanted was already an option, I wouldn't be using rescore. I need it to try more things like merging decimal scores into the other neighboring tier or moving songs with +/- modifiers to a different tier. If it's really not possible, maybe point to where the issue is like 'too may songs at 76, please refine those scores and try again'.
Also double check how rescore interacts with a supplied cutoff. The cutoff is already creating a bunch of 0-point songs. So no need for the curve to keep a 0-tier among the remaining songs, which it could be doing based on how it interprets that. Same for original scoring that has some DQs. If enough songs are disqualified, I probably want to reward every valid song with at least one point. The DQ tier becomes the 0 tier. It shouldn't be completely discounted in the algorithm as if those songs don't exist and we still need a 0 tier above that.

[main ≡ +0 ~2 -0]$$ just rescore --cutoff music:74
node scripts/ml.mjs rescore "$@"
(current round: 2026-10-11-lfm-halloween-oct-2025)
Wrote data/analysis/2026-10-11-lfm-halloween-oct-2025/music.md
Wrote data/analysis/2026-10-11-lfm-halloween-oct-2025/music.json

Up
     #  Song                      Score  Mod   A   B   C   D   E  Comment
    13  Mosquitoes                   76    ·   2   3   3   3   3  76
    17  Romance                      76    ·   2   3   3   3   3  76
    15  St. James Infirmary          76    ·   2   3   3   3   2  76
    16  we fell in love in octo…     76    ·   2   3   3   2   2  76
     2  In The End                 75.5    +   2   1   2   2   2  755+
    12  Girls My Age               75.5    ·   2   1   1   1   2  755
     3  Thirteen                     75    ·   2   1   ·   1   1  75
     5  Hallowed Be Thy Name - …   74.7    ·   1   ·   ·   ·   ·  747
     9  Leaving Shire              74.5    ·   ·   ·   ·   ·   ·  745 inst
     8  Magnificent Seventies      74.5    ?   ·   ·   ·   ·   ·  745? do do do do do is nice enough but 9 minutes???
    11  Glycerine - Remastered       74    ·   ·   ·   ·   ·   ·  74
    14  Hells Bells                  74    ·   ·   ·   ·   ·   ·  74
     0  Poltergeist                73.5    ·   -   -   -   -   -  735
     1  In My Secret Place           72    ·   -   -   -   -   -  72
     4  Above The Clouds           73.5    ·   -   -   -   -   -  735
     6  I Got Heaven                 73    ·   -   -   -   -   -  73
     7  (Forever) Live And Die     73.7    ?   -   -   -   -   -  737? nicer but might be more boring than the 35s
    10  Last Caress - C.I. Reco…   73.1    ·   -   -   -   -   -  731
    18  I Did Something Weird L…     60    ·   -   -   -   -   -  6
        Total                                 15  15  15  15  15
    A. 3 tiers (bucket-count 2) — 2×7 / 1×1 / 0×4
    B. 3 tiers (bucket-count 2) — 3×4 / 1×3 / 0×5 · merges a tier (3→1 jump, no tiebreak)
    C. 4 tiers (bucket-count 3) — 3×4 / 2×1 / 1×1 / 0×6
    D. 4 tiers (bucket-count 3) — 3×3 / 2×2 / 1×2 / 0×5 · needs a tiebreak (splits 1 tie)
    E. 4 tiers (bucket-count 3) — 3×2 / 2×4 / 1×1 / 0×5 · needs a tiebreak (splits 1 tie)

    
[main ≡ +0 ~2 -0]$$ just rescore --tier-count 3
node scripts/ml.mjs rescore "$@"
(current round: 2026-10-11-lfm-halloween-oct-2025)
Wrote data/analysis/2026-10-11-lfm-halloween-oct-2025/music.md
Wrote data/analysis/2026-10-11-lfm-halloween-oct-2025/music.json

Up
     #  Song                      Score  Mod   A  Comment
    13  Mosquitoes                   76    ·   2  76
    17  Romance                      76    ·   2  76
    15  St. James Infirmary          76    ·   2  76
    16  we fell in love in octo…     76    ·   2  76
     2  In The End                 75.5    +   2  755+
    12  Girls My Age               75.5    ·   2  755
     3  Thirteen                     75    ·   2  75
     5  Hallowed Be Thy Name - …   74.7    ·   1  747
     9  Leaving Shire              74.5    ·   ·  745 inst
     8  Magnificent Seventies      74.5    ?   ·  745? do do do do do is nice enough but 9 minutes???
    11  Glycerine - Remastered       74    ·   ·  74
    14  Hells Bells                  74    ·   ·  74
     0  Poltergeist                73.5    ·   -  735
     1  In My Secret Place           72    ·   -  72
     4  Above The Clouds           73.5    ·   -  735
     6  I Got Heaven                 73    ·   -  73
     7  (Forever) Live And Die     73.7    ?   -  737? nicer but might be more boring than the 35s
    10  Last Caress - C.I. Reco…   73.1    ·   -  731
    18  I Did Something Weird L…     60    ·   -  6
        Total                                 15
    A. 3 tiers (bucket-count 2) — 2×7 / 1×1 / 0×4


Also definitely need a reset option since it's hard to undo those command tweaks. I think re-parse might work but a flag on rescore would be good. potentially with optons to keep manual scores but clear algorithm flags like tier-count and cutoff. That could be default and an extra param to ALSO clear score, or use parse for that.
This attempt to bump the cutoff back up seems to have ignored me. Maybe again it doesn't actually reflow, just filters the existing options, maybe with a limit to keep one? idk why it did nothing. I just want my original options back to see if cutoff is what messed it up. I already changed cutoff lower and that didn't reflow anything since there was only one candidate left. I need each of these changes to allow options to come back if they now fit the critera. Not constantly narrow with no undo option.

[main ≡ +0 ~2 -0]$$ just rescore --tier-count 4
node scripts/ml.mjs rescore "$@"
(current round: 2026-10-11-lfm-halloween-oct-2025)
Wrote data/analysis/2026-10-11-lfm-halloween-oct-2025/music.md
Wrote data/analysis/2026-10-11-lfm-halloween-oct-2025/music.json

Up
     #  Song                      Score  Mod   A  Comment
    13  Mosquitoes                   76    ·   2  76
    17  Romance                      76    ·   2  76
    15  St. James Infirmary          76    ·   2  76
    16  we fell in love in octo…     76    ·   2  76
     2  In The End                 75.5    +   2  755+
    12  Girls My Age               75.5    ·   2  755
     3  Thirteen                     75    ·   2  75
     5  Hallowed Be Thy Name - …   74.7    ·   1  747
     9  Leaving Shire              74.5    ·   ·  745 inst
     8  Magnificent Seventies      74.5    ?   ·  745? do do do do do is nice enough but 9 minutes???
    11  Glycerine - Remastered       74    ·   ·  74
    14  Hells Bells                  74    ·   ·  74
     7  (Forever) Live And Die     73.7    ?   ·  737? nicer but might be more boring than the 35s
     4  Above The Clouds           73.5    ·   ·  735
     0  Poltergeist                73.5    ·   ·  735
     1  In My Secret Place           72    ·   -  72
     6  I Got Heaven                 73    ·   -  73
    10  Last Caress - C.I. Reco…   73.1    ·   -  731
    18  I Did Something Weird L…     60    ·   -  6
        Total                                 15
    A. 3 tiers (bucket-count 2) — 2×7 / 1×1 / 0×7

    Option A should have called out a tiebreak here. question mark coud go up or down, should prompt which song on the next tier gets the extra point or at least call it out so I can pin.
---