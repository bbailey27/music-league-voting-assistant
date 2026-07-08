# Combined tier equality — fit trust modes

Manual owner-typed fit and LLM fit.json use different normalization and same-tier rules.

## Diagram

```mermaid
flowchart TD
  parse[parse with manual fit]
  merge[merge with fit.json]
  parse --> detectManual{fitSource manual?}
  detectManual -->|yes| autoGate{"gate words + no --gate?"}
  autoGate -->|yes| setGate["profile.gate = passFailMaybe / passFail"]
  autoGate -->|no| normManual
  setGate --> normManual[normalizeCombined fitTrust=manual]
  detectManual -->|no| normLLM[normalizeCombined fitTrust=llm]
  merge --> normLLM
  normManual --> tierManual["tierKey = raw combined bucket"]
  normLLM --> tierLLM["tierKey = music + coarse fit band"]
  tierManual --> allocate[allocateBell units + staircase]
  tierLLM --> allocate
```

## Modes

| Mode       | Detection                              | Normalization                         | Same-tier key                                |
| ---------- | -------------------------------------- | ------------------------------------- | -------------------------------------------- |
| **manual** | Any `fitSource: manual` with fit score | Adaptive fit std floor (field spread) | Quantized **raw** weighted blend (0.5 steps) |
| **llm**    | fit.json merge, no manual numerics     | Fit std floor 14                      | `effectiveMusic \| coarseFit band`           |

Rank/sort uses normalized `combinedScore`. Manual mode buckets vote equality on the raw
blend so symmetric swaps (90/77 vs 77/90 → raw 83.5) stay tied.

## See also

- [`spec/point-allocation.md`](../point-allocation.md) — Same score = same tier
- [`scripts/score/merge.mjs`](../../scripts/score/merge.mjs) — `resolveFitTrust`, `normalizeCombined`
- [`scripts/score/allocate.mjs`](../../scripts/score/allocate.mjs) — `tierKey`, `describeTierGroup`
