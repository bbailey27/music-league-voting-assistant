# Fit Evaluation

## Objective Prompts

Correctness dominates.
Explanations do not make invalid entries valid.

## Conceptual Prompts

Evaluate fit and music separately.
Determine weighting before ranking if unclear.

Some recurring conceptual tastes are captured as **opt-in lenses** in
[fit-guidance.md](fit-guidance.md) (e.g. weighting personality traits over a
literal symbol/element, or judging trait fit from lyrics rather than vibe). Those
are _suggested per league/style and confirmed with the user_ — the rules in this
file always apply; a guidance profile only refines them for matching rounds.

## Lyric-Based Prompts

Use lyric analysis only when the prompt genuinely depends on lyrics.

Submitter explanations can strengthen a subjective interpretation but do not automatically improve ranking.

## Clarify before scoring

**No assumptions about priorities.** Before scoring, confirm the points below. If any
is unset and not covered by a confirmed [guidance profile](fit-guidance.md) or explicit
user instruction for this round, **ask before scoring**.

Run one short pass (one question at a time), then score.

### Necessary points to confirm

1. **Prompt type & gate** — objective vs conceptual vs lyric; graded tiers vs
   `pass/fail` (or `pass/maybe/fail`) gate.
2. **Criteria/trait list** — dimensions fit will be judged on; surface explicitly
   for user reaction.
3. **Relative influence** — pin each trait using the [influence vocabulary](#influence-vocabulary-be-precise) below.
4. **Guidance-profile match** — if the round matches [Associations](fit-guidance.md#associations),
   propose the profile, describe its lens concretely, and confirm (never auto-apply).
5. **Gate boundary** (gate rounds only) — clarify the pass/fail line, or score clear
   cases and list borderline entries for user adjudication.
6. **Music weighting** — see [timing rule](#when-to-ask-about-music-weight) below.

### Influence vocabulary (be precise)

Vague "A matters more than B" is ambiguous. Pin each trait to one level:

- `primary` — drives the tier.
- `co-primary` / `even` — ~equal weight; all drive the score together.
- `secondary` — real fit signal, leans below primary but stacks; strong secondary
  reads can match a basic primary and is **field-relative** (see `traits-over-symbols`
  in fit-guidance). Absence of a primary is not penalized.
- `bonus` — helps when present; absence neutral; lighter and more additive than
  `secondary`.
- `tiebreak-only` — splits ties only; does not move the tier.
- `soft-penalty-if-present` — presence drags down; absence neutral.
- `ignore` — not scored.
- `hard-gate` — failing zeroes the song regardless of other traits.

When the user ranks traits, resolve the lower trait's level explicitly (co-primary,
secondary, bonus, tiebreak, penalize-when-present, or ignore).

### When to ask about music weight

Fit and music are scored and combined separately (`combineWeights`). Whether to
clarify the fit-vs-music balance now depends on the task:

- **Fit-research-only task** (no music scores yet, or merge/allocation happens
  later): **do not** ask about music weight yet. Capture trait influence and stop.
- **Music scores already parsed and allocation comes right after research:** go
  ahead and clarify the fit-vs-music weight (and any per-axis music role like a
  `bonus`) in the same pass, so the merge can run immediately.

## Canonical fit signal

Both the LLM fit JSON and manual comment tokens produce the **same** per-song fit
shape that the allocator consumes:

- `fitTier` — graded (`excellent | strong | solid | moderate | weak | nope`) or a
  gate word (`pass | maybe | fail`).
- `fitScore` — numeric (0–100); derived from the tier's representative value when
  only a tier is given (`FIT_TIER_SCORES`).
- `gate` — `pass | maybe | fail` for gate rounds (a gate word in `fitTier` is
  accepted too).
- `source` — `manual` vs `llm`. **Manual wins**; the LLM fills only fit-silent songs.

For gate rounds, rank the `maybe` band by how defensible the read is (fitScore),
not by music — music is only a secondary tiebreak.

## Output

Fit research is written to **`analysis/<roundname>/fit.json`** (fit-only — no `draftVotes`). After merge, the deliverable is **`analysis/<roundname>/scores.json`**. See [analysis-artifacts.md](analysis-artifacts.md).

The deterministic merge step (`parse-round.mjs --fit <fit.json>` / `mergeFitJson`) joins `fit.json` with the parsed music scores by `rawOrderIndex`/title, computes `combinedScore` (a **per-round normalized** blend — each axis z-scored over the contenders with asymmetric std floors, then remapped onto a ~75-centered scale, not a literal `0.7 × fit + 0.3 × music`; see [point-allocation.md](point-allocation.md)), runs the allocator, and writes **`scores.json`** with `musicScore` / `combinedScore` / `draftVotes` — `fit.json` stays fit-only; the LLM never supplies `draftVotes`.

The human-readable fit report is the **generated HTML**, not a markdown table: run `scripts/render-fit-html.mjs` on the JSON. The HTML uses a stacked card layout (raw-order # / title / artist in a narrow identity column) so the rationale/notes get full width.

Once an allocation exists (songs carry `draftVotes`), every output must end with a
**vote-transfer table**: raw submission order, song metadata (`#`, title, artist), points,
and a total — the copy-back-into-Music-League view. HTML renders it from `draftVotes`;
markdown companions (`music.md` after parse; optional hand-maintained `fit.md`) must
include the same table when votes exist.
