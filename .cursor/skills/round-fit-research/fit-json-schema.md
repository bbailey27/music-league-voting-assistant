# Fit JSON schema

Source of truth for `analysis/<roundname>-fit.json`. The merge step joins on `rawOrderIndex` (fallback: normalized `title`). Manual fit tokens in user comments **win** over LLM fields.

## Top-level object

```json
{
  "round": {
    "title": "Music League | League | Prompt",
    "league": "League Name",
    "prompt": "Round theme text",
    "description": "Optional expanded criteria"
  },
  "themeKeywords": ["keyword1", "keyword2"],
  "guidanceProfiles": ["traits-over-symbols", "lyrics-first"],
  "method": "Optional one-line research approach",
  "fitScale": {},
  "songs": [],
  "highlights": ["Optional narrative bullets"],
  "combine": { "note": "…", "options": ["…"] }
}
```

`guidanceProfiles` (optional): ids of any opt-in lenses applied this round, from
[`spec/fit-guidance.md`](../../../spec/fit-guidance.md). Suggested per league/style
and confirmed with the user — render-only/traceability, never auto-applied.

After merge (`parse-round.mjs --fit`), the file also carries:

- `combineWeights`: `{ "fit": 0.7, "music": 0.3 }`
- per-song: `musicScore`, `musicComment`, `combinedScore`, `draftVotes`

Do **not** supply `draftVotes` in initial fit research — the allocator writes them.

## fitScale

Maps tier name → `{ "fitScore": number, "desc": "meaning" }`. Rendered as the HTML fit-scale table.

Representative scores (also used by `FIT_TIER_SCORES` in code):

| Tier      | Score |
| --------- | ----- |
| excellent | 93    |
| strong    | 85    |
| solid     | 72    |
| moderate  | 52    |
| weak      | 35    |
| nope      | 15    |

Gate rounds may use `pass` / `maybe` / `fail` as `fitTier` instead of graded tiers.

## Per-song object (required for merge)

```json
{
  "rawOrderIndex": 3,
  "title": "Song Title",
  "artist": "Artist",
  "fitTier": "solid",
  "fitScore": 72,
  "themesHit": ["theme keyword matched"],
  "basis": "lyrics | title | vibe | submitter quote",
  "confidence": "high | medium | low",
  "flags": ["stretch-read", "submitter-assist"],
  "rationale": "1–3 sentences: why this tier, what evidence"
}
```

Optional context fields (render-only, never override scoring):

- `submitterAssist`: true when submitter quote materially helped interpretation

Gate-style rounds add `"gate": "pass" | "maybe" | "fail"` (or put gate word in `fitTier`).

## Graded vs gate rounds

**Graded:** assign `fitTier` + `fitScore` on the scale above.

**passFail:** binary — off-theme → `fail` (allocator gives 0 regardless of music).

**passFailMaybe:** three-state — tag arguable entries `maybe`; rank maybes by defensibility (`fitScore`), music only as tiebreak. Allocator funds maybe-band only when budget is plentiful or leniency is raised.

## Merge weights

Default combined ranking: `0.7 × fit + 0.3 × music`. Override with `--rank` / profile when merging.

Cutoff example: `--cutoff fit:68` zeroes songs below fit 68 before tiering.

## Validation checklist

- [ ] One entry per non-own song from parse JSON (match `rawOrderIndex`)
- [ ] Own submission omitted (same as HTML parser)
- [ ] Songs with manual fit in user comment left fit-silent in JSON (manual wins)
- [ ] Every song has `fitTier`, `fitScore`, and `rationale`
- [ ] `fitScore` consistent with tier (or explicit override with reason in rationale)
- [ ] JSON parses; run merge then `just fit <name>` to render
