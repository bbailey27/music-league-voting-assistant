# Analysis artifact layout

Round inputs and analysis outputs live in the private `music-league-data` submodule
mounted at **`data/`** (see README → Private data). Each round's outputs live in
**`data/analysis/<date>-<slug>/`** (per-round folder). Inputs stay flat in
**`data/rounds/<date>-<slug>.html`**.

## Pipeline stages (ownership)

Each stage reads/writes specific artifacts. **Only parse reads HTML.**

| Stage            | Script                             | Reads                                  | Writes                                  |
| ---------------- | ---------------------------------- | -------------------------------------- | --------------------------------------- |
| **Parse**        | `parse-round.mjs` / `just parse`   | round `.html`/`.txt`                   | `music.md`, `music.json`                |
| **Fit research** | agent / manual                     | round prompt, songs                    | `fit.json` (thematic only)              |
| **Merge**        | `merge-scores.mjs` / `just merge`  | `music.json`, `fit.json`               | `scores.json`                           |
| **Pick**         | `pick-round.mjs` / `just pick`     | `music.json` (+ `fit.json` for replay) | `pick` on JSON, `picks.jsonl`           |
| **Render**       | `render-*-html.mjs` / `just final` | persisted JSON                         | `music.html`, `scores.html`, `fit.html` |

**Invariants:**

- Parse never writes `pick` or `scores.json`.
- Merge never reads HTML and never records a pick.
- Pick never reads HTML; it preserves the full `options[]` menu for training.
- Renderers are pure — they read persisted JSON only (no re-merge / re-allocate).

Re-parse (`just parse`) only when replacing the HTML export. Pick is always a separate
JSON step afterward.

## Naming

| Artifact     | Files                                              | Meaning                                                |
| ------------ | -------------------------------------------------- | ------------------------------------------------------ |
| **Music**    | `music.md`, `music.json`, optional `music.html`    | Comment scores + music-only draft allocation           |
| **Fit**      | `fit.json`, `fit.html`, optional `fit.md`          | Thematic fit research only — **no** `draftVotes`       |
| **Scores**   | `scores.json`, `scores.html`                       | **Deliverable** — merged music + fit with `draftVotes` |
| **Pick log** | `data/analysis/picks.jsonl` (one file, all rounds) | Pick training log (chosen, full menu, reason)          |
| **Versions** | `versions/*`                                       | Exploratory score variants (not official)              |

The shared file legend lives once, git-tracked in the data submodule, at
**`data/analysis/README.md`** — the tooling does **not** generate a per-round README.
Add a `README.md` inside a round folder only when that round has specific detail worth
recording.

Produce scores with:

```bash
just merge <round>
# or: node scripts/merge-scores.mjs <round-id>
```

That writes `scores.json` and leaves `fit.json` unchanged.

## Date slugs and tidying

Round ids carry a leading `YYYY-MM-DD-` date slug. `scripts/maintain-rounds.mjs`
(`ml tidy`, also run automatically when parsing via `parse-round.mjs` / `ml parse`,
and at the start of `ml run` before archiving) keeps the trees tidy:

- **Name.** Any undated round id — input file in `data/rounds/` and/or folder in
  `data/analysis/` — gets today's date prepended (a round's `.html`/`.txt` inputs
  and analysis folder rename together). Before **5am** local it stamps _yesterday_,
  so a late-night export keeps the date of the round it came from. If a dated
  sibling with the same bare slug already exists (common when candidate research
  started early), the undated id is folded into that sibling instead of stamping
  a second date. Duplicate dated ids for the same bare slug are merged into the
  earliest date. Already-dated ids and unresolvable name collisions are left
  untouched.
- **Archive.** Rounds whose slug date is **more than 2 days** older than the
  effective today are moved into the archive folders (today + yesterday +
  2-days-ago stay active). Tune the window with `--age N`; undated rounds are
  skipped (unknown age). During `ml run` the round being run is never archived.

Use `ml tidy --dry-run` to preview, `--no-name` / `--no-archive` to run one half.

## Recurring league slug families

Many rounds belong to a **recurring league** that reuses a predictable bare slug (the part
after the `YYYY-MM-DD-` date). Naming and folding key off the **bare slug**: `applyDateSlugs`
folds an undated input into an existing dated folder only when their bare slugs match
(`bareSlugOf`, `datedSiblingsOf` in `scripts/paths.mjs`). So a new installment must reuse its
league's established slug family — otherwise the pre-round research folder and the later parsed
round land in two `analysis/<date>-<slug>/` folders that never merge (as happened when 2017
research was slugged `2017-bg-kpop` but the parsed round was `bg-2017`).

| League                 | Slug family      | Examples                        |
| ---------------------- | ---------------- | ------------------------------- |
| K-pop Boy Group Years  | `bg-<year>`      | `bg-2016`, `bg-2017`, `bg-2018` |
| Story / sentence chain | `story-<n>`      | `story-8`, `story-9`            |
| Tarot                  | `tarot-<arcana>` | `tarot-devil`, `tarot-hermit`   |
| Last.fm stats          | `lfm-<topic>`    | `lfm-art`, `lfm-curses`         |
| AAA                    | `aaa-<topic>`    | `aaa-cars`, `aaa-text`          |
| K-pop themed           | `kpop-<theme>`   | `kpop-ost`, `kpop-glittering`   |

**Before creating a new round input or analysis folder**, look for prior installments of the
same league in the active _and_ `archive/` trees (`data/rounds/`, `data/analysis/`) and copy
their exact slug shape. Name the pre-round research folder, the saved HTML/text input, and
every analysis artifact with that one bare slug so the whole round stays in a single
`analysis/<date>-<slug>/` folder — including when the voting-HTML export is added later.

## Archive

- `data/rounds/archive/` — retired inputs; **ignored** by round discovery/parsing.
- `data/analysis/archive/` — retired outputs; ignored by pipeline status.

When consulting a **previous** round, check both the active folders and `archive/`.

## Example

```text
data/analysis/README.md            ← shared legend (git-tracked in data submodule)
data/analysis/picks.jsonl          ← pick training log (all rounds)
data/analysis/2026-06-09-tarot-hanged-man/
  music.md
  music.json
  fit.json
  fit.html
  scores.json
  scores.html
```

Synthetic reference round: `tests/fixtures/sample-round/`.
