// CLI help text — single source for `just help` / `ml help` and README parity.

export const HELP_TOPICS = [
  'parse',
  'merge',
  'pick',
  'final',
  'fit',
  'scores',
  'pin',
  'flags',
  'tidy',
  'config',
];

const PIN = `  --pin <index>:<votes>
                          Pin one song's vote count (repeatable; comma-separate:
                          --pin 9:2,12:1). Index = raw submission order (# column
                          in music.md and CLI tables). votes > 0 = upvotes;
                          votes < 0 = downvotes when the round has downs enabled.
                          Other songs reflow so each bank stays exact. On pick,
                          pins reconcile at the margin against the chosen option.`;

const SHAPE = `  --shape <preset>
                          Allocation curve preset: auto (default — enumerates
                          budget-exact staircases), bell, balanced (alias for
                          bell), top-heavy, compressed, relative.`;

const DOWN_SHAPE = `  --down-shape <shape>
                          Downvote distribution when downs are enabled:
                          concentrated | flat | curved (aliases: worst, even,
                          curve, bell). Pick also accepts short positional
                          codes after the letter: cv (curved), fl (flat), cc
                          (concentrated) — e.g. just pick tarot A cv.`;

const TIER_KNOBS = `  --tier-count <n>         Force exactly n distinct upvote point tiers.
  --bucket-count <n>       Force n funded score-cluster tiers (lower-level knob).`;

const FAVORITE_BAND = `  --favorite-band <min>    Merge raw music scores ≥ min into one shared
                          top tier (default 80 on music-only rounds).
  --no-favorite-band       Disable favorite-band merge.`;

const RANK = `  --rank combined|fit|music
                          Axis used to rank and tier songs for allocation:
                          combined — blended fit+music (default on merge and
                          thematic pick; auto on parse when comments carry manual
                          fit scores); fit — fit score only; music — music score
                          only (default on music-only pick/parse).`;

const WEIGHTS = `  --weights <fit>:<music>  Blend ratio for combined ranking, e.g. 3:2 or
                          0.6:0.4 (normalized to sum 1). Stored in profile when
                          set. Defaults when omitted:
                          • merge / thematic pick — 7:3 (fit:music)
                          • parse with manual fit in comments — 5:5 (50:50)`;

const GATE = `  --gate passFail|passFailMaybe
                          Thematic gate model (pass/fail or pass/maybe/fail).
  --cutoff <axis>:<min>    Numeric cutoff gate instead, e.g. fit:70 or music:65.`;

