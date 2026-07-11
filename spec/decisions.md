# Decision Log

Why the tools behave the way they do — and what we tried and rejected along the
way. The other `spec/` files say **what** the current behavior is; this file is
the running history of **how we got there**, so a decision that was reversed (or
nearly reversed) doesn't get silently re-litigated every few rounds.

## How to maintain this

See [`.cursor/rules/decision-log.mdc`](../.cursor/rules/decision-log.mdc) for format and when to add entries.

---

## 2026-07-10 — `--pin i:0` forces a song to zero on both axes

**Change.** A pin of `0` (`--pin 6:0`) now means "no vote of any kind": `parsePins`
(`scripts/parse/cli-flags.mjs`) routes it to **both** `overrides[i] = 0` and
`downOverrides[i] = 0`, and `allocateDownvotes` (`scripts/score/allocate.mjs`) treats a
finite down override `>= 0` (not just `> 0`) as pinned, so a `:0` song is committed at
zero and excluded from the down pool (its shape downvote flows to the rest of the bank).
Previously `i:0` fell into the upvote branch as a `0` up-pin, a no-op that left the song's
shape downvote in place.

**Why.** With two songs tied on combined score, the flat/curved down shape downvotes one
arbitrarily; the owner needs a way to say "not this one" and push the downvote to the tie
partner. `:0` is the natural "force zero" pin for that. (Related gap logged in
`future-plans` Bugs #4: tied scores straddling a vote-tier boundary should also emit a
tie-split callout.)

**Refs.** `working tree` — `scripts/parse/cli-flags.mjs`, `scripts/score/allocate.mjs`,
`tests/score.test.mjs`.

---

## 2026-07-10 — Pin comparison: one shared up+down net table

**Change.** The `pick` pin comparison is now a single shared table instead of an
upvote-only `A (original)` / `A (altered)` pair. It ranks every non-own song by
combined (or music) score and shows signed net votes (`+up` / `-down` / `·`) in an
`Original` column (the chosen up option **+** chosen down shape, with **no** pins on
either axis) and an `Altered` column (the applied ballot). Every net change — up or
down — is listed as one diff (`#i Title: <orig> → <alt>`). The header names the combo
(`A cv + pin`). `hadPins` now counts **down** pins too (`hasAnyPins`), so a
downvote-only pin still renders the comparison and no longer prints a false "Pins
produced no changes". The clean baseline comes from `applyOptionPick` forcing the
option's own up split with empty `downOverrides` (down eligibility depends on the up
split), captured before the pinned reallocation; its `reallocate` closures take an
explicit `downOverrides` argument.

**Why.** With downvote pins the old output was misleading: down-only pins skipped the
table entirely (`hadPins` only saw upvote overrides), the table showed only upvotes,
and it recomputed option A _from_ the pins so the "original" didn't match the menu A.
The owner asked for the combo `A + cv` as the baseline and the pin diffs measured
against it — "merge that table as if it's like the ballot but ranked in combined-score
order, apply both original picks, then see what the diffs are."

**Refs.** `working tree` — `scripts/round/pick.mjs`, `scripts/pick-round.mjs`,
`scripts/parse/cli-print.mjs`, `scripts/parse/cli-table.mjs`, `tests/cli-print.test.mjs`.

---

## 2026-07-10 — Split fit flags: `--fit [tier|gate]` + auto-detected numeric fit

**Change.** `--fit-words` (which bundled tier words, gate words, and a bare 2nd number)
is replaced on `parse` by `--fit` / `--fit gate`. `--fit` (or `--fit tier`) scans tier
words only; `--fit gate` scans gate words only; only the literal `tier`/`gate` is consumed
as the flag value so a following round name is safe. `--fit-words` remains a silent alias
for `--fit tier`. The old deprecated `--fit <fit.json>` merge flag on parse is removed (merge
lives on `just merge`). `scoreComment` opts are now `{ tierWords, gateWords, numericFit }`
(legacy `fitWords` still accepted → all three on). A bare 2nd number is always surfaced as
`fitNumberCandidate`; new `applyNumericFitAutoDetect` commits it round-wide when ≥ 75%
(`NUMERIC_FIT_MIN_RATIO`) of scored songs carry one, and flags the rest `needsFitScore` —
surfaced like a missing music score (parse banner `warnMissingFitScoresCli`, `ml status`,
`music.json`). Tier `<word> negative` mirrors across the scale (see the entry below).

**Why.** Owner found one flag meaning "numeric fit" _and_ "keyword scan" confusing, and tier
and gate were welded together though a round is either graded or gated. `--fit`/`--gate` as
plain booleans collide with existing `--fit <path>` / `--gate <type>`, so the owner's
`--fit [tier|gate]` shape was chosen (unambiguous with the positional round name). Numeric
fit is auto-detected because "two numbers on every song clearly means I wanted fit scores";
the 75% threshold tolerates a few stragglers while calling them out (line-156 backlog note:
a missing fit score deserves the same callout as a missing music score).

**Refs.** `f43117a` — `scripts/score/comment.mjs`, `scripts/score-core.mjs`,
`scripts/parse-round.mjs`, `scripts/parse/cli-warn.mjs`, `scripts/ml.mjs`,
`scripts/score/render.mjs`, `scripts/cli-help.mjs`, `tests/comment-parse.test.mjs`,
`tests/ml.test.mjs`, regression baseline; `spec/score-parsing.md`, `spec/scoring-comments.md`,
`spec/point-allocation.md`, `README.md`.

---

## 2026-07-10 — Manual fit tier: earliest tier word on the line wins

**Change.** `parseFitSignals` (`scripts/score/comment.mjs`) no longer picks the manual fit
tier by iterating tier synonyms in best-to-worst priority and taking the first tier whose
synonym appears anywhere on the scoring line. Tier vocabulary is now one combined
named-group regex (`FIT_TIER_RE`, built from `FIT_TIER_WORDS`); `pickTier` scans the line
once with `matchAll`, takes the **earliest** match, and maps its named group back to a tier.
A match immediately followed by `negative` (e.g. `strong negative`) is **mirrored** across
the graded scale (excellent↔nope, strong↔weak, solid↔moderate) — that fit, but bad. This
replaces the old `tierNegated` rule that dropped the tier entirely.

**Why.** `755. weak fit. great if it said 'her'…` scored as **strong** (85) because `great`
(strong tier) was checked before `weak` regardless of position. The owner types the grade
first, so position must beat tier rank; a later prose tier word is incidental. Owner
preferred a single scan-then-map over the earlier `<tier> fit` adjacency heuristic (doesn't
care about fit-adjacency, always writes the score first). After the fix that song parses
`weak` (35), dropping it from the top upvote slot in `2026-07-07-story-8`. Owner also
overruled the old "`strong negative` is ignored" rule: `strong negative` is a strongly
_bad_ fit, so the tier is mirrored (→ `weak`) rather than dropped. `node --test` 212 pass;
added comment-parse cases locking earliest-wins (both directions) and the `negative` mirror.

**Refs.** `working tree` — `scripts/score/comment.mjs`, `tests/comment-parse.test.mjs`,
`spec/score-parsing.md` (Fit channels → Tier / gate words).

---

## 2026-07-08 — Helper dedup (score-core split Phase 4): `normalizeDownShape` + `OPTION_LETTERS`

**Change.** `normalizeDownShape` is now exported from `scripts/score/allocate.mjs` (and the
`score-core.mjs` barrel); `parseDownShape` in `scripts/parse/cli-flags.mjs` delegates to it
instead of carrying a second copy of the alias table, keeping its throw-on-invalid contract.
`OPTION_LETTERS` is now exported from `scripts/score/render.mjs` (and the barrel);
`render-html-shared.mjs` imports it and `scripts/round/pick.mjs` aliases it
(`TRADEOFF_OPTION_LETTERS = OPTION_LETTERS`). The `['A'…'F']` literal now exists in exactly
one place.

**Why.** Finishing the score-core split (Phase 4). Two independent copies of the down-shape
alias map (one returning `null`, one throwing) and three copies of the option-letter array
were drift risks. Pure refactor — output byte-identical (regression snapshot clean; the only
baseline change was the barrel export-list adding `normalizeDownShape` + `OPTION_LETTERS`).
`npm test` 211, unchanged; no new eslint errors.

**Refs.** `working tree` — `scripts/score/allocate.mjs`, `scripts/score/render.mjs`,
`scripts/score-core.mjs`, `scripts/parse/cli-flags.mjs`, `scripts/render-html-shared.mjs`,
`scripts/round/pick.mjs`; `.cursor/plans/split-score-core-into-modules.plan.md` (Phase 4).

---

## 2026-07-08 — Renderer dedup (score-core split Phase 2): shared head + comparator helpers

**Change.** `render-html-shared.mjs` gained `reportTitleLine(round, fallback)`,
`leadHtml(round)`, and a `byRawOrder` comparator. `render-fit-html.mjs` and
`render-final-html.mjs` now import them instead of each defining the identical
prompt/league/title-line template, the `<p class="lead">` description block, and the
`(a.rawOrderIndex ?? 0) - (b.rawOrderIndex ?? 0)` sort tiebreak inline.

**Why.** Finishing the score-core module split (Phase 2). The bulk of the renderer dedup
already shipped as `render-html-shared.mjs`; this removed the last duplicated head/sort
logic. Pure extraction — output is byte-identical (confirmed by the new regression
snapshot: music.html unchanged; `npm test` 211 unchanged).

**Refs.** `c253abb` — `scripts/render-html-shared.mjs`, `scripts/render-fit-html.mjs`,
`scripts/render-final-html.mjs`; `.cursor/plans/split-score-core-into-modules.plan.md`.

---

## 2026-07-08 — Output snapshot regression harness + `ML_DATA_DIR` test override

**Change.** Added `scripts/regression-snapshot.mjs` (+ `just test-regression`): it runs the
full deterministic pipeline (parse → pick → final) on the committed `sample-round` fixture in
a throwaway workspace, then diffs the generated `music.md` / `music.json` / `music.html` and
the `score-core.mjs` public export list against a committed baseline under
`tests/fixtures/sample-round/snapshot/`. `pickedAt` is normalized to a sentinel; a dated
fixture id (`2020-01-01-sample-round`) keeps parse's date-slugging a no-op so the analysis dir
is stable. `--update` regenerates the baseline. Covered by `tests/regression-snapshot.test.mjs`,
so drift fails `npm test`. Also added `tests/ml.test.mjs` (dispatcher routing + stage errors +
deprecated-flag redirects) and `tests/pipeline-e2e.test.mjs` (parse→pick→final artifacts).
To make the pipeline testable in isolation, `paths.mjs` now honors `ML_DATA_DIR` (defaults to
`data`) so tests point at a temp data root while `scripts/` + `node_modules` still resolve from
the repo root.

**Why.** The score-core module split (renderer dedup, Phase 2) and other refactors need a
diff-based catch-net beyond unit tests — behavior drift in vote tables / JSON shape wasn't
caught otherwise. This is Wave 2 of `remaining-work-master`, the prerequisite gate for the
score-core Phases 2–4. See `.cursor/plans/hands-off-orchestrator.plan.md`.

**Refs.** `working tree` — `scripts/regression-snapshot.mjs`, `scripts/paths.mjs`,
`tests/{ml,pipeline-e2e,regression-snapshot}.test.mjs`, `tests/fixtures/sample-round/snapshot/`,
`justfile`.

---

## 2026-07-08 — HTML report shows the APPLIED ballot after a pick, not the frozen options

**Change.** Two render fixes in `render-html-shared.mjs` (used by `music.html` and the
fit report), both making the post-pick page reflect the allocation actually applied
(pins/reflow included), read off the live songs via `ballotUp`/`ballotDown`
(`finalVotes ?? draftVotes`):

