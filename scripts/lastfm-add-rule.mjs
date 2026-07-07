#!/usr/bin/env node
// Interactive "add a merge rule" wizard for data/ref/lastfm/merge-rules.json.
//
// Walks you through adding one rule without remembering the JSON shape or flags: pick a
// rule type, then answer prompts. Handles "merge these N spellings into this one canonical"
// for artists and titles, and album-specific relabels (overrides). Previews and asks to
// confirm before writing; merges into the existing file (unions aliases, de-dupes).
//
// Usage:
//   node scripts/lastfm-add-rule.mjs [--rules <path>] [--dry-run] [--help]
//
// After adding rules, regenerate the aggregates:
//   node scripts/lastfm-aggregate.mjs
//
// Non-interactive: pipe answers on stdin, e.g.
//   printf '1\nEXO\nExo\nEXO-K\n\ny\n' | node scripts/lastfm-add-rule.mjs --dry-run

import fs from "node:fs";
import { dirname } from "node:path";
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { matchFlag } from "./cli-args.mjs";

const DEFAULT_RULES = "data/ref/lastfm/merge-rules.json";

const HELP = `lastfm-add-rule — interactive wizard to add Last.fm merge rules

Adds a rule to data/ref/lastfm/merge-rules.json (used by the merged/titles aggregation,
never the chart). You do NOT need rules for parenthesization or language/version labels
(Eng Ver = English Version = English) — those normalize automatically.

Rule types:
  1) artist alias   merge artist spelling variants into one canonical artist
  2) title alias    merge title variants (within one artist) into one canonical title
  3) override       relabel a specific (artist, track, album) AND/OR set its dimension
                    columns (language / remix / live / instrumental)
  4) album rule     set dimension columns for EVERY track on an album (e.g. a live album)

Dimensions let you fix cases code can't infer from the title — e.g. EXO's raw "Growl" is
Korean or Chinese depending on the album. Precedence: override.set > albumRule.set > auto.

Usage:
  node scripts/lastfm-add-rule.mjs [--rules <path>] [--dry-run] [--help]

Then regenerate counts:
  node scripts/lastfm-aggregate.mjs
`;

function parseArgs(argv) {
  const args = { rules: DEFAULT_RULES, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") { args.dryRun = true; continue; }
    const n = matchFlag(argv, i, "rules", (v) => { args.rules = v; });
    if (n != null) { i = n; continue; }
  }
  return args;
}

function loadRulesFile(path) {
  if (!fs.existsSync(path)) return { artistAliases: [], titleAliases: [], overrides: [], albumRules: [] };
  const raw = JSON.parse(fs.readFileSync(path, "utf8"));
  raw.artistAliases ||= [];
  raw.titleAliases ||= [];
  raw.overrides ||= [];
  raw.albumRules ||= [];
  return raw;
}

