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

**No assumptions about priorities.** Before scoring a round's songs, confirm the
points below. If any is unspecified and is **not** settled by a confirmed
[guidance profile](fit-guidance.md) or an explicit user instruction for this
round, **ask the user before scoring** — do not invent a priority order.

Run this as one short clarification pass (one question at a time), then score.

### Necessary points to confirm

1. **Prompt type & gate** — objective vs conceptual vs lyric; graded tiers vs a
   `pass/fail` (or `pass/maybe/fail`) gate round.
2. **Criteria/trait list** — the dimensions fit will be judged on (e.g. grammar,
   continuation, symbol/element, personality traits, lyrics-vs-vibe). Surface the
   list explicitly so the user can react to it.
3. **Relative influence of each trait** — how much each dimension moves the score,
   using the **influence vocabulary** below. Never assume one trait outranks another.
4. **Guidance-profile match** — if the round matches a row in the
   [Associations](fit-guidance.md#associations) table or an existing profile,
   **propose it, describe its lens concretely** (not just the id), and get
   confirmation. Profiles are suggested, never auto-applied.
5. **Gate boundary** (gate rounds only) — clarify where the pass/fail line sits if
   it is unclear. If only a few entries are borderline, you may score the clear
   ones and **list the questionable cases at the end for the user to adjudicate**
   rather than guessing.
6. **Music weighting** — see [timing rule](#when-to-ask-about-music-weight) below;
   often deferred.

### Influence vocabulary (be precise)

A vague "A matters more than B" is ambiguous. Always pin down what the lower
trait's influence actually is, using these levels:

- `primary` — drives the score; the main basis for the tier.
- `co-primary` / `even` — two or more traits weighted ~equally; all drive the
  score together. One primary present and one co-primary present are roughly even.
- `secondary` — a real fit dimension that **leans** slightly below primary, as a
  fuzzy distinction rather than a hard cap. It meaningfully shapes the tier (more
  than a tiebreak) and stacks with primaries, and a missing primary is **not**
  punished. All else equal a primary edges out a secondary, but the gap is small:
  **strong scores across several secondaries can match or beat a basic read of a
  primary.** It is also **field-relative** — if many songs nail the primary,
  secondary-only songs slide down; if most of the field leans on secondaries, the
  primary becomes more of a `bonus` to a few songs and a strong secondary can earn
  the top tier. Use this for "close 2nd" traits (e.g. the symbol/element in
  `traits-over-symbols`).
- `bonus` — adds points on top when present but is **not itself a fit signal**;
  **absence is not penalized** (e.g. "a fair amount of bonus from music"). Lighter
  and more additive than `secondary`, which can carry partial fit on its own.
- `tiebreak-only` — does **not** move the tier; only separates otherwise-equal songs.
- `soft-penalty-if-present` — presence **drags the score down** (down-rank);
  absence is neutral/fine.
- `ignore` — not scored at all.
- `hard-gate` — binary requirement; failing it zeroes the song regardless of every
  other trait.

When the user says "A matters more than B", resolve which of these B is — e.g.:

> "Should B be a lower-weighted **co-primary** (still shapes the tier, just less),
> a **secondary** signal (a close 2nd — leans slightly lower, but stacks and can
> match/beat a basic primary read; field-relative), a **bonus** (helps when present, never
> hurts, but isn't fit on its own), a **tiebreak** (only splits ties), something
> we **penalize when present**, or **ignored** entirely?"

Ask analogously about each trait the user wants to have more or less influence:

> "Among these traits — [the trait list] — are there any you want to have more or
> less influence on the fit score, and which level above does each land on?"

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

Fit research is written to the JSON sidecar (`analysis/<roundname>-fit.json`), which is the source of truth — one object per song (tier, fitScore, themesHit, flags, confidence, basis, submitterAssist, rationale) plus round metadata and the fit scale. The JSON may also carry optional `highlights` (string array) and `combine` (`{ note, options[] }`) narrative fields.

The deterministic merge step (`parse-round.mjs --fit <fit.json>` / `mergeFitJson`) joins this file with the parsed music scores by `rawOrderIndex`/title, computes `combinedScore`, runs the allocator, and writes `musicScore` / `combinedScore` / `draftVotes` back into it — so the LLM never needs to supply `draftVotes`.

The human-readable fit report is the **generated HTML**, not a markdown table: run `scripts/render-fit-html.mjs` on the JSON. The HTML uses a stacked card layout (raw-order # / title / artist in a narrow identity column) so the rationale/notes get full width.

Once an allocation exists (songs carry `draftVotes`), both outputs must end with a **vote-transfer table**: raw submission order, just song metadata (`#`, title, artist) and the points, plus a total. This is the copy-back-into-Music-League view. The HTML renders it automatically from `draftVotes`; the markdown companion must include the same table.
