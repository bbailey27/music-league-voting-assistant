---
name: Downvote curve shapes (concentrated / flat / curved)
overview: >
  Add a per-round downvote-shape knob, independent of the upvote A/B/C tier
  structure. Three named down curves — concentrated, flat, curved — plus a
  proposal surfaced as a `down-structure` tradeoff (CLI + HTML) selectable with
  `--down-shape`. Default stays curved (the current bell). Upvote options are
  unchanged.
status: done
isProject: false
---

# Downvote curve shapes

## Why
Sequenced allocation now sends every zero-upvote song (plus DQ) to the downvote
pass. With an unbounded down cap the bell sometimes spreads `-1`s and sometimes
the owner wants the whole bank on the single worst/invalid song. No single rule
fits every round, so give a per-round choice.

## Shapes (down pool = zero-upvote eligible songs + DQ, worst-first; budget B, cap C)
- **concentrated** — pile worst-first to cap; uncapped ⇒ all B on the single worst.
- **flat** — even spread: 1 each across the worst songs (round-robin), then 2 each, …
- **curved** — graduated bell (existing `allocateBellDown`); worst gets the most, tapering.

## Tasks
1. Down strategies + `downShape` dispatch in `allocateDownvotes`
   (`concentrated`/`flat`/`curved`; `relative` unchanged). Default = curved.
2. `--down-shape` CLI flag → `profile.downShape`; passthrough in `ml.mjs` and
   `render-final-html.mjs`. `enrichProfileWithBudget` already spreads the profile.
3. Surface a `down-structure` tradeoff (only when the three shapes diverge) with
   per-song down previews; dedup like `tier-structure`.
4. Render `down-structure` in CLI (`printTradeoffCli`) and HTML
   (`tradeoffsHtml` / table helper), selector hint `--down-shape <name>`.
5. Tests for each shape + the dedup/surfacing behavior.
6. Update `spec/point-allocation.md`, `spec/decisions.md`, point-allocation skill.
