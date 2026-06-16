# Decision Log

Why the tools behave the way they do — and what we tried and rejected along the
way. The other `spec/` files say **what** the current behavior is; this file is
the running history of **how we got there**, so a decision that was reversed (or
nearly reversed) doesn't get silently re-litigated every few rounds.

## How to maintain this

- Newest entry first.
- One entry per committed behavior change (or a notable clarification that
  reshaped a rule). In-session false starts that never landed don't need an
  entry; a decision that changed committed behavior does.
- Keep each entry short: **Change** (what), **Why** (the reasoning / the user
  call behind it), **Overruled** (only when it reverses or supersedes an earlier
  decision), **Refs** (commit hash once committed, or `working tree` if not yet;
  plus the spec section it affects).

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

**Refs.** `working tree`; affects `spec/point-allocation.md` (new _Pre-allocation
gate_ section) and the three skills above.

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

**Change.** Fit research is written to `analysis/<round>-fit.json` (one object per
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
