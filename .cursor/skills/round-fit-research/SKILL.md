---
name: round-fit-research
description: >-
  Performs thematic Music League fit research from round HTML/parse JSON and writes
  analysis/<round>-fit.json with fit tiers, scores, and rationale. Use when a round
  needs fit evaluation, lyric/theme scoring, pass/maybe/fail gates, or fit HTML prep.
disable-model-invocation: true
---

# Round fit research

Manual/agent step between parse and merge. Deterministic code never judges fit — only merges and allocates after you write the JSON sidecar.

## When required

After parse, `just status <name>` advises fit research for **thematic/lyric/subjective** rounds. Plain music-only rounds skip this.

Check `analysis/<name>.json` for songs flagged `needsResearch` (thematic mode, music scored, no fit token yet).

## Workflow

1. **Read round context** from `rounds/<name>.html` or parse JSON:
   - Prompt: `<title>` third segment or text header after `ROUND N`
   - `themeKeywords` — distill from prompt (also useful in JSON header)
   - Each `div.song` (skip `mine: true`): title, artist, album, submitter quote, **your** `data-comment`
2. **Check guidance profiles** in [`spec/fit-guidance.md`](../../../spec/fit-guidance.md):
   - Match the round's **league** or voting style against the Associations table.
   - If a profile (e.g. `traits-over-symbols`, `lyrics-first`, `story-continuation`)
     may apply, **propose it, describe its lens concretely, and confirm with the
     user** — these are suggested, never auto-applied.
   - Record any applied profile in the fit JSON `guidanceProfiles[]` + `method`.
3. **Clarify before scoring** — see [`spec/fit-evaluation.md` → Clarify before scoring](../../../spec/fit-evaluation.md#clarify-before-scoring).
   **Make no assumptions about priorities.** Run one short clarification pass before
   judging any song:
   - Confirm prompt type & whether it is a gate round.
   - Surface the **trait/criteria list** and ask which the user wants to have more
     or less influence — pin down each trait's level using the **influence
     vocabulary** (`primary` / `co-primary`/`even` / `secondary` / `bonus` /
     `tiebreak-only` / `soft-penalty-if-present` / `ignore` / `hard-gate`). A vague
     "A matters more than B" must be resolved into one of these (lower co-primary?
     a `secondary` close-2nd that leans lower but stacks and is field-relative?
     bonus? tiebreak only? penalize B when present? ignore B?).
   - For gate rounds, clarify the pass/fail boundary, or score the clear ones and
     **bring borderline cases up at the end for the user to pick**.
   - **Music weight:** if this is a fit-research-only prompt, **don't** ask about
     music weight yet. If music scores are already parsed and allocation comes
     right after research, clarify the fit-vs-music weight in the same pass.
4. **Apply rules** from `spec/fit-evaluation.md`, `spec/uncertainty.md`, `spec/comments.md`:
   - Objective prompts: correctness dominates; explanation cannot validate invalid entries
   - Conceptual prompts: evaluate fit and music separately; apply the confirmed trait influence
   - Lyric prompts: analyze lyrics only when the prompt genuinely depends on them
   - Submitter quotes strengthen interpretation but do not auto-upgrade tier
   - Preserve user comments verbatim; manual fit tokens in comments win over LLM
   - A confirmed guidance profile refines (never overrides) these rules and manual fit tokens
5. **Write** `analysis/<name>-fit.json` — schema in [fit-json-schema.md](fit-json-schema.md)
6. **Merge + allocate:**
   ```bash
   node scripts/parse-round.mjs rounds/<name>.html --fit analysis/<name>-fit.json
   ```
   Resolve any printed tradeoffs (see **point-allocation**). Allocation must spend both vote banks exactly and never mix up+down on one song.
7. **Render:**
   ```bash
   just fit <name>
   ```

## Fit scores: anchors, not buckets

The tier `fitScore`s below are **representative anchors**, not the only legal
values. When a song sits between two tiers ("just missed excellent", "barely a
solid"), give it an **intermediate `fitScore`** (e.g. `77` between solid 72 and
strong 85) rather than snapping it to an anchor — fit research isn't precise
enough to pretend `85` and `83` differ, but a genuine borderline song should read
as borderline. The intermediate value flows into `combinedScore`, so it blends
with the more precise music score and helps break ties. Songs that are genuinely
equal should **share** an anchor and let music differentiate them. The tier word
still snaps to the nearest anchor (`fitTierForScore`) for coarse grouping.

Covers / multiple recordings of the same song get the **same fit** (same
lyric/meaning); any point difference between them comes from music, not fit (see
**point-allocation**).

## Fit scale (graded tiers)

| Tier      | Rep. score | Typical meaning           |
| --------- | ---------- | ------------------------- |
| excellent | 93         | On the nose, unmistakable |
| strong    | 85         | Clear fit, minor stretch  |
| solid     | 72         | Good fit, reasonable read |
| moderate  | 52         | Loose/partial connection  |
| weak      | 35         | Tenuous, keyword-only     |
| nope      | 15         | Off-theme / invalid       |

Use `fitScale` in JSON with tier descriptions tailored to **this** prompt.

## Gate rounds

When the prompt is binary or has a questionable band:

- `pass` / `fail` via `--gate passFail`
- `pass` / `maybe` / `fail` via `--gate passFailMaybe`

Rank `maybe` by how defensible the read is (`fitScore`), not by music.

## Rationale quality

Each song needs a short `rationale` covering:

- Which prompt criteria matched (cite title/lyrics/vibe, not generic praise)
- Why this tier vs adjacent tier
- Flags for stretch reads, submitter-assist, or ambiguity

Optional `themesHit[]`, `basis`, `confidence`, `flags[]` feed the HTML cards.

## HTML structure (sampling)

When reading saved HTML, grep or read sections — files are large:

```bash
rg 'data-comment|div class="song"|x-data.*mine' rounds/<name>.html | head
```

Key selectors (see `extract-html.mjs`):

- Songs: `div.song[id^="song-"]`
- Your comment: `data-comment`
- Skip own: `x-data` containing `mine: true`
- Submitter quote: `p` with `i.bi-quote` where `x-show="true"`

## Output format

**JSON is source of truth** — not a markdown fit table.

Human review uses generated HTML (`analysis/<name>-fit.html`): card layout with tier hue, themes, rationale, combined scores, and vote-transfer table after merge.

Optional top-level narrative: `highlights[]`, `combine: { note, options[] }`.

## Precedence

| Source                               | Wins when                                                       |
| ------------------------------------ | --------------------------------------------------------------- |
| Manual fit in user comment           | Always for that song                                            |
| Explicit user instruction this round | Over any guidance profile                                       |
| Confirmed guidance profile           | Refines the LLM read; never beats manual fit or universal rules |
| LLM fit JSON                         | Fills fit-silent songs only                                     |
| Submitter quote                      | Context in rationale only                                       |

Manual notation reference: `spec/score-parsing.md` (`fit 8`, `strong fit`, `pass`, etc.).

## Do not

- Invent music scores or `draftVotes` in fit JSON
- Score submitter quotes
- Skip songs that appear in parse output (except your own submission)
- Commit `analysis/` outputs unless user asks

Full field list: [fit-json-schema.md](fit-json-schema.md). Pipeline commands: **parse-scores-pipeline**.
