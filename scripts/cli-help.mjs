// CLI help text — single source for `just help` / `ml help` and README parity.

export const HELP_TOPICS = [
  'save-round',
  'parse',
  'merge',
  'pick',
  'rescore',
  'final',
  'fit',
  'scores',
  'pin',
  'flags',
  'tidy',
  'config',
  'leagues',
];

const PIN = `  --pin <index|title>:<votes>
                          Pin one song's vote count (repeatable; comma-separate:
                          --pin 9:2,12:1 — or space-separated: --pin 9:2 12:1).
                          Index = raw submission order (# column in music.md and
                          CLI tables); a title fragment may stand in for the
                          index (--pin fox:2) resolving exact → substring →
                          subsequence, ambiguous fragments error with the
                          candidates. votes > 0 = upvotes; votes < 0 = downvotes
                          when the round has downs enabled. Other songs reflow
                          so each bank stays exact. On pick, pins reconcile at
                          the margin against the chosen option. On rescore, pins
                          are additive: stored pins persist and new --pin values
                          merge on top (same song = new value wins); --reset
                          clears them. Every table run prints an active register
                          line — "Pins: … · Flags: …" — covering stored pins and
                          non-default knobs (weights/tiers/cutoff/shape/band).
                          Short form: -p.`;

const SCORE_OVERRIDE = `  --score <index|title>:<value>
                          Write a music score onto music.json (no HTML re-parse).
                          Index = raw submission order (a title fragment may
                          stand in, e.g. --score bohemian:74). Value uses the same
                          grammar as scoring comments: literal digits scale
                          (7 → 70, 10 → 100, 705 → 70.5), \`=\` reads as \`+\` (73= → 73+),
                          and modifiers attach: 74.5+, 76-, 75?, 74.5+?,
                          76play / 76 play / 76play?, or plain DQ to disqualify
                          the song (kept score stays on the record; allocation
                          ignores DQ songs — valid on both --score and
                          --fit-score). Clears needsUserInput — song enters
                          allocation normally; adding a score also clears a DQ
                          that held only because the song had no score.
                          Repeatable; comma-separate (or space-separate pairs:
                          --score 5:74 7:DQ). Short form: -sc.
  --fit-score <index|title>:<value>
                          Same for fitScore on fit.json (thematic) or the song
                          record on music-only rounds (numeric values use the
                          same grammar; DQ disqualifies the song like
                          --score <i>:DQ). Short form: -fs.`;

const SHAPE = `  --shape <preset>
                          Allocation curve preset: auto (default — enumerates
                          budget-exact staircases), bell, balanced (alias for
                          bell), top-heavy, compressed, relative. Short: -sh.`;

const DOWN_SHAPE = `  --down-shape <shape>
                          Downvote distribution when downs are enabled:
                          concentrated | flat | curved (aliases: worst, even,
                          curve, bell). Pick also accepts short positional
                          codes after the letter: cv (curved), fl (flat), cc
                          (concentrated) — e.g. just pick <round> A cv.
                          Short form: -ds.`;

const TIER_KNOBS = `  --tier-count <n>          Force exactly n distinct upvote point tiers (--tc).
  --bucket-count <n>        Force n funded score-cluster tiers (--bc).`;

const FAVORITE_BAND = `  --favorite-band <min>    Merge raw music scores ≥ min into one shared
                          top tier (floor scales like comments: -fb 7 = 80-style
                          min 70 column). Short: -fb.
  --no-favorite-band       Disable favorite-band merge.`;

const RANK = `  --rank combined|fit|music
                          Axis used to rank and tier songs for allocation:
                          combined — blended fit+music (default on merge and
                          thematic pick; auto on parse when comments carry manual
                          fit scores); fit — fit score only; music — music score
                          only (default on music-only pick/parse). Short: -rk.`;

const WEIGHTS = `  --weights <fit>:<music>  Blend ratio for combined ranking, e.g. 3:2 or
                          0.6:0.4 (normalized to sum 1). Short form: -w.
                          Stored in profile when set. Defaults when omitted:
                          • merge / thematic rounds — 7:3 (fit:music)
                          • parse with manual fit in comments — 5:5 (50:50)`;

