# Decision Log

Why the tools behave the way they do — and what we tried and rejected along the
way. The other `spec/` files say **what** the current behavior is; this file is
the running history of **how we got there**, so a decision that was reversed (or
nearly reversed) doesn't get silently re-litigated every few rounds.

## How to maintain this

See [`.cursor/rules/decision-log.mdc`](../.cursor/rules/decision-log.mdc) for format and when to add entries.

---

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
