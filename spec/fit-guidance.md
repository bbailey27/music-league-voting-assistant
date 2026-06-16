# Fit Guidance Profiles (opt-in lenses)

Named, **optional** fit-research lenses. Unlike [fit-evaluation.md](fit-evaluation.md)
(universal rules that always apply), a profile here is a _preference_ that only
applies to rounds where it fits. They exist so recurring tastes don't have to be
re-explained every round, **without** silently overriding the default read for
rounds where they don't belong.

## How profiles are applied

- **Suggested, not automatic.** Before scoring, check [Associations](#associations)
  and run the clarification pass in
  [fit-evaluation.md → Clarify before scoring](fit-evaluation.md#clarify-before-scoring).
- **Record what was applied.** When a profile is used, list it in the fit JSON's
  top-level `guidanceProfiles: ["id", …]` and reflect it in `method`
  (see [fit-json-schema.md](../.cursor/skills/round-fit-research/fit-json-schema.md)).
- **Scope is per round.** A profile is a candidate for similar rounds, never a
  global default. An explicit user instruction for a round always wins over a
  profile, and a profile never overrides the universal rules in
  [fit-evaluation.md](fit-evaluation.md) or a manual fit token in a user comment.
- **Profiles compose.** More than one may apply to the same round (e.g.
  `traits-over-symbols` + `lyrics-first`).

## Profiles

### `traits-over-symbols`

**When to consider:** Astrology / archetype / persona / "describe a character or
type" prompts that list **both** a literal symbol or element **and** personality traits.

Decision log: [`decisions.md`](decisions.md) → 2026-06-10 — `traits-over-symbols`.

**Lens:**

- **Both is best.** both > traits-only > symbol-only > neither.
- **Symbol/element is a positive secondary signal — never a penalty.** Shared
  elements (e.g. water across water signs) cannot reach the top tier alone but stack
  with traits. A specific archetype reference beats a generic shared-element match.

**Tier effect:** top tier needs **both**; traits-only above symbol-only; never
downgrade for carrying imagery.

### `lyrics-first`

**When to consider:** Any conceptual/thematic round where fit is about meaning or
temperament rather than a sonic genre brief.

**Lens:**

- Judge trait/concept fit primarily from the **lyrics** (explicit words and clear
  imagery), not the instrumental **vibe**/production mood.
- Vibe/production may _corroborate_ a lyric-backed read but cannot be the sole
  basis for a high tier. A song whose only connection is "it sounds dreamy/sad/etc."
  caps around `weak`–`moderate` unless the lyrics back it up.
- Use `basis` honestly (`lyrics` vs `vibe`) and flag `vibe-leaning` / `vibe-only`
  so the downgrade is visible.

**Tier effect:** vibe-only fits are capped low; lyric-evidenced fits rank above
equally-themed vibe-only ones.

### `story-continuation`

**When to consider:** Continue-the-sentence / collaborative creative-writing
rounds where each submitted **title** has to attach to a running stem, and the
league runs the format across **multiple rounds**.

**Lens:**

- Judge each title on two axes that are **co-primary (even)**:
  - **continuation** — how easy _and_ interesting it is to keep the sentence
    going (or cleanly start a new one); reward a fresh, vivid next beat.
  - **grammar** — how smoothly the title attaches to the stem (tense/agreement).
    Scored evenly with continuation, **not** as a gate — the stem itself often
    mixes tenses, so a small clash is not fatal.
- **Music is a `bonus`,** not a co-primary: a strong song adds a fair amount on
  top, but a weak musical pick is never penalized for being weak _here_ and music
  cannot rescue an incoherent or ungrammatical continuation on its own.
- Titles that are self-contained or break the stem ("…WE made plans" after "me
  and the devil") lose continuation credit even if grammatical.

**Tier effect:** the top tier needs both a smooth attach **and** an interesting
next beat; grammatical-but-flat and clever-but-clunky picks land mid-pack and are
split by the music bonus. Confirm the exact music weight per round (see
[fit-evaluation.md → When to ask about music weight](fit-evaluation.md#when-to-ask-about-music-weight)).

## Associations

Suggested (not automatic) profile candidates by league / voting style. Add rows as
patterns recur.

| League / style                           | Candidate profiles                    | Notes                                                               |
| ---------------------------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| Chill Western Astrology League           | `traits-over-symbols`, `lyrics-first` | Zodiac: element shared across signs → secondary; traits + both win. |
| Any astrology / tarot / archetype series | `traits-over-symbols`                 | Shared symbols secondary; both symbol + traits strongest.           |
| Lyric- or meaning-driven thematic rounds | `lyrics-first`                        | Prompt about meaning, not sonic genre.                              |
| Continue-the-sentence / story leagues    | `story-continuation`                  | Grammar + continuation co-primary; music bonus.                     |

## Adding a profile

Append preferences here when a user states one that should outlive a single round:

1. Give it a short kebab-case `id` and a clear **When to consider**.
2. Describe the **Lens** as concrete scoring rules and the **Tier effect**.
3. Add an [Associations](#associations) row if it maps to a league or style.
4. Keep it opt-in — if a preference should apply to _every_ round, it belongs in
   [fit-evaluation.md](fit-evaluation.md) instead.
