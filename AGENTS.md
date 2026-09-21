<!-- GENERATED FILE — do not edit by hand. Source: .cursor/rules/*.mdc — regenerate with: `just agents` -->

# AGENTS.md

Behavioral rules for agents working in this repo, synced verbatim from
[`.cursor/rules/`](./.cursor/rules) so Cursor and AGENTS.md-reading tools (opencode, etc.)
stay in agreement. Edit rules there, then run `just agents` (or: add/edit a rule and run
any `just` command — `just lint` fails with a reminder if AGENTS.md is stale).

Orientation:

- Pipeline runs through [justfile](./justfile) (`just run <round>`, `just status`); stack: Node ESM scripts, no web framework.
- Tests: `npm test` (node:test). Lint: `just lint` / `just fix`. Public repo — round data and personal lists live in the private `data/` submodule, never commit them here.
- Durable specs live in [spec/](./spec); decision history in [spec/decisions.md](./spec/decisions.md).
- After editing or adding any [.cursor/rules/](./.cursor/rules) rule, run `just agents` to regenerate this file before finishing.

## Always-applied rules (17)

### cli-docs-parity.mdc

*Keep CLI help, README, and shared outputs in sync when flags or user-visible behavior change*

# CLI docs and output parity

## CLI help and README

When you **add, rename, or change** a CLI flag, subcommand, or user-facing command
behavior, update in the **same pass**:

1. [`scripts/cli-help.mjs`](./scripts/cli-help.mjs) — `HELP` topic for the command,
   the shared flag blurb (`PIN`, `SCORE_OVERRIDE`, …) if reused, `just help flags`
   matrix, and examples.
2. [`README.md`](./README.md) — command table and flag summary for the affected stage(s).

`just help` is the discoverability layer (`spec/decisions.md` 2026-06-26). Do not ship code-only flag changes and defer help.

Also touch [`spec/point-allocation.md`](./spec/point-allocation.md) when allocation or
profile flags change (existing spec convention).

## Output parity across commands

Shared **outputs** and **pipelines** must stay consistent everywhere they are used.
When you fix or improve user-visible output (table columns, warnings, formatting,
wording, a shared helper's behavior), apply the change to **every command** that uses
that output — not just the one you were working on.

Typical shared surfaces (grep before finishing):

| Surface                                                         | Used by                                        |
| --------------------------------------------------------------- | ---------------------------------------------- |
| [`scripts/parse/cli-print.mjs`](./scripts/parse/cli-print.mjs) | parse, merge, rescore, pick (tables, ballot)   |
| [`scripts/parse/cli-warn.mjs`](./scripts/parse/cli-warn.mjs)   | parse, merge, rescore, pick (blocker warnings) |
| [`scripts/round/explore.mjs`](./scripts/round/explore.mjs)     | parse, merge, rescore (menu + explore write)   |
| [`scripts/tradeoff-rows.mjs`](./scripts/tradeoff-rows.mjs)     | option / up / down tables                      |
| [`scripts/score/render.mjs`](./scripts/score/render.mjs)       | music.md/json payload, markdown reports        |
| [`scripts/cli-help.mjs`](./scripts/cli-help.mjs)               | all documented flags                           |

**Default:** apply parity everywhere — the owner expects the same tables, warnings, and
flag semantics whether they ran `parse`, `merge`, or `rescore`.

**Ask first** only when stages are **intentionally** different (documented in spec or
decisions) or when matching would change committed pick semantics / artifact shape in a
way that is not obviously correct. If unsure whether divergence is intentional, ask
rather than silently leaving one command stale.

## Checklist (same pass as the code change)

- [ ] Flag or command change → `cli-help.mjs` + README
- [ ] Shared output/helper change → all importing commands updated
- [ ] Behavior change → `spec/decisions.md` (per decision-log rule)
- [ ] Major workflow change → `spec/diagrams/` if applicable (per workflow-diagrams rule)

Do not log help-only wording tweaks in `spec/decisions.md` unless they document a
behavior change already recorded there.


### copy-paste-blocks.mdc

*Output pasteable deliverables (tickets, PR/issue/comment text) in a single copyable code block*

# Copyable Paste Blocks

When the user asks for text to paste somewhere else — a ticket/issue description, a
PR description, a code-review comment, a Slack/email message, a commit message body,
or any "give me an md block / something I can paste" request — output it as a SINGLE
fenced code block the user can copy verbatim.

## The fence-nesting rule (most common failure)

If the deliverable itself contains triple-backtick code fences, a triple-backtick
outer wrapper terminates early and the block is not copyable. The outer fence MUST
be longer than any fence inside it.

- Inner content has ` ``` ` fences -> wrap the whole thing in four backticks ` ```` `.
- Inner content has ` ```` ` -> wrap in five backticks. Always outer length = (max
  inner fence length) + 1.
- Do not add a language tag to the outer wrapper (it is a copy container, not
  highlighted source).

## Example

When the ticket text contains a ```ts block, deliver it like this (four-backtick outer):

`````markdown
````markdown
# Ticket title

Some text.

```ts
const x = 1;
```
````
`````

## Checklist before sending pasteable text

- One self-contained block, nothing the user must hand-edit after pasting.
- Outer fence strictly longer than the longest inner fence.
- No stray prose inside the block that is not part of the deliverable.
- Follows `summary-output-format` wording (direct, factual; no filler).


### data-submodule-sync.mdc

*Cursor IDE workflow for the data/ submodule — sidebar, branch picker, push order*

# Data submodule sync (`data/` → `music-league-data`)

`data/` is a **second git repo** inside the project. The parent repo only records which
**commit SHA** `data/` should be at. Cursor treats them as separate repos in Source
Control.

When the user commits or syncs via the **sidebar** (not the terminal), guide them using
**which repo is selected** and **what the branch indicator shows** — not a bash
checklist unless they ask for commands.

## Two repos in Source Control

The sidebar lists **two** repositories (expand "Source Control Repositories" if needed):

| Repo                                       | What it holds                                                                |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| **music-league-voting-assistant** (parent) | Code, specs — plus a **`data` pointer** entry when the submodule SHA changed |
| **data** (or **music-league-data**)        | Round HTML, `analysis/`, `ref/` — the actual private files                   |

**Wrong repo = broken sync.** Commits under `data/analysis/…` belong in the **`data`**
repo. A parent commit that only shows `data` (submodule hash) is just updating the
pointer.

## Before you commit data files (sidebar)

1. **Select the `data` repo** in Source Control (not the parent).
2. **Branch indicator** (bottom status bar, or repo header): must say **`main`**, not
   `HEAD detached at …` or a raw commit hash.
3. If detached: open the **`data` Git graph** → checkout **`main`** → merge or cherry-pick
   your work onto `main` before committing. Do not leave new commits only on a detached
   HEAD.
4. **Pull/sync `data` first** (cloud/sync on the **`data` repo**) before starting work,
   so machines don't fork after the shared ancestor.

## Push order (sidebar)

After data changes:

1. **Commit in the `data` repo** — stage files under `analysis/`, `rounds/`, `ref/`.
2. **Push/sync the `data` repo** — wait until it succeeds (no "ahead of origin").
3. **Switch to the parent repo** — it should now show **`data`** as a changed submodule
   pointer (often listed as modified `data`, not individual data files).
4. **Commit + push/sync the parent** — message like "Update data submodule ref".

**Never push the parent while `data` is still ahead of origin.** That publishes a SHA
GitHub doesn't have → `not our ref` on the other machine.

When the user is about to sync/commit, **remind them which repo to select and whether
`data` has been pushed first** — unless they already confirmed both repos are synced.

## Switching machines (sidebar)

1. **Pull/sync the parent** (prefer pull that updates submodules if offered).
2. **Select the `data` repo** → confirm **`main`**, not detached → **pull/sync**.
3. If the Git graph shows HEAD below `main`, checkout **`main`**.

## How detached HEAD happens (and what it looks like)

Parent pull, submodule update, or **clicking an old commit in the `data` Git graph**
checks out one SHA — not the branch. The status bar shows **`HEAD detached`**; the graph
shows the blue HEAD dot **off** the `main` label.

New commits there are easy to lose across machines until merged onto **`main`** and
pushed from the **`data` repo**.

**Prevention:** after any parent pull, glance at the **`data` repo** branch indicator.
If not `main`, checkout `main` in the graph before editing analysis or rounds.

## Red flags in the UI

| What you see                                                   | Meaning                                        |
| -------------------------------------------------------------- | ---------------------------------------------- |
| `data` repo: **ahead** of origin, parent already pushed        | Other machine will break — push **`data`** now |
| `HEAD detached` on **`data`**                                  | Stop — checkout **`main`** before more commits |
| Parent shows **`data`** changed but you didn't push **`data`** | Push **`data`** first, then commit parent      |
| Git graph: **`main`** cloud on a commit you don't have         | Pull **`data`** before committing              |


### decision-log.mdc

*Keep spec/decisions.md current as decisions are finalized and committed*

# Maintain the decision log

When committed/spec behavior changes, add a **newest-first** entry to
`spec/decisions.md` in the same pass — don't defer.

**Scope:** tool/code/spec behavior only. Do **not** log round-specific analysis work —
song-research rankings, candidate add/drop adjustments, or per-round `data/analysis/**`
edits are not spec changes and don't belong here.

Format: `## <YYYY-MM-DD> — <title>` · **Change** · **Why** · **Overruled** (if any) ·
**Refs** (short hash + spec section once shipped; see below).

Skip in-session false starts. Per `no-auto-commit`, only commit when the user asks.

## Refs: `working tree` and backfill

- The **entry you are writing now** for uncommitted work uses `working tree` in
  **Refs** until that work is committed.
- You cannot know the hash before commit. After the behavior lands in git, update
  that entry's ref on the **next** `decisions.md` edit (same session or later) —
  not in the same breath as drafting the entry.
- **Whenever you add or edit any decision-log entry**, also scan older entries:
  1. `rg 'working tree' spec/decisions.md` — skip non-ref prose (e.g.
     no-auto-commit wording).
  2. For each stale **Refs** line except the current uncommitted entry, find the
     introducing commit (`git log -1 --oneline -- <primary file from ref>`) and
     replace `working tree` with that short hash.
  3. Backfill a few obvious matches per pass; do not repo-wide sweep unless asked.

This keeps refs current incrementally — each decision-log touch cleans up prior
`working tree` leftovers.


### end-of-session-commit-reminder.mdc

*Remind the user to commit before ending a session when work is uncommitted*

# End-of-session commit reminder

When the session is winding down — the user says they're done, signs off, or you
have finished a substantial chunk of work — **do not commit on your own** (see
`no-auto-commit.mdc`). Instead, **remind the user** if there is uncommitted work.

## When to remind

- User signals end of session ("that's all", "thanks", "logging off", etc.)
- You are wrapping up after a multi-file feature or refactor
- `git status` would show modified/untracked files you touched this session

Skip the reminder if the working tree is clean or the user already committed or
explicitly said they'll commit later.

## What to say (brief)

1. **Uncommitted changes** — note that files are still in the working tree; offer
   to commit in reasonable chunks if they want (do not run `git commit` unless asked).
2. **`data/` submodule** — if analysis/rounds under `data/` changed, remind which
   repo to commit/push first (`data` before parent pointer). See `data-submodule-sync.mdc`.
3. **Active plan files** — if `.cursor/plans/*.plan.md` with open work was part of
   this effort, note plan-lifecycle: commit the plan with the effort's first commit,
   delete when shipped.

Keep it to a short checklist, not a lecture.


### no-auto-commit.mdc

*Never create git commits unless the user explicitly asks*

# Never commit unless explicitly asked

Do **not** run `git commit` (or `git commit --amend`) on your own initiative.
Only commit when the user explicitly asks you to in their request.

- Finishing a task, fixing tests, or "wrapping up" is **not** permission to commit.
- Leave changes in the working tree for the user to review.
- Other git operations that don't create commits (`status`, `diff`, `log`,
  `add`) are fine when useful.

When in doubt, leave the work uncommitted and let the user decide.


### no-grep-csvs.mdc

*Never grep/rg directly on the song reference CSVs*

# Never grep the song CSVs directly

The song CSVs the scan scripts load (`data/ref/fav-songs.csv`,
`data/ref/chill-minor-rock-etc-search.csv`, `data/ref/all-songs-no-inst.csv`,
and `data/ref/lastfm/track-titles.csv`) contain many columns beyond the title.
Running `grep` / `rg` on them produces noisy, misleading results because the
search term can match album names, artist names, playlist names, or other
metadata — not just titles. (The Last.fm title table is picked via
`table-map.json` / `--table`; regenerate it with `node scripts/lastfm-aggregate.mjs`.)

The same applies to the other generated Last.fm tables in `data/ref/lastfm/`
(`tracks-variants.csv`, `tracks-affinity.csv`, `tracks-versions.csv`,
`tracks-pandora.csv`, `tracks-chart.csv`, `tracks-literal.csv`, `artists.csv`) —
query them with the Last.fm scripts, not raw `grep`.

Always use the dedicated scan scripts instead:

| Need                                  | Script                                              |
| ------------------------------------- | --------------------------------------------------- |
| Titles **starting with** a word       | `node scripts/title-prefix-scan.mjs <prefix> [...]` |
| Titles **containing** a word anywhere | `node scripts/title-contains-scan.mjs <word> [...]` |

Both scripts parse the CSVs properly, extract only the title column, normalize
and dedup, and produce a clean grouped report.

## Presenting results

1. Always write output to a file with `--out <path>` (e.g. under `data/analysis/<round>/`).
2. Tell the user exactly where the file is.
3. Also reproduce the **full, unfiltered** results directly in the visible chat
   response — not buried in a collapsed tool-output block. Every matching title
   must appear; do not summarize, filter, editorialize, or omit any hits.


### output.mdc

*Output conventions — tables, highlights, and fit-round artifacts in CLI and rendered reports*

# Output Rules

Authoritative spec: [`spec/analysis-artifacts.md`](./spec/analysis-artifacts.md),
[`spec/point-allocation.md`](./spec/point-allocation.md).

## Tables

- **Ranked table** — sort by allocation rank; include artist when useful.
- **Raw-order vote-transfer table** — `#`, title, points; copy-back into Music League.
- **Explore output** — Up options (A–E), Down options, Ballot preview after parse/merge/rescore.
- **Excluded songs** — BLANK/DQ/gate-fail visible in CLI tables, not silently dropped.

## Highlights

Surface in markdown/HTML/CLI when present:

- Cutoff / gate failures
- `needsUserInput` blank scores (blocker — lead with these)
- `needsReview` / uncertainty (`?` band — see `spec/uncertainty.md`)
- Fit/music disagreements
- Pin-reflowed option columns vs committed ballot

## Fit rounds

Fit research output is `fit.json` + rendered `fit.html` / `scores.html` — not a
markdown fit table. After pick, `music.md` carries the committed allocation.

Preserve user and submitter comments verbatim when practical.


### parsing.mdc

*Hard rules for parsing round inputs and scores (numeric-first, userComment only, HTML preferred, never cluster by string similarity)*

# Parsing Rules

Authoritative spec: [`spec/round-input-parsing.md`](./spec/round-input-parsing.md),
[`spec/score-parsing.md`](./spec/score-parsing.md).

## Hard rules

- **Numeric parsing before evaluation** — digit scaling, modifiers, then rank/tier.
- **`userComment` only** — never score from `submitterComment`.
- **Own songs skipped** — `mine: true` / own marker; still list in raw-order table.
- **HTML preferred** — use saved `.html` when available; lenient text is fallback.
- **Peel-first comments** — scoring line is before the first newline; see score-parsing.
- **Years are not scores** — bare 19XX/20XX skipped when scanning for music number.
- **Bare `-`** — disqualified / below consideration (not a numeric score).
- **Never cluster by string similarity** — 715 ≠ 735.

## Paths

| Input | Command hint |
| --- | --- |
| `.html` | `just parse <round>` |
| Live Text paste | `just parse <round> --lenient` or web app paste |

If this file disagrees with **spec/**, follow the spec.


### plan-lifecycle.mdc

*When to commit, keep, and delete .cursor/plans/*.plan.md files*

# Plan file lifecycle

Plans are scratch paper during implementation. Durable context lives in `spec/`,
`spec/decisions.md`, and git history — not a growing plans folder.

## Commit timing

- **Multi-step effort (several commits):** include any related
  `.cursor/plans/*.plan.md` files that are not yet committed in the **first**
  commit of the effort (even if still `status: pending`). Delete finished plan
  files in the **last** commit of that effort.
- **Single commit, plan already in git:** delete the finished plan in that same
  commit if nothing remains open.

### Single commit, plan not yet committed

When the whole effort will land in **one commit** and the plan file has **never**
been committed, **ask the user** which path to take — do not assume:

1. **Commit the plan** (include it in the commit), then delete it in a **later**
   pass once implementation is verified done. Use when you want the design in git
   history alongside the code.
2. **Do not commit the plan** — treat it as ephemeral scratch paper; delete it as
   soon as implementation is done (same session / before or with the code commit,
   but the plan file itself never enters git).

If the user has already expressed a preference in the thread, follow that instead
of asking again.

## What to keep

Keep only plans that are **partial or not started**:

- `future-plans.plan.md` — living backlog (always)
- Named plans with open todos or deferred scope

When a plan is mostly done, **extract any open items into `future-plans.plan.md`**
(or another partial plan) **only as pointers** — then either:

- **Keep the plan file** trimmed to open phases (full steps, verification, file
  paths — enough to resume without git), or
- **Move the full open-phase detail** into a surviving partial plan.

Do **not** replace a deleted plan with a one-line summary in `future-plans`. The
backlog table links to partial plans; the plan file holds the how-to.

Do **not** keep `status: done` plans for reference — `git show <commit>:.cursor/plans/foo.plan.md`
recovers them. No plan slug needed in `decisions.md`.

## Orchestrator / master plans

When a master plan's waves are shipped, delete the master plan and all done child
plans together. Move any open items to `future-plans` or a surviving partial plan
first.

## Folder target

Between efforts: ~3–8 files in `.cursor/plans/` (backlog + active partials +
deferred tracks), not an archive of completed work.


### ranking.mdc

*Music-score ranking conventions — sort by numeric score first; uncertainty never changes baseline ordering*

# Ranking Rules
Sort by numeric score first.
Uncertainty never changes baseline ordering.
Compare uncertain songs against adjacent tiers only when near a cutoff.
Keep equal scores in the same tier whenever practical.
This preference applies primarily to music-score ranking and does not override meaningful fit differences.


### release-dates-no-spotify.mdc

*Release-date lookups use cache/MusicBrainz/Wikipedia only — do not suggest Spotify API credentials (not implemented, not planned)*

# Release dates — no Spotify API

**Do not suggest setting up Spotify API credentials** (`SPOTIFY_CLIENT_ID`,
`SPOTIFY_CLIENT_SECRET`) for release-date lookups. That integration is **not implemented**
for this workspace and is **not planned** — treat any stub code as a possible future path only.

## Lookup order (bg-years / `release-year-gate.mjs`)

1. Local cache (`data/ref/release-dates.json`)
2. With `--fetch`: **MusicBrainz** (artist + title search)
3. If MusicBrainz misses or looks wrong (compilation/repackage trap): **Wikipedia** song
   article — cite the wiki URL

## Reporting year checks to the user

Split results into **confirmed** vs **needs check**:

- **Confirmed** — date from cache/MB/wiki with a cited source; safe to pass/fail the gate.
- **Needs check** — no date yet, MB only matched a compilation/repackage, or sources disagree.
  List these explicitly with wiki/search links. **Never present an unverified date as final.**

Hand-verify ambiguous rows, then add dates to the cache or re-run `--fetch`.

## Related

- `spec/release-dates.md`
- `scripts/release-year-gate.mjs`


### round-slug-naming.mdc

*Round slug naming — reuse a league's slug family so a round stays in one folder*

# Round slug naming

Round ids are `YYYY-MM-DD-<slug>`. `maintain-rounds.mjs` auto-stamps the date; you choose
the `<slug>`.

**Recurring leagues reuse one bare slug family.** Date-slugging folds a later HTML/text
export into an existing research folder **only when the bare slug matches** (the part after
`YYYY-MM-DD-`). A mismatched slug silently creates a second `analysis/<date>-<slug>/` folder
for the same round — so the pre-round research and the parsed votes never merge.

Before naming a new round or research folder:

1. Check the active **and** `archive/` trees (`data/rounds/`, `data/analysis/`) for prior
   installments of the same league.
2. Reuse their exact slug shape for the research folder, the saved input file, and every
   analysis artifact.

Known families (full table in [spec/analysis-artifacts.md](./spec/analysis-artifacts.md)):

- **K-pop Boy Group Years → `bg-<year>`** (`bg-2016`, `bg-2017`, `bg-2018`) — not `<year>-bg-kpop`.
- Story chain → `story-<n>`; Tarot → `tarot-<arcana>`; Last.fm → `lfm-<topic>`; AAA → `aaa-<topic>`.

If this file disagrees with the spec, follow **spec/**.


### rule-frontmatter.mdc

*Every rule file in .cursor/rules/ must have frontmatter (summary description + alwaysApply) — fix any rule found without it*

# Rule frontmatter requirement

Every `.cursor/rules/*.mdc` file must carry frontmatter. A rule without it is **not
loaded by Cursor at all** — it silently stops governing behavior, and the AGENTS.md
sync (`just agents`) quarantines it into a "reference only" section that no agent
treats as active.

When you find a rule file with no frontmatter — while editing rules, running
`just agents` (the script warns), or any repo touch — fix it in the same pass:

1. Add frontmatter with a **summary description** of the rule's actual content
   (one line, written to trigger correctly in Cursor's agent-requested mode).
2. Tag it `alwaysApply: true` — these existing rules were all written to govern
   generally. Only downgrade to `alwaysApply: false` if the content is clearly
   situational to one task type.
3. The body stays as-is; do not rewrite the rule's substance while adding the header.
4. Run `just agents` so `AGENTS.md` picks the rule up. If you forget, the staleness
   check catches it on the next `just lint` (see below).

Staleness enforcement: `just agents` regenerates `AGENTS.md`; `just lint` runs
`scripts/sync-agents-md.mjs --check` and fails with a reminder whenever rules changed
without a re-sync. After adding or editing any rule, run it in the same pass.

Template:

```mdc
---
description: <one-line summary of what the rule governs>
alwaysApply: true
---
```

Do not log frontmatter additions in `spec/decisions.md` — they are metadata recovery,
not behavior changes (the rule text is what governs, and it predates the fix).


### save-plans-in-repo.mdc

*Always save finalized plans into the repo's .cursor/plans/ folder*

# Save plans in the repo

When you produce a plan (e.g. via the plan/CreatePlan flow), also persist it
into this repo at `.cursor/plans/` so it is version-controlled alongside the code.

- Write the plan to `.cursor/plans/<slug>.plan.md` (use the `*.plan.md` suffix to
  match the existing files in that folder).
- Use a short, descriptive kebab-case slug for `<slug>`.
- Keep YAML frontmatter consistent with the other plans (`name`, `overview`,
  `status`, `isProject`).
- If a plan tool wrote the file elsewhere, copy it into `.cursor/plans/` here as well.

When the work ships, follow [plan-lifecycle.mdc](./.cursor/rules/plan-lifecycle.mdc): delete finished
plans (extract any open items to `future-plans.plan.md` first).


### summary-output-format.mdc

*Output summaries as copyable markdown blocks with direct wording*

# Summary Output Format

When the user asks for a summary — of changes, for a PR, for a ticket, for a code review response, or any other deliverable text — output it inside a fenced markdown code block (` ```markdown `) so they can copy it directly.

## Wording

- Write in direct, factual language. Describe what changed and why.
- Do not use filler phrases like "This change enhances...", "This improvement ensures...", "We have implemented...", or "This update provides...".
- Prefer short active sentences: "Added X", "Split Y into Z", "Replaced A with B".
- Name the specific files, flags, functions, or patterns involved.
- When a decision was made not to address something, state the reason plainly.
- Do not over-clarify based on discarded attempts and misunderstandings.


### workflow-diagrams.mdc

*Keep spec/diagrams flowcharts in sync when major workflows change*

# Workflow diagrams

Visual flow docs live in [`spec/diagrams/`](./spec/diagrams/README.md) (mermaid flowcharts
for scoring and pipeline behavior).

## When to update

If you change a **major workflow** — behavior that affects how data moves through parse,
merge, normalize, allocate, pick, or render — in the same pass:

1. Check whether `spec/diagrams/` already has a diagram for that flow.
2. **Update** the existing diagram and prose if the flow changed.
3. **Add** a new file under `spec/diagrams/` (and a row in `README.md`) if none exists.

“Major” means a user-visible or allocator-visible path change, not refactors that preserve
behavior (rename/move with no semantic change).

## Conventions

- One topic per file; kebab-case filename; link from `spec/diagrams/README.md`.
- Match diagram style in existing files (camelCase node IDs, `flowchart LR` / `TD`).
- Note **planned vs shipped** in prose when behavior is not yet in code.
- Cross-link the implementing script(s) and relevant spec section.

Do not log diagram-only edits in `spec/decisions.md` unless they document a behavior change
already recorded there.


## Situational rules (2) — apply when the description matches the task

### allocation.mdc

*Point allocation — follow spec/point-allocation.md*

# Allocation Rules

Authoritative rules live in [`spec/point-allocation.md`](./spec/point-allocation.md)
(pre-allocation gate, clustering, smoothness, standing shape, tradeoffs, invariants).

If this file disagrees with the spec, follow **spec/**.


### song-release-status.mdc

*Song/album research — save release-status findings (B-Side vs Title Track vs Single) into the private data/ ref docs*

# Song release status — record findings in ref docs

When researching any song for any task (round fit, release year, candidate scoring,
scrobble cleanup), any release info you learn — album appearance, standalone single
release, title-track status — **must be saved into the ref docs, even if it surfaced
incidentally** and even if nobody asked. Record it in:

1. `data/ref/all-songs-no-inst.csv` + `data/ref/all-scrobbles.csv` — the trailing
   `B-Side vs Title Track vs Single` column on every (song, artist) row.
2. `data/ref/b-side-title-track-status.csv` — one row: song | album | the album's actual
   lead single | status | source note.

Status vocabulary and the full workflow (row hygiene, no-tag list for Pandora
pseudo-rows) live in [`data/README.md`](./data/README.md#rule-song-release-status-b-side--title-track--single)
— that file is authoritative; this rule is the pointer.

Key definitions to keep straight:

- **Title track** is the album's *lead/promotional* song — not a literal name match with
  the album (EXO's THE WAR title track is "Ko Ko Bop"). Verify what the album promoted
  (Wikipedia tracklist/infobox, official announcements) before assigning.
- A standalone single that later shows up as an album b-side stays **Single** (lone
  "Single" = single-only or single + b-side; never title track).
- A track that was a standalone single AND later an album's title track becomes
  **Title Track** — or the clarified **Single + Title Track** when the standalone
  release history is worth keeping.
- Promoted album tracks (b-side with an MV / music-show promotion) are **not** singles
  unless actually released standalone.
- Empty column = not yet checked. Never write "Unknown".

Do not grep the song CSVs directly while reading/writing these columns — see
`no-grep-csvs` (always-applied). After editing the tables, keep field counts and the
private submodule ordering rule in `data-submodule-sync` in mind.

## File targets (all root-relative)

| File                                     | What to do there                                            |
| ---------------------------------------- | ----------------------------------------------------------- |
| `data/ref/all-songs-no-inst.csv`         | trailing release-status column, every (song, artist) row     |
| `data/ref/all-scrobbles.csv`             | same column, same rule                                       |
| `data/ref/b-side-title-track-status.csv` | findings log row with album, actual lead single, source note |
| `data/README.md`                         | the rule + status vocabulary (authoritative reference)       |


