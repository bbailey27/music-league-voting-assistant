---
name: preserve-manual-fit-scores
overview: Make manual fit scores written in comments parse robustly (identifier-anchored numbers, no keyword over-matching), persist into music.json, render in music.html, and auto-weight allocation toward combined when present. Tier/gate WORD vocabulary is kept but gated behind a default-off --fit-words flag. Also separate allocate from render so renderers are pure presenters.
status: partial
isProject: false
todos:
  - id: parsing-contract
    content: "Lock parsing contract table + fixture comments in plan and spec/score-parsing.md (music vs fit vs tier vs gate vs ignored) — agree before coding"
    status: pending
  - id: tests-first
    content: "TDD red phase — tests/comment-parse.test.mjs (or score.test block) with full matrix; fitWords false default + fitWords true; all must fail until impl"
    status: pending
  - id: word-gating
    content: Gate FIT_TIER_SYNONYMS + GATE_WORDS behind opts.fitWords (default off); when on, tier/gate match without literal 'fit'; negation guard for tier words
    status: pending
  - id: parse-grammar
    content: "Scoring line vs submission tail; peel first number = music, parse remainder for fit; FIT_SHORTHAND; N fit vs fit bonus"
    status: pending
  - id: flag-plumbing
    content: Add --fit-words to parse-round parseArgs and thread opts through parseRoundHtml/parseRoundDocument/parseRoundText/parseBlock to scoreComment; update usage strings
    status: pending
  - id: alloc-combined
    content: Add MANUAL_FIT_WEIGHTS (0.5/0.5); auto-set rankBy=combined + combinedScore + ctx.combineWeights when hasManualFit and no --rank override
    status: completed
  - id: persist-fields
    content: Persist fitScore/fitTier/gate/fitSource/combinedScore per song + top-level combineWeights in buildJsonPayload
    status: completed
  - id: pure-render
    content: "Make renderers pure: render-final-html reads persisted music.json (drop scoreComment re-score and inline mergeFitJson; drop --fit); centralize allocate in parse/merge; ml final does merge-then-render"
    status: completed
  - id: tests
    content: "TDD green phase — all comment-parse matrix tests pass; persistence + allocation tests unchanged/green"
    status: in_progress
  - id: docs-decisions
    content: Sync spec/score-parsing.md to contract; decisions.md entry when shipped
    status: in_progress
---

## Preserve and correctly parse manual fit scores

**Wave 1 slice (remaining):** `--fit-words`, identifier-anchored grammar, parsing contract +
tests-first. **Sequence:** Wave 1 of [remaining-work-master.plan.md](remaining-work-master.plan.md).

## Implementation order (TDD)

Do **not** change `comment.mjs` until the contract below is locked and failing tests
exist.

1. **Parsing contract** — table + fixture comments (this section + `spec/score-parsing.md`).
   Stop and confirm with owner if any row is wrong.
2. **Red** — `tests/comment-parse.test.mjs` (or dedicated block in `score.test.mjs`):
   one test per contract row × `{ fitWords: false }` and `{ fitWords: true }` where
   applicable. Run `npm test` — new tests must **fail** on current code.
3. **Green** — implement `opts.fitWords`, identifier-anchored music numbers, word
   gating, negation guard; thread `--fit-words` from CLI.
4. **Spec + decisions** — copy contract into `spec/score-parsing.md`; log ship in
   `decisions.md`.

Persistence, pure render, and auto-combined allocation are **already shipped** — do
not re-test those except where the parse output feeds them.

---

## Parsing contract (default: `--fit-words` OFF)

Each user comment (`userComment` only — submitter text is never scored) resolves to
fields on the `scoreComment` result. **Prose is not a score** unless a rule below
says otherwise.

### Field legend