1. **`pickHtml` "Your pick" table** now reads each song's vote from the live song
   instead of `chosen.perSong[...].votes`, and totals the live bank. The collapsed
   "Options considered" table still shows the untouched A/B/C distributions; the
   "Manual tweaks" line still explains the diff.
2. **`buildComboBallot` / `comboBallotHtml` "Ballot (raw order)"** now collapses to the
   single applied column once a `pick` is recorded (`hasPick`), ignoring the
   persisted `tier-structure` / `down-structure` option columns. The multi-column
   combo ballot is shown only **before** a pick (so you can transcribe a column
   without running the pick command). Copy switches to "Your applied ballot…" and the
   per-option legend is dropped when picked.

Regression tests in `tests/render-html.test.mjs` and `tests/pipeline-stages.test.mjs`.

**Why.** With `--pin`, the recorded option's `perSong` is the **pre-tweak** curve
(aaa-cars option A = `4/4/3/3/3/2/1/0`), while the applied ballot after pin/reflow is
`5/3/3/3/2/2/2/0`. The card list already used `finalVotes`, so the page contradicted
itself — cards showed 5/3/2… but the pick table and the raw-order ballot both showed
the frozen 4/4/3…. The applied allocation is the authoritative ballot, so every
post-pick view must reflect it; the option menu is a pre-decision aid only.

**Overruled.** The prior behavior where `buildComboBallot` kept showing `pick.options`
as multiple ballot columns "when tradeoffs are resolved" (former
`pipeline-stages.test.mjs` case) — the owner clarified the multi-option ballot is for
BEFORE picking only. **Refs:** working tree.

## 2026-07-07 — `--fit-words` gate words auto-activate the gate

**Change.** `applyManualFitScoring` (parse) now sets `profile.gate` when comments
carry `pass`/`maybe`/`fail` words and no explicit `--gate` / `--cutoff` was given:
`passFailMaybe` if any `maybe` is present, else binary `passFail`. It propagates to
`merge` / `pick` via the stored profile (`buildGate(args) ?? stored.gate`). An
explicit gate is never overridden; numeric-only manual fit (no gate words) still
gates nothing. Docs: `spec/score-parsing.md`, `spec/scoring-comments.md`,
`spec/point-allocation.md` (gate profile), `cli-help.mjs` `--fit-words`.

**Why.** A parsed per-song `gate` was **inert** without `profile.gate` — `gateClass`
short-circuits every song to `pass` when the profile has no gate. So `just parse
--fit-words` on a pass/maybe/fail round parsed the gate words but ranked purely by
combined (= music with no fit numbers), putting an 80-music `maybe` at the top of a
pass field (reported on `2026-07-06-kpop-controversial`). Requiring a separate
`--gate passFailMaybe` was a non-obvious second step; auto-wiring mirrors the existing
auto-default of `rankBy` → `combined` for manual fit.

**Refs.** `working tree` · `scripts/parse-round.mjs` (`applyManualFitScoring`),
`tests/score.test.mjs`, `spec/score-parsing.md`, `spec/scoring-comments.md`,
`spec/point-allocation.md`.

---

## 2026-07-07 — Last.fm variant dimensions (language/remix/live/instrumental as columns) + grouping profiles

**Change.** Reworked the Last.fm layer so version info is parsed into COLUMNS instead of the
title. `lastfm-export.mjs` gains `parseVariant(track)` → `{ title (stripped), language, remix,
live, instrumental }` and `parseArtist(artist)` → `{ mainArtist, artists[], collab }`;
`readVariants()` emits a dimensioned base; `rollup(base, keys)` + `PROFILES` compute grouping
profiles; `artistRollup()` credits every listed artist; `resolveTable()` + `table-map.json`
pick a consumer's CSV. `normTitle` is now `parseVariant().title`. `lastfm-aggregate.mjs` writes
`tracks-variants.csv` (base) plus profile files `tracks-affinity/-versions/-pandora.csv`,
`track-titles.csv` (now stripped), `tracks-chart.csv`, `tracks-literal.csv`, `artists.csv`
(replacing `tracks-merged.csv`). Rules gained `overrides.set` (dimension sets) and `albumRules`
(per-album sets); precedence override.set > albumRule.set > auto-extraction. `merge-candidates`
adds `language` and `instrumental` (≥5 plays) flags. `lastfm-add-rule.mjs` wizard supports
dimension sets + album rules. Consumers (`title-prefix-scan`, `title-candidate-score`) read via
`resolveTable` with `--table` / `--table-map` runtime overrides. Docs: `spec/lastfm-data.md`
(objective) + `data/ref/lastfm/README.md` + `table-map.json` (personal). Seeded EXO Growl rules.

**Grouping profiles.** `affinity` [mainArtist,title] = fuzziest popularity; `versions`
[mainArtist,title,language,remix] = DEFAULT, splits language/remix/custom versions while live +
instrumental fold to their nearest sibling; `pandora` adds live+instrumental (splits all);
`title` [title] = cross-artist matching; `chart`/`literal` stay raw. `mainArtist` keys personal
profiles so "X feat. Y" counts toward X; `artists.csv` credits every collaborator.

**Why.** Two jobs were awkward when version words lived in the title: rough affinity (wants
everything merged) and cross-artist title search (wants a stripped title). Columns make grouping
a key-selection choice and let live/instrumental fold to nearest without hard-coding title
strings. Some distinctions (EXO raw `Growl` Korean vs Chinese) depend on album, not title, so
album-aware rules are required — hence `albumRules` + `override.set`. Personal "which table for
which job" is kept in the data submodule so a public fork stays clean (fork-safe defaults in
code). Instrumentals with real plays are surfaced as fixes since they're usually mis-scrobbles.

**Refs.** `working tree` · `scripts/lastfm-export.mjs`, `scripts/lastfm-aggregate.mjs`,
`scripts/lastfm-merge-candidates.mjs`, `scripts/lastfm-add-rule.mjs`, `scripts/title-prefix-scan.mjs`,
`scripts/title-candidate-score.mjs`, `data/ref/lastfm/{merge-rules,table-map}.json`, `data/ref/lastfm/{README,lastfm-fixes}.md`,
`spec/lastfm-data.md`, `tests/lastfm-export.test.mjs`.

---

## 2026-07-06 — Last.fm `merged`: parens never differentiate + language-label folding + rule wizard

**Change.** `normTitle` (merged/titles only) now (a) strips parenthesization entirely, keeping
the inner WORDS — so `Song (Remix)` == `Song Remix`, `으르렁 (Growl)` == `으르렁 Growl`, and the
two Speed voice versions (`놀리러 간다 (Voice Version)` / `놀리러 간다 Voice Version`) merge with no
rule — and (b) folds language/version labels: `ver`/`ver.`→`version`, `eng/kor/jpn/chn/…`→full
language, and a bare language == `<language> version`, so `(Eng Ver)` == `English Version` ==
`(English)`. Real variant WORDS (remix, live, instrumental, distinct languages, `(original by …)`)
stay in the key. `scripts/lastfm-merge-candidates.mjs` now clusters by this normalized key by
default (new tags `parens`, `label`; `--fuzzy` restores the old all-parens-dropped family view
with a `naming` tag). Added `scripts/lastfm-add-rule.mjs`, an interactive wizard (buffers stdin
so it works in a TTY and via pipe) to append artist/title aliases and album overrides. Removed
the speculative EXO Growl titleAlias (the parens fold now covers `(Growl)` ⇄ `Growl`). Added
`tests/lastfm-export.test.mjs`.

**Why.** User: "parentheses in the title is never a valid differentiator if the words in the
parentheses are the same," and cross-platform language labels should collapse. These are
personal-affinity folds, so they apply to `merged` only — **never `chart`** (the Last.fm replica
stays raw per-string). The same folds are surfaced by merge-candidates as the "fix these on
Last.fm" list. Growl album-merge decision left OPEN pending a re-export (Chinese-character title,
plain `Growl`, EXO-K/EXO-M variants); note EXO-K/EXO-M are language indicators and must not be
blanket-merged, and all-songs lists artist `EXO` vs the export's `Exo`.

**Refs.** `working tree` · `scripts/lastfm-export.mjs` (`normTitle`/`normalizeVersionLabels`),
`scripts/lastfm-merge-candidates.mjs`, `scripts/lastfm-add-rule.mjs`, `tests/lastfm-export.test.mjs`.

---

## 2026-07-06 — Last.fm export aggregation tooling + repointed scrobble source

