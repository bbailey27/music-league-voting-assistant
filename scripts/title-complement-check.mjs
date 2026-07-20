#!/usr/bin/env node
// Structural complement check for title-chain rounds.
//
// Usage:
//   node scripts/title-complement-check.mjs "Title One" "Title Two" ...
//   node scripts/title-complement-check.mjs --slot copular "Title" ...
//   node scripts/title-complement-check.mjs --help
//
// Guidance: .cursor/skills/title-chain/SKILL.md → "Structural complement check"
//
// Slots:
//   copular — title follows a copula (e.g. "…all i wanted was [TITLE]"): NP, infinitive, PP fragment
//   closer  — title CLOSES the story after a vocative (e.g. "…oh devil, [TITLE]."): must be a
//             complete, terminal sentence (clause / imperative / exclamative), not a dangling
//             fragment. This is the inverse of copular — here a full clause is the goal and an
//             open NP fragment is the failure mode.
//
// Copular tags: ok-np, ok-inf, ok-adj, ok-fragment, bad-clause, bad-unknown.
// Closer tags:  ok-clause, ok-imperative, ok-excl, ok-question, bad-fragment, bad-unknown.
// you-in-title is informational (for `closer` it is on-theme: "you" = the devil being addressed).

import { matchFlag } from "./cli-args.mjs";

const AUX = new Set([
  "is", "are", "was", "were", "am", "be", "been", "being",
  "have", "has", "had", "do", "does", "did",
  "will", "would", "shall", "should", "can", "could", "may", "might", "must",
  "i'm", "you're", "we're", "they're", "he's", "she's", "it's",
  "i've", "you've", "we've", "they've",
  "i'll", "you'll", "we'll", "they'll",
  "don't", "doesn't", "didn't", "won't", "wouldn't", "can't", "couldn't",
  "ain't", "isn't", "aren't", "wasn't", "weren't",
]);

const CONTENT_VERB = new Set([
  "want", "need", "ask", "know", "say", "said", "tell", "told",
  "get", "got", "make", "made", "remind", "matter",
]);

const NP_OPENERS = new Set([
  "a", "an", "the", "this", "that", "these", "those",
  "my", "your", "his", "her", "our", "their", "its",
  "one", "two", "three", "just", "only", "all", "both", "each", "every", "any", "some",
  "no", "another", "more", "less", "much", "many", "few",
  "nothing", "something", "everything", "anything",
  "what", "which", "whose",
]);

// Subjects that, in title-initial position, make the title read as a full clause
// ("You Won", "I Give Up", "Nobody Wins").
const SUBJECT_PRON = new Set([
  "i", "you", "we", "they", "he", "she", "it",
  "nobody", "somebody", "everybody", "someone", "everyone", "nothing", "everything",
]);

// Subject+verb contractions that head a full clause ("You're the Winner", "It's Over").
const CONTRACTED_SUBJECT = new Set([
  "i'm", "you're", "we're", "they're", "he's", "she's", "it's", "that's", "there's",
  "i've", "you've", "we've", "they've", "i'll", "you'll", "we'll", "they'll",
  "i'd", "you'd", "we'd", "they'd",
]);

const WH_WORDS = new Set(["what", "where", "when", "why", "who", "whom", "whose", "how", "which"]);

// Fronted adverbs that precede a subject in a full clause ("Here I Stand", "Now We Are Free").
const ADVERB_FRONT = new Set(["here", "there", "now", "then", "today", "tonight", "still", "so"]);

// Finite aux/modal openers that head yes/no questions ("Did You Win", "Is This the End").
const QUESTION_AUX = new Set([
  "do", "does", "did", "is", "are", "was", "were", "am",
  "will", "would", "shall", "should", "can", "could", "may", "might", "must",
  "have", "has", "had",
]);

// Base verbs that, title-initial, read as an imperative addressed to the devil ("Take Me Now").
const IMPERATIVE_VERBS = new Set([
  "take", "give", "save", "hold", "leave", "run", "come", "go", "stay", "tell", "kill",
  "burn", "let", "keep", "help", "forgive", "forget", "trust", "believe", "listen", "look",
  "wait", "remember", "breathe", "live", "fight", "hang", "win", "lose", "end", "begin",
  "meet", "kiss", "break", "free", "release", "finish", "wake", "call", "spare", "kneel",
]);

