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
//
// Tags: ok-np, ok-inf, ok-adj, ok-fragment, bad-clause, bad-unknown; you-in-title is informational.

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

export const COMPLEMENT_SLOTS = ["copular"];

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

const CLASSIFIERS = {
  copular: classifyCopularComplement,
};

export function classifyComplement(title, slot = "copular") {
  const fn = CLASSIFIERS[slot];
  if (!fn) return { fit: "bad-unknown", reason: `unknown slot “${slot}”` };
  return fn(title);
}

export { classifyCopularComplement, hasYou, tokens };

const HELP = `title-complement-check — structural fit for a title-chain complement slot

Usage:
  node scripts/title-complement-check.mjs [--slot <name>] "Title" ["Title" ...]

Slots:
  copular   after a copula (default) — e.g. "…all i wanted was [TITLE]"

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
