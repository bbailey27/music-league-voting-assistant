---
name: title-chain
description: >-
  Pick a song to SUBMIT for a Music League "story / sentence chain" round, where players build
  one running sentence/story by chaining song TITLES (lyrics don't matter — only the title text).
  Use when the user is continuing a story made of song titles, wants a title that extends a given
  sentence (e.g. "We made a pact…"), asks to mine their CSVs for titles starting with a given
  word, or asks where they can leave the end of the sentence. Distinct from submission-song-search
  (theme/lyric fit) and round-fit-research (scoring a round's existing songs).
---

# Title-chain submission

The group writes ONE running sentence/story by chaining song **titles**. Only the title text
matters — never lyrics or song meaning. You submit one title that extends the sentence so far;
whichever song wins the round becomes the canonical next link (usually not yours).

## The mechanic that drives everything

You're handing the **next** player a slot. A submission is good only if voters can both (a) read
your title as a clear continuation, and (b) picture a viable next title. So you're optimizing the
_end_ of the sentence as much as the words you add.

## Inputs

| Thing                             | Location                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sentence so far + the scene/story | from the user                                                                                                                                                                                                                                                                                    |
| Title pool (largest first)        | `data/ref/lastfm/track-titles.csv` (col0 = stripped title, col1 = artist), `all-songs-no-inst.csv`, `chill-minor-rock-etc-search.csv`, `fav-songs.csv` (all col0 = title, col1 = artist). The Last.fm table is chosen via `table-map.json`; regenerate with `node scripts/lastfm-aggregate.mjs`. |
| Prefix scan tool                  | `scripts/title-prefix-scan.mjs` (reusable CLI)                                                                                                                                                                                                                                                   |
| Complement checker (structural)   | `scripts/title-complement-check.mjs` — `--slot copular` today; add slots in-file (see below)                                                                                                                                                                                                     |
| Engagement score                  | `scripts/title-candidate-score.mjs` — weighted scrobbles + Pandora fields; `sort-candidates.mjs` for bullet lists                                                                                                                                                                                |
| Story-5 word bank                 | `scripts/one-off/story-5-prefix-scan.mjs`                                                                                                                                                                                                                                                        |
| Per-round writeup                 | `data/analysis/<round>/candidates.md`                                                                                                                                                                                                                                                            |

`song-topic-summaries.csv` is about **meaning** — irrelevant here.

## Tooling: scan titles by leading word (no truncation)

**Reusable CLI** — `scripts/title-prefix-scan.mjs` loads all four CSVs, dedups by normalized title,
anchors a regex at the **start** of each prefix, and writes the grouped report to `--out <path>` or
stdout (counts on stderr when stdout is the report sink). Example:

`node scripts/title-prefix-scan.mjs to "not to" don't stay hold --out data/analysis/story-5/hits.txt`

**Round word bank** — for story-5's curated regex groups and default output path, run
`node scripts/one-off/story-5-prefix-scan.mjs` (optional group keys filter the bank). Copy that
one-off for a new round if you need custom patterns beyond simple prefix strings.

- **Anchor at the start.** "How to Save a Life" must NOT match a "to…" search. The script
  normalizes then tests `^…`, so it's correct — but always sanity-check.
- **Confirm the row count.** A truncated CSV export silently undercounts (one export had 428 rows
  instead of 14,850). `wc -l` each file; if a count looks low, ask the user to re-export.
- When `--out` is a file, counts print to stdout and the full list lives in that file (never trust a
  long inline list). With no `--out`, the full report goes to stdout.

## Tooling: structural complement check (not vibe)

Before promoting candidates, run a **mechanical** checker for the current sentence slot. Do **not**
substitute story “vibe” or agent intuition for structural fit — especially for copular slots
(_…was **[title]**_, _…is **[title]**_) where the title must be a **complement** (noun phrase,
infinitive, prepositional fragment, etc.), not its own clause.

**Copular slot (story-7: _…all i wanted was_)** — default `--slot copular`

```bash
node scripts/title-complement-check.mjs "All the Things She Said" "This Love" "All I Want"
node scripts/title-complement-check.mjs --slot copular "To Be Alone"
```

| Tag            | Meaning                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok-np`        | Determiner/quantifier opener (_a/the/this/all/one/nothing/my/…_) — noun phrase complement. **Incomplete NPs are fine**; the sentence does not have to end. |
| `ok-inf`       | _To_ + verb — infinitive complement (_To Be Alone_).                                                                                                       |
| `ok-fragment`  | _For/with/…_ — incomplete prepositional complement (_For You_ → …for you to \_\_\_).                                                                       |
| `ok-adj`       | Short adj/adv/noun fragment.                                                                                                                               |
| `bad-clause`   | Early auxiliary or embedded clause (_This Is…_, _That Would…_, _All I Want_).                                                                              |
| `bad-unknown`  | No recognized complement opener.                                                                                                                           |
| `you-in-title` | Informational flag only — not a reject by itself.                                                                                                          |

Record `complement-fit` (checker tag) in `candidates.md` for every finalist. Re-run after
editing the checker.

**False positives to avoid when extending:** nouns after _this/the_ (_This Love_, _The Chance of
Love_) are `ok-np`, not verbs. Relative clauses inside NPs (_All the Things She Said_, _All the
days I loved_) are `ok-np`; only flag _all/this/that + I/we/you + content-verb_ at words 1–3
(_All I Want_).

### Other sentence slots — add a `--slot`

Identify what the **title must be grammatically** after the fixed prefix, then encode that — not
story fit.

| Prefix (example)              | Grammatical slot        | `--slot`            |
| ----------------------------- | ----------------------- | ------------------- |
| _…all i wanted was_ (story-7) | Copular complement      | `copular` (shipped) |
| _…we made a pact._            | New sentence / fragment | _(add slot)_        |
| _…for you_                    | PP completion           | _(add slot)_        |
| _…one last time_              | NP completion           | _(add slot)_        |

**How to extend** (`scripts/title-complement-check.mjs`)

1. Implement `classify<Name>Complement(title)` with the same tag vocabulary where possible.
2. Register it in `CLASSIFIERS` and append the name to `COMPLEMENT_SLOTS`.
3. Document the prefix and slot in the script header and in `data/analysis/<round>/candidates.md`.
4. Tune shared sets (`NP_OPENERS`, `AUX`, `CONTENT_VERB`, …) or add slot-local rules.
5. Add regression titles (valid + invalid) in `tests/` when a slot stabilizes.

Import `{ classifyComplement, classifyCopularComplement }` from the script in tests or other tools.

## Tooling: engagement score (rank within a tier)

After structural filtering, rank candidates by **personal affinity** — not story vibe. Same formula
as story-5/6 (`scripts/one-off/sort-candidates.mjs` now imports the shared module).

**Script:** `scripts/title-candidate-score.mjs`

```bash
node scripts/title-candidate-score.mjs "One Day" "My Girl" "The Chance of Love"
node scripts/title-candidate-score.mjs --json "One Day"
```

**Formula** (`ENGAGEMENT_WEIGHTS` in the script — change there, not in prose):

| Source                          | Field                                                   |     Weight |
| ------------------------------- | ------------------------------------------------------- | ---------: |
| `all-songs-no-inst.csv`         | title present (Pandora thumb-up)                        |        +10 |
| `lastfm/track-titles.csv` col 2 | scrobble count (per stripped title, via `resolveTable`) |         ×2 |
| `all-songs-no-inst.csv` col 21  | favorite playlist count                                 |         ×5 |
| col 24                          | ranking-game points                                     |         ×1 |
| col 32                          | my playlist count                                       |         ×2 |
| col 20                          | artist rating (% )                                      | +1 per 10% |

Lookup normalizes titles and also tries a parenthetical-stripped form so candidates like
_That Feeling_ match longer CSV rows.

**In `candidates.md`:** sort finalists by **Engagement** (total score) descending. Optional
`[score]` suffix on bullet lists (story-6 style). Re-sort tier bullets:

`node scripts/one-off/sort-candidates.mjs data/analysis/<round>/candidates.md`

Engagement is tiebreak / submission preference only — never override `bad-clause`.

**Agent role after the checker:** story/pronoun/continuability only. Never downgrade `ok-np` /
`ok-inf` because the beat “feels” odd; never upgrade `bad-clause` because the story is good.

## Workflow

1. **Frame the scene + voice.** Who is "I/me"? Who's the audience? What pronouns are fixed
   (e.g. the girl is _her/she_)? Get the user's skip list.
2. **Get the leading words.** The user usually has candidate joiners ("to…", "don't…", "I'm…").
   Each continuation is a real title that **starts with** that word.
3. **Scan the CSVs** for those leading words (local, cheap — not a web search). Hand the user the
   grouped hits to prune.
4. **Run `title-complement-check.mjs`** with the round’s `--slot` on every finalist; write
   `candidates.md` with `complement-fit` + **Engagement** (from `title-candidate-score.mjs`).
   Sort finalists by Engagement descending. Drop `bad-clause` unless the user explicitly wants a
   quoted-clause parse (rare).
5. **Let the user pull their own shortlist** from the scan file — apply their pattern preferences;
   use story/pronoun/continuability criteria below, not agent grammar vibes.

## Criteria (priority order)

1. **Structural fit first (mechanical).** For copular-complement slots, the title must pass the
   round’s complement checker. NPs and fragments may leave the sentence open — that is not a flaw.
2. **Pronoun consistency.** "I/me" must stay the same character. The "you" rule is narrow:
   don't _narrate about_ a fixed third party as "you" — but a **spoken plea/imperative** that
   uses "you" ("Don't Leave Me", "Open Your Eyes") is fine and often strong.
3. **Tense.** Present tense is welcome — the title pool skews present, and switching to present
   flows when a character starts speaking. Match what reads naturally.
4. **Leave a good end (continuability).** Voters won't vote if they can't picture a next title.
   - A clean full stop → next can be any new sentence (safe).
   - A half-finished ending is fine **and can guide** the next part — _if_ common titles fill the
     slot. A slot that begs a common **noun/verb** ("Burn Up …the sky") is good; one that begs a
     **scarce connector** ("…me / …her / …and / …to / …till") is rough.
   - **Resolutions/endings are weak** (the story feels over → nothing to add).
5. **Contribution.** Move the story; a whole idea beats filler. **Oblique is fine but must still
   connect** — a poetic beat needs a clear referent in _this_ scene.

## Second-opinion review rubric

Use only when the user **explicitly** asks for review — not as default candidate filtering.

For copular-complement rounds, **run `title-complement-check.mjs --slot copular` first**. Do not
override its tags with agent grammar judgment. Split **structural** (checker tag) from **story**
(scene fit).

For each candidate:

1. **Insert the exact title** after the sentence fragment and read it literally, but judge story
   flow against the **full sentence/story so far**, not only the current fragment.
2. **Choose one parse:** same-sentence continuation, new sentence, quoted/thought sentence, or
   fragment/cliffhanger.
3. **State intended punctuation** if the parse depends on it: none, comma, period, colon, dash, or
   line break. Treat punctuation as a submission clarification, not as a risk by itself.
4. **Structural column:** checker tag (`ok-np`, `bad-clause`, …). Do not re-litigate unless the
   checker has a known bug (document the fix in the script, not in prose overrides).
5. **Assess story flow separately:** whether it advances, reverses, clarifies, or stalls the full
   scene.
6. **Check the next slot:** wide, medium, narrow, or dead end for the next player.

Output columns: `candidate`, `parse`, `structural`, `punctuation`, `story flow`, `next slot`.
Keep comments terse. Do not list "incomplete" as a risk unless the next slot is narrow and likely
hard to satisfy from title-prefix searches.

## Strong modes (observed to land well)

- **A character speaking** — imperatives/pleas/declaratives in their voice (the most reliable).
- **Self-referential seals** ("That's That / That's It") that point back at what just happened.
- **Verb+particle that begs a noun** ("Burn Up", "Hold On"), keeping the next slot wide.
- **Time/finality phrases** ("Until the End of Time", "Until We Meet Again").

## Switching to a character addressing someone (tense/voice trap)

A present-tense imperative right after past narration ("…made a pact. **Stay alive.**") can leave
voters unsure _who's speaking_ — the tense flips with no cue. The natural fix is a narrative frame
("I said to her…"), **but those first-person speech-frame titles are almost never in a title pool**
(scanned `i said / i told / i whispered / and she / so i / then i` → all 0). Workaround that needs
no frame: pick an address that **contains "me / my"** ("Don't Leave Me", "Speak to Me", "Call My
Name", "I Need My Girl") — it's then unmistakably a person being addressed, and "me" stays the
narrator. Bare imperatives ("Stay Alive", "Breathe", "Wake Up") read more ambiguously; deprioritize
them when the speaker isn't otherwise marked.

## Don't

- Don't judge by lyrics/meaning — titles only.
- Don't propose a title you haven't confirmed is in the scan file.
- Don't reject `ok-np` / `ok-inf` / `ok-fragment` checker tags based on story vibe, or accept
  `bad-clause` because the narrative is good — fix or extend the checker instead.
- Don't fabricate the "next" title as if it exists — if you can't name a viable real continuation,
  say so (list it under "open ending, no continuation found").
- Don't pick a beat that ends the story when the round is meant to keep going.
- Don't commit `data/` outputs unless asked (`.cursor/rules/no-auto-commit.mdc`).
