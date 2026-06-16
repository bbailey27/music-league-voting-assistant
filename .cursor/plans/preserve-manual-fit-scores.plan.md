---
name: preserve-manual-fit-scores
overview: Make manual fit scores written in comments parse robustly (identifier-anchored numbers, no keyword over-matching), persist into music.json, render in music.html, and auto-weight allocation toward combined when present. Tier/gate WORD vocabulary is kept but gated behind a default-off --fit-words flag. Also separate allocate from render so renderers are pure presenters.
status: pending
isProject: false
todos:
  - id: parse-grammar
    content: "Rework parseFitTokens/scoreComment: identifier-anchored music/fit numbers, mods on music number, ambiguity -> needsReview; numeric fit always parsed"
    status: pending
  - id: word-gating
    content: Gate FIT_TIER_SYNONYMS + GATE_WORDS behind opts.fitWords (default off); add negation guard for tier words
    status: pending
  - id: flag-plumbing
    content: Add --fit-words to parse-round parseArgs and thread opts through parseRoundHtml/parseRoundDocument/parseRoundText/parseBlock to scoreComment; update usage strings
    status: pending
  - id: alloc-combined
    content: Add MANUAL_FIT_WEIGHTS (0.5/0.5); auto-set rankBy=combined + combinedScore + ctx.combineWeights when hasManualFit and no --rank override
    status: pending
  - id: persist-fields
    content: Persist fitScore/fitTier/gate/fitSource/combinedScore per song + top-level combineWeights in buildJsonPayload
    status: pending
  - id: pure-render
    content: "Make renderers pure: render-final-html reads persisted music.json (drop scoreComment re-score and inline mergeFitJson; drop --fit); centralize allocate in parse/merge; ml final does merge-then-render"
    status: pending
  - id: tests
    content: "Update/add tests: word-off defaults, --fit-words vocabulary + negation, numeric pairing cases, persistence, auto-combined allocation, render fixture"
    status: pending
  - id: docs-decisions
    content: Update score-parsing.md, point-allocation.md, analysis-artifacts.md, README; add decisions.md entries
    status: pending
---

## Preserve and correctly parse manual fit scores

### Decisions locked (from Q&A)

- Numeric fit self-identifies: a number tagged `fit` (`80 fit` / `fit 80`) is always parsed; music is the number tagged `music` (or the lone bare number).
- Tier/gate WORDS (`pass`, `maybe`, `strong`, `off-theme`, ...) are OFF by default, parsed only with an explicit `--fit-words` flag. The vocabulary code is kept, not deleted.
- Numeric coercion (`scaleScoreToken`: `7->70`, `75->75`, `755->75.5`) is intentional and unchanged.
- When any song has manual fit, allocation auto-switches to `rankBy: combined` using a new balanced default weight (0.5 fit / 0.5 music), overridable with `--weights` / `--rank`.
- Manual fit is persisted in `music.json` and rendered in `music.html`.
- Allocate and render are separated: allocation happens only in the parse/merge step; renderers are pure presenters of a persisted JSON.

### Current behavior (for reference)

- `parseFitTokens` ([scripts/score-core.mjs](scripts/score-core.mjs:185)) parses numeric fit, then tier words (armed by literal `fit`), then **gate words unconditionally** (`GATE_WORDS` loop at line 210) — this is the `maybe` / `off-theme` over-match on music-only rounds.
- Tier regex `strong` matches inside `strong negative fit` with no negation handling ([score-core.mjs:169](scripts/score-core.mjs:169)).
- `buildJsonPayload` ([score-core.mjs:1595](scripts/score-core.mjs:1595)) drops `fitScore`/`fitTier`/`gate`/`fitSource`/`combinedScore`.
- `render-final-html` re-derives fit by re-running `scoreComment` on the stored comment ([render-final-html.mjs:100](scripts/render-final-html.mjs:100)) AND re-runs `mergeFitJson` (allocation) when given `--fit` ([render-final-html.mjs:110](scripts/render-final-html.mjs:110)) — so allocation happens inside render, sometimes.
- Plain allocate path is music-only ([parse-round.mjs:260](scripts/parse-round.mjs:260)); `rankValue('combined')` already blends `fitScore`+`score` live ([score-core.mjs:227](scripts/score-core.mjs:227)).

### 1. Parsing: identifier-anchored numbers + word gating (`scripts/score-core.mjs`)

