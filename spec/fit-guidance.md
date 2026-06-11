# Fit Guidance Profiles (opt-in lenses)

Named, **optional** fit-research lenses. Unlike [fit-evaluation.md](fit-evaluation.md)
(universal rules that always apply), a profile here is a _preference_ that only
applies to rounds where it fits. They exist so recurring tastes don't have to be
re-explained every round, **without** silently overriding the default read for
rounds where they don't belong.

## How profiles are applied

- **Suggested, not automatic.** Before scoring a round, check the
  [Associations](#associations) table for the round's league or voting style. If a
  profile may apply, **propose it and confirm with the user** before scoring —
  never apply silently.
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
type" prompts that list **both** a literal symbol or element **and** a set of
personality traits (e.g. zodiac signs, tarot figures, elemental themes).

**Lens:**

- **Both is best.** A song that hits **both** the symbol/element **and** the
  personality traits is the strongest fit and earns the top tier.
- **Rank order:** both > traits-only > symbol/element-only > neither. Traits
  outrank the bare symbol, but the symbol/element is a **positive, secondary
  signal — never a penalty.** A song is not "better" for _lacking_ the imagery;
  do not downgrade a song for having it. Only rank it below songs that also carry
  the traits.
- **Shared elements are weaker, not worthless.** When an element/symbol is common
  to several prompts in the same series (e.g. "water" is shared by every water
  sign — Cancer, Scorpio, Pisces), a literal match on it is a _secondary_ signal:
  it cannot reach the top tier **on its own**, but it still counts toward fit and
  stacks with any traits the song carries.
- A clever or explicit reference to the _specific_ archetype (naming the sign,
  invoking its myth) is stronger than a generic shared-element match.

**Tier effect:** symbol/element-only picks are a valid but lower fit (they sit
below trait-bearing songs, not at the floor); traits-only picks rank above them;
top tiers go to songs that carry **both**. Never treat the imagery as a negative.

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

| League / style                           | Candidate profiles                    | Notes                                                                                                                                                                                                               |
| ---------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chill Western Astrology League           | `traits-over-symbols`, `lyrics-first` | Zodiac prompts list a symbol/element + trait list; element (water/fire/earth/air) is shared across signs, so it is a secondary signal — credit it, but let traits decide the top, and reward songs that carry both. |
| Any astrology / tarot / archetype series | `traits-over-symbols`                 | Shared symbols/elements across the series are secondary (not decisive) signals; both symbol + traits is the strongest fit.                                                                                          |
| Lyric- or meaning-driven thematic rounds | `lyrics-first`                        | When the prompt is about what a song _says/means_, not how it sounds.                                                                                                                                               |
| Continue-the-sentence / story leagues    | `story-continuation`                  | Titles attach to a running stem; grammar and an interesting continuation are co-primary (even), with music as a bonus on top. Recurs across the league's rounds.                                                    |

## Adding a profile

Append preferences here when a user states one that should outlive a single round:

1. Give it a short kebab-case `id` and a clear **When to consider**.
2. Describe the **Lens** as concrete scoring rules and the **Tier effect**.
3. Add an [Associations](#associations) row if it maps to a league or style.
4. Keep it opt-in — if a preference should apply to _every_ round, it belongs in
   [fit-evaluation.md](fit-evaluation.md) instead.
