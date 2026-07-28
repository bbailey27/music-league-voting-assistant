# League registry

The central index of **recurring leagues** and the machinery each one uses. Music League
runs the same leagues over and over (a new K-pop Boy Group Years round every few weeks, a
new story-chain installment, a new tarot arcana). Each league carries standing context —
a slug family, an eligibility/DQ rule, reusable scripts, fit-guidance profiles, relevant
rules and skills — that used to live scattered across `.cursor/rules/round-slug-naming.mdc`,
`spec/fit-guidance.md`, and individual script headers. This registry pulls that into one
place so it can be looked up and surfaced automatically.

**Source of truth:** [`scripts/leagues.mjs`](../scripts/leagues.mjs) (`LEAGUES` array).
This doc is the narrative; the module is authoritative and machine-readable. Keep them in
sync when adding a league.

## Descriptor shape

Each entry in `LEAGUES` is a `League` descriptor:

| Field             | Meaning                                                                          |
| ----------------- | -------------------------------------------------------------------------------- |
| `id`              | Stable kebab-case key (`bg-years`, `story-chain`, …).                            |
| `names`           | Exact league names as they appear in the ML page `<title>`.                      |
| `slugFamily`      | Human slug shape (`bg-<year>`, `story-<n>`) — matches `analysis-artifacts`.      |
| `slugPrefixes`    | Bare-slug prefixes for matching a round when the league name is absent.          |
| `mode`            | Default scoring mode (`objective` / `thematic`).                                 |
| `summary`         | One-line description.                                                            |
| `reminders`       | Standing eligibility / DQ / scoring reminders (surfaced on parse).               |
| `releaseDateRule` | Release-date gate rule when the league is year-themed (`spec/release-dates.md`). |
| `scripts`         | Reusable scripts + a one-line role each.                                         |
| `rules`           | Relevant `.cursor/rules/*.mdc`.                                                  |
| `skills`          | Relevant `.cursor/skills/*` ids.                                                 |
| `fitProfiles`     | `spec/fit-guidance.md` profile ids (thematic leagues).                           |
| `refs`            | Relevant spec files.                                                             |

## How a round is matched

`leagueForRound({ roundId, leagueName })` resolves a descriptor by:

1. **Exact league name** (case-insensitive) from the parsed round (`round.league`, read
   from the ML `<title>` — see [`extract-html.mjs`](../scripts/extract-html.mjs)).
2. **Slug-family fallback** — the round id's bare slug prefix (`bg-2018` → `bg-`), for text
   rounds or leagues whose ML name isn't registered.

Unknown rounds resolve to `null` and surface no banner.

## Where it surfaces

- **`just parse <round>`** prints the matched league's reminders + resolved script
  commands (`<round>` / `<year>` filled in) right after writing `music.*`.
- **`just status <round>`** shows which league the round belongs to.
- **`just leagues [<name>]`** lists the registry, or details one league (matches by id,
  name, or slug family/prefix — e.g. `bg`, `bg-years`, `bg-2018`).

## Registry (summary)

Authoritative list in [`scripts/leagues.mjs`](../scripts/leagues.mjs); this table is a map.

| id            | Slug family      | Mode      | Standing notes / machinery                                                                 |
| ------------- | ---------------- | --------- | ------------------------------------------------------------------------------------------ |
| `bg-years`    | `bg-<year>`      | objective | Boy groups, male soloists, subunits; DQ girl groups; `version-earliest` release-year gate. |
| `story-chain` | `story-<n>`      | thematic  | Title-only; `title-*-scan` scripts; profile `story-continuation`.                          |
| `tarot`       | `tarot-<arcana>` | thematic  | Profiles `traits-over-symbols` + `lyrics-first`.                                           |
| `astrology`   | `<sign>`         | thematic  | Chill Western Astrology League; `traits-over-symbols` + `lyrics-first`.                    |
| `lastfm`      | `lfm-<topic>`    | objective | `lastfm-*` table scripts; query via scan scripts, never raw grep.                          |
| `aaa`         | `aaa-<topic>`    | thematic  | Themed AAA rounds.                                                                         |
| `kpop-themed` | `kpop-<theme>`   | thematic  | Themed K-pop song picks.                                                                   |

## Adding or editing a league

1. Add/edit the descriptor in [`scripts/leagues.mjs`](../scripts/leagues.mjs) (`LEAGUES`).
2. Keep `slugFamily` consistent with the
   [recurring slug families](analysis-artifacts.md#recurring-league-slug-families) table and
   [`round-slug-naming.mdc`](../.cursor/rules/round-slug-naming.mdc).
3. List fit profiles that already exist in [`fit-guidance.md`](fit-guidance.md); add the
   profile there first if it's new.
4. Update the summary table above.
5. Log a behavior change in [`decisions.md`](decisions.md) only if it changes tool behavior
   (not for a new note on an existing league).
