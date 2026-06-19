# Analysis artifact layout

Round inputs and analysis outputs live in the private `music-league-data` submodule
mounted at **`data/`** (see README → Private data). Each round's outputs live in
**`data/analysis/<date>-<slug>/`** (per-round folder). Inputs stay flat in
**`data/rounds/<date>-<slug>.html`**.

## Naming

| Artifact     | Files                                           | Meaning                                                |
| ------------ | ----------------------------------------------- | ------------------------------------------------------ |
| **Music**    | `music.md`, `music.json`, optional `music.html` | Comment scores + music-only draft allocation           |
| **Fit**      | `fit.json`, `fit.html`, optional `fit.md`       | Thematic fit research only — **no** `draftVotes`       |
| **Scores**   | `scores.json`, `scores.html`                    | **Deliverable** — merged music + fit with `draftVotes` |
| **Versions** | `versions/*`                                    | Exploratory score variants (not official)              |

The shared file legend lives once, git-tracked in the data submodule, at
**`data/analysis/README.md`** — the tooling does **not** generate a per-round README.
Add a `README.md` inside a round folder only when that round has specific detail worth
recording.

Produce scores with:

```bash
node scripts/parse-round.mjs data/rounds/<round>.html --fit data/analysis/<round>/fit.json
```

That writes `scores.json` and leaves `fit.json` unchanged.

## Date slugs and tidying

Round ids carry a leading `YYYY-MM-DD-` date slug. `scripts/maintain-rounds.mjs`
(`ml tidy`, also run automatically at the start of `ml run`) keeps the trees tidy:

- **Name.** Any undated round id — input file in `data/rounds/` and/or folder in
  `data/analysis/` — gets today's date prepended (a round's `.html`/`.txt` inputs
  and analysis folder rename together). Before **5am** local it stamps _yesterday_,
  so a late-night export keeps the date of the round it came from. Already-dated
  ids and name collisions are left untouched.
- **Archive.** Rounds whose slug date is **more than 2 days** older than the
  effective today are moved into the archive folders (today + yesterday +
  2-days-ago stay active). Tune the window with `--age N`; undated rounds are
  skipped (unknown age). During `ml run` the round being run is never archived.

Use `ml tidy --dry-run` to preview, `--no-name` / `--no-archive` to run one half.

## Archive

- `data/rounds/archive/` — retired inputs; **ignored** by round discovery/parsing.
- `data/analysis/archive/` — retired outputs; ignored by pipeline status.

When consulting a **previous** round, check both the active folders and `archive/`.

## Example

```text
data/analysis/README.md            ← shared legend (git-tracked in data submodule)
data/analysis/2026-06-09-tarot-hanged-man/
  music.md
  music.json
  fit.json
  fit.html
  scores.json
  scores.html
```

Synthetic reference round: `tests/fixtures/sample-round/`.
