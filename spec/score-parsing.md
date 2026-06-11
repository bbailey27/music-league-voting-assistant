# Score Parsing

## Core Conversion

755=75.5
745=74.5
735=73.5
725=72.5
715=71.5

## Modifiers

- `+` = slight upward tie-break adjustment.
- `-` = slight downward tie-break adjustment.
- `?` = uncertainty marker only.

## Typo Normalization

73= should be interpreted as 73+.

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

7? = 70.0 with uncertainty flag.
6? = 60.0 with uncertainty flag.

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

- **Explicit fit score:** `fit 8`, `fit85`, or `8 fit` — same digit-scaling as
  music (`8`→80, `85`→85, `855`→85.5). So `72 music, fit 8` ⇒ music 72, fit 80.
  A bare `fit 8` with no other number is a fit note only, not a music score.
- **Fit tier word:** `excellent | strong | solid | moderate | weak`, with
  synonyms (`perfect`→excellent, `single keyword`→weak, `on-theme`→solid, …).
  Tier words are only honored when the comment is **armed** with the literal word
  `fit` (e.g. "strong fit"), so prose like "solid track" is never a fit grade.
- **Gate flag:** `pass` / `maybe` (`questionable`, `borderline`, `stretch`) /
  `fail` (`off-theme`, `invalid`). `fail > maybe > pass` when more than one matches.
- **Thematic, fit unknown:** a `music`-labelled number with no fit token marks the
  song `needsResearch` (in thematic mode) so the LLM step fills it.
- **Precedence:** a deliberate manual fit signal wins; the LLM fit JSON fills only
  fit-silent songs.
