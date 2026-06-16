---
name: parse-scores-pipeline
description: >-
  Runs Music League round inputs through parse-round.mjs and the ml.mjs dispatcher —
  HTML vs text path, modes, merge flags, and test verification. Use when parsing a
  round, fixing parser bugs, or reproducing analysis outputs from rounds/ inputs.
disable-model-invocation: true
---

# Score input pipeline

After merge, confirm `draftVotes` sum to `upvoteBankSize` and `draftDownvotes` to `downvoteBankSize` (when enabled); no song has both.

## Pre-allocation gate (do this before ANY allocation)

After every parse, **lead** with blockers before showing any distribution — above
all **blank scores** (`needsUserInput`): never invent one, resolve each (or get an
explicit "leave 0") first. Also surface parse-health issues and `needsReview`
flags; a bare-`-` DQ is not a blocker.

Full rule + rationale: [`spec/point-allocation.md` → Pre-allocation gate](../../../spec/point-allocation.md#pre-allocation-gate-resolve-blocking-inputs-first).

## Music-only rounds (no fit)

Plain rounds need **parse only** — no fit JSON, no merge, no `just fit`:

```bash
just parse <name>              # or: just run <name> on a fresh round
# → analysis/<name>/music.md + music.json with draft allocation
```

Open `analysis/<name>/music.md` for ranked + raw-order vote tables. `just status <name>` shows fit steps as optional and says you're done after parse for music-only rounds.

## Flow

Pipeline tree and artifact paths: **round-artifacts** skill and
[`spec/analysis-artifacts.md`](../../../spec/analysis-artifacts.md).

`extract-html.mjs` and `parse-text.mjs` are libraries — always invoked via `parse-round.mjs`.

## Choose input path

| Input          | When                                           | Notes                                                        |
| -------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| `.html`        | Saved round page (preferred)                   | Full budget cap, Spotify URI, reliable `data-comment`        |
| `.txt` strict  | Copy/paste with `Album art` + `N/1000` footers | Same canonical shape as HTML                                 |
| `.txt` lenient | Live Text / OCR paste                          | Auto-detected when anchors missing; use `--lenient` to force |

Dispatcher prefers HTML when both `.html` and `.txt` exist.

## Commands

**Recommended (fuzzy name):**

```bash
just parse tarot                           # default --mode objective, writes JSON
just parse tarot --mode subjective
just parse tarot --no-json                 # markdown only
just run tarot                             # next step (parse if not done)

npm run ml -- parse tarot --lenient        # without just
```

**Direct (explicit path):**

```bash
node scripts/parse-round.mjs tests/fixtures/sample-round/sample-round.html
node scripts/parse-round.mjs rounds/2026-06-09-tarot-hanged-man.txt --lenient
```

**Merge fit + allocate (after `fit.json` exists):**

```bash
node scripts/parse-round.mjs rounds/<name>.html \
  --fit analysis/<name>/fit.json \
  --rank combined \
  --shape auto \
  --gate passFailMaybe \
  --cutoff fit:68
```

Profile flags (all optional except `--fit` path):

| Flag        | Values                                                            | Default                 |
| ----------- | ----------------------------------------------------------------- | ----------------------- |
| `--mode`    | `objective`, `subjective`                                         | `objective`             |
| `--rank`    | `music`, `fit`, `combined`                                        | `combined` when `--fit` |
| `--shape`   | `auto`, `bell`, `compressed`, `balanced`, `top-heavy`, `relative` | `auto`                  |
| `--gate`    | `passFail`, `passFailMaybe`                                       | none                    |
| `--cutoff`  | `axis:min` e.g. `fit:68`, `music:70`                              | none                    |
| `--lenient` | (text only)                                                       | auto-detect             |

Writes **`scores.json`** with `draftVotes`, `musicScore`, `combinedScore`. **`fit.json` is not modified.** Prints tradeoffs needing human choice.

**Render:**

```bash
just scores tarot              # deliverable HTML
just fit tarot                 # fit-only HTML
just fit tarot --order combined --out analysis/<name>/fit.html
node scripts/render-fit-html.mjs analysis/<name>/scores.json
```

## Modes

- **objective:** words-only comment → disqualified (not scored).
- **subjective:** words-only → `needsReview` (may carry fit meaning).

Words-only with manual fit tokens (`pass`, `strong fit`) still parse fit signals — see `spec/score-parsing.md`.

## Outputs

**`analysis/<name>/music.md`** — ranked table, raw-order vote table, round description, needs-score/DQ/review lists, tradeoffs.

**`analysis/<name>/music.json`** — canonical songs with parsed signals; source for fit step context.

## Verify

```bash
npm test
```

| Test file                   | Covers                                   |
| --------------------------- | ---------------------------------------- |
| `tests/score.test.mjs`      | `scoreComment`, `allocate`, gates, merge |
| `tests/parse-text.test.mjs` | Lenient Live Text fixture                |

Adding regressions:

1. Capture failing input in `tests/regressions/` (`.txt`, `.md` notes, or minimal HTML snippet).
2. Assert canonical fields in a new `tests/*.test.mjs` case — follow existing patterns.
3. Run `npm test` before claiming fixed.

Regression prose cases in `tests/regressions/00N.md` document score-parsing edge cases (e.g. `715` ≠ `735`).

## Common failures

| Symptom                     | Fix                                             |
| --------------------------- | ----------------------------------------------- |
| Many `needsUserInput`       | Re-export HTML after autosave + reload          |
| No songs found              | Wrong file type or empty paste                  |
| Ambiguous `just parse 2026` | Use a more specific fuzzy name                  |
| Budget mismatch in report   | Rebalance manually or adjust allocation profile |

See **round-artifacts** for capture conventions and **point-allocation** for profile semantics.