// Finite (inflected) verbs used to detect a clause inside an NP-initial title
// ("The Truth Hurts", "The Winner Takes It All"). AUX is unioned in at check time.
const FINITE_VERBS = new Set([
  "won", "wins", "lost", "loses", "hurts", "hurt", "makes", "made", "takes", "took",
  "gives", "gave", "knew", "knows", "know", "got", "gets", "went", "goes", "came", "comes",
  "ended", "ends", "began", "begins", "survives", "survived", "survive", "tricked", "tricks",
  "lied", "lies", "said", "tells", "told", "ruins", "ruined", "beats", "beat", "kept",
  "wins", "matters", "mattered", "remains", "remain", "stays", "stayed", "falls", "fell",
  "dies", "died", "cries", "cried", "laughs", "burns", "burned", "calls", "called",
]);

export const COMPLEMENT_SLOTS = ["copular", "closer"];

function tokens(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function hasYou(title) {
  return /\byou\b|\byour\b|\byours\b/i.test(title);
}

/** Copula complement: …was / …is + [title] — NP, to-infinitive, or PP fragment. */
function classifyCopularComplement(title) {
  const t = tokens(title);
  if (!t.length) return { fit: "bad-unknown", reason: "empty" };

  if (t[0] === "to" && t.length >= 2) {
    const w = t[1];
    if (["the", "a", "an", "my", "each", "every"].includes(w)) {
      return { fit: "bad-unknown", reason: "to + noun (preposition), not infinitive" };
    }
    return { fit: "ok-inf", reason: `to ${w}` };
  }

  if (t.length >= 2 && AUX.has(t[1])) {
    return { fit: "bad-clause", reason: `finite “${t[1]}” at word 2` };
  }

  if (
    t.length >= 3
    && ["all", "that", "this"].includes(t[0])
    && ["i", "we", "you"].includes(t[1])
    && CONTENT_VERB.has(t[2])
  ) {
    return { fit: "bad-clause", reason: `${t[1]} ${t[2]} (embedded clause)` };
  }

  for (let i = 0; i < Math.min(3, t.length); i++) {
    if (AUX.has(t[i])) {
      return { fit: "bad-clause", reason: `finite “${t[i]}” at word ${i + 1}` };
    }
  }

  if (NP_OPENERS.has(t[0])) {
    return { fit: "ok-np", reason: `opens with “${t[0]}”` };
  }

  if (t.length <= 3 && !AUX.has(t[0]) && !CONTENT_VERB.has(t[0])) {
    return { fit: "ok-adj", reason: "short fragment (adj/adv/noun)" };
  }

  if (["for", "with", "without", "before", "after", "until", "since"].includes(t[0])) {
    return { fit: "ok-fragment", reason: `opens with “${t[0]}” (incomplete PP)` };
  }

  return { fit: "bad-unknown", reason: `opens with “${t[0]}”` };
}

/**
 * Closer slot: title must END the sentence and the story after a vocative
 * ("…oh devil, [TITLE]."). A complete clause / imperative / exclamative closes it;
 * a bare NP or PP fragment leaves the prompt open and fails.
 */
function classifyCloserComplement(title) {
  const t = tokens(title);
  if (!t.length) return { fit: "bad-unknown", reason: "empty" };

  const hasFinite = (from = 0) =>
    t.slice(from).some((w) => AUX.has(w) || FINITE_VERBS.has(w));

  // Exclamative: "What a Shame", "Such a Mistake", "What a Disaster".
  if ((t[0] === "what" || t[0] === "such") && (t[1] === "a" || t[1] === "an")) {
    return { fit: "ok-excl", reason: `exclamative "${t[0]} ${t[1]} …"` };
  }

  // Question: literal "?", wh-question, or aux-inverted yes/no question.
  if (/\?/.test(title)) return { fit: "ok-question", reason: "ends with ?" };
  if (WH_WORDS.has(t[0])) {
    return { fit: "ok-question", reason: `wh-question "${t[0]} …"` };
  }
  if (QUESTION_AUX.has(t[0]) && t.length >= 2 && SUBJECT_PRON.has(t[1])) {
    return { fit: "ok-question", reason: `aux-inverted "${t[0]} ${t[1]} …"` };
  }

  // Fronted adverb + subject + verb: "Here I Stand", "Now We Are Free", "So It's the End".
  if (ADVERB_FRONT.has(t[0]) && t.length >= 3
    && (SUBJECT_PRON.has(t[1]) || CONTRACTED_SUBJECT.has(t[1]) || NP_OPENERS.has(t[1]))) {
    return { fit: "ok-clause", reason: `fronted "${t[0]}" + subject clause` };
  }

  // Subject pronoun + predicate: "You Won", "I Give Up", "You Make Me Sick".
  if (SUBJECT_PRON.has(t[0]) && t.length >= 2) {
    return { fit: "ok-clause", reason: `subject "${t[0]}" + predicate` };
  }

  // Contracted subject+verb: "You're the Winner", "It's Over".
  if (CONTRACTED_SUBJECT.has(t[0])) {
    return { fit: "ok-clause", reason: `contracted clause "${t[0]} …"` };
  }

  // NP-initial: needs a finite verb after the head noun to be a clause,
  // else it is a dangling fragment ("The Winner", "A Mistake").
  if (NP_OPENERS.has(t[0])) {
    if (t.length >= 2 && AUX.has(t[1])) {
      return { fit: "ok-clause", reason: `"${t[0]} ${t[1]} …" (copular clause)` };
    }
    if (hasFinite(2)) {
      return { fit: "ok-clause", reason: "NP subject + finite verb" };
    }
    return { fit: "bad-fragment", reason: `open NP "${t[0]} …" (no finite verb — leaves it open)` };
  }

  // Imperative addressed to the devil: "Take Me Now", "Spare Me".
  if (IMPERATIVE_VERBS.has(t[0]) && t.length >= 2) {
    return { fit: "ok-imperative", reason: `imperative "${t[0]} …"` };
  }

  // Bare subject noun + finite verb: "Love Is Not Enough", "Nobody Wins".
  if (hasFinite(1)) {
    return { fit: "ok-clause", reason: "subject noun + finite verb" };
  }

  return { fit: "bad-fragment", reason: `no finite verb — "${t[0]} …" reads as an open fragment` };
}

const CLASSIFIERS = {
  copular: classifyCopularComplement,
  closer: classifyCloserComplement,
};

export function classifyComplement(title, slot = "copular") {
  const fn = CLASSIFIERS[slot];
  if (!fn) return { fit: "bad-unknown", reason: `unknown slot “${slot}”` };
  return fn(title);
}

export { classifyCopularComplement, classifyCloserComplement, hasYou, tokens };

const HELP = `title-complement-check — structural fit for a title-chain complement slot

Usage:
  node scripts/title-complement-check.mjs [--slot <name>] "Title" ["Title" ...]

Slots:
  copular   after a copula (default) — e.g. "…all i wanted was [TITLE]"
  closer    must END the sentence/story after a vocative — e.g. "…oh devil, [TITLE]."
            (complete clause/imperative/exclamative good; open NP fragment bad)

Output columns: fit [you-in-title] title reason

Add a slot: implement classify*Complement(), register in CLASSIFIERS, append to COMPLEMENT_SLOTS.
See .cursor/skills/title-chain/SKILL.md
`;

function parseArgs(argv) {
  let slot = "copular";
  const titles = [];
  for (let i = 0; i < argv.length; i++) {
    const next = matchFlag(argv, i, "slot", (v) => { slot = v; });
    if (next !== null) {
      i = next;
      continue;
    }
    if (argv[i] === "--help" || argv[i] === "-h") continue;
    titles.push(argv[i]);
  }
  return { slot, titles };
}

const isMain = process.argv[1]?.endsWith("title-complement-check.mjs");
if (isMain) {
  const { slot, titles } = parseArgs(process.argv.slice(2));
  if (!titles.length || process.argv.includes("--help") || process.argv.includes("-h")) {
    console.error(HELP);
    process.exit(titles.length ? 0 : 1);
  }
  if (!CLASSIFIERS[slot]) {
    console.error(`Unknown slot “${slot}”. Available: ${COMPLEMENT_SLOTS.join(", ")}`);
    process.exit(1);
  }
  for (const title of titles) {
    const { fit, reason } = classifyComplement(title, slot);
    const you = hasYou(title) ? "you-in-title" : "";
    console.log([fit, you, title, reason].filter(Boolean).join("\t"));
  }
}