**Change.** Added `scripts/lastfm-export.mjs` (shared parse/normalize/aggregate/rules lib for
the https://lastfm.ghan.nl/export/ "Recent Tracks" format), `scripts/lastfm-aggregate.mjs`
(writes `data/ref/lastfm/{tracks-literal,tracks-chart,tracks-merged,track-titles}.csv` +
`_meta.json`), and `scripts/lastfm-merge-candidates.mjs` (flags variant tracks to merge on
Last.fm; never auto-merges). Repointed `title-prefix-scan.mjs` (`SONG_CSV_FILES`) and
`title-candidate-score.mjs` off the stale `all-scrobbles.csv` onto `lastfm/track-titles.csv`;
`lfm-curses-rank.mjs` now imports the shared lib. Custom `data/ref/lastfm/merge-rules.json`
(artistAliases / titleAliases / album-keyed overrides) restores album/naming distinctions
Last.fm loses; applied to `merged`/`titles`, never `chart`.

**Aggregation rules.** Four layers: `literal` (artist,track,album exact), `chart` (Last.fm
replica: album-merged, title case-insensitive, artist case-SENSITIVE, symbol/CJK titles
INCLUDED), `merged` (fold explicit/clean + feat, keep remix/version/live/`(original by …)`,
apply rules, symbols included), `titles` (title,artist). **Accents never stripped**; titles
case-insensitive, artists case-sensitive (LISA ≠ LiSa). Fuzzy accent/case folding is used
only for merge-candidate flagging, never to merge.

**Why.** `all-scrobbles.csv` was a stale partial export. The raw export validated at 15,958
unique (artist,track) ≈ Last.fm's reported 15,957, and the regenerated `chart` reproduces the
live top-50 exactly (ranks, counts, and tie-breaks). Earlier "Last.fm drops symbol/CJK titles"
claim was doubly wrong (bad aggregation + no evidence): user confirmed 놀리러 간다 (Speed) sits
at #313 on the site, so Last.fm INCLUDES symbol titles and numbers through them; `chart` now
includes them. Tie-break confirmed: count desc, artist asc, title asc (case-insensitive).

**Refs.** `working tree` · `scripts/lastfm-export.mjs`, `scripts/lastfm-aggregate.mjs`,
`scripts/lastfm-merge-candidates.mjs`, `data/ref/lastfm/`, `spec/lastfm-data.md`.

---

## 2026-07-01 — Title-chain engagement score module

**Change.** Extracted story-5/6 candidate ranking into `scripts/title-candidate-score.mjs`
(weighted scrobbles + `all-songs-no-inst.csv` playlist/ranking fields). `sort-candidates.mjs`
imports it. Documented in `.cursor/skills/title-chain/SKILL.md`; story-7 finalists use
**Engagement** column instead of raw scrobble count.

**Why.** Raw scrobbles alone under-rank library titles the user thumbs up but rarely scrobbles
(_My Girl_, _Nothing Short of a Miracle_ baseline +10 from all-songs presence).

**Refs.** `working tree` · `scripts/title-candidate-score.mjs`, `.cursor/skills/title-chain/SKILL.md`.

---

## 2026-07-01 — Title-chain structural complement checker

**Change.** Added `scripts/title-complement-check.mjs` with `--slot copular` for story-7
(_…all i wanted was [title]_). Tags: `ok-np`, `ok-inf`, `ok-fragment`, `bad-clause`, etc.
Slot name is in `--slot`, not the filename (`classifyComplement`, `classifyCopularComplement`).
New slots register in `CLASSIFIERS`. Updated `.cursor/skills/title-chain/SKILL.md`.

**Why.** Agent “vibe” grammar checks misclassified valid NPs (_This Love_) and rejected
relative-clause NPs (_All the Things She Said_). Mechanical rules match what the user
validates: complement type after the fixed prefix, not whether the sentence ends.

**Refs.** `working tree` · `scripts/title-complement-check.mjs`, `.cursor/skills/title-chain/SKILL.md`.

---

## 2026-06-30 — Combined tier equality by fit trust (manual vs LLM)

**Change.** Two combined sub-modes via `profile.fitTrust`:

- **`manual`** — parse with owner-typed fit: `applyManualFitScoring` calls
  `normalizeCombined` with adaptive fit std floor for rank/sort; `tierKey` buckets
  on quantized **raw** weighted blend so equal owner intent (90/77 vs 77/90) ⇒
  equal votes even when normalized display scores differ.
- **`llm`** — merge / fit.json: unchanged dampened fit floor (14) and
  `music + coarse fit band` tierKey.

`resolveFitTrust()` picks mode; any manual fit on the field wins for mixed rounds.
`fitTrust` persists in slim profile JSON.

**Why.** Raw 0.5×fit + 0.5×music display tied KARMA/Stone at 83.5, but
`tierKey` used `c:90|solid` vs `c:77|excellent` → different vote units. Owner
numeric fit should not silently apply LLM coarse-band cutoffs.

**Overruled.** Using coarse fit bands for manual numerics (85 vs 86 crossing
excellent/strong was unintentional).

**Refs.** `working tree` · `scripts/score/merge.mjs`, `scripts/score/allocate.mjs`,
`scripts/parse-round.mjs`, `spec/point-allocation.md` (Same score = same tier).

---

## 2026-06-30 — Cutoff-gated songs visible in option tables

**Change.** `isExcludedFromAllocation` now treats profile `--cutoff` failures like gate
`fail` and music DQ: pool-excluded songs append to CLI/markdown/HTML option tables with
**—** vote cells. Shared `gateClass` lives in `scripts/score/gate.mjs`; table renderers
thread `profile` into `expandTradeoffRows`.

**Why.** Yesterday's gate-fail fix only checked `song.gate === 'fail'`. Fit cutoffs
(`--cutoff fit:52`) classify failures via profile, so those songs vanished from the
A/B/C table.

**Refs.** `working tree` · `scripts/score/gate.mjs`, `scripts/tradeoff-rows.mjs`,
`tests/cli-table.test.mjs`.

## 2026-06-30 — Parse: manual fit + explicit `--rank combined`

**Change.** `applyManualFitScoring` always fills `combinedScore` when comments carry
manual fit, including when `--rank combined` is passed explicitly. Only the default
`rankBy` switch (→ `combined`) is skipped when `--rank` is provided. CLI help documents
default weights: **5:5** on parse with manual fit, **7:3** on merge/thematic pick.

**Why.** `if (hasManualFit && !args.rank)` treated an explicit `--rank combined` as
“don’t run combined setup,” leaving `combinedScore` null and hiding Music/Fit/Combined
columns even though allocation still blended via fallback.

**Refs.** `working tree` — `scripts/parse-round.mjs`, `scripts/cli-help.mjs`,
`tests/score.test.mjs`.

## 2026-06-29 — Thematic pick: combined rank + option+pin comparison table

**Change.** Fit-path `just pick` now ranks tradeoffs by `combined` (matching `just merge`)
unless `--rank` overrides — not objective mode’s music default. Pin overrides no longer
feed the menu merge; `applyOptionPick` reconciles against the unpinned menu only. After
`just pick B --pin …`, the CLI prints a **B (original) | B (altered)** comparison table
before the applied ballot.

**Why.** `just pick B --pin 11:3,12:3` used a music-ranked option B (wrong menu vs Up
table), treated pins as no-ops when the corrupted menu already had 3s, shed mid-tier 2s
instead of bottom 1s, and showed a 13/15 applied total with no before/after view.

**Refs.** `working tree` · `scripts/pick-round.mjs`, `scripts/round/pick.mjs`,
`scripts/parse/cli-print.mjs`.

## 2026-06-29 — Gate-fail songs visible in tradeoff / ballot tables

**Change.** `isExcludedFromAllocation` now covers gate `fail` and blank-score songs
(not just music `-` DQ). Pool-excluded songs append to CLI/markdown/HTML option
tables with **—** in vote columns and **—** in Combined (when shown); ballot
combo columns match own-song dashes. Shared logic lives in `scripts/tradeoff-rows.mjs`.

**Why.** Gate-failed entries (e.g. BPM out of range) were omitted from the A/B/C
comparison table — easy to miss a disqualified song mid-scroll.

**Refs.** `working tree` · `scripts/tradeoff-rows.mjs`, `scripts/parse/cli-table.mjs`,
`scripts/score/render.mjs`, `scripts/render-html-shared.mjs`.

## 2026-06-29 — CLI comment column: left-aligned, terminal-wide, configurable

**Change.** Pick/ballot Comment column is left-aligned and expands to remaining
terminal width. Preferences live in gitignored `.ml-config.json`; `just config
comment-width <auto|n>` sets a per-clone cap (default auto).

**Why.** Wide terminals wasted space with a 28-char right-aligned comment column;
users wanted readable full comments without reformatting every session.

**Refs.** working tree — `scripts/ml-config.mjs`, `scripts/parse/cli-print.mjs`,
`scripts/ml.mjs`, `justfile`.

---

## 2026-06-29 — CLI/markdown table width uses terminal display columns

**Change.** Added `scripts/text-width.mjs` (East Asian wide = 2 columns). CLI pick
tables and markdown `renderTable` pad columns by display width, not JS string length.
Song titles truncate by display width too.

**Why.** CJK titles like `...말하자면` are 7 code units but 11 terminal columns,
which shifted Score/Mod/Vote columns one cell right in monospace output.

**Refs.** working tree — `scripts/text-width.mjs`, `scripts/parse/cli-print.mjs`,
`scripts/score/render.mjs`.

---

## 2026-06-28 — Down option table minus signs; clearer tier-split notes

**Change.** Down pick-option columns show `-1` again (up stays plain `2`). Notes for
`tier-split` / `tier-split-down` say **same tier (music X, fit Y band)** instead of
"Tied score 64.3" — the old number was a tier average, not a shared combined score.

**Why.** Minus on down matches ballot/sign convention; combined-mode tiers group by
music + coarse fit band, so different Combined columns can still be one allocation tier.

**Refs.** working tree — `scripts/parse/cli-table.mjs`, `scripts/parse/cli-print.mjs`,
`scripts/score/allocate.mjs`.

---

## 2026-06-28 — Pick shorthand `A cc` + fit column in CLI tables

**Change.** Combined-mode CLI tables show **Music / Fit / Combined**. Pick accepts
up+down in one positional: `just pick <round> A cc` (or `A cc` as one token);
`cv|fl|cc` = curved|flat|concentrated. `--down-shape` still works. Suggested commands
in output use the shorthand.

**Why.** Fit was only visible in comments; down shape needed a clearer combo syntax
than reusing A/B/C or a separate long flag.

**Refs.** working tree — `scripts/cli-commands.mjs`, `scripts/parse/cli-table.mjs`,
`scripts/parse/cli-print.mjs`, `scripts/pick-round.mjs`, `scripts/ml.mjs`.

---

## 2026-06-28 — Pick CLI: up letter vs down --down-shape

**Change.** Upvote tradeoffs keep column letters **A|B|C**; downvote tradeoffs use
shape codes **cv|fl|cc** (curved / flat / concentrated). Prompt text and ballot
legends explain that one command records both axes:
`just pick <round> <A|B|C> --down-shape <shape>`. Down-structure markdown/HTML
tables match the CLI. `just pick` persists `--down-shape` into round profile JSON.

**Why.** Both tradeoffs reused A/B/C, so `just pick A` looked ambiguous; down shape
was already a separate flag but never surfaced clearly in the CLI.

**Refs.** working tree — `scripts/cli-commands.mjs`, `scripts/parse/cli-print.mjs`,
`scripts/score/render.mjs`, `scripts/render-html-shared.mjs`, `scripts/pick-round.mjs`.

---

## 2026-06-28 — CLI current-round pointer + flag-first args

**Change.** `ml` commands accept an optional round name; when omitted, they reuse
`data/.current-round` (updated only when the user names a round explicitly).
Argument parsing treats tokens starting with `-` as flags, so
`just parse --fit-words` works. `just` recipes pass all args through (`parse *args`).

**Why.** Mid-round workflow should not require retyping the round slug on every step;
`--fit-words` must not be mistaken for a fuzzy round name.

**Refs.** working tree — `scripts/ml.mjs`, `scripts/paths.mjs`, `justfile`.

## 2026-06-27 — Forced up spill: DQ and blanks before budget-mismatch

**Change.** `spillRemainder` last-resort phases assign capped overflow to blank-score
slots, then disqualified songs, even when downvotes are enabled. Own submission stays
excluded.

**Why.** Spill must exhaust every valid sink before `budget-mismatch`; blanks outrank DQ
when both could absorb overflow.

**Refs.** working tree — `scripts/score/allocate.mjs`, `spec/point-allocation.md`.

## 2026-06-27 — Per-song caps are hard (no spill relaxation)

**Change.** Removed cap-relaxation tails from `spillRemainder` and
`spillDownRemainder`. When caps × eligible slots cannot hold the full bank, spill
stops and `budget-mismatch` flags the under-spent remainder.

**Why.** Music League per-song caps are ballot limits, not soft allocator hints.

**Overruled.** Prior spill paths that exceeded `maxUpvotesPerSong` /
`maxDownvotesPerSong` to force budget exactness.

**Refs.** working tree — `scripts/score/allocate.mjs`, `spec/point-allocation.md`.

## 2026-06-27 — Blank-score `--pin` + bell-style spill (not top dump)

**Change.** `--pin` on `needsUserInput` songs is allowed at pick — counts toward the
bank and reflows other songs. `reconcileOptionPins` injects out-of-menu pins (blank
slots) and reflows with the same bell-style promotion (zeros first, weakest tier
next — not top-first). `spillRemainder` uses that promotion too.

**Why.** User can assign a ballot point without re-parsing; phantom budget from blank
pins had spilled onto POSE (+3) instead of 74-tier songs.

**Overruled.** 2026-06-27 entry rejecting blank-score pins.

**Refs.** `working tree` · `scripts/score/allocate.mjs`, `scripts/round/pick.mjs`,
`scripts/parse/cli-flags.mjs`.

## 2026-06-27 — Reject `--pin` on blank-score / out-of-menu songs

**Change.** `pinEligibilityError` rejects `--pin` on `needsUserInput`,
disqualified, own, or unknown indices at pick time. `reconcileOptionPins` no longer
injects pins for raw-order slots absent from the chosen option menu.

**Why.** Pinning `#11` (blank score) added a phantom vote to reflow math; allocate
could not apply it, leaving a spare point that `spillRemainder` gave to POSE (+3).

**Overruled.** Blank-score pins allowed; allocate applies them; spill uses tier promotion.

**Refs.** `working tree` · `scripts/parse/cli-flags.mjs`, `scripts/round/pick.mjs`,
`scripts/pick-round.mjs`.

## 2026-06-27 — Tradeoff prompts point at pick, not parse re-run

**Change.** `tier-structure` / `down-structure` tradeoff question text now says
`just pick <round> …` for recording choices (including `--tier-count` /
`--bucket-count` / `--down-shape`). Removed “on parse” — parse allocation flags
preview the draft only; pick commits.

**Why.** Three-stage split left misleading “re-run parse with --tier-count” wording
in allocator output and `music.md`.

**Refs.** `working tree` · `scripts/score/allocate.mjs`, `spec/point-allocation.md`.

## 2026-06-27 — CLI tradeoff tables: Mod/Comment columns + excluded songs

**Change.** Parse/merge/pick CLI tables (`printTradeoffCli`, `printBallotCli`,
`printAppliedAllocationCli`) add **Mod** and **Comment** columns. Songs with blank
scores or disqualification that are omitted from the allocation pool append at the
bottom of the options table with **BLANK** or **-** in Score, **-** in vote columns.

**Why.** Long tradeoff output scrolled past the head missing-score banner; excluded
songs were invisible in the A/B/C table and modifiers lived only in markdown.

**Refs.** `working tree` · `scripts/parse/cli-table.mjs`, `scripts/parse/cli-print.mjs`.

## 2026-06-27 — Pick CLI shows `just pick`, not `--option`

**Change.** Tradeoff/ballot CLI output, pick error messages, and `music.md` option
legends now recommend `just pick <round> <letter>` (with flags as needed). Pick prints
the applied raw-order ballot after commit (including pin tweaks). Parse/merge/pick warn
prominently on blank scores; pick warns on single-dash flags (`-pin`).

**Why.** `just` is the documented interface; `--option A` and raw `ml` forms mixed with
positional `just pick name A` and hid post-pin allocations.

**Refs.** `working tree` · `scripts/cli-commands.mjs`, `scripts/parse/cli-print.mjs`,
`scripts/pick-round.mjs`, `spec/point-allocation.md` (pick stage).

## 2026-06-27 — Modifier-qualified `?` (score vs +/−/play)

**Change.** `?` glued to the music number applies to the **score** only when it is
the sole modifier (`75?`). When `?` follows `+`, `-`, or `play`, it marks **that
modifier** uncertain (`75+?`, `7-?`, `74 play?`) — stored as `plusUncertain`,
`minusUncertain`, `playlistUncertain`. The modifier still applies for tiebreaks.

**Why.** Owner uses `75+?` to question the nudge, not the base score; same pattern for
playlist second thoughts.

**Refs.** `3b85cae` — `scripts/score/comment.mjs`, `spec/score-parsing.md`,
`spec/scoring-comments.md`.

## 2026-06-27 — Peel-first comment parsing + `--fit-words`

**Change.** `scoreComment` peels the **first number** on the scoring line (before
first `\n`) as music, then parses the **remainder** for fit. Tier/gate vocabulary
requires `--fit-words` (default off). `fit bonus` shorthand maps to strong/85.
Gate/tier words in the submission tail are ignored.

**Why.** Music is always written first when assigning points; parsing fit tokens before
music caused misreads (`8 fit` → fit-only, `76 fit bonus` → swallowed music 76).
Peel-first matches the owner's workflow; `--fit-words` prevents prose gate/tier
over-matching on default parse.

**Overruled.** Fit-first numeric tokens (`8 fit` alone = fit-only); tier words armed
only by literal `fit`; unconditional gate-word matching.

**Refs.** `3b85cae` — `scripts/score/comment.mjs`, `spec/score-parsing.md`,
`spec/scoring-comments.md`, `tests/comment-parse.test.mjs`.

## 2026-06-27 — Plan file lifecycle: commit early, delete on ship

**Change.** New rule `.cursor/rules/plan-lifecycle.mdc`: commit plan files with the
first wave of an effort; delete finished plans in the last wave (or the same commit
for single-shot fixes). Keep only partial/deferred plans; open items go to
`future-plans.plan.md`. Closed pipeline-cleanup master plan and shipped child plans
removed from `.cursor/plans/`.

**Why.** Plans accumulate fast; `spec/` + `decisions.md` + git tree at commit time
are enough durable context. No plan slugs in decisions.

**Refs.** `8b806b4` — `.cursor/rules/plan-lifecycle.mdc`, `.cursor/plans/future-plans.plan.md`.

## 2026-06-26 — Three-stage CLI docs: ml help, status pick row, README

**Change.** `ml help [parse|merge|pick|final]` and `just help` document the
parse → merge → pick → final workflow. `ml status` shows a Pick recorded row and
next-step guidance for music-only rounds after pick. README, `spec/analysis-artifacts.md`,
and the workspace skill updated for stage ownership and deprecated parse flags.

**Why.** Wave 5 of pipeline-cleanup master plan — make stage boundaries discoverable
without reading plan files.

**Refs.** `3442983`, `72ddfe4`, `2bc7ec9` — `scripts/ml.mjs`, README, spec/analysis-artifacts.md.

## 2026-06-26 — Split parse-round into parse/\* modules

**Change.** `scripts/parse-round.mjs` is a 259-line entry point importing
`scripts/parse/{cli-flags,cli-print,pipeline}.mjs`. Pure flag validators, terminal
print helpers, and HTML parse helpers moved out; public re-exports unchanged.
`merge-scores.mjs` and `pick-round.mjs` import flags from `parse/cli-flags.mjs`.

**Why.** Wave 3 of pipeline-cleanup master plan — slim parse entry after pick/merge
extraction.

**Refs.** working tree — `scripts/parse-round.mjs`, `scripts/parse/*`.

## 2026-06-26 — Pure render + fit field persistence (Wave 2b)

**Change.** `render-final-html.mjs` reads persisted `music.json` only — dropped
inline `scoreComment` re-score and `mergeFitJson` (`--fit` deprecated with hint).
`buildJsonPayload` persists `fitScore`/`fitTier`/`gate`/`fitSource`/`combinedScore`
and top-level `combineWeights`. Parse auto-switches to `rankBy: combined` with
`MANUAL_FIT_WEIGHTS` (0.5/0.5) when any song has manual fit. `ml final` runs
`merge-scores` first when `fit.json` exists but `scores.json` does not.

**Why.** Wave 2b of pipeline-cleanup master plan — allocation belongs in
parse/merge only; renderers are pure presenters.

**Refs.** working tree — `scripts/render-final-html.mjs`, `scripts/score/render.mjs`,
`scripts/parse-round.mjs`, `scripts/ml.mjs`, `scripts/score/fit-signal.mjs`.

## 2026-06-26 — Three-stage pipeline: parse / merge / pick

**Change.** Split monolithic parse flags into stage scripts: `merge-scores.mjs`
(music.json + fit.json → scores.json), `pick-round.mjs` (JSON-only `--option` /
`--reason` / `--pin`), shared logic in `scripts/round/pick.mjs`. `parse-round.mjs`
no longer accepts `--fit`, `--option`, or `--reason` (deprecated with redirect
hints). `ml.mjs` / `just` add `merge` and `pick`; parse writes `profile` snapshot
into music.json for pick replay.

**Why.** Wave 2 of pipeline-cleanup master plan — parse never writes `pick`, pick
never reads HTML, merge never picks.

**Refs.** working tree — `scripts/merge-scores.mjs`, `scripts/pick-round.mjs`,
`scripts/round/pick.mjs`, `scripts/parse-round.mjs`, `scripts/ml.mjs`, `justfile`.

## 2026-06-26 — Split score-core into focused modules

**Change.** `scripts/score-core.mjs` is now a thin re-export barrel over
`scripts/score/{format,fit-signal,comment,allocate,merge,render}.mjs`. Public
export surface unchanged (23 symbols); `mergeFitJson` lives in `render.mjs` to
keep the allocate↔merge import graph acyclic.

**Why.** The 2300-line monolith mixed six concerns; module split is Wave 1 of the
pipeline-cleanup master plan and unblocks allocator work in `allocate.mjs` only.

**Refs.** working tree — `scripts/score-core.mjs`, `scripts/score/*`.

## 2026-06-22 — Point badges use discrete tier palette, not score heat

**Change.** Upvote boxes (`draftVotes` / `finalVotes`) now use a fixed discrete
palette keyed by rank among distinct non-zero point values in the round (highest
→ purple, second → blue, third → green, fourth → teal, …). Same point value =
same color always. Zero stays neutral gray; downvotes keep red `has-down`
styling. Fit/music/combined score heat (`scoreToHue` / `scoreHeatAttrs`) is
unchanged. `render-html-shared.mjs` exports `VOTE_TIER_HUES`, `buildVoteTierMap`,
`voteTierHue`, and `voteTierAttrs`.

**Why.** Vote badges were inheriting `--tier-hue` from the card's fit-score
gradient, so two songs with the same 2 points could show different shades. Points
are tier-based (same value = same tier), not continuous scores.

**Refs.** `working tree`; `scripts/render-html-shared.mjs`, `scripts/render-fit-html.mjs`, `scripts/render-final-html.mjs`.

## 2026-06-22 — scores.html defaults to combined order; score boxes use round-relative heat

**Change.** `render-fit-html.mjs` now auto-selects `--order combined` when the
input basename is `scores` or any song carries `combinedScore` (unless `--order`
is passed explicitly). Fit-only `fit.json` keeps the fit default. Score boxes
(fit / music / combined) and fit-tier labels get a red→green `--score-hue`
gradient from each axis's min/max in the round (same HSL chip pattern as vote
badges). `render-html-shared.mjs` exports `scoreRangeFromSongs`, `scoreToHue`,
and `scoreHeatAttrs`.