| Field | Meaning |
| --- | --- |
| `score` | Music score (0–100-ish, after digit scaling) |
| `fitScore` / `fitTier` | Manual fit signal (numeric or tier word) |
| `gate` | pass / maybe / fail (gate rounds only) |
| `+` `-` `?` `playlistAdd` | Modifiers on the **music** number |
| `needsReview` / `needsUserInput` / `isDisqualified` | Non-score outcomes |
| *(ignored)* | Text that does not populate any field |

Digit scaling unchanged: `7`→70, `73`→73, `755`→75.5.

### Core algorithm: peel music, parse remainder

Owner **always** puts the music score as the **first number** on the scoring line (line 1
before any `\n`) — that's how they scan when assigning points. There is **no fit-only**
notation; fit is never scored without music.

**Algorithm (scoring line only):**

1. Find the **first number** (+ mods) → **music** `score`. Strip it from the line.
2. Parse the **remainder** for fit: 2nd number, explicit `N fit` / `fit N`, shorthand,
   tier/gate words (`--fit-words` only).

Leading/trailing words (`fit`, `music`, `playlist`, prose) around the first number do
**not** change step 1 — only position of the first digit token matters.

| Comment | Music (1st #) | Fit (from remainder) |
| --- | --- | --- |
| `75` | 75 | — |
| `fit 8` | 80 | — |
| `music 80` | 80 | — |
| `8 fit` | 80 | — |
| `78 music, 8 fit` | 78 | 80 (`8 fit` in remainder) |
| `75 80` | 75 | 80 (2nd # in remainder; `--fit-words`) |
| `80 fit 75` | 80 | 75 (2nd # in remainder; `--fit-words`) |
| `76 fit bonus` | 76 | shorthand strong/85 |
| `fit 7. music 8` | 70 | 80 (1st # is 7, not fit-first) |

### Comment layout: scoring line vs submission

1. **Scoring line** (top) — scratch notes you will delete or trim before submit: music
   score, fit shorthand, tier/gate words, numeric fit.
2. **Submission tail** (below) — prose you may **keep** on the vote, separated from
   scoring by one or more newlines so cleanup does not swallow it.

**Rule:** Split on the **first `\n`**. Parse fit signals only from the **scoring line**
(first line). The submission tail is never scanned for tier/gate/shorthand or extra
fit numbers — it is inert for parsing (still stored as the full comment text).

```
75? strong maybe          ← scoring line (parse this)
                          ← newline(s)
Great song — fits the vibe perfectly   ← submission tail (ignore for fit/tier/gate)
```

This applies **always** (with or without `--fit-words`). It prevents gate/tier words
in submission prose (`fits`, `maybe` in a sentence, `off-theme joke`) from affecting
allocation.

**Remainder fit parsing:**

| Signal | `--fit-words` | Notes |
| --- | --- | --- |
| Explicit `N fit` / `fit N` in remainder | either | e.g. `78` peeled → ` music, 8 fit` → fit 80 |
| 2nd number in remainder | **on** | e.g. `75` peeled → ` 80` → fit 80 |
| `FIT_SHORTHAND` in remainder | either | e.g. `76 fit bonus` |
| Tier / gate words in remainder | **on** | first match; scoring line only |

Tier/gate/shorthand: **first match wins** per channel on the remainder (one tier, one gate).

---

### What becomes **music** (`score`)

**Always** the first number on the scoring line (+ mods). Words before/after that token
(`fit`, `music`, prose) are ignored for music extraction.

| Pattern | Example | Result |
| --- | --- | --- |
| First number | `75`, `75?`, `73+` | music = scaled number; mods attached |
| Words before first # | `fit 8`, `music 80` | music from first # (80) |
| Trailing prose after first # | `74 soft punk` | music 74; rest ignored for music |
| Number only on submission tail | `75?\nGreat song 80` | music 75 from line 1; **80 ignored** |

**Bug today:** fit tokens are stripped *before* finding the music number, so `8 fit`
alone becomes fit-only and `76 fit bonus` loses music 76. Fix: peel **first number
first**, then parse remainder.

### What becomes **fit** (`fitScore` / `fitTier`)

Parsed from the **remainder** after the music number is peeled. Three fit channels:

| Channel | `--fit-words` | When |
| --- | --- | --- |
| **Numeric fit** | not required | Explicit `N fit` / `fit N` in remainder (`78` + ` music, 8 fit`) |
| **2nd number** | **required** | Bare 2nd # in remainder (`75` + ` 80`) |
| **Fit shorthand** | not required | Multi-word phrases in remainder (`76 fit bonus`) |
| **Tier / gate words** | **required** | `strong`, `pass`, `maybe`, … in remainder |

#### Numeric fit & 2nd number

| Pattern | Example (full comment) | `--fit-words` | Result |
| --- | --- | --- | --- |
| Explicit in remainder | `78 music, 8 fit` | either | music 78, fit 80 |
| 2nd # in remainder | `75 80`, `80 fit 75` | **on** | 1st music, 2nd fit |
| 2nd # in remainder | `75 80` | off | music 75; 2nd # ignored |
| Shorthand in remainder | `76 fit bonus` | either | music 76, fitTier strong |
| Lone `8 fit` / `fit 8` | whole comment | either | music 80 only; no remainder fit |

#### Fit shorthand (always on; scoring line only)

Short phrases the owner uses instead of full tier words when pre-marking songs that
should rank higher on fit **before** LLM fit research runs. Distinct from generic
tier/gate vocabulary (those stay behind `--fit-words`). **Not matched past first `\n`.**

| Phrase | Maps to | fitScore | Example comment | Result |
| --- | --- | --- | --- | --- |
| `fit bonus` | `strong` | 85 | `76 fit bonus` | music 76, fitTier strong, fitSource manual |
| `fit bonus` | `strong` | 85 | `fit bonus` (alone) | score null, fitTier strong |

*(Extensible list in `FIT_SHORTHAND` in `comment.mjs` / `fit-signal.mjs`; add phrases
only with a contract row + test.)*

**Intent:** `fit bonus` = "I'm confident this fits — bump combined ranking" without
writing `strong fit` or a numeric `8 fit`. Triggers auto-combined allocation when
any manual fit is present (same as numeric fit).

#### Tier / gate words (`--fit-words` only; scoring line only)

When `--fit-words` is passed, the **flag** enables tier/gate vocabulary on the
**scoring line** — no literal `fit` after tier words. When the flag is off, none of
these match (except [fit shorthand](#fit-shorthand-always-on-scoring-line-only)).
Nothing in the submission tail is scanned.

| Pattern | `--fit-words` | Example (scoring line) | Result |
| --- | --- | --- | --- |
| Tier word | **on** | `strong`, `75 strong`, `solid 72` | fitTier + music if number present |
| Tier word | off | `75 strong` | music 75; **no tier** |
| Tier + negation | **on** | `strong negative` | *(ignored)* |
| Gate word | **on** | `pass`, `75 maybe` | gate; music if number present |
| Gate on tail | either | `75?\n…maybe fits…` | music 75; **gate null** (tail ignored) |
| Tier on tail | **on** | `75?\n…strong finish…` | music 75; **no tier** from tail |
| Single-line gate | **on** | `maybe great song 75` | music 75 + gate maybe (all on line 1) |
| Single-line gate | off | `maybe great song 75` | music 75; **gate null** |

**First match** per channel on the scoring line (one tier, one gate). Precedence:
fail > maybe > pass for gates. Multi-word shorthand phrases checked before single-word
tier/gate regexes to avoid `fit bonus` splitting.

### What becomes **gate** (`gate`)

Same as tier words — **`--fit-words` only**. See table above.

### What is **ignored** (no field set)

| Text | Why |
| --- | --- |
| Submitter comment field | Scoring-neutral; not passed to `scoreComment` |
| Submission tail (after first `\n`) | Never scanned for fit/tier/gate/shorthand |
| Prose on scoring line (not in vocabulary) | `"74 soft punk"` — music 74; rest ignored on that line |
| `10/10`, alternate scales | Ignored (existing rule) |
| Lowercase `todo` in prose | Not a placeholder marker (only all-caps `TODO`) |

### Special outcomes (not music/fit/gate)

| Input | Mode | Result |
| --- | --- | --- |
| `` (empty) | any | `needsUserInput` |
| `TODO`, `TODO 80` | any | `needsUserInput`; score not trusted |
| `-` | any | `isDisqualified` |
| `no` / `nope` / `invalid` | any | `isDisqualified` |
| words only, no number | objective | `isDisqualified` |
| words only, no number | subjective | `needsReview` |
| `76 music` | thematic | music 76; `needsResearch` (fit unknown) |

### Fixture matrix (tests must cover)

Write one test per row. Columns: `comment`, `fitWords`, `mode`, expected
`score`, `fitScore`, `fitTier`, `gate`, flags, `needsReview`.

**Default off (`fitWords: false`):**

| comment | score | fit | gate | notes |
| --- | --- | --- | --- | --- |
| `75` | 75 | — | — | bare music |
| `75?` | 75 | — | — | uncertain mod |
| `78 music, 8 fit` | 78 | 80 | — | peel 78; remainder has `8 fit` |
| `8 fit` | 80 | — | — | peel 8; no remainder fit |
| `fit 8` | 80 | — | — | peel 8; leading `fit` ignored |
| `fit 7. music 8` | 70 | 80 | — | peel 7; remainder has 8 |
| `76 fit bonus` | 76 | strong / 85 | — | shorthand in remainder |
| `fit bonus` | null | strong / 85 | — | shorthand only |
| `maybe great song 75` | 75 | — | — | **no gate** |
| `off-theme 80` | 80 | — | — | **no gate** |
| `strong fit` | null | — | — | **no tier** (words off) |
| `solid track 72` | 72 | — | — | prose not tier |
| `74 soft punk` | 74 | — | — | trailing prose on scoring line OK |
| `75?\nGreat song, maybe fits` | 75 | — | — | tail ignored (off or on) |

**With `--fit-words` (`fitWords: true`):**

| comment | score | fit | gate | notes |
| --- | --- | --- | --- | --- |
| `75 80` | 75 | 80 | — | peel 75; 2nd # in remainder |
| `80 fit 75` | 80 | 75 | — | peel 80; 2nd # in remainder |
| `75 playlist 80` | 75 | 80 | — | filler in remainder OK |
| `music 75 fit 80` | 75 | 80 | — | peel 75; remainder has `fit 80` |
| `75 strong` | 75 | tier strong | — | tier on scoring line |
| `75 strong\nGreat song` | 75 | tier strong | — | tail ignored |
| `75?\n…off-theme joke…` | 75 | — | — | no gate from tail |
| `strong` | null | tier strong | — | tier only, one line |
| `pass` | null | — | pass | gate-only |
| `maybe a 70?` | 70 | — | maybe | all on scoring line |
| `maybe great song 75` | 75 | — | maybe | single-line OK |
| `76 fit bonus\npublic comment` | 76 | strong / 85 | — | shorthand line 1 only |

---

### Decisions locked (from Q&A)

- **Peel-first:** first number on scoring line = music; parse **remainder** for fit. No
  fit-only comments. Owner always writes music first for scanning.
- **Scoring line** = text before first `\n`; submission tail never scanned.
- With `--fit-words`: 2nd number in remainder → fitScore; tier/gate in remainder.
- Explicit `N fit` / `fit N` in remainder works with or without `--fit-words`.
- **Fit shorthand** (`fit bonus`): always on, remainder only.
- Numeric coercion (`scaleScoreToken`: `7->70`, `75->75`, `755->75.5`) is intentional and unchanged.
- When any song has manual fit, allocation auto-switches to `rankBy: combined` using a new balanced default weight (0.5 fit / 0.5 music), overridable with `--weights` / `--rank`.
- Manual fit is persisted in `music.json` and rendered in `music.html`.
- Allocate and render are separated: allocation happens only in the parse/merge step; renderers are pure presenters of a persisted JSON.

### Current behavior (for reference)

- `parseFitTokens` today arms tier words on literal `\bfit\b` and matches gate words
  unconditionally — both wrong for default parse ([comment.mjs](scripts/score/comment.mjs)).
- `buildJsonPayload` ([score-core.mjs:1595](scripts/score-core.mjs:1595)) drops `fitScore`/`fitTier`/`gate`/`fitSource`/`combinedScore`.
- `render-final-html` re-derives fit by re-running `scoreComment` on the stored comment ([render-final-html.mjs:100](scripts/render-final-html.mjs:100)) AND re-runs `mergeFitJson` (allocation) when given `--fit` ([render-final-html.mjs:110](scripts/render-final-html.mjs:110)) — so allocation happens inside render, sometimes.
- Plain allocate path is music-only ([parse-round.mjs:260](scripts/parse-round.mjs:260)); `rankValue('combined')` already blends `fitScore`+`score` live ([score-core.mjs:227](scripts/score-core.mjs:227)).

### 1. Parsing: identifier-anchored numbers + word gating (`scripts/score-core.mjs`)

- `scoreComment(rawComment, mode, opts = {})` — add `opts` carrying `{ fitWords = false }`.
- Split `rawComment` → `scoringLine` (before first `\n`) + `submissionTail` (unused).
- **Peel music:** first `\d` token (+ mods) on `scoringLine` → `score`; `remainder` = rest.
- **`parseFitFromRemainder(remainder, { fitWords })`:**
  - `FIT_SHORTHAND` multi-word phrases first.
  - Explicit `N fit` / `fit N` in remainder (not start of shorthand phrase).
  - When `fitWords`: 2nd number in remainder → fitScore.
  - `FIT_TIER_SYNONYMS` / `GATE_WORDS` only when `fitWords`; first match; negation guard.

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

### 6. Tests (TDD)

**New file (preferred):** `tests/comment-parse.test.mjs` — import `scoreComment` from
`score-core.mjs`; helper `parse(comment, { fitWords, mode })`.

**Do first (red):** full fixture matrix in [Parsing contract](#parsing-contract-default---fit-words-off)
above. Existing `scoreComment manual fit notation` block in `score.test.mjs` must be
**split or rewritten** — several assertions encode the old over-match behavior
(`borderline, maybe` → gate, `strong fit` → tier without flag) and will flip.

**Already green (don't break):** digit scaling, modifiers, DQ/needs-input, persistence,
auto-combined allocation, pure render.

**CLI integration (after unit matrix green):** one parse-round test that `--fit-words`
threads through to extracted songs (optional; can follow in Wave 2).

### 7. Spec / docs / decision log

- **`spec/score-parsing.md`** — replace/extend "Manual Fit Notation" with the parsing
  contract tables (music / fit / gate / ignored / special outcomes). This is the
  owner-facing agreement doc; keep in sync with tests.
- `spec/point-allocation.md`: manual-fit auto-combined already documented — touch only if contract changes allocation inputs.
- `spec/decisions.md`: one entry when Wave 1 ships (word gating + identifier grammar + TDD contract).

### Edge cases / risks

- Old `music.json` files lack fit fields -> render music-only; re-running `ml parse` regenerates them cleanly.
- `mergeFit` precedence relies on `fitSource === 'manual'` ([score-core.mjs:1340](scripts/score-core.mjs:1340)) — preserved by persisting `fitSource`.
- `needsResearch` thematic flag and the downvote path are unaffected.
- Mixed rounds (some songs fit, some not): `combinedScore` already falls back to music when `fitScore` is null ([score-core.mjs:1316](scripts/score-core.mjs:1316)).
- Removing `render-final-html --fit` is a CLI surface change; the only caller is `ml final`, updated here to merge-then-render.