- `scoreComment(rawComment, mode, opts = {})` — add `opts` carrying `{ fitWords = false }`.
- `parseFitTokens(comment, { fitWords })`:
  - Numeric fit (`fit N` / `N fit`) always parsed (unchanged).
  - `FIT_TIER_SYNONYMS` and `GATE_WORDS` only scanned when `fitWords` is true. Default off => no tier/gate word matching at all (kills the `maybe`/`off-theme`/`fits` and `strong negative fit` over-matches). Keep the `fit`-armed requirement for tier words and add a simple negation guard (skip a tier word preceded by `no|not|non|negative|never`).
- Music-number extraction (replace the strip-then-first-number block at [score-core.mjs:70-99](scripts/score-core.mjs:70)):
  1. Prefer identifier-anchored: `/(\d{1,3})(\.\d)?([+\-?=]*)\s*music\b/i` -> music score + mods (handles `75? music`).
  2. Else strip the fit-number token(s) and take the first remaining number as music (covers bare `75`, `75?`, and `80 music`).
  3. If a `fit` token is present but no music number resolves: music = null (fit-only note); if multiple ambiguous untagged numbers remain, set `needsReview` with a reason.
  - Modifiers (`+ - ? =`) continue to attach to the music number.

### 2. Flag plumbing for `--fit-words`

- `parse-round.mjs` `parseArgs` ([parse-round.mjs:27](scripts/parse-round.mjs:27)): add a `--fit-words` boolean (like `--no-json`/`--lenient`).
- Thread an options object through: `parseRoundHtml(html, mode, opts)` ([parse-round.mjs:180](scripts/parse-round.mjs:180)) -> `parseRoundDocument(document, mode, opts)` ([extract-html.mjs:42](scripts/extract-html.mjs:42)) -> `scoreComment(..., opts)` ([extract-html.mjs:138](scripts/extract-html.mjs:138)); and `parseRoundText(text, mode, opts)` ([parse-text.mjs:346](scripts/parse-text.mjs:346)) -> `parseBlock` -> `scoreComment` ([parse-text.mjs:206](scripts/parse-text.mjs:206), [parse-text.mjs:315](scripts/parse-text.mjs:315)).
- `ml parse` already forwards extra flags ([ml.mjs cmdParse](scripts/ml.mjs:194)) and `just parse name *flags` passes through ([justfile:5](justfile)), so only usage strings need updating ([ml.mjs:328](scripts/ml.mjs:328), parse-round usage line).

### 3. Allocation: auto-combined when manual fit present (`scripts/parse-round.mjs` + `score-core.mjs`)

- Add `export const MANUAL_FIT_WEIGHTS = { fit: 0.5, music: 0.5 }` in score-core (distinct from `DEFAULT_COMBINED_WEIGHTS` 0.7/0.3 used for LLM thematic rounds).
- In the plain path ([parse-round.mjs:260](scripts/parse-round.mjs:260)), before `allocate`: compute `hasManualFit = parsed.songs.some(s => s.fitSource === 'manual' && (s.fitScore != null || s.gate != null))`. When true and the user did not pass `--rank`: set `profile.rankBy = 'combined'` and `profile.weights = parseWeights(args.weights) || MANUAL_FIT_WEIGHTS`; set `s.combinedScore = combinedScore(s, weights)` on each song; record `ctx.combineWeights = weights`.

### 4. Persistence (`buildJsonPayload`, `scripts/score-core.mjs:1595`)

- Add per-song: `fitScore`, `fitTier`, `gate`, `fitSource`, `combinedScore`.
- Add top-level `combineWeights` when combined ranking was used, so the deliverable is reproducible and self-contained.

### 5. Architecture: separate allocate from render (answers "why does music.html run allocation?")

**Why it happens today:** `render-final-html.mjs` predates the per-round `scores.json` / merge split (the per-round-folders refactor, commit `c038e98`). It was the original "final" renderer that took `music.json` + an optional `--fit fit.json` and ran `mergeFitJson` *inline* so you could get a fit-blended view without a separate merged file. Now that `parse-round --fit` writes `scores.json` and `render-fit-html` is a pure presenter, that inline merge is redundant overlap — allocation lives in two places and the renderer does it conditionally. The `scoreComment` re-score in `buildModel` exists for the same reason: `music.json` didn't persist derived fields, so the renderer recomputed them.