**Why.** Direct `node scripts/render-fit-html.mjs …/scores.json` (without
`ml scores`'s implicit `--order combined`) still sorted cards by fit. Per-round
relative coloring makes tight spreads (e.g. music 68–77) readable without a
fixed 0–100 scale.

**Refs.** `working tree`; `scripts/render-fit-html.mjs`, `scripts/render-html-shared.mjs`.

## 2026-06-22 — Pins can no longer exceed a bank: reflow, flag, and reject

**Change.** Three guards so a manual pin can never produce an over-budget (or
silently under-budget) ballot:

1. **`--option` + `--pin` reflow** (`reconcileOptionPins` in `parse-round.mjs`).
   `--option` pins a whole funded distribution; layering an extra `--pin` on top used
   to _add_ to it (e.g. `--option A --pin <song>:2` summed to 9 against an 8-point
   bank). Now the pin is reconciled at the margin: a net-positive pin sheds the
   surplus from the lowest-ranked unpinned funded songs; a net-negative pin promotes
   the next candidates (best-ranked unfunded first, then below-cap). `--option A
--pin 9:2` now yields `2-2-2-2` by dropping the bottom funded song, summing to 8.
2. **`budget-mismatch` tradeoff** (`flagBudgetMismatch` in `score-core.mjs`, all
   `allocate` return paths). Any final allocation whose up/down totals ≠ the banks is
   flagged (`over` set when a bank is exceeded). CLI prints a loud `⛔ OVER BUDGET` /
   `⚠️ Bank not fully spent` line (`warnBudgetMismatch`); reports already render the
   budget line, so they surface it too.
3. **Invalid pin rejected** (`pinCapError`). A `--pin` above a finite per-song cap
   (`maxUpvotesPerSong`/`maxDownvotesPerSong`; `0` = unlimited) errors at the CLI
   instead of being silently clamped to the cap.

Removed the spec language that said "a pin can exceed the bank (deliberate manual
override); there is no separate overflow tradeoff."

**Why.** Recording a story-5 pick, `--option A` combined with up-pins printed a 9/8
upvote ballot with no warning. Exceeding a bank is never a valid Music League ballot,
so the intended way to express a manual distribution is either to pin all affected
songs so they even out, or to pin a delta and let allocation reflow around it — the
latter wasn't supported for the `--option` path, and nothing caught the overshoot.

**Overruled.** Prior behavior that pins (and `--option`+pin) may overspend a bank
without a tradeoff.

**Refs.** working tree — `spec/point-allocation.md` (Profile → overrides/pins;
Interactive tradeoffs → `budget-mismatch`); `scripts/parse-round.mjs`,
`scripts/score-core.mjs`; tests in `tests/score.test.mjs`.

## 2026-06-19 — `title-chain` skill + `title-prefix-scan` tool

