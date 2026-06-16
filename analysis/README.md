# Analysis output

Each round's outputs live in its own folder: **`analysis/<date>-<slug>/`**
(inputs stay flat in `rounds/<date>-<slug>.html`).

**Start with `scores.json` / `scores.html`** — the merged deliverable. The other
files (`music.*`, `fit.*`, `versions/`) are intermediate. The full file legend,
archive convention, and naming rules live in
[`spec/analysis-artifacts.md`](../spec/analysis-artifacts.md).

Synthetic reference round for docs/tests: `tests/fixtures/sample-round/`.

> `analysis/` is otherwise gitignored — local working data only. This README is
> the one tracked file here.
