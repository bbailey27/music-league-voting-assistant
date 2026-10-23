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
| `slugPrefixes`    | Bare-slug prefixes for matching a round when the league name is absent.                     |
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
2. **Slug-family fallback** — the round id's bare slug prefix, for text rounds or
   rounds whose ML name isn't registered.

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
- **`just save-round <slug>`** is the naming-consistency moment: matching families
  print their recent slugs; unknown families print the digest and (interactive
  sessions) ask before saving, then auto-register the family. `just rename <slug>`
  re-aligns afterwards, cascading input/analysis/picks/registry.

## Adding or editing a league

1. Add/edit the descriptor in `data/ref/leagues.json` (private submodule). Plain
   leagues usually get there automatically — editing one only matters when it needs
   reminders, scripts, or cross-links.
2. Constraint-league reminders follow the fit-profile vocabulary in
   [`fit-guidance.md`](fit-guidance.md); add a new profile there first.
3. Keep the description generic in docs — the examples live in the data file.
4. Log a behavior change in [`decisions.md`](decisions.md) only if it changes tool
   behavior (not for a new note on an existing league).