function addArtistAlias(rules, rule) {
  const existing = rules.artistAliases.find((r) => r.canonical === rule.canonical);
  if (existing) existing.aliases = [...new Set([...(existing.aliases || []), ...rule.aliases])];
  else rules.artistAliases.push(rule);
}
function addTitleAlias(rules, rule) {
  const existing = rules.titleAliases.find((r) => r.artist === rule.artist && r.canonical === rule.canonical);
  if (existing) existing.aliases = [...new Set([...(existing.aliases || []), ...rule.aliases])];
  else rules.titleAliases.push(rule);
}
function addOverride(rules, rule) {
  const key = (o) => `${o.match.artist}\u0000${o.match.track}\u0000${o.match.album}`;
  const i = rules.overrides.findIndex((o) => key(o) === key(rule));
  if (i >= 0) rules.overrides[i] = rule;
  else rules.overrides.push(rule);
}
function addAlbumRule(rules, rule) {
  const key = (o) => `${o.match.artist}\u0000${o.match.album}`;
  const i = rules.albumRules.findIndex((o) => key(o) === key(rule));
  if (i >= 0) rules.albumRules[i] = rule;
  else rules.albumRules.push(rule);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) { output.write(HELP); return; }
  const args = parseArgs(argv);

  // Buffer stdin lines so this works both interactively (TTY) and with piped input —
  // plain readline drops 'line' events emitted between question() calls.
  const rl = readline.createInterface({ input, output });
  const queue = [];
  const waiters = [];
  let closed = false;
  rl.on("line", (l) => (waiters.length ? waiters.shift()(l) : queue.push(l)));
  rl.on("close", () => { closed = true; while (waiters.length) waiters.shift()(null); });
  const nextLine = () =>
    queue.length ? Promise.resolve(queue.shift())
      : closed ? Promise.resolve(null)
        : new Promise((res) => waiters.push(res));
  const ask = async (q) => { output.write(q); return ((await nextLine()) ?? "").trim(); };
  const askList = async (label) => {
    output.write(`${label}\n(one per line; blank line to finish)\n`);
    const out = [];
    for (;;) {
      const v = await ask("  alias> ");
      if (!v) break;
      out.push(v);
    }
    return out;
  };

  const askDims = async () => {
    const set = {};
    const language = await ask("  language (blank to skip): ");
    if (language) set.language = language;
    const remix = await ask("  remix/custom-version name (blank to skip): ");
    if (remix) set.remix = remix;
    if (/^y/i.test(await ask("  mark as LIVE? [y/N]: "))) set.live = "live";
    if (/^y/i.test(await ask("  mark as INSTRUMENTAL? [y/N]: "))) set.instrumental = "instrumental";
    return set;
  };

  try {
    const type = await ask("Rule type — [1] artist alias  [2] title alias  [3] override  [4] album rule: ");
    const rules = loadRulesFile(args.rules);
    let kind, rule;

    if (type === "1" || /artist/i.test(type)) {
      kind = "artistAliases";
      const canonical = await ask("Canonical artist (the spelling to KEEP): ");
      const aliases = await askList("Alias artist spellings to MERGE INTO it:");
      if (!canonical || !aliases.length) { output.write("Need a canonical + at least one alias. Aborted.\n"); return; }
      rule = { canonical, aliases };
      addArtistAlias(rules, rule);
    } else if (type === "2" || /title/i.test(type)) {
      kind = "titleAliases";
      const artist = await ask("Artist (exact, as scrobbled): ");
      const canonical = await ask("Canonical title (the one to KEEP): ");
      const aliases = await askList("Alias titles to MERGE INTO it:");
      if (!artist || !canonical || !aliases.length) { output.write("Need artist + canonical + at least one alias. Aborted.\n"); return; }
      rule = { artist, canonical, aliases };
      addTitleAlias(rules, rule);
    } else if (type === "3" || /override/i.test(type)) {
      kind = "overrides";
      const artist = await ask("Match — artist (exact): ");
      const track = await ask("Match — track (exact): ");
      const album = await ask("Match — album (exact; from tracks-variants.csv): ");
      const as = await ask("Relabel this track AS (blank to keep the title): ");
      output.write("Set dimension columns (blank to leave unchanged):\n");
      const set = await askDims();
      const note = await ask("Note (optional, Enter to skip): ");
      if (!artist || !track || (!as && !Object.keys(set).length)) {
        output.write("Need artist + track + (a relabel or at least one dimension). Aborted.\n"); return;
      }
      rule = { match: { artist, track, album } };
      if (as) rule.as = as;
      if (Object.keys(set).length) rule.set = set;
      if (note) rule.note = note;
      addOverride(rules, rule);
    } else if (type === "4" || /album/i.test(type)) {
      kind = "albumRules";
      const artist = await ask("Match — artist (exact): ");
      const album = await ask("Match — album (exact): ");
      output.write("Set dimension columns for EVERY track on this album:\n");
      const set = await askDims();
      const note = await ask("Note (optional, Enter to skip): ");
      if (!artist || !album || !Object.keys(set).length) {
        output.write("Need artist + album + at least one dimension. Aborted.\n"); return;
      }
      rule = { match: { artist, album }, set };
      if (note) rule.note = note;
      addAlbumRule(rules, rule);
    } else {
      output.write("Unknown rule type. Aborted.\n");
      return;
    }

    output.write(`\nAdding to ${args.rules} [${kind}]:\n${JSON.stringify(rule, null, 2)}\n`);
    const ok = await ask(args.dryRun ? "\n(--dry-run) not writing. Preview only. [enter]" : "\nWrite this rule? [y/N]: ");
    if (args.dryRun) { output.write("Dry run — no changes written.\n"); return; }
    if (!/^y/i.test(ok)) { output.write("Aborted — nothing written.\n"); return; }

    fs.mkdirSync(dirname(args.rules), { recursive: true });
    fs.writeFileSync(args.rules, JSON.stringify(rules, null, 2) + "\n");
    output.write(`Wrote ${args.rules}. Now run: node scripts/lastfm-aggregate.mjs\n`);
  } finally {
    rl.close();
  }
}

main();