const GATE = `  --gate passFail|passFailMaybe
                          Thematic gate model (pass/fail or pass/maybe/fail).
  --cutoff [<f|m|c>|<axis>]:<min>
                          Numeric cutoff gate instead, e.g. fit:70, music:65,
                          combined:76 — axis shorthand m | f | c (m:65 = music:65),
                          and a bare value assumes music (-c 70 = music:70, -c 735
                          = music ≥ 73.5 — values scale like scoring comments).
                          A combined cutoff gates allocation only — it does NOT
                          rescale the combined scores (reflows votes to songs
                          above the line). Short form: -c.`;

export const HELP = {
  overview: `Music League pipeline — parse → (merge) → pick → render

Stages (each reads/writes JSON; only save-round and parse touch HTML):
  0. save-round  clipboard → data/rounds/<dated id>.html. Reads the league name
                 from the export <title> and runs the family check — merging,
                 staking a family root, or separating all prompt with registered
                 names shown. Full ladder: just help save-round.
  1. parse   HTML/text → music.md + music.json
  2. merge   music.json + fit.json → scores.json   (thematic only)
  3. pick    record distribution choice (A/B/C) → pick in JSON + picks.jsonl
  4. final   render music.html or scores.html

Music-only:
  just save-round <name>
  just parse <name>
  just pick <name> B --reason "…"
  just final <name>

Thematic:
  just save-round <name>
  just parse <name>
  # agent writes fit.json
  just merge <name>
  just pick <name> C --reason "…"
  just final <name>

Re-parse only when you replace the HTML export. Pick is always a separate step.

Commands:
  just parse | merge | pick | rescore | fit | scores | final | run | status | tidy | leagues | config | help
Command shortcuts: just s <slug> = save-round, just p = pick, just r = rescore.
Short flags: -w weights · -c cutoff · -p pin · -rk rank · -sh shape · -ds down-shape ·
  -tc tier-count · -bc bucket-count · -fb favorite-band · -sc score · -fs fit-score.
(No just installed? 'npm run ml -- parse' runs the same dispatcher.)

Re-weight/re-shape a parsed round from JSON (no HTML re-read): just rescore <name> -w 5:5.
Set a missing or wrong raw score: just rescore <name> -sc <i>:<v> (see just help rescore).

<name> is optional after the first explicit use — stored in data/.current-round.
Omit it to continue the same round (e.g. just parse --fit, just run, just merge).
Name a round explicitly to switch (e.g. just parse <round> --fit).

Fuzzy match: a slug token or a full date ("2026-06-09").
Run "just help <cmd>" for detail (save-round, parse, merge, pick, final, fit, scores, pin, flags, tidy, config, leagues).`,

  pin: `just help pin — manual vote overrides (--pin)

Format:  --pin <index|title>:<votes>     (repeatable; comma-separate or
                                          space-separate pairs: --pin 9:2,12:1
                                          ≡ --pin 9:2 12:1; short form: -p)

  index   Raw submission order — the # column in music.md "Raw order (for entering
          votes)" and the ballot printed after parse/pick. Same numbering Music
          League uses when you enter votes by position (0, 1, 2, …). A title
          fragment may replace the index (--pin fox:2) — exact → substring →
          subsequence match, case-insensitive; an ambiguous fragment errors with
          the candidate list, and an all-numeric head is always an index even
          when a song's title is that number.

  votes   Integer count on that song:
          • positive → upvotes   (9:2  = give song #9 exactly 2 upvotes)
          • negative → downvotes when the round has downvotes enabled (6:-2 = 2 down on #6)

Blank-score songs (needsUserInput) may be pinned on pick — a ballot-only workaround
that assigns votes without a music score. To fill the score and run allocation
normally, use just rescore --score <i>:<v> instead (see just help rescore).
Own, disqualified, and unknown indices are rejected at pick.

Other songs are re-allocated around the pin so the vote bank is still spent exactly.
On explore (parse / merge / rescore), pins reflow every A–E option column; on pick,
a pin is a tweak on top of the chosen option (logged as a manual tweak; CLI prints
B (original) | B (altered) when pins change the distribution). Stored pins in JSON
apply on pick when --pin is omitted.

Works on:  parse  merge  rescore  pick

Examples:
  just rescore --pin 8:1,5:1               # every option column honors both pins
  just merge <round> --pin 3:3               # thematic explore with pinned menu
  just pick <round> A --pin 9:2 --reason "pin two songs to 2; reflow drops bottom 1"`,

  'save-round': `just save-round <slug>

Save the clipboard as a round export and decide what slug family it joins, with
the league name read from the export <title>. Every family decision shows the
registered names of the families being considered.

Vocabulary:
  round slug   the bare round name saved under (e.g. kpop-test-run) — always
               date-stamped; this is the round's identity on disk
  family       a descriptor in data/ref/leagues.json that claims rounds via
               slugPrefixes (dash-prefixed token families or exact-slug 1-round
               families); visible under just leagues, recalled from parse
  family root  the prefix you stake so later rounds of a series auto-join it

The family ladder, in order:
0. Slug ends with a trailing dash (e.g. 5th-gen-) — that's a family root, not a
   finished round slug. save-round refuses to write and shows that family's
   recent concrete slugs instead; answer with just the missing tail (4, free-5)
   or n to cancel and rerun with the full slug.
1. Slug owned by a family and the round's league name is registered for it
   → saves silently. A nameless family fills its first name from parse.
2. Slug owned but the league name is new → asked once:
     m               same league, new official name — the alias joins the owning
                     family (this is the once-per-iteration confirm, e.g. a new
                     last.fm numbering)
     1..N            merge into numbered OTHER family instead — suggested
                     correction first when the round's league name is already
                     registered elsewhere (the name is the proof), then fami-
                     lies sharing the slug's first token
     root <x-test->  different league — stake the family root yourself: the
                     round keeps its FULL slug but joins the typed root
                     (root kpop-test- makes kpop-test-run the first round of a
                     kpop-test-<topic> series). Answering y instead keeps the
                     FULL slug as a 1-round (solo) family.
     <round-slug>    save under a NEW bare round slug — it is a round name,
                     never a family id, and family rules re-check it
     n               cancel — nothing is written; the clipboard is intact
3. Slug matches nothing but the league name is registered → folds into that
   family automatically (the name is the same-league proof).
4. Slug matches nothing and shares a first token with some family → merge or
   separate prompt: m / 1..N / root <…> / y / <round-slug> / n, names shown.
5. Nothing matches anywhere (slug, first token, league name) → fully new
   league: saves without a prompt as its own 1-round family.

Non-interactive runs never merge — a mismatch saves covered (no name) or as its
own 1-round family, with the later link-up hint printed.

Later corrections:
  just rename <new-slug>               # re-align a saved round (cascades)
  just leagues <id> --set-family …     # re-shape / re-root a drifted family
  just leagues <id> --set-prefixes …   # replace the matching prefixes

Example:
  just save-round kpop-test-run
  # owned by kpop-<theme>, page title "Kpop Test Series" not registered:
  #   root kpop-test-  → family kpop-test-<topic>; kpop-test-two joins it later
  #   y alone          → 1-round family kpop-test-run (solo-league assumption)`,

  parse: `just parse [<name>] [flags]

Parse a saved round HTML or text file → music.md + music.json.
Does NOT write pick. When fit.json exists and you pass --weights / --rank / --gate /
--cutoff, also merges into scores.json and prints the blended option tables.
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
  --fit [tier|gate]        Scan comment keywords for fit (see spec/scoring-comments.md).
                          --fit (or --fit tier) reads tier words (excellent…weak);
                          --fit gate reads gate words (pass/maybe/fail), which
                          auto-activate the gate — passFailMaybe if any maybe, else
                          passFail — unless you pass --gate <type>. (--fit-words is
                          the old spelling of --fit tier.) A 2nd number as fit
                          (e.g. "75. 80") is auto-detected round-wide — no flag.

Deprecated (warns — use merge + pick instead):
  --option, --reason

Example:
  just parse <round> --shape auto
  just parse --fit                    # current round, tier words
  just parse --fit gate               # gate words
  just help pin                       # full --pin reference

After a parse, the matched league prints its reminders + scripts (recalling
descriptors and their family). A round whose official league isn't in the registry
gets auto-registered as a plain league — reminders stay optional and are edited in
data/ref/leagues.json.`,

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
  just merge <round> --rank combined --weights 3:2
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
                          just pick <round> A cv.

pick ranks off the stored combinedScore — it does not re-blend. To change the
fit:music weights (or re-shape from JSON without re-parsing), use just rescore.

Flags:
  --reason "…"             Rationale stored in the pick record.
  ${PIN}
  ${RANK}
  ${GATE}
  ${SHAPE}
  ${DOWN_SHAPE}
  ${TIER_KNOBS}
  ${FAVORITE_BAND}
  --scores                 Write pick to scores.json (default when fit.json exists).
  --dry-run                Resolve and print the pick without writing files.

Example:
  just pick <round> C --reason "thematic standouts on 75 anchor"
  just pick B --pin 11:3,12:3 --reason "lift top pair; shed bottom 1s"
  just pick <round> A --pin 9:2 --reason "pin one song to 2"
  just help pin                       # full --pin reference`,

  rescore: `just rescore [<name>] [flags]

Re-blend + re-allocate from JSON — never reads HTML, never re-scans comments.
Recomputes each song's combinedScore from the stored music score + fitScore under
new weights/knobs, re-runs the draft menu (A/B/C options), and rewrites
music.md + music.json. Resets any committed pick back to draft (re-run just pick
to commit again). Does NOT touch picks.jsonl. Omit <name> for the current round.

Flags:
  ${WEIGHTS}
  ${RANK}
  ${GATE}
  ${SHAPE}
  ${DOWN_SHAPE}
  ${TIER_KNOBS}
  ${PIN}
  ${SCORE_OVERRIDE}
  ${FAVORITE_BAND}
  --reset                  Clear stored knobs (weights/shapes/gate/tier counts,
                          favorite band) and stored pins; manual --score edits
                          stay — a full reset is just parse <round>.
  --dry-run                Report the re-weight target without writing files.

Example:
  just rescore tarot --weights 5:5    # re-blend 50/50, reset pick to draft
  just rescore --pin 8:1,5:1          # reflow every option column around pins
  just rescore --score 17:78+         # fill a blank box; re-tier + re-allocate
  just rescore --score 5:74.5+,7:75   # break a tiebreak-limited flat field
  just rescore --shape bell           # re-shape the current round's menu
  just rescore --reset                # back to the stored scores' own menu`,

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

  leagues: `just leagues [<name>]

Show the recurring-league registry (facts in data/ref/leagues.json; narrative in
spec/leagues.md). Each descriptor ties a league to its slug family, mode, standing
eligibility/DQ reminders, reusable scripts, rules, skills, and fit-guidance profiles.

  just leagues               List every league. Active-first: leagues with a dated
                             round in the last 2 weeks show their latest concrete
                             slug plus 2 more recent ones for pattern recall; dormant
                             ones collapse to a footer line. Rounds from history that
                             were never parsed get plain descriptors on the spot
                             (auto-registration — plain leagues carry no reminders).
   just leagues <name>       Detail one league — matches by id, league name, or slug
                             family/prefix.

Slug-family edit flags (name + flags together) — auto-registration never revises
a matched entry, so fix a drifted family by hand. Round matching is specific-first:
the longest matching slugPrefixes entry claims the round (registry order breaks ties),
so overlapping families coexist as long as the narrow one has the longer prefix:

  --set-family '<shape>'    Set the slugFamily display shape (quote values with <…>).
  --set-prefixes 'p1,p2'    Replace slugPrefixes — the bare prefixes that actually
                            match rounds (startsWith). Dash-explicit: trailing '-'
                            is a token family (<family>- claims every round under
                            it); no dash is an exact-slug family — a one-off league
                            owns its saved slug itself. Match rule: the longest
                            matching prefix claims a round; equal-length ties go to
                            the newest (last-listed) family.
  --summary '<text>'        Replace the one-line summary.

Flags print a before → after diff, refresh the detail card, and warn when the
family's concrete prefix is not covered by slugPrefixes. Writes data/ref/leagues.json
(commit the data submodule); tests write a fixture instead (ML_LEAGUES_JSON).

At save time the same decisions are available inline: the save-round ladder (m /
1..N merge / root <x-test-> stake / y separate) asks league-name-aware questions
with registered names shown — full ladder: just help save-round.

The matched league's reminders + scripts also print automatically after "just parse",
and "just status <round>" shows which league a round belongs to.

Example:
  just leagues                # active-first registry digest (slug recall before saves)
  just leagues <league-id>    # one league's reminders, scripts, fit profiles
  just leagues <league-id> --set-family 'kpop-constraints-<theme>'
      --set-prefixes 'kpop-constraints-' --summary '…'   # narrow a drifted family
  just leagues <one-off-id> --set-family 'halloween-kpop'
      --set-prefixes 'halloween-kpop'                    # one-off: 1-round family`,

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
  --weights fit:music         ✓       ✓             Blend ratio; default 7:3 merge,
                                                    5:5 parse w/ manual fit. NOT on
                                                    pick (inert) — use just rescore
  --gate passFail|…           ✓       ✓       ✓     Thematic pass/maybe/fail model
  --cutoff [f|m|c|axis]:min   ✓       ✓       ✓     Cutoff gate; bare value → music;
                                                    values scale like comments
  --shape preset              ✓       ✓       ✓     Upvote curve (auto, bell, …)
  --down-shape shape          ✓       ✓       ✓     Downvote curve (flat/curved/…)
  --tier-count n              ✓       ✓       ✓     Force n point tiers
  --bucket-count n            ✓       ✓       ✓     Force n funded clusters
  --pin i:v                   ✓       ✓       ✓     Pin song votes (menu reflow on explore; pick tweak)
  --favorite-band min         ✓       ✓       ✓     Shared top tier at score floor
  --no-favorite-band          ✓       ✓       ✓     Disable favorite-band merge

Parse-only:
  --mode objective|subjective       Scoring mode for blank comments
  --no-json                         Skip music.json
  --lenient                         Tolerant pasted-text parse
  --fit [tier|gate]                 Scan tier (default) or gate keywords; 2nd-number
                                    fit is auto-detected round-wide (no flag)
  --option, --reason                Deprecated — use merge + pick

Pick-only:
  --reason "…"                      Stored pick rationale
  --scores                          Force scores.json write (thematic)
  --dry-run                         Print pick without writing
  A|B|C [cv|fl|cc]                  Option letter + optional down-shape shorthand

Render (fit / scores / final):
  --out path                        Output HTML path
  --order axis                      Card sort (values vary by command — see help)

Rescore-only (re-blend/re-allocate from JSON; resets pick to draft):
  just rescore <name> --weights fit:music | --shape | --rank | --gate | --down-shape
                                    | --tier-count | --bucket-count | --pin
                                    | --score i:v | --fit-score i:v | --favorite-band | --dry-run
                                    (--score / --fit-score write raw scores; not vote pins)

Single-dash aliases (same meaning, expand to the long form):
  -w weights   -c cutoff    -p pin       -rk rank     -sh shape    -ds down-shape
  -tc tier-count  -bc bucket-count  -fb favorite-band  -sc score  -fs fit-score
  Booleans keep long forms (--dry-run, --no-json, …).

Command shortcuts: just s <slug> = save-round, just p = pick, just r = rescore.
(No just installed? 'npm run ml -- <cmd>' runs the same dispatcher.)

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
