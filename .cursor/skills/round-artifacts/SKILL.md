---
name: round-artifacts
description: >-
  Round file naming, HTML/text capture conventions, and pipeline artifact paths
  for Music League rounds. Use when adding a new round export, naming analysis
  outputs, checking pipeline status, or troubleshooting missing scores in HTML.
disable-model-invocation: true
---

# Round artifacts

## Input (flat)

```text
rounds/<roundname>.html          primary input (preferred)
rounds/<roundname>.txt           pasted text fallback
rounds/archive/                  retired inputs — ignored by parsing
```

## Output (per-round folder)

```text
analysis/<roundname>/
  music.md / music.json          music-only parse + allocation
  fit.json / fit.html            fit-only research (thematic; no draftVotes)
  scores.json / scores.html      deliverable — merged draftVotes
```

Full naming (`music.html`, `versions/`, `archive/`, and the shared git-tracked
`analysis/README.md` legend): [spec/analysis-artifacts.md](../../spec/analysis-artifacts.md).

Synthetic sample for docs/tests: `tests/fixtures/sample-round/`.

## Capture checklist

1. Autosave + **reload** the Music League vote page.
2. Confirm comments appear in `data-comment` on save.
3. Save page source to `rounds/<roundname>.html`.
4. `just parse <name>` → `analysis/<roundname>/music.*`
5. (Thematic) agent writes `fit.json`, then merge → `scores.json`, render → `scores.html`.

`rounds/` and `analysis/` are gitignored — local working data only. When referencing an older round, check `archive/` subfolders too.