export const HELP = {
  overview: `Music League pipeline — parse → (merge) → pick → render

Stages (each reads/writes JSON; only parse touches HTML):
  1. parse   HTML/text → music.md + music.json
  2. merge   music.json + fit.json → scores.json   (thematic only)
  3. pick    record distribution choice (A/B/C) → pick in JSON + picks.jsonl
  4. final   render music.html or scores.html

Music-only:
  just parse <name>
  just pick <name> B --reason "…"
  just final <name>

Thematic:
  just parse <name>
  # agent writes fit.json
  just merge <name>
  just pick <name> C --reason "…"
  just final <name>

Re-parse only when you replace the HTML export. Pick is always a separate step.

Commands:
  ml parse | merge | pick | fit | scores | final | run | status | tidy | config | help

<name> is optional after the first explicit use — stored in data/.current-round.
Omit it to continue the same round (e.g. just parse --fit-words, just run, just merge).
Name a round explicitly to switch (e.g. just parse tarot --fit-words).

Fuzzy match: "tarot" or "2026-06-09".
Run "just help <cmd>" for flags (parse, merge, pick, final, fit, scores, pin, flags, tidy, config).`,

  pin: `just help pin — manual vote overrides (--pin)

Format:  --pin <index>:<votes>     (repeatable; comma-separate: --pin 9:2,12:1)

  index   Raw submission order — the # column in music.md "Raw order (for entering
          votes)" and the ballot printed after parse/pick. Same numbering Music
          League uses when you enter votes by position (0, 1, 2, …).

  votes   Integer count on that song:
          • positive → upvotes   (9:2  = give song #9 exactly 2 upvotes)
          • negative → downvotes when the round has downvotes enabled (6:-2 = 2 down on #6)

Blank-score songs (needsUserInput) may be pinned on pick — manual ballot slot.
Own, disqualified, and unknown indices are rejected at pick.

Other songs are re-allocated around the pin so the vote bank is still spent exactly.
On pick, a pin is a tweak on top of the chosen option (logged as a manual tweak;
CLI prints B (original) | B (altered) when pins change the distribution).

Works on:  parse (explore)  merge (thematic explore)  pick (commit with tweak)

Examples:
  just parse kpop-favorite --pin 3:3          # explore: pin #3 to 3 upvotes
  just pick story-5 A --pin 9:2 --reason "pin Two Evils to 2; reflow drops bottom 1"`,

  parse: `just parse [<name>] [flags]

Parse a saved round HTML or text file → music.md + music.json.
Does NOT write pick or scores. Does NOT read fit.json.
Omit <name> to reuse the current round (data/.current-round).

Flags:
  --mode objective|subjective
                          How blank comments are treated: objective → needsUserInput
                          (never invented); subjective → needsReview.
  ${SHAPE}
  ${DOWN_SHAPE}
  ${TIER_KNOBS}
  ${PIN}
  ${FAVORITE_BAND}
  ${RANK}
                          On parse, manual fit in comments auto-enables combined
                          rank (and 5:5 weights unless --weights is set). Explicit
                          --rank combined still applies; use --rank music to tier
                          on music only while keeping parsed fit scores.
  ${WEIGHTS}
  ${GATE}
  --no-json                Skip writing music.json (markdown only).
  --lenient                Tolerate Live Text / pasted round text input.
  --fit-words              Parse tier/gate words and a second number on the scoring
                          line as fit (see spec/scoring-comments.md).

Deprecated (warns — use merge + pick instead):
  --fit, --option, --reason

Example:
  just parse kpop-favorite --shape auto
  just parse --fit-words              # current round
  just help pin                       # full --pin reference`,

  merge: `just merge [<name>] [flags]

Merge music.json + fit.json → scores.json. Never reads HTML.
Prints the up/down option tables (A/B/C) for thematic rounds.
Omit <name> to reuse the current round.

Flags:
  ${RANK}
  ${WEIGHTS}
  ${GATE}
  ${SHAPE}
  ${DOWN_SHAPE}
  ${TIER_KNOBS}
  ${PIN}
  ${FAVORITE_BAND}

Example:
  just merge tarot --rank combined --weights 3:2
  just help pin                       # full --pin reference`,

  pick: `just pick [<name>] <A|B|C> [cv|fl|cc] [flags]

Record a distribution choice. JSON-only — never re-reads HTML.
Writes pick to music.json (music-only) or scores.json (when fit.json exists),
refreshes the markdown report, and appends picks.jsonl.
Omit <name> to reuse the current round.

Positional:
  <A|B|C>                  Option letter from the tier-structure tradeoff table.
  cv | fl | cc             Optional down-shape short code (curved | flat |
                          concentrated) when the round has downvotes — e.g.
                          just pick tarot A cv.

Flags:
  --reason "…"             Rationale stored in the pick record.
  ${PIN}
  ${RANK}
  ${WEIGHTS}
  ${GATE}
  ${SHAPE}
  ${DOWN_SHAPE}
  ${TIER_KNOBS}
  ${FAVORITE_BAND}
  --scores                 Write pick to scores.json (default when fit.json exists).
  --dry-run                Resolve and print the pick without writing files.

Example:
  just pick tarot C --reason "thematic standouts on 75 anchor"
  just pick B --pin 11:3,12:3 --reason "lift top pair; shed bottom 1s"
  just pick story-5 A --pin 9:2 --reason "pin Two Evils to 2"
  just help pin                       # full --pin reference`,

  final: `just final [<name>] [flags]

Render the draft-vote HTML deliverable:
  - scores.json → scores.html when merge has run (thematic)
  - music.json → music.html for music-only rounds
Auto-runs merge first if fit.json exists but scores.json does not.
Omit <name> to reuse the current round.

Flags:
  --out <path>             Output HTML path (default: analysis/<round>/music.html
                          or scores.html).
  --order <axis>           Card sort order in the renderer:
                          combined | fit | raw | votes | score
                          (default: votes for music.json, combined for scores.json).

Example:
  just final tarot
  just final tarot --order combined`,

  fit: `just fit [<name>] [flags]

Render fit.json → data/analysis/<round>/fit.html (fit-research report only).
Does not run merge or pick. Omit <name> for the current round.

Flags:
  --out <path>             Output HTML path (default: analysis/<round>/fit.html).
  --order fit|combined|music|raw
                          Card sort order (default: fit).

Example:
  just fit tarot --order combined`,

  scores: `just scores [<name>] [flags]

Render scores.json → data/analysis/<round>/scores.html (the thematic deliverable).
Same renderer as final on a merged round. Omit <name> for the current round.

Flags:
  --out <path>             Output HTML path (default: analysis/<round>/scores.html).
  --order combined|fit|raw|votes|score
                          Card sort order (default: combined).

Example:
  just scores tarot`,

  tidy: `just tidy [flags]

Date-slug undated round inputs and archive stale rounds (>2 days by default).
Also runs automatically at the start of just run.

Flags:
  --dry-run, -n            Preview changes without writing.
  --no-name                Skip date-slugging undated round files.
  --no-archive             Skip moving stale rounds to archive/.
  --age <days>             Archive threshold in days (default: 2).

Example:
  just tidy --dry-run`,

  config: `just config [comment-width [auto|<n>|unset]]

View or set local CLI preferences (.ml-config.json, gitignored).

  comment-width            Show current setting (auto or a number).
  comment-width auto       Fill remaining terminal width (default).
  comment-width <n>        Cap Comment column at n display columns (min 28).
  comment-width unset      Same as auto.

Pick/ballot tables left-align the Comment column and expand it on wide terminals.

Example:
  just config comment-width 80`,

  flags: `just help flags — all CLI flags by command

Shared allocation / profile flags (see spec/point-allocation.md):
  Flag                    parse   merge   pick    Effect (summary)
  ─────────────────────── ─────── ─────── ─────── ─────────────────────────────
  --rank combined|fit|music   ✓       ✓       ✓     Ranking axis (see help parse/merge)
  --weights fit:music         ✓       ✓       ✓     Blend ratio; default 7:3 merge/pick,
                                                    5:5 parse w/ manual fit
  --gate passFail|…           ✓       ✓       ✓     Thematic pass/maybe/fail model
  --cutoff axis:min           ✓       ✓       ✓     Numeric fit/music cutoff gate
  --shape preset              ✓       ✓       ✓     Upvote curve (auto, bell, …)
  --down-shape shape          ✓       ✓       ✓     Downvote curve (flat/curved/…)
  --tier-count n              ✓       ✓       ✓     Force n point tiers
  --bucket-count n            ✓       ✓       ✓     Force n funded clusters
  --pin i:v                   ✓       ✓       ✓     Pin song votes (explore or pick)
  --favorite-band min         ✓       ✓       ✓     Shared top tier at score floor
  --no-favorite-band          ✓       ✓       ✓     Disable favorite-band merge

Parse-only:
  --mode objective|subjective       Scoring mode for blank comments
  --no-json                         Skip music.json
  --lenient                         Tolerant pasted-text parse
  --fit-words                       Tier/gate words + 2nd number as fit in comments
  --fit, --option, --reason         Deprecated — use merge + pick

Pick-only:
  --reason "…"                      Stored pick rationale
  --scores                          Force scores.json write (thematic)
  --dry-run                         Print pick without writing
  A|B|C [cv|fl|cc]                  Option letter + optional down-shape shorthand

Render (fit / scores / final):
  --out path                        Output HTML path
  --order axis                      Card sort (values vary by command — see help)

Other commands:
  just tidy     --dry-run | --no-name | --no-archive | --age <days>
  just config   comment-width [auto|<n>|unset]

Run "just help <cmd>" for full flag text and examples on one command.`,
};

export function cmdHelpText(topic) {
  const key = topic?.toLowerCase();
  if (!key) return HELP.overview;
  return HELP[key] ?? null;
}
