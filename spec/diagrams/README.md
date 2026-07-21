# Workflow diagrams

Mermaid flowcharts for major scoring and pipeline flows. These complement prose specs
(`spec/point-allocation.md`, `spec/score-parsing.md`, etc.) with visual “how it flows”
views.

When you change a workflow these diagrams describe, update the diagram in the same pass
(or add a new file here). See [.cursor/rules/workflow-diagrams.mdc](../../.cursor/rules/workflow-diagrams.mdc).

## Diagrams

| Flow                                                          | File                                                               | Primary code                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Combined normalization — contender pool (cutoff / DQ)         | [normalization-contender-pool.md](normalization-contender-pool.md) | `scripts/score/merge.mjs` (`isContender`, `normalizeCombined`)       |
| Combined tier equality — fit trust (manual vs LLM)            | [combined-tier-fit-trust.md](combined-tier-fit-trust.md)           | `scripts/score/merge.mjs`, `scripts/score/allocate.mjs`              |
| Tier-structure menu — backfill order (merge/jump → tie-split) | [tier-structure-menu-backfill.md](tier-structure-menu-backfill.md) | `scripts/score/allocate.mjs` (`groupAtomicAlternatives`, menu block) |

## Conventions

- One topic per file; kebab-case filename matching the flow name.
- Each file: short prose, the mermaid diagram, who is in/out, and links to spec + code.
- Use `flowchart LR` or `flowchart TD` with camelCase node IDs (no spaces in IDs).
- Planned or not-yet-shipped behavior: say so explicitly in the prose.
