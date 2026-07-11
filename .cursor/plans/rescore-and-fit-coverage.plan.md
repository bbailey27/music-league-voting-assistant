---
name: rescore-and-fit-coverage
overview: Add `just rescore` (re-weight/re-allocate from JSON, no raw re-parse) and make needsFitScore channel-agnostic (tier/gate, not just numeric). Rolls in future-plans #17 (partial) + the Q1 fit-coverage fix.
status: pending
isProject: false
todos:
  - id: fit-coverage
    content: Channel-agnostic needsFitScore — flag missing tier/gate signal, not just numeric
    status: pending
  - id: rescore-core
    content: rescore-round.mjs — re-blend stored score/fitScore + re-allocate menu from music.json (+fit.json), never HTML
    status: pending
  - id: rescore-persist
    content: Persist new combinedScore/profile to music.json+md; reset committed pick to draft; no picks.jsonl write
    status: pending
  - id: rescore-cli
    content: Wire `just rescore` / `ml rescore`; remove inert --weights from pick (points to rescore); help + usage
    status: pending
  - id: rescore-tests
    content: Tests (rescore re-blend changes combined + menu; pick reset; fit-coverage tier/gate) + regression snapshot
    status: pending
  - id: rescore-docs
    content: decisions.md, score-parsing/point-allocation spec, README, cli-help; close future-plans #17 (partial) + Bugs #1
    status: pending
---

# `just rescore` + channel-agnostic fit coverage

Rolls in **future-plans #17** (the re-weight/re-allocate-without-re-parse slice) and the
**Q1** fit-coverage fix. Deferred from #17: manual raw-score edit (B) and any music/fit
JSON restructure (D). Scope confirmed with owner: **A + C** only.

## Motivation

Re-weighting a round today requires `just parse` on the raw HTML, which risks changing
the owner's file (a test re-parse silently dropped 0.7/0.3 → 0.5/0.5 and re-ranked the
field). `pick --weights` looks like it should help but is **inert for ranking** (ranks off
the stored `combinedScore`; only `parse` recomputes the blend — backlog "Bugs #1"). The
default combined weight is already `{ fit: 0.7, music: 0.3 }` (`DEFAULT_COMBINED_WEIGHTS`),
so no default change is needed — the fix is a JSON-sourced re-blend command.

## Approved design decisions

- **Separate verb**, not an overload: `just rescore` recomputes + reprints but does **not**
  pick (owner keeps `pick` for committing a distribution).
- **Re-blend only**: rescore changes the blend + allocation, sourcing stored `score` /
  `fitScore` as truth. It does **not** re-scan comments for fit/tier/gate words (that stays
  in `parse`; keeps forward-compat with deferred manual-edit feature B).
- **Reset to draft**: when the blend changes, clear any committed pick (finalVotes + pick
  record) so the owner re-picks against the new scores.

## A. `just rescore <round> [knobs]`

New `scripts/rescore-round.mjs` (mirrors `pick-round.mjs`'s arg/profile plumbing).

Knobs (all merge over stored `profile`, same as `pick`'s `buildProfile`):
`--weights m:f`, `--shape`, `--gate`, `--cutoff`, `--down-shape`, `--tier-count`,
`--bucket-count`, `--favorite-band`, `--rank`.

Flow:
1. Read `music.json`; `useMerge = existsSync(fitJson)` (thematic) as in `pick-round.mjs`.
2. Rebuild profile from args + stored `musicData.profile`.
3. **Re-blend** stored per-song `score` + `fitScore` into new `combinedScore`:
   - objective / manual-fit: `applyManualFitScoring(profile, songs, { weights })`
     (`scripts/parse-round.mjs`) → `normalizeCombined` on stored `fitScore`/`gate`.
   - thematic (fit.json): `mergeFitJson(parsed, fitData, profile)` (`scripts/score/render.mjs`).
4. **Re-allocate the menu** (`allocate` / `mergeFitJson` tradeoffs) — no letter chosen.
5. **Reset committed pick to draft**: drop `pick`/committed `finalVotes` so the written
   JSON/md is menu/draft state (`draftVotes`), not a stale applied ballot.
6. **Persist**: write `music.json` (+ `music.md`) via `buildJsonPayload` / `buildMarkdown`
   with updated `combinedScore` + `profile` (weights + knobs). Do **not** touch
   `picks.jsonl`.
7. **Print** the `parse`-style menu (up A/B/C options, down-structure, notes, draft ballot)
   — reuse `printPickCli` from `scripts/parse/cli-print.mjs`.

Cleanup enabled: remove `--weights` from `pick` (inert there) and hint `use just rescore`;
resolves backlog "Bugs #1".

## C. Channel-agnostic `needsFitScore`

`applyNumericFitAutoDetect` (`scripts/score/comment.mjs`) currently sets `needsFitScore`
only for numeric rounds. Generalize the *flag* (keep the numeric *commit* as-is):

- After the numeric commit, run a `flagMissingFitSignals(songs)` pass: a song "has fit" if
  `fitScore != null || fitTier != null || gate != null`. If **≥ `NUMERIC_FIT_MIN_RATIO`
  (0.75)** of scored songs have a fit signal, set `needsFitScore = true` on the ones that
  don't.
- Numeric-missing flagging becomes a special case of this general pass; keep behavior
  identical for numeric rounds. Existing surfacing (`warnMissingFitScoresCli`, `ml status`,
  `music.json`) now covers tier- and gate-graded rounds too.

## Implementation phases

1. **fit-coverage** — generalize the flag in `comment.mjs` (+ tests in
   `tests/comment-parse.test.mjs`). Independent; land first.
2. **rescore-core** — `rescore-round.mjs` re-blend + re-allocate from JSON.
3. **rescore-persist** — write-back + draft reset.
4. **rescore-cli** — `ml.mjs` dispatch, `justfile` recipe, drop `pick --weights`, help/usage.
5. **rescore-tests** — rescore re-blend changes combined + menu; pick reset; regression
   snapshot refresh if the sample-round pipeline output shifts.
6. **rescore-docs** — `spec/decisions.md`, `spec/score-parsing.md`,
   `spec/point-allocation.md`, `README.md`, `scripts/cli-help.mjs`; mark future-plans #17
   partially shipped (B/D remain) and close Bugs #1.

## Verification

- `node --test` green; `node scripts/regression-snapshot.mjs` matches (update baseline only
  for intended drift).
- Manual: on a fit round, `just rescore <round> --weights 5:5` changes `combinedScore` +
  the menu without reading HTML; re-running with `--weights 7:3` returns to the original
  blend. A tier-only round with one un-graded song shows the `needsFitScore` callout.