**Change.** Added a new task type for Music League "story / sentence chain" rounds (build one
running sentence by chaining song **titles**; lyrics/meaning irrelevant). New skill
`.cursor/skills/title-chain/SKILL.md` and tool `scripts/title-prefix-scan.mjs` (loads all four
song CSVs, dedups by normalized title, anchors a regex at the **start** of the title, writes the
full grouped list to a `data/analysis/<round>/prefix-hits.txt` to avoid truncation). Codified the
submission criteria: grammar/sense first; pronoun + narrow "you" rule (spoken pleas may use "you",
narration about a fixed third party may not); present tense welcome (title pool skews present);
**continuability** = voters must be able to picture a viable next title (a slot begging a common
noun/verb is good, one begging a scarce connector "me/her/and/to" is bad; resolutions are weak);
oblique beats must still connect to the scene.

**Why.** User ran a title-chain round and the existing `submission-song-search` skill didn't fit
(it's lyric/theme-based). The leading-word scan + the "where can you leave the end of the sentence"
rules are reusable across future story rounds even though the sentence changes.

**Refs.** working tree (`scripts/title-prefix-scan.mjs`, `.cursor/skills/title-chain/SKILL.md`).

## 2026-06-19 — topic-summary `verify` column + English-source link rule

**Change.** Added a `verify` column to `data/ref/song-topic-summaries.csv`
(`track,artist,summary,lyrics_url,verify`) and audited all 98 rows. `verify` ∈ `en` (saved link
carries English lyrics/translation or solid English meaning analysis — clickable to check), `rom`
(only a romanization/Hangul link exists; summary rests on search synthesis + own Korean reading),
`none` (no link; lowest confidence). Re-pointed rom-only links to English sources where they exist
(current split: 54 `en`, 6 `rom`, 38 `none`). Updated `submission-song-search` to require an
English-bearing `lyrics_url` when one exists and to ban presenting `Eng: N/A` pages (e.g. most
colorcodedlyrics / letras.mus.br / versuri) as if they documented meaning.

**Why.** User noticed many saved links (e.g. a colorcodedlyrics page with `Eng: N/A`) had no
English column, so they couldn't verify how the meaning was derived. The meaning had come from the
web-search synthesis (or Korean reading), not the saved link — a provenance gap that hides
low-confidence summaries. The `verify` tag plus the English-source rule make each row's grounding
explicit and checkable.

**Refs.** working tree (`data/ref/song-topic-summaries.csv`,
`.cursor/skills/submission-song-search/SKILL.md`).

---

## 2026-06-19 — `submission-song-search` skill + reusable topic-summary cache

**Change.** Added `.cursor/skills/submission-song-search/SKILL.md` (registered in
`music-league-workspace`) for the PRE-round "what should I submit" task — mining
`data/ref/fav-songs.csv` / mood CSVs / discographies for theme fits. It codifies the
search-frugal method: reuse prior research, scan big lists without truncation (print + check a
count; read from a file when long), hand the user a prune-able `analysis/<round>/shortlist.md`
before deep-searching, run a cheap `"<song> meaning"` batch pass before full-lyric dives, and chunk
findings. Introduced `data/ref/song-topic-summaries.csv` (`track,artist,summary,lyrics_url`) as a
reusable, round-neutral topic cache so the same songs aren't re-searched across rounds.

**Why.** The Hermit research repeatedly hit output truncation (tail candidates silently dropped)
and burned searches on songs whose titles lied about their lyrics. A standing skill + summary
cache makes future themed-submission research cheaper and reproducible.

**Refs.** working tree (`.cursor/skills/submission-song-search/SKILL.md`,
`data/ref/song-topic-summaries.csv`).

---

## 2026-06-28 — Date-slug sibling merge (early research + later import)

**Change.** `applyDateSlugs` now detects an existing dated round with the same
bare slug (e.g. `2026-06-27-lfm-art` when slugging undated `lfm-art`) and folds
the undated input/analysis into that id instead of stamping a fresh date.
`consolidateDuplicateBareSlugs` merges duplicate dated ids for one bare slug into
the earliest date. Added `bareSlugOf` / `datedSiblingsOf` in `paths.mjs`.

**Why.** Candidate research often creates an analysis folder before HTML import.
A later `ml run` on another round could date-slug that folder; importing HTML
and running again stamped a second date for the same round slug.

**Refs.** working tree (`spec/analysis-artifacts.md` → Date slugs and tidying).

---

## 2026-06-22 — Date-slug naming on parse (not only `ml run`)

**Change.** `parse-round.mjs` now calls `ensureDateSlugForInput` (naming only, no
archive) before reading the round file, so `ml parse`, direct script invocation,
and agent parses all date-slug undated rounds the same way `ml run` does. Added
`ensureDateSlugForInput` to `scripts/maintain-rounds.mjs`.

**Why.** Parsing via `node scripts/parse-round.mjs data/rounds/story-5.html` left
the input undated and wrote analysis under the bare slug; only `ml run` ran naming
first. Parse should stamp the date without pulling in stale-round archiving.

**Refs.** working tree (`spec/analysis-artifacts.md` → Date slugs and tidying).

---

## 2026-06-19 — `ml tidy`: auto date-slug naming + stale-round archiving

**Change.** Added `scripts/maintain-rounds.mjs` plus an `ml tidy` command (and
`just tidy`). It (1) prepends today's `YYYY-MM-DD-` slug to any undated round id —
input file and/or analysis folder, renamed together — using _yesterday_ before 5am
local, and (2) moves rounds whose slug date is >2 days old into
`data/rounds/archive/` and `data/analysis/archive/`. `ml run` now runs naming first
(so generated artifacts land under the dated name), then archives everything stale
except the round being run. Flags: `--dry-run`, `--age N`, `--no-name`,
`--no-archive`. New date/prefix helpers (`DATE_PREFIX_RE`, `hasDatePrefix`,
`datePrefixOf`) live in `scripts/paths.mjs`; tests in `tests/maintain-rounds.test.mjs`.

**Why.** Item 1 of `future-plans`: round exports were being saved without the date
slug and archiving was a manual chore. Folding both into the normal `run` workflow
keeps `data/rounds/` and `data/analysis/` consistent and current without extra steps.

**Overruled.** Considered archiving on a 2-days-old (keep today+yesterday only)
window and an explicit-only archive command; chose keep-3-days plus auto-on-run
(excluding the active round) so re-rendering a recent round never self-archives. Date
slugging covers analysis folders too (not just input files as the plan literally
said) so an orphan folder like `analysis/tarot-hermit` gets dated as well.

**Refs.** working tree; `spec/analysis-artifacts.md` → Date slugs and tidying,
`scripts/maintain-rounds.mjs`, `scripts/ml.mjs`, `scripts/paths.mjs`.

---

## 2026-06-18 — Private round/analysis/ref data split into a `data/` submodule

**Change.** Round inputs, analysis outputs, and reference data moved out of the public
repo into a separate **private** git repo (`music-league-data`) mounted as a git
submodule at **`data/`** — so paths are now `data/rounds/`, `data/analysis/`, and
`data/ref/`. `scripts/paths.mjs` gained a `DATA_DIR` base and a `REF_DIR` export;
`ROUNDS_DIR`/`ANALYSIS_DIR` are now `join(DATA_DIR, …)`. `tests/ml-status.test.mjs`
creates fixtures under `data/analysis/` and asserts the `data/analysis/…` path. The
previously git-tracked `analysis/README.md` and `rounds/.gitkeep` move into the data
submodule; the obsolete `rounds/*`, `analysis/*`, `ref/*` ignore rules leave
`.gitignore`. README, `spec/analysis-artifacts.md`, the `justfile`, and the
`music-league-workspace` skill were updated to the `data/` paths.

**Why.** The code should be a public portfolio piece, but exact round comments and the
personal favorites list should stay private. A public repo exposes everything in its
history forever, so plaintext private data can't be tracked there. A submodule keeps
the data version-controlled and backed up while staying behind the private repo's access
control, and mounting it at `data/` keeps the scripts' on-disk paths intact (no
per-round path juggling).

**Overruled.** Considered three top-level submodules at `rounds/`/`analysis/`/`ref/`
(zero script change, but heavier, and would have moved the tracked `analysis/README.md`
piecemeal) and `git-crypt` in a single repo (opaque blobs in a portfolio repo, key
management). Single `data/` submodule chosen for a clean public/private boundary.

**Refs.** working tree; README → Private data, `spec/analysis-artifacts.md`,
`scripts/paths.mjs`.

---

## 2026-06-17 — `--option` works on music-only rounds, not just the fit-merge path

