# Fit Evaluation

## Objective Prompts

Correctness dominates.
Explanations do not make invalid entries valid.

## Conceptual Prompts

Evaluate fit and music separately.
Determine weighting before ranking if unclear.

## Lyric-Based Prompts

Use lyric analysis only when the prompt genuinely depends on lyrics.

Submitter explanations can strengthen a subjective interpretation but do not automatically improve ranking.

## Output

Fit research is written to the JSON sidecar (`analysis/<roundname>-fit.json`), which is the source of truth — one object per song (tier, fitScore, themesHit, flags, confidence, basis, submitterAssist, rationale) plus round metadata and the fit scale. The JSON may also carry optional `highlights` (string array) and `combine` (`{ note, options[] }`) narrative fields.

The human-readable fit report is the **generated HTML**, not a markdown table: run `scripts/render-fit-html.mjs` on the JSON. The HTML uses a stacked card layout (raw-order # / title / artist in a narrow identity column) so the rationale/notes get full width.
