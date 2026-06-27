# Writing scoring comments

How to fill in Music League comment boxes so the parser reads your music and fit
scores correctly. For digit-scaling edge cases and parser internals, see
[score-parsing.md](score-parsing.md).

## Cheat sheet

```text
Ideal music-only:     75
Ideal music + fit:    78 music. 8 fit
Quick fit bump:       76 fit bonus
Quick music + tier:   75 strong          (--fit-words)
Quick music + gate:   75 maybe           (--fit-words)
Two numbers:          75. 80             (--fit-words)
With fit tag:         80. fit 75         (--fit-words)
Keep vote prose:      75 strong\nYour public comment here
```

**Parse with fit words enabled** when you use tier/gate vocabulary or a bare second
number for fit:

```bash
just parse my-round --fit-words
```

Without `--fit-words`, only **explicit** fit numbers in the remainder (`8 fit`) and
**shorthand** (`fit bonus`) are picked up — prose like `maybe` or `strong` is ignored.

---

## Write like this

### Music-only rounds

Put the **music score first** — that's the number you scan for when assigning points.

```text
75
73+
74? music play
74 soft punk — nice bridge
```

### Music + fit on one line (ideal)

Music is always the **first number** on line 1. Fit goes **after** it on the same line.
Use a **period** after the music score to mark the split (`78 music. 8 fit`, `80. fit 75`,
`75. 80`). The parser accepts other separators, but the period is the clearest when
scanning.

```text
78 music. 8 fit
76 fit bonus
75. 80
80. fit 75
75 strong
75 maybe
```

| You wrote         | Music | Fit                               |
| ----------------- | ----- | --------------------------------- |
| `78 music. 8 fit` | 78    | 80 (numeric fit)                  |
| `76 fit bonus`    | 76    | strong (shorthand)                |
| `75. 80`          | 75    | 80 (needs `--fit-words`)          |
| `80. fit 75`      | 80    | 75 (needs `--fit-words`)          |
| `75 strong`       | 75    | strong tier (needs `--fit-words`) |

These also work — same rule (first number = music):

```text
75
8 fit          → music 80 only (no separate fit score)
fit 8          → music 80
music 80       → music 80
```

### Keeping text for the vote (two lines)

Line 1 = scratch notes the parser reads. Line 2+ = prose you may leave on the vote.

```text
75? strong maybe
Love this one — perfect for the prompt
```

Only line 1 is parsed for scores. Words on line 2 never affect allocation.

---

## Music score quick reference

| You wrote      | Score | Notes                           |
| -------------- | ----- | ------------------------------- |
| `7`            | 70    | one digit → ×10                 |
| `73`           | 73    | two digits → as-is              |
| `755`          | 75.5  | three digits → ÷10              |
| `73+` or `73=` | 73    | `+` nudge (tiebreak)            |
| `73-`          | 73    | `-` nudge                       |
| `74?`          | 74    | score could move up/down        |
| `75+?`         | 75    | `+` nudge; unsure about the `+` |
| `7-?`          | 70    | `-` nudge; unsure about the `-` |
| `74 play`      | 74    | playlist-add nudge              |
| `74 play?`     | 74    | unsure about playlist add       |

`**?` follows what it qualifies:\*\* alone after the number → score uncertainty;
after `+`, `-`, or `play` → that modifier is uncertain (not the score).

---

## Fit tier words (`--fit-words`)

Tier words on **line 1** map to a numeric fit score used for combined ranking. First
match wins. `strong negative` (tier word + `negative` right after) is ignored.

| Tier          | Fit score | Words recognized                                         |
| ------------- | --------- | -------------------------------------------------------- |
| **excellent** | 93        | excellent, perfect, ideal, on the nose, spot-on, spot on |
| **strong**    | 85        | strong, great                                            |
| **solid**     | 72        | solid, good, clearly, on-theme, on theme                 |
| **moderate**  | 52        | moderate, okay, ok, loose, partial                       |
| **weak**      | 35        | weak, single keyword, tenuous, barely                    |

**Examples** (all require `--fit-words`):

```text
75 excellent
75 strong
75 — great chorus         → music 75, tier strong (`great` is tier vocabulary)
solid 72
74 soft punk              → music 74 only (no tier/gate word in the line)
```

---

## Gate words (`--fit-words`)

For pass/maybe/fail rounds. Scanned on line 1. Precedence: **fail > maybe > pass**.

| Gate      | Words recognized                               |
| --------- | ---------------------------------------------- |
| **fail**  | fail, fails, off-theme, invalid                |
| **maybe** | maybe, questionable, borderline, iffy, stretch |
| **pass**  | pass, passes, qualifies, valid, fits, on-theme |

**Examples:**

```text
75 pass
75 maybe
off-theme 80             → music 80, gate fail
maybe great song 75      → music 75, gate maybe
```

---

## Fit shorthand (always on)

Multi-word phrases on the **remainder** after your music number (same line). Always
write a music score first — `fit bonus` alone is not valid notation.

| Phrase        | Maps to | Fit score |
| ------------- | ------- | --------- |
| **fit bonus** | strong  | 85        |

**Example:**

```text
76 fit bonus             → music 76, tier strong
```

---

## Numeric fit (remainder)

After the music number is peeled, an explicit fit number in the rest of line 1 uses the
same digit scaling as music (`8` → 80).

```text
78 music. 8 fit          → music 78, fit 80
78 music. fit 8          → music 78, fit 80
```

With `--fit-words`, a **second number** on line 1 also works (period recommended):

```text
75. 80                   → music 75, fit 80
80. fit 75               → music 80, fit 75
75. playlist 80          → music 75, fit 80
```

---

## Special cases (short)

| You wrote                 | Result                                               |
| ------------------------- | ---------------------------------------------------- |
| empty box                 | flagged — needs a score                              |
| `TODO` / `TODO 80`        | flagged — placeholder not trusted                    |
| `-`                       | disqualified (no vote)                               |
| `no` / `nope` / `invalid` | disqualified                                         |
| words only, no number     | disqualified (objective) / needs review (subjective) |