**Change.** `--option <A|B|C…>` now applies a surfaced `tier-structure` distribution
on plain (music-only) parses, not only on the `--fit` merge path. Previously the
`--option` handler lived entirely inside `parse-round.mjs`'s `if (args.fit)` branch,
so a music-only `just parse <round> --option B` fell through to the unparameterized
`allocate()` and the flag was **silently ignored** (exit 0, no warning) even though
the report's tradeoff legend advertised it. The pick/menu logic is now factored into
two shared helpers — `resolveOptionPick(tradeoffs, spec, baseOverrides)` (pure: maps
a letter to the chosen option's per-song override map) and `applyOptionPick(...)`
(re-allocates, builds the pick record, logs it) — called from both branches.
Music-only picks now also write a `pick` block into `music.json` (consumed by
`render-final-html.mjs`'s existing `music.pick` read) and a row to
`analysis/picks.jsonl`. `recordPickToTrainingLog` takes a songs array and falls back
to `score`/`finalVotes` when `musicScore`/`draftVotes` are absent.

**Why.** The pre-allocation report tells the user to pick with `--option B`, so the
flag doing nothing on music-only rounds was a silent correctness gap — the workaround
was `--tier-count <n>`, which only coincidentally reproduces an option. Sharing one
resolver keeps the two paths from drifting.

**Refs.** `50556da` — `scripts/parse-round.mjs` (`resolveOptionPick`,
`applyOptionPick`, music-only branch), `scripts/score-core.mjs` (`buildJsonPayload`
`pick`), `tests/score.test.mjs` (two `resolveOptionPick` cases).

---

## 2026-06-17 — downvote pins via signed `--pin`

**Change.** `--pin <i>:<v>` now accepts a **negative** value to pin downvotes
(`--pin 6:-2` = two downvotes on song 6); positive still pins upvotes. `parsePins`
returns `{ overrides, downOverrides }`, threaded into `profile.downOverrides`. In the
allocator: a down-pinned song is dropped from the upvote pool (and leftover-spill
targets) so it earns **zero upvotes**; in `allocateDownvotes` the pinned magnitudes
are committed first, excluded from the shaped pool and from `spillDownRemainder` (so
they're never topped up past the pin), and the residual bank is shaped around them.
Pinned songs still appear (at their fixed magnitude) in every surfaced
`down-structure` option's `perSong`, so the combo ballot shows them. `buildPickRecord`
records pins as signed `downTweaks` for the training log.

**Why.** Downvotes had no manual override — the only knob was the global
`--down-shape`. Punishing a specific song (e.g. `-2` on a DQ, `-1` on a few others)
required hand-editing. Signed `--pin` reuses the existing up-pin mental model and
matches the signed ballot's `+`/`-` display.

**Overruled.** None. Considered and skipped: a down `preallocation-overflow` tradeoff
when pins exceed the bank — `--pin` upvotes have no such guard, so down pins stay
symmetric (a pin is a deliberate override).

**Refs.** `b1e5f33` — `scripts/parse-round.mjs` (`parsePins` signed split,
`profile.downOverrides`, usage), `scripts/score-core.mjs` (`allocate` up-pool prune,
`allocateDownvotes` pin handling, `buildPickRecord` `downTweaks`),
`tests/score.test.mjs` (parse + engine cases), `spec/point-allocation.md`.

## 2026-06-16 — combo ballot (one column per up×down) + downvotes always negative

**Change.** The raw submission-order ballot moved out of the per-option comparison
tables into one **Ballot (raw order)** section with **one column per up-option ×
down-shape combo**. Each column is a complete signed ballot (upvotes positive,
downvotes **negative**) read straight down, so any combination is transcribable
without first committing to `--option`/`--down-shape`. Each combo is built
independently (apply the up option, then the down shape); a song the up option
upvotes **and** the down shape downvotes is a `!` **conflict** cell — never silently
dropped or netted — and per-column totals still report each axis's intended budget
plus a conflict count. Identical full-ballot columns are deduped (header lists the
equivalent selectors). The per-axis comparison tables (`tier-structure`,
`down-structure`) now show **by combined score only** (judgment). Downvotes display
as negative everywhere: comparison tables, card vote badges (fit + final), the
`tier-split-down` tie label, and the markdown raw-order ballot (via
`formatVoteAllocation`). Built by a pure `buildComboBallot` shared by both HTML
reports and the CLI (`printBallotCli`).

**Why.** The old bottom transfer table duplicated each option's raw-order column and
only showed the default pick, while downvotes lived in a separate view and read as
`0` in the up table — so transcribing meant cross-referencing two tables and walking
the list twice. A per-combo column makes entry a single-column read while keeping
per-option transcription (enter any option without picking first) — folding the
per-option raw tables into combos rather than dropping them. A combo can't always be
made internally valid (down shapes are computed for the
default up pool, so a different up option may upvote a down-targeted song); rather
than recompute per option or silently net to a smaller total, we flag the cell and
leave the fix to the user (per their call).

**Overruled.** Supersedes the prior "single signed `Votes` column" ballot and the
"raw-for-entry sub-table per option" half of the 2026-06-16 _clean `--option` picks_
layout below.

**Refs.** `b1e5f33` — `scripts/render-html-shared.mjs` (`buildComboBallot`,
`comboBallotHtml`, `.ballot` styles; removed dead `.transfer` styles),
`scripts/render-fit-html.mjs` + `scripts/render-final-html.mjs` (call `comboBallotHtml`,
dropped `renderTransfer`), `scripts/parse-round.mjs` (`printBallotCli`),
`scripts/score-core.mjs` (`tier-split-down` label sign), `tests/score.test.mjs`
(`buildComboBallot` cases), `spec/point-allocation.md`.

## 2026-06-16 — downvote shape as its own axis (concentrated / flat / curved)

**Change.** The downvote curve is now chosen independently of the upvote tier
structure via `downShape` (`concentrated` | `flat` | `curved`), CLI
`--down-shape`. `concentrated` piles the bank worst-first to cap (uncapped ⇒ all on
the single worst/invalid song); `flat` spreads 1-each across the worst songs;
`curved` is the existing graduated bell and the default. When `downShape` is unset
the allocator surfaces a `down-structure` tradeoff proposing the distinct shapes
(per-song previews, deduped on the resulting distribution) so the owner picks per
round; pinning a shape suppresses it. Rendered in the CLI (`printTradeoffCli`) and
HTML (`tradeoffsHtml` reusing the song×option table) with a `--down-shape` selector.

**Why.** Sequenced allocation sends every zero-upvote song plus DQ to the down
pass, and no single rule fits every round: concentrating the whole bank on one
clearly-bad/invalid song and spreading `-1`s across the worst are both legitimate.
A per-round knob plus a proposal of both (the owner's suggestion) beats hard-coding
one. Upvote A/B/C options are unchanged.

**Refs.** `50556da` — `scripts/score-core.mjs` (`allocateDownvotes`,
`allocateConcentratedDown`, `allocateFlatDown`, `normalizeDownShape`),
`scripts/parse-round.mjs` (`--down-shape`, `parseDownShape`, `printTradeoffCli`),
`scripts/render-final-html.mjs`, `scripts/render-html-shared.mjs`,
`spec/point-allocation.md`.

## 2026-06-16 — sequenced allocation: upvotes first, then downvotes over zero-up + DQ

**Change.** Downvotes are no longer drawn from a pre-partitioned bottom slice of a
single up/down spectrum. Allocation is now **sequential**: (1) shape upvotes over
the whole eligible field minus a _minimal_ downvote reserve (the fewest bottom
songs needed to hold the down bank at its per-song cap — uncapped ⇒ 1), then
(2) shape downvotes over **every** song the upvote pass left at zero, plus any
disqualified song. `spectrumTargets` was replaced by `upvotePool` (returns only
the up pool); `finishDownvotes` now defaults its target set to all zero-upvote
eligible songs (`downEligible`) instead of the reserved slice. Disqualified /
unrankable songs (null score → `-Infinity`) are mapped to a finite floor below the
lowest real score in `allocateBellDown` so they sort worst and pull the most
downvote weight.

**Why.** With unlimited per-song caps (Music League exports `0` = unlimited), the
old `spectrumTargets` collapsed the up and down pools to ~1 song each, dumping all
upvotes on the top song and starving/garbling downvotes. The reserve-as-maximum
behavior was wrong: the reserve is a _floor_ for cap-safety, and the bell should
decide reach. Mixing a DQ song's `-Infinity` into the down bell also produced
`Inf/Inf → NaN` weights, which overspent the down bank (e.g. story-4: down spent
20 vs a budget of 5, DQ left at 0). Sequencing matches the owner's model:
distribute upvotes, let the curve zero the bottom naturally, then downvote
whatever is left at zero (DQ always included).

**Overruled.** An earlier "center split" that pre-assigned an up pool, a down pool,
and an untouched middle by a statistical center — rejected as an artificial
boundary; reach is curve/ratio-driven, not capped at a center.

**Refs.** `50556da` — `scripts/score-core.mjs` (`upvotePool`, `finishDownvotes`,
`allocateBellDown`), `spec/point-allocation.md` (Allocation model).

## 2026-06-16 — record picks: reason, manual tweaks, options kept visible + training log

**Change.**

1. Picking an option (`--option`) now writes a durable **pick record** to
   `fitData.pick`: the chosen option, **every option that was presented** (slimmed
   `perSong` with score + votes), an optional **reason** (`--reason "why"`), and any
   **manual tweaks** (final votes that deviate from the chosen option's canonical
   distribution, auto-diffed — e.g. an extra `--pin` on top of the pick).
2. A new helper `buildPickRecord()` (pure, in `score-core.mjs`) builds that record;
   `parse-round.mjs` writes it into `scores.json` and **appends one line to the
   global `analysis/picks.jsonl`** training log (round, options-shown as
   votes-by-index, chosen, reason, tweaks, and a compact field score snapshot).
3. `scores.html` keeps the alternatives visible **after** a pick: a focused
   **Your pick** table (chosen distribution by combined score) with the reason and
   tweaks, plus a collapsed **Options considered** comparison reusing the
   song×option table with the chosen column highlighted (`chosenIndex`).

**Why.** A pick used to vanish into a flat pinned allocation — the menu that was
weighed and the rationale were lost. Keeping the options visible and recording
_what was shown → what was chosen and why_ makes the deliverable auditable and
builds a dataset for future allocation/training work. Embedding in `scores.json`
keeps each round self-contained; the global `picks.jsonl` accumulates across rounds.

**Refs.** `working tree` · `spec/point-allocation.md` (`--reason`, pick record) ·
`scripts/score-core.mjs` (`buildPickRecord`) ·
`scripts/render-html-shared.mjs` (`pickHtml`, `tierStructureTableHtml` `chosenIndex`).

---

## 2026-06-16 — clean `--option` picks, distinguishable option shapes, own song in raw order

**Change.**

1. **`--option <A|B|C…>`** selects a `tier-structure` distribution fork by its column
   letter and applies that exact curve as deterministic per-song pins. A pick is now
   one clean flag instead of hand-transcribing `--pin` for each song — needed because
   two options can share a tier/bucket-count label.
2. Each tier-structure option carries a **`shape`** signature (the run pattern, e.g.
   `2×4 / 1×2 / 0×5`); legends/labels use it so options never look identical.
3. The comparison output now renders in **two orders** — by combined score
   (judgment) and by **raw submission order** (app entry). The raw-order ballot and
   the `Vote transfer` table interleave the owner's own **unvotable** song so every
   submission slot is present.
4. **Owner song bug fix:** the fit-merge path dropped the owner's own submission
   from `scores.json` entirely, so the raw-order transfer in `scores.html` had a
   silent gap (Devil: `#9 Overdose` missing → every later row off by one when typing
   into the app). `mergeFitJson` now persists `ownSongs`, and both `render-fit-html`
   and `render-final-html` show it as a `— your song` row.

**Why.** Picking a distribution required reading a comparison table and then manually
building a pin command; and the ballot you transcribe into the app was both in the
wrong order (combined, not submission) and missing your own song's slot.

**Refs.** `working tree` · `scripts/parse-round.mjs` (`--option`, `resolveOptionIndex`,
two-order CLI ballot), `scripts/score-core.mjs` (option `shape`, `ownSongs`
writeback), `scripts/render-html-shared.mjs` (`tradeoffsHtml` two tables + own row),
`scripts/render-fit-html.mjs` + `scripts/render-final-html.mjs` (transfer interleaves
own song), `spec/point-allocation.md`.

---

## 2026-06-16 — favorite-band off for combined rounds; expose normalized axes + music-lift flag

**Change.** Four linked fixes to how the normalized combined score is allocated and
shown:

1. **Favorite-band merge is off by default when `rankBy = combined`.** The `80`
   floor (`favMin`) is a raw-music anchor ("8+"); comparing it against the
   normalized combined score is a category error — the 75-centered z-remap shoves
   above-average songs over `80` regardless of raw quality. On the Devil round it
   merged four songs whose raw music was 77 / 76 / 74 / 75.5 (zero of them real
   8+ favorites) into one tier. An explicit `--favorite-band <min>` is still honored.
2. **Expose `fitNorm` / `musicNorm`** — each axis z-scored over contenders and
   remapped onto the same 75-centered scale, so `combinedScore = w.fit·fitNorm +
w.music·musicNorm` exactly. Written back to the merged JSON and rendered on each
   card as a `combined = fitⁿ ×w + musicⁿ ×w (raw fit/music)` breakdown line. Raw
   100-point fit alone couldn't explain a jump; the normalized pair can.
3. **`musicLift` callout** (`flagMusicLifts`) — flags any song whose combined rank
   sits above a song with a strictly better fit tier (music, not fit, carried it
   past). Surfaced as an `↑ music-lifted over <tier>` flag, naming the leapfrogged
   song, rather than silently reordering. (Devil: Seven Devils over Christian Woman;
   UNKNOWN LOVERZ over If I'm Honest.)
4. **Comparison table shows each song's own score, not the merged-unit value.** The
   tier-structure `perSong` now carries `score` (the song's real combinedScore)
   alongside `rank` (the favorite-band unit value used for ordering), so the table
   stops printing the broadcast top-of-band value for every favorite.

**Why.** Ranking by a normalized blend made the top opaque and let a raw-music
heuristic (the `80` favorite floor) fire on a scale where `80` is just "~0.5 SD above
the field." Exposing the normalized axes makes every placement auditable; turning off
the mis-scaled merge stops manufacturing fake co-favorites; the lift flag keeps the
"promotion is a callout, not an auto-reorder" principle (mirrors pass-vs-maybe).

**Overruled.** Alternatives for the favorite floor — gate on raw music ≥ 80, redefine
"favorite" as excellent fit tier, or trigger on band tightness — rejected in favor of
simply disabling it for combined rounds (the tier/bucket-count tradeoffs already give
top-flattening control).

**Refs.** `working tree` · `scripts/score-core.mjs` (`favMin` gate, `normalizeCombined`
`fitNorm`/`musicNorm`, `flagMusicLifts`, `perSong.score`), `scripts/render-fit-html.mjs`
(norm breakdown + lift flag), `scripts/render-html-shared.mjs` (styles, table score),
`spec/point-allocation.md` R2 + combined sections.

---

## 2026-06-16 — tradeoff distribution options render as a song×option comparison table

**Change.** A `tier-structure` tradeoff (the "which point split?" fork) now renders
as **one side-by-side comparison table** instead of one block per option. Rows are
songs in combined/rank order, columns are the options (`A` = default, `B`, …), and
each cell is the votes that option assigns; a `Total` row closes it. The allocator
attaches `perSong` (best-first, index-aligned across options) to each tier-structure
option to carry the per-song votes. Applied to every surface: the `parse-round`
merge CLI (aligned text table), `scores.html` (the merge now persists `tradeoffs`
into the JSON so `render-fit-html` can show them), `final.html`, and `music.md`.

**Why.** Three stacked per-option blocks (or three prose strings like "the fruits 3;
If I'm Honest 2; …") forced a manual diff to see what actually moves between options.
A shared table makes the delta obvious at a glance and reads in the same combined
order as the ranked list. Non-distribution tradeoffs (favorite-band split, etc.)
stay as compact bullet choice lists.

**Refs.** `working tree` · `scripts/render-html-shared.mjs` (`tradeoffsHtml`),
`scripts/score-core.mjs` (`renderTierStructure`, `perSong`, `mergeFitJson` writeback),
`scripts/parse-round.mjs` (`printTradeoffCli`), `scripts/render-fit-html.mjs`,
`scripts/render-final-html.mjs`.

---

## 2026-06-16 — combined score: per-round normalization with asymmetric std floors

**Change.** `rankBy: combined` no longer ranks on the raw `0.7·fit + 0.3·music`.
`mergeFit` now runs `normalizeCombined`: each axis is **z-scored over the
contenders** (point-eligible songs — not DQ'd, not blank, not gated out), the
weights are applied to the standardized values, and the blend is remapped onto a
**75-centered, music-anchored** display scale (`combinedScore`). The reconciliation
is **asymmetric, expressed as different std floors**: music floor low
(`MUSIC_STD_FLOOR = 2`, so a tight music field amplifies half-points and `+/-`),
fit floor high (`FIT_STD_FLOOR = 14`, so the imprecise AI fit number rides an
effectively fixed, dampened scale and a tight good-fit cluster is never amplified).
`+`/`-` now **fold into the music value** (`MODIFIER_MUSIC_DELTA = 0.34`) before
normalizing, so a `74+` can out-tier a plain `74` in combined mode (combined
`tierKey` keys on this modifier-folded music). A field below `MIN_NORM_CONTENDERS`
(4) falls back to fixed reference anchors. The display remap is centered so the
average contender ≈ 75 and a clear standout reaches ~80 — keeping the staircase's
75/80 anchors and the `≥ 80` favorite-band merge valid **unchanged**. `ml scores`
and the combined HTML sort now order by `combinedScore` with **music as the
secondary tiebreak**.

**Why.** Fit and music differed in _spread_, not just weight: the AI fit number
ranges far wider than music, so the raw blend let a barely-meaningful ~8-point fit
gap (e.g. `93` vs `85`) dwarf a decisive 1-point music gap — the opposite of what
`0.7/0.3` implies. Z-scoring puts the weights on comparable scales. The asymmetric
floors encode trust: the owner's music precision is real (tight → amplify), the AI
fit precision is not (tight → do not amplify). Dropping gated-out fit from the
contender population is the fit-side analogue of the owner's `-` music DQ — it keeps
terrible-fit outliers from inflating the fit std so the curve represents the real
candidates. On The Devil round this dropped The Perfect Drug (fit 88 / music 70)
from 2 votes to 1 and lifted UNKNOWN LOVERZ and Dancing On The Wall (high music) to
2 — music finally counts.

**Overruled.** Symmetric normalization (one floor for both axes) was rejected: after
dropping low-fit outliers the survivors are a _tighter_ fit cluster, which a
round-relative std would then **amplify** — re-inflating the meaningless `93` vs `85`
gap, the exact opposite of the goal. The high fit floor prevents that. Snapping fit
to its band anchors (an earlier idea) was rejected to keep granular fit scores
visible (cliff-vs-slope) for research and the owner's eye.

**Refs.** working tree; `normalizeCombined` / `effectiveMusic` / `isContender` and
the `rankValue` + combined `tierKey` changes in `scripts/score-core.mjs`; combined
sort in `scripts/render-fit-html.mjs`; `cmdScores` `--order combined` default in
`scripts/ml.mjs`; tests under _Combined-score normalization_ in
`tests/score.test.mjs`; spec _Profile / Same score = same tier / Modifiers_ in
`spec/point-allocation.md`.

---

## 2026-06-16 — auto allocation: center-out staircase (R1) + favorite-band merge (R2)

**Change.** `allocate`'s `auto` shape no longer uses the bell-target + Ckmeans +
per-member waterfill. It now enumerates **budget-exact staircases** of `+1` steps
(a `0/1` cutoff plus nested promotion steps) and selects one by: fewest junk steps →
best boundary worth (real gaps + 75/80 anchors) → shortest top → cleanest break.
Distinct point tiers are therefore **contiguous by construction** (always exactly 1
apart — no `{4,1,0}` cliffs). Top height comes from the budget, not the cap: a
promotion on neither an anchor nor a real gap is "junk" and minimized first, so a
tight cluster stays low-topped (a lone `80` over a `73–76` field gets `2`, never a
lone `3`/`4`). **R2:** scores `≥ 80` merge into one shared top tier by default
(`favoriteBand`, `--favorite-band <min>` / `--no-favorite-band`); a significant
merged band surfaces a `top-band-split` tradeoff. The kpop one-off
(`scripts/one-off/kpop-solo-versions.mjs`) dropped its `CAP=2` stopgap and runs at
the round's natural cap.

**Why.** The bell+waterfill model produced top-heavy, non-contiguous curves on tight
clusters (the reported `{4,1,0}` bug), which forced a manual `CAP=2` workaround on
the kpop round. Stacking unit steps makes contiguity structural and ties top height
to the budget. The favorite merge reflects that `90` vs `84` is not a real
difference — favorites should share the top.

**Overruled.** The plan's preference order put boundary quality (gap + anchor) above
the "shorter top" preference, which alone re-introduced lone-`3` tops on tight
clusters (kpop). Resolved by splitting the two: anchors do **not** force extra steps;
a junk-promo count gates top-heaviness first, then quality, then shorter top. The
plan's `3 3 3 → C2` example (favorites at `3` over a graduated `≥75` band) still
holds because its second step lands on the 75 anchor, not a junk gap.

**Refs.** working tree; `allocateBell` in `scripts/score-core.mjs`
(staircase enumerator, `JUNK_GAP`/`PROMO_PENALTY`, R2 merge), `--favorite-band`
flags in `scripts/parse-round.mjs`; tests in `tests/score.test.mjs` (R1/R2 +
`3 3 3` regression + contiguity); spec _How the tiers are drawn_ / _R2_ in
`spec/point-allocation.md`.

---

## 2026-06-16 — passFailMaybe: passes shaped first, governed by max(maybe) ≤ min(pass)

**Change.** In `passFailMaybe` rounds the **passes are shaped first**, and the
governing rule is `max(maybe) ≤ min(funded pass)` — a `maybe` never earns more
points than the lowest-funded pass. Funded maybes default to the **1-point floor**
(ordered by defensibility / fitScore), with `leniency` (0…1) reaching further down
the list. In a **low-pass round** (more maybes than passes) the maybe band may take
its **own graduated staircase** capped at the lowest pass. The choice surfaces as a
`maybe-band` tradeoff (none / flat / graduated).

**Why.** The previous flow could let a high-music `maybe` outrank a `pass` (a maybe
funded above the lowest pass), inverting the gate. It also had no way to fairly
distribute points in a round with few clear passes and many maybes without simply
moving the pass/fail line. Anchoring on `max(maybe) ≤ min(pass)` keeps the gate's
meaning while still rewarding the most-defensible maybes; the graduated band handles
low-pass rounds where leniency is warranted (a hard or widely-misread prompt).

**Overruled.** An initial "passes fully funded first, maybes only from leftover"
reading left maybes at `0` even with generous budgets. Corrected per owner intent:
the rule allows equality (maybe = lowest pass) and a leniency dial, not "never fund
a maybe."

**Refs.** working tree; `allocate` maybe-funding branch in
`scripts/score-core.mjs`; tests in `tests/score.test.mjs` (invariant, leniency,
low-pass graduated band); spec _Profile → gate → passFailMaybe_ and _maybe-band_ in
`spec/point-allocation.md`.

---

## 2026-06-15 — music.html on the ml status checklist

**Change.** `ml status <round>` shows an optional **Music HTML** row (with stale
detection) when `analysis/<round>/music.html` exists.

**Why.** `ml final` writes `music.html` for music-only (non-thematic) rounds, but the
status checklist only listed scores/fit HTML — so that deliverable, and whether it
had gone stale relative to `music.json`, was invisible.

**Refs.** `5e6051f`; affects `pipelineState` / `cmdStatusOne`
(`scripts/ml.mjs`); test in `tests/ml-status.test.mjs`; layout in
`spec/analysis-artifacts.md`.

---

## 2026-06-15 — Persist needsResearch on music.json songs

**Change.** `buildJsonPayload` now writes `needsResearch` (boolean) on each song
object in `music.json`.

**Why.** Thematic scoring sets `needsResearch` when a song has a music score but no
fit signal yet (`scoreComment`), but the flag was dropped on write — so the fit
research loop, which filters `music.json` for songs needing outside knowledge, could
never see it.

**Refs.** `14b531b`; affects `buildJsonPayload` (`scripts/score-core.mjs`); test
in `tests/score.test.mjs`. Unblocks the research loop in
`followup-3-thematic-mode.plan.md`.

---

## 2026-06-15 — Pre-allocation gate: surface blockers before allocating

**Change.** Added a named **Pre-allocation gate** rule (`spec/point-allocation.md`,
plus the `music-league-workspace`, `parse-scores-pipeline`, and `round-fit-research`
skills): before proposing or presenting any allocation, the agent must lead with
blocking inputs and resolve blank scores before showing distributions. Full rule
and the list of blockers live in the spec section.

**Why.** On the Pride round a blank score box (Old Town Road — a fit-passing song)
was mentioned only as a parse statistic, not as a blocking callout, and allocation
silently kept it at 0 across every proposed curve. The flag data was already in
`music.md`; what was missing was a workflow rule making it a blocking lead rather
than a footnote under the distribution.

**Refs.** `ddd5282`; affects `spec/point-allocation.md` (new _Pre-allocation
gate_ section) and the three skills above.

---

## 2026-06-15 — Per-round analysis folders; split fit research from the deliverable

**Change.** Analysis outputs moved from flat `analysis/<round>-fit.json` (and
`analysis/<round>.md`) to per-round folders with named artifacts:
`analysis/<roundname>/{music.md,music.json,fit.json,fit.html,scores.json,scores.html}`.
`parse-round --fit` now writes `scores.json`; `fit.json` stays fit-only research.
`scripts/paths.mjs` centralizes discovery and artifact names; `archive/` is ignored.
The full layout lives in `spec/analysis-artifacts.md`.

**Why.** The flat `-fit.json` mixed fit-only research with post-merge `draftVotes`
and collided as rounds accumulated, so there was no reliable way to tell the fit
step's input apart from the merged deliverable. Per-round folders give each round a
predictable home and keep `fit.json` (research) separate from `scores.json` (output).

**Refs.** `c038e98`; affects `scripts/paths.mjs`, `scripts/parse-round.mjs`,
`scripts/ml.mjs`, `scripts/render-fit-html.mjs`, and `spec/analysis-artifacts.md`.

---

## 2026-06-11 — Own submission shown in the raw-order table

**Change.** The HTML extractor still keeps the user's own song (`mine: true`) out of
scoring/allocation, but now records it in a new `ownSongs` list, and the markdown
raw-order table interleaves it at its real index as `(your song — not scored)`.
`buildJsonPayload` mirrors it under `ownSongs`.

**Why.** The user enters votes by raw position; dropping the own song left an
invisible index gap (e.g. 17 → 19), risking a misaligned ballot. Showing the slot
(with no votes) makes the index sequence complete and self-checking.

**Refs.** `e588936`; affects the raw-order output in `buildMarkdown`
(`scripts/score-core.mjs`) and `parseRoundDocument` (`scripts/extract-html.mjs`);
test in `tests/extract-html.test.mjs`.

---

## 2026-06-11 — Recover round markup from a rich-text View-Source paste

**Change.** The HTML parse path now retries when a saved `.html` yields no songs:
if the document is a "Cocoa HTML Writer" wrapper (View Source of the round pasted
into TextEdit/Notes/Mail, which re-encodes the real markup as entity-escaped text
split across `<td class="td1">` cells), `recoverEscapedSource` rebuilds the
original `vote.html` source from the decoded cell text and re-parses it. Ordinary
saved rounds are unaffected (recovery only fires after a zero-song parse and only
when the rebuilt text contains a song list).

**Why.** A real `lfm-stats` capture arrived in this wrapped form and parsed to
zero songs. The genuine markup (budget, `song-` divs, `data-comment`, `uri`
inputs) survives intact inside the wrapper, so recovering it is lossless for
scoring rather than asking for a re-export.

**Refs.** `e588936`; affects `spec/score-parsing.md` (HTML input handling);
tests in `tests/extract-html.test.mjs`, fixture
`tests/regressions/cocoa-viewsource-wrapper.html`.

---

## 2026-06-11 — Forced tie-splits land where a modifier resolves them

**Change.** When the budget can't divide evenly across whole tiers, the leftover
point forces exactly one equal-score group to split. K-selection now prefers a
clustering whose split lands on a group a `+`/`-` modifier can break (the extra
goes to the song that earned it) over one that coin-flips an **unmodified** tie.
Concretely it now keeps two plain `76`s equal and spends the remainder on a
`75+?`/`75` pair instead.

**Why.** The old spill dumped the remainder on the top songs first, splitting the
two best (unmodified) songs 4/3 — an arbitrary choice with nothing to justify it.
That contradicts the manual method (keep tied top songs equal; resolve the
leftover where a modifier decides it). An arbitrary split is only chosen when no
candidate avoids it, and then it still surfaces as a `tier-split` tradeoff.

**Refs.** `fd58e78`; `scripts/score-core.mjs`,
`spec/point-allocation.md` → "Forced splits land where a modifier resolves them".

---

## 2026-06-11 — Tradeoff tables: aligned columns + precise raw-scores column

**Change.** `tier-structure` options render as column-aligned markdown tables
(padded source) with `Points` / `Songs` / `Score range`, plus a `Scores` column
listing the exact raw tokens (e.g. `73-`, `73+?`, `74?`) rolled into each tier.
The `Scores` column only appears when some score in the round carries a
`+`/`-`/`?` modifier.

**Why.** The earlier `3×2`-style shorthand was ambiguous ("4 songs at 1 point" vs
"1 song at 4 points") and the score range alone hid which modified entries landed
in a tier.

**Refs.** `fd58e78`; `scripts/score-core.mjs`,
`spec/point-allocation.md` → "Ambiguous tier counts are surfaced".

## 2026-06-10 — Tiers are drawn by 1-D clustering, not a fixed bell curve

**Change.** Point tiers are found with optimal 1-D k-means
(Ckmeans.1d.dp) on the score axis: clustering picks where the boundaries fall (on
real gaps), a monotonic per-member waterfill assigns points (budget-exact,
capped, higher score never fewer points), and the **tier count is soft** —
opinion- and points-aware, not a hard target. Equal-opinion songs (`tierKey`)
form atomic units that never split across a boundary. Two knobs were separated:
`--bucket-count <n>` forces **K** (number of score clusters); `--tier-count <n>`
forces the number of **final point tiers** (distinct point values). Genuinely
ambiguous splits surface as a `tier-structure` tradeoff keyed by bucket count.

**Why.** Hand-tuned bell weights plus a rigid zero-quota / `levelCap` couldn't
express "imagine the scores as a bell and draw vertical tier lines on the natural
gaps." Clustering is the principled version of that, and a soft tier count lets
the budget and score spread decide granularity instead of a fixed number.

**Overruled.** Replaces the bell-curve-only allocator with its `levelCap`
granularity gate and any fixed zero-tier quota.

**Refs.** `fd58e78`; `scripts/score-core.mjs`, `scripts/parse-round.mjs`,
`spec/point-allocation.md`; plan `clustering-tier-allocation_4fd38c3b`.

## 2026-06-10 — Smoothness is the one hard rule; the curve matters more than the zero tier

**Change.** The single hard allocation rule: songs **≤ 1 score apart must never
end > 1 point apart** (a `>1` jump may only land on a real `>1` score gap).
Everything else (how many tiers, whether a zero tier exists) is shaped by the
budget and clustering, not quotas. The floor is a _consequence_ of a low-point
curve, not a goal: don't flatten the curve by filling the zero tier with 1s when
you could promote 2s and leave zeros; expand both tails together as points allow.

**Why.** Iterating on "always keep some zeros" vs "don't flatten the curve"
converged here. The user's real objective is the **shape** — a graduated curve
that mirrors the music-score spread — with zeros falling out naturally because
points are usually scarce. A hard zero quota or a flat all-1s/all-cap result both
destroy that shape; a Lipschitz-style smoothness rule protects it while staying
budget-exact.

**Overruled.** Supersedes earlier rigid "N zeros required" framing.

**Refs.** `fd58e78`; `scripts/score-core.mjs`,
`spec/point-allocation.md` → "Smoothness (the one hard rule)".

## 2026-06-10 — Recurring fit tastes live in opt-in guidance profiles, not global rules

**Change.** Added `spec/fit-guidance.md`: named, **opt-in** fit lenses that are
proposed per league/voting-style and confirmed with the user, never auto-applied
and never overriding the universal rules in `spec/fit-evaluation.md` or a manual
fit token. Seeded profiles: `traits-over-symbols`, `lyrics-first`,
`story-continuation`, plus an Associations table. Added an **influence
vocabulary** (`primary` / `co-primary` / `secondary` / `bonus` /
`tiebreak-only` / `soft-penalty-if-present` / `ignore` / `hard-gate`) so "A
matters more than B" is always pinned to a precise level before scoring.

**Why.** Preferences that came up while scoring (e.g. judge traits from lyrics,
not vibe) are real and reusable, but assuming they apply to _every_ round would
silently distort rounds where they don't belong. Capturing them as suggested
lenses removes the re-clarification tax without making them global defaults.

**Refs.** `33fd69b`; `spec/fit-guidance.md`, `spec/fit-evaluation.md`,
`.cursor/skills/round-fit-research/`.

## 2026-06-10 — `traits-over-symbols`: both is best; the symbol is never a penalty

**Change.** For astrology/tarot/archetype prompts that list both a symbol/element
and personality traits, rank **both > traits-only > symbol-only > neither**. The
symbol/element is a positive **secondary** signal: a shared element (e.g. "water"
across all water signs) can't reach the top tier on its own but still counts and
stacks with traits. A song is never rated higher for _lacking_ the imagery.

**Why.** An early over-correction read "prefer traits over water imagery" as
"penalize literal imagery," which was wrong. The intended order only swaps
trait-only above symbol-only; carrying both should win.

**Overruled.** Corrects the transient "imagery is a negative" reading.

**Refs.** `33fd69b`; `spec/fit-guidance.md` → `traits-over-symbols`.

## 2026-06-10 — Granular fit scores; covers differ by music, not fit

**Change.** Fit research may use intermediate numbers instead of snapping to band
values (e.g. a "just missed excellent" note becomes an in-between score), so the
made-up fit axis merges cleanly with precise music scores and helps break ties.
Different recordings of the same song (covers) are allowed to differ in points,
but by **music score**, not fit — and small music gaps (e.g. 71 vs 71.5) should
not force a disproportionate 2-point split.

**Why.** Hard fit bands were too coarse once music scores entered the merge:
fit 85 vs 83 are effectively equal at research precision, but forcing a borderline
song into a band threw away signal that a half-point nudge preserves. Covers share
fit by definition, so any spread between them must come from the music read.

**Refs.** `fd58e78` (merge/covers) + `33fd69b` (fit-evaluation);
`spec/fit-evaluation.md`, `spec/point-allocation.md`.

## 2026-06-09 — Text input parsing split out from HTML; scoring extracted to a core module

**Change.** Added `parse-text.mjs` for pasted plain-text rounds and extracted the
shared scoring/allocation logic into `score-core.mjs`, leaving `parse-round.mjs`
as a thin CLI over both HTML and text inputs.

**Why.** Not every round arrives as Music League HTML, and the parsing/allocation
logic had grown enough to be worth testing in isolation.

**Refs.** commit `d5ece6e`; `scripts/parse-text.mjs`, `scripts/score-core.mjs`.

## 2026-06-09 — User-friendly CLI, linting, and a no-auto-commit rule

**Change.** Added the `ml.mjs` CLI wrapper, a `justfile`, ESLint +
markdownlint config, and the `no-auto-commit` rule (never commit unless the user
explicitly asks).

**Why.** Day-to-day use needed friendlier entry points and consistent formatting;
the no-auto-commit rule keeps changes in the working tree for review instead of
the agent committing on its own initiative.

**Refs.** commit `9e70046`; `scripts/ml.mjs`, `.cursor/rules/no-auto-commit.mdc`.

## 2026-06-09 — Combined fit + music rounds score the two axes separately

**Change.** Thematic rounds combine a fit signal and a music score via explicit
`combineWeights`, scored and stored separately, then merged deterministically.

**Why.** Conflating the two axes lost information; keeping them separate lets the
fit-vs-music balance be set (or deferred) per round.

**Refs.** commit `b05953f`; `spec/point-allocation.md`, `spec/fit-evaluation.md`.

## 2026-06-09 — Fit report is generated HTML; the JSON sidecar is the source of truth

**Change.** Fit research is written to `analysis/<roundname>/fit.json` (one object per
song + round metadata), and the human-readable report is generated HTML
(`render-fit-html.mjs`), not a hand-written markdown table. Once an allocation
exists, every output ends with a copy-back vote-transfer table.

**Why.** A markdown table cramped the rationale/notes; a stacked-card HTML view
gives them full width, and a machine-readable JSON sidecar lets the deterministic
merge own `draftVotes` so the LLM never has to.

**Overruled.** Replaces the markdown fit table as the primary fit output.

**Refs.** commit `b9efe32`; `scripts/render-fit-html.mjs`,
`spec/fit-evaluation.md` → "Output".

## 2026-06-09 — Deterministic parsing MVP

**Change.** First deterministic `parse-round.mjs` that converts scores, applies
modifiers, and produces a draft allocation without an LLM in the loop, plus the
follow-up plan set.

**Why.** Score conversion and ranking must be reproducible and auditable; only the
genuinely subjective fit read should need a model.

**Refs.** commit `a0d1e0d`; `scripts/parse-round.mjs`.

## 2026-06-07 — Foundational parsing rules: numbers first, never group by appearance

**Change.** Established the core spec rules: `755`→75.5 style conversion happens
**before** any ranking; `+`/`-` are tiebreak nudges and `?` is uncertainty only
(`?` may mean up or down — no midpoint or directional bias); a bare `-` means too
low to score; `73=` is a `73+` typo; `7?`→70 uncertain; blank/`TODO` comments are
flagged `needsUserInput`. Never group scores by visual similarity (`715` is
unrelated to `735`).

**Why.** Music League comments are terse and idiosyncratic; pinning the exact
meaning of every token up front keeps parsing deterministic and prevents
appearance-based mistakes (e.g. treating `725` as near `73.x`).

**Refs.** commit `0f66b71`; `spec/score-parsing.md`, `spec/uncertainty.md`,
`spec/comments.md`.
