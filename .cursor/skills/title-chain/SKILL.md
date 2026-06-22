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
*end* of the sentence as much as the words you add.

## Inputs

| Thing | Location |
| --- | --- |
| Sentence so far + the scene/story | from the user |
| Title pool (largest first) | `data/ref/all-scrobbles.csv` (col0 title), `all-songs-no-inst.csv`, `chill-minor-rock-etc-search.csv`, `fav-songs.csv` (all col0 = title, col1 = artist) |
| Prefix scan tool | `scripts/title-prefix-scan.mjs` (reusable CLI) |
| Story-5 word bank | `scripts/one-off/story-5-prefix-scan.mjs` |
| Per-round writeup | `data/analysis/<round>/candidates.md` |

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

## Workflow

1. **Frame the scene + voice.** Who is "I/me"? Who's the audience? What pronouns are fixed
   (e.g. the girl is *her/she*)? Get the user's skip list.
2. **Get the leading words.** The user usually has candidate joiners ("to…", "don't…", "I'm…").
   Each continuation is a real title that **starts with** that word.
3. **Scan the CSVs** for those leading words (local, cheap — not a web search). Hand the user the
   grouped hits to prune.
4. **Judge each hit** against the criteria below; write `candidates.md` (ranked + dropped + why).
5. **Let the user pull their own shortlist** from the scan file — then mine their picks for the
   pattern of what they consider grammatical + sensible, and apply it.

## Criteria (priority order)

1. **Grammar / sense first.** Reads cleanly after the sentence so far; fits the story with no
   insider context (voters only see sentence-so-far + your title).
2. **Pronoun consistency.** "I/me" must stay the same character. The "you" rule is narrow:
   don't *narrate about* a fixed third party as "you" — but a **spoken plea/imperative** that
   uses "you" ("Don't Leave Me", "Open Your Eyes") is fine and often strong.
3. **Tense.** Present tense is welcome — the title pool skews present, and switching to present
   flows when a character starts speaking. Match what reads naturally.
4. **Leave a good end (continuability).** Voters won't vote if they can't picture a next title.
   - A clean full stop → next can be any new sentence (safe).
   - A half-finished ending is fine **and can guide** the next part — *if* common titles fill the
     slot. A slot that begs a common **noun/verb** ("Burn Up …the sky") is good; one that begs a
     **scarce connector** ("…me / …her / …and / …to / …till") is rough.
   - **Resolutions/endings are weak** (the story feels over → nothing to add).
5. **Contribution.** Move the story; a whole idea beats filler. **Oblique is fine but must still
   connect** — a poetic beat needs a clear referent in *this* scene.

## Strong modes (observed to land well)

- **A character speaking** — imperatives/pleas/declaratives in their voice (the most reliable).
- **Self-referential seals** ("That's That / That's It") that point back at what just happened.
- **Verb+particle that begs a noun** ("Burn Up", "Hold On"), keeping the next slot wide.
- **Time/finality phrases** ("Until the End of Time", "Until We Meet Again").

## Switching to a character addressing someone (tense/voice trap)

A present-tense imperative right after past narration ("…made a pact. **Stay alive.**") can leave
voters unsure *who's speaking* — the tense flips with no cue. The natural fix is a narrative frame
("I said to her…"), **but those first-person speech-frame titles are almost never in a title pool**
(scanned `i said / i told / i whispered / and she / so i / then i` → all 0). Workaround that needs
no frame: pick an address that **contains "me / my"** ("Don't Leave Me", "Speak to Me", "Call My
Name", "I Need My Girl") — it's then unmistakably a person being addressed, and "me" stays the
narrator. Bare imperatives ("Stay Alive", "Breathe", "Wake Up") read more ambiguously; deprioritize
them when the speaker isn't otherwise marked.

## Don't

- Don't judge by lyrics/meaning — titles only.
- Don't propose a title you haven't confirmed is in the scan file.
- Don't fabricate the "next" title as if it exists — if you can't name a viable real continuation,
  say so (list it under "open ending, no continuation found").
- Don't pick a beat that ends the story when the round is meant to keep going.
- Don't commit `data/` outputs unless asked (`.cursor/rules/no-auto-commit.mdc`).
