# Score Parsing

## Core Conversion

755=75.5
745=74.5
735=73.5
725=72.5
715=71.5

## Modifiers

Modifiers attach to the **music number** (or to `play` / `playlist` on the line).
You can combine them. **`?` applies to whatever it immediately follows:**

| You wrote  | Meaning                                            |
| ---------- | -------------------------------------------------- |
| `74?`      | score 74; the **score** could move up or down      |
| `75+?`     | score 75 with `+`; you're unsure about the **`+`** |
| `7-?`      | score 70 with `-`; you're unsure about the **`-`** |
| `74 play`  | score 74; playlist-add nudge                       |
| `74 play?` | score 74; unsure about **playlist** add            |

`73=` is treated as `73+` (typo). The `+` / `-` / `play` still apply for tiebreaks;
modifier-uncertain flags are for your notes and display (`+?`, `-?`, `play?`).

## Bare Dash

A standalone '-' means too low for consideration / not worth scoring.

## Needs Input

A blank comment box is an accidental skip and is flagged `needsUserInput` so the
user is prompted for a real score. An all-caps `TODO` marker anywhere in the
comment (usually leading, e.g. `TODO`, `TODO score later`) is treated the same
way — it is a self-reminder that no decision was made yet, so any placeholder
number sitting next to it is not trusted. Lowercase `todo` inside prose is not a
marker.

## Uncertain Integers

7? = 70.0 with **score** uncertainty.
6? = 60.0 with **score** uncertainty.
7-? = 70 with `-` applied; **minus** is uncertain (not score uncertainty).

## Hard Rules

Numeric conversion occurs before any ranking, tiering, or interpretation.
Never group scores by visual similarity.
715 is not related to 735.
725 is below every 73.x score.

## Manual Fit Notation

`scoreComment` extracts a canonical fit signal from the comment alongside the
music score, so thematic/blended rounds can be scored without an LLM when you
already know the fit. The fit signal feeds the same shape the LLM fit JSON
produces (`fitScore` / `fitTier` / `gate`, `fitSource: 'manual'`).

### Peel-first (scoring line)

Comments split on the **first newline**. Line 1 is the **scoring line**; the
submission tail is never scanned for fit/tier/gate.

1. **First number** on the scoring line (+ mods) → **music** `score`. Always — leading
   `fit` / `music` / prose does not change which digit is music.
2. **Remainder** of the scoring line (after that number) → fit signals.

There is no fit-only notation; music is always the first number you write.

| Comment           | Music | Fit (from remainder)                            |
| ----------------- | ----- | ----------------------------------------------- |
| `75`              | 75    | —                                               |
| `fit 8` / `8 fit` | 80    | —                                               |
| `78 music. 8 fit` | 78    | 80 (explicit `8 fit` in remainder)              |
| `75. 80`          | 75    | 80 (2nd # in remainder; requires `--fit-words`) |
| `80. fit 75`      | 80    | 75 (2nd # in remainder; requires `--fit-words`) |
| `76 fit bonus`    | 76    | shorthand → strong / 85                         |

### Fit channels (remainder unless noted)

- **Explicit fit number:** `N fit` / `fit N` in the remainder — same digit-scaling
  as music (`8`→80). Not matched when part of a shorthand phrase (`fit bonus`).
- **Second number:** bare 2nd # in remainder → fitScore when `--fit-words` is on.
- **Fit shorthand:** controlled multi-word phrases in the **remainder** after the
  music number (e.g. `76 fit bonus` → strong / 85). Not valid without a music score.
- **Tier / gate words:** only when `--fit-words` is passed; scanned on the full
  scoring line. Tier synonyms: `excellent | strong | solid | moderate | weak` (+ synonyms).
  The **earliest** tier word on the line wins, not the highest tier — write the grade first
  (`weak fit`) and a later prose tier word (`great if it said 'her'`) is ignored.
  Gate: `pass` / `maybe` / `fail` (`fail > maybe > pass`). A tier word followed by
  `negative` (e.g. `strong negative`) is **mirrored** across the scale (that fit, but bad):
  excellent↔nope, strong↔weak, solid↔moderate.
  Without `--fit-words`, tier/gate vocabulary in comments is ignored (no over-matching).
  **Gate words auto-activate the gate.** A parsed per-song `gate` is inert unless the
  allocation profile turns the gate on (`gateClass` treats every song as a pass
  otherwise), so when `--fit-words` extracts any gate word and the caller didn't set
  an explicit `--gate` / `--cutoff`, `applyManualFitScoring` sets `profile.gate` to
  **`passFailMaybe`** (any `maybe` present) or **`passFail`** (only pass/fail). This is
  the same auto-wiring that defaults `rankBy` to `combined` for manual fit, and it
  propagates to `merge` / `pick` via the stored profile. An explicit `--gate` /
  `--cutoff` is never overridden.

### Other

- **Thematic, fit unknown:** a music score with no fit signal marks the song
  `needsResearch` (in thematic mode) so the LLM step fills it.
- **Precedence:** manual fit wins; the LLM fit JSON fills only fit-silent songs.
- **CLI:** `just parse <name> --fit-words` / `ml parse <name> --fit-words`.
