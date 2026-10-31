# League registry

The engine that ties a round to its **recurring league** context, and the machinery
each one carries (slug family, mode, standing eligibility/DQ reminders, reusable
scripts, fit-guidance profiles).

**Source of truth: [`data/ref/leagues.json`](../../data/ref/leagues.json) — a private
file in the data submodule.** The main repo publishes it, so no league or round facts
(names, slug families, reminders, round examples) live here. This doc describes the
machinery only; [`scripts/leagues.mjs`](../scripts/leagues.mjs) is the engine that
reads the file (generic fixture for tests: `tests/fixtures/leagues-registry.json`).

## Descriptor shape

Each entry in the registry file is a `League` descriptor:

| Field             | Meaning                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `id`              | Stable kebab-case key.                                                                      |
| `names`           | Exact league names as they appear in the ML page `<title>`.                                 |
| `slugFamily`      | Human slug shape — matches the per-round folder naming.                                     |
| `slugPrefixes`    | Slug-match prefixes; trailing `-` = token family, bare `x-y` = exact 1-round family.        |
| `mode`            | Default scoring mode (`objective` / `thematic`; `null` until a parse records one).          |
| `summary`         | One-line description.                                                                       |
| `reminders`       | Standing eligibility / DQ / scoring reminders (surfaced on parse). Empty for plain leagues. |
| `releaseDateRule` | Release-date gate rule when the league is year-themed (`spec/release-dates.md`).            |
| `scripts`         | Reusable scripts + a one-line role each.                                                    |
| rules/skills/refs | Cross-links to rules, skills, fit profiles, and specs.                                      |

**Plain vs. constraint leagues.** A plain league registers with only name/family/mode/
summary — no reminders. Its parse banner is the league label alone. Constraint leagues
(the ones an LLM must check against standing rules) carry the `reminders` text.

## How a round is matched

`leagueForRound({ roundId, leagueName })` resolves a descriptor by:

1. **Exact league name** (case-insensitive) from the parsed round (`round.league`, read
   from the ML `<title>` — see [`extract-html.mjs`](../scripts/extract-html.mjs)).
2. **Slug-family fallback — most-specific prefix wins.** The round id's bare slug is
   matched against every league's `slugPrefixes` and the **longest** matching prefix
   claims the round; equal-length ties go to the family listed **later** in the
   registry file. Since entries are appended (upsertPlainLeague and hand edits both
   add at the bottom), file order is creation order — the **newest** family wins a
   tie. A broader family therefore cannot swallow a narrower league's rounds:
   `<family>-constraints-` beats `<family>-`. The same rule decides
   `upsertPlainLeague`'s covered-by-slug check, which league a round's slug recency
   counts toward, and which family's recent slugs save-round recalls.

Unknown rounds resolve to `null` and surface no banner.

## Where it surfaces

- **`just parse <round>`** prints the matched league's reminders + resolved script
  commands (`<round>` / `<year>` filled in) right after writing `music.*`; it also
  fills a nameless family entry with the official name + mode (save-round created it
  slug-first).
- **`just status <round>`** shows which league the round belongs to.
- **`just leagues [<name>]`**: lists every family active-first with the 3 most recent
  concrete slugs (a 14-day window counting archived rounds, since sweeps happen at
  2 days); dormant families collapse to a footer. Details one league by id, name, or
  slug prefix. Also backfills plain-league pages into the registry from round history.
- **`just save-round <slug>`** is the naming-consistency moment. It drains the
  clipboard first and extracts the round's official league name from the export
  `<title>`, so every prompt shows the round's name plus the proposed families'
  registered names. One uniform ladder for the save:
  1. slug matches a family — no prompt when the round's name is registered (or the
     family is nameless); otherwise ask once. The prompt lists, numbered: a family
     already carrying the round's league name (suggested correction — `1` folds
     the slug into it, the name is the proof), then first-token matches
     (`1..N` merge), plus `m` = alias under the slug owner, `root <x-test->` =
     stake the family root yourself (the round saves under its slug but joins the
     typed root — `root kpop-test-` starts a `kpop-test-<topic>` series),
     `y` = full round slug as its own 1-round family, `<round-slug>` = save under
     a NEW bare round slug (a round name, never a family id — family rules
     re-check it), `n` cancels.
  2. slug matches nothing but the league name is registered → auto-fold into that
     family (common-run widen for 1-round families; token-anchored families stay
     pinned to their shape and take the sibling slug as an exact add).
  3. slug matches nothing but shares a first token with any family → merge or
     separate prompt (`m`/`1..N` merge, `y` separate, `<round-slug>` rename).
  4. nothing matches (slug, token, name) → fully new league: auto-saves its own
     1-round family, no question.
  A parsed round whose official name matches an entry widens it on parse
  (covered-by-name) — the name is the same-league proof. `just rename <slug>`
  re-aligns a saved round afterwards, cascading input/analysis/picks/registry.

## Adding or editing a league

1. Add/edit the descriptor in `data/ref/leagues.json` (private submodule). Plain
   leagues usually get there automatically — editing one only matters when it needs
   reminders, scripts, or cross-links. **Append new descriptors at the bottom** —
   file order is creation order and equal-length slug-prefix ties go to the
   last-listed (newest) family.
2. Constraint-league reminders follow the fit-profile vocabulary in
   [`fit-guidance.md`](fit-guidance.md); add a new profile there first.
3. Keep the description generic in docs — the examples live in the data file.
4. Log a behavior change in [`decisions.md`](decisions.md) only if it changes tool
   behavior (not for a new note on an existing league).

## Fixing a drifted slug family from the CLI

Auto-registration only fills gaps — a descriptor matched by league name (or an
earlier slug prefix) never gets its `slugFamily` or `slugPrefixes` revised, so the
family shape can go stale when a league changes its round naming. Fix it with the
`ml leagues <name>` edit flags (see `just help leagues` for the full block):

- `--set-family '<shape>'` — the display shape.
- `--set-prefixes 'p1,p2'` — replaces the bare prefixes that actually drive round
  matching (`startsWith`); keep lists narrow, a too-broad prefix merges unrelated
  leagues' rounds into one entry (e.g. a generic `<prefix>-` family merged with the
  more specific `<prefix>-constraints-` family). Dash-explicit: a prefix ending in
  `-` is a token family; one without is an **exact-slug family** — the 1-round
  shape for a one-off league (`--set-family '<saved-slug>' --set-prefixes '<saved-slug>'`),
  which also picks up same-league sub-slugs later without implying an open series.
- `--summary '<text>'` — rewrites the one-line summary so the shape inside it matches.

Edits print a before → after diff, refresh the detail card, and warn when the
family's concrete prefix is not covered by `slugPrefixes`. They write
`data/ref/leagues.json` in place and bust the in-process cache.