**Target pipeline:** `parse` -> (`merge`) -> `render`, where allocation/scoring is a single reusable step and renderers only present a persisted JSON.

- `parse-round` writes `music.json` with all derived fields (music, fit, combined, votes, tradeoffs) — enabled by sections 3-4 above.
- `parse-round --fit` writes `scores.json` (already the pure allocate/merge step).
- `render-final-html`: drop the `scoreComment` re-score (line 100) and the inline `mergeFitJson` (line 110); read persisted `music.json` fields directly. Remove the `--fit` option (allocation is not a render concern). Card rendering ([render-final-html.mjs:208](scripts/render-final-html.mjs:208)) and the combined-weights fact ([render-final-html.mjs:172](scripts/render-final-html.mjs:172)) already display fit/combined when the fields are present.
- `render-fit-html`: already pure — no change.
- `ml.mjs` `cmdFinal` ([ml.mjs:223](scripts/ml.mjs:223)): replace the `render-final-html --fit` branch with merge-then-render — if `fit.json` exists but `scores.json` doesn't, run the merge step first to produce `scores.json`, then render it via `render-fit-html`; otherwise render `music.json` via `render-final-html`. The orchestrator owns allocation; renderers never call it.

Net: the "allocate inside render sometimes" smell is removed, renderers become side-effect-free and reusable, and the persistence work in this plan is the prerequisite that makes that possible. (Back-compat: old `music.json` files without fit fields render music-only; re-running `ml parse` regenerates them.)

### 6. Tests

- `tests/score.test.mjs`: rewrite the "manual fit notation" block ([tests/score.test.mjs:54](tests/score.test.mjs:54)) for words-off defaults (`strong fit` -> no tier; `maybe`/`off-theme`/`pass` -> no gate); add `{ fitWords: true }` cases for the vocabulary incl. negation (`strong negative fit`). Add numeric pairing cases: `80 music 75 fit`, `75? music. 80 fit`, `72 music, fit 8`, and `maybe a 70?` (words off -> music 70 uncertain, no gate).
- `tests/score.test.mjs`: assert `buildJsonPayload` persists `fitScore`/`fitTier`/`gate`/`fitSource`/`combinedScore` + top-level `combineWeights`.
- Allocation test: a round with manual fit yields `rankBy: combined` results (votes differ from music-only) at the documented 0.5/0.5 weight.
- `tests/render-html.test.mjs`: a `music.json` fixture carrying manual fit renders the tier/score and "combined 50% / 50%" without a `--fit` sidecar; assert `render-final-html` produces identical output with and without the (now-removed) re-score path for a fields-complete `music.json`.

### 7. Spec / docs / decision log

- `spec/score-parsing.md` "Manual Fit Notation" ([spec/score-parsing.md:46](spec/score-parsing.md:46)): numeric identifiers always parsed and robustly paired; tier/gate WORDS require `--fit-words` (default off) with the controlled vocabulary + negation rule; gate words no longer fire unconditionally; auto-combined allocation (balanced default) when manual fit present; persisted in `music.json`.
- `spec/point-allocation.md`: note manual-fit auto-combined behavior + `MANUAL_FIT_WEIGHTS` default.
- `spec/analysis-artifacts.md`: `music.json` now carries fit fields + `combineWeights`; renderers are pure presenters (allocation only in parse/merge).
- `README.md` "How comments are scored" / allocation sections: document the `music`/`fit` pattern, `--fit-words`, and auto-combined.
- `spec/decisions.md` (newest-first, `Refs: working tree`): entries for (a) stop over-matching fit/gate words; gate behind `--fit-words`, (b) persist manual fit in `music.json` + render from it + auto-combined balanced allocation, (c) separate allocate from render (remove `render-final-html --fit` inline merge; `ml final` does merge-then-render).

### Edge cases / risks

- Old `music.json` files lack fit fields -> render music-only; re-running `ml parse` regenerates them cleanly.
- `mergeFit` precedence relies on `fitSource === 'manual'` ([score-core.mjs:1340](scripts/score-core.mjs:1340)) — preserved by persisting `fitSource`.
- `needsResearch` thematic flag and the downvote path are unaffected.
- Mixed rounds (some songs fit, some not): `combinedScore` already falls back to music when `fitScore` is null ([score-core.mjs:1316](scripts/score-core.mjs:1316)).
- Removing `render-final-html --fit` is a CLI surface change; the only caller is `ml final`, updated here to merge-then-render.
