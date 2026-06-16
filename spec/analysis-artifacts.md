# Analysis artifact layout

Each round's outputs live in **`analysis/<date>-<slug>/`** (per-round folder). Inputs stay flat in **`rounds/<date>-<slug>.html`**.

## Naming

| Artifact     | Files                                           | Meaning                                                |
| ------------ | ----------------------------------------------- | ------------------------------------------------------ |
| **Music**    | `music.md`, `music.json`, optional `music.html` | Comment scores + music-only draft allocation           |
| **Fit**      | `fit.json`, `fit.html`, optional `fit.md`       | Thematic fit research only — **no** `draftVotes`       |
| **Scores**   | `scores.json`, `scores.html`                    | **Deliverable** — merged music + fit with `draftVotes` |
| **Versions** | `versions/*`                                    | Exploratory score variants (not official)              |

The shared file legend lives once, git-tracked, at **`analysis/README.md`** — the
tooling does **not** generate a per-round README. Add a `README.md` inside a round
folder only when that round has specific detail worth recording.

Produce scores with:

```bash
node scripts/parse-round.mjs rounds/<round>.html --fit analysis/<round>/fit.json
```

That writes `scores.json` and leaves `fit.json` unchanged.

## Archive

- `rounds/archive/` — retired inputs; **ignored** by round discovery/parsing.
- `analysis/archive/` — retired outputs; ignored by pipeline status.

When consulting a **previous** round, check both the active folders and `archive/`.

## Example

```text
analysis/README.md            ← shared legend (git-tracked)
analysis/2026-06-09-tarot-hanged-man/
  music.md
  music.json
  fit.json
  fit.html
  scores.json
  scores.html
```

Synthetic reference round: `tests/fixtures/sample-round/`.
