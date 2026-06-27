#!/usr/bin/env node
// Friendly front-end for the Music League workflow: fuzzy round names,
// input-type inference, and next-step guidance so you don't have to type full
// paths or remember which script wants which file.
//
// Usage:
//   node scripts/ml.mjs parse  <name> [--mode objective|subjective] [--no-json]
//   node scripts/ml.mjs fit    <name> [--out <path>] [--order fit|combined|raw]
//   node scripts/ml.mjs scores <name> [--out <path>] [--order fit|combined|raw]
//   node scripts/ml.mjs final  <name> [--out <path>] [--order votes|score|raw]
//   node scripts/ml.mjs run    <name>        (alias: next) — runs the next scriptable step
//   node scripts/ml.mjs status [name]        — pipeline checklist + next step (no name = all rounds)
//
// The real scripts (parse-round.mjs, render-fit-html.mjs, render-final-html.mjs)
// are spawned as-is; this dispatcher only resolves names and decides what to run.

import { existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ROUNDS_DIR,
  inputPathFor,
  listAllRoundIds,
  listRoundInputIds,
  musicPaths,
  fitPaths,
  scoresPaths,
} from './paths.mjs';
import { applyDateSlugs, archiveStaleRounds, tidyRounds } from './maintain-rounds.mjs';

const SCRIPTS_DIR = 'scripts';

// ---------------------------------------------------------------------------
// Fuzzy name resolution
// ---------------------------------------------------------------------------
function isSubsequence(query, target) {
  let i = 0;
  for (let j = 0; j < target.length && i < query.length; j++) {
    if (target[j] === query[i]) i++;
  }
  return i === query.length;
}

function fuzzyMatches(query, names) {
  const q = String(query).trim().toLowerCase();
  if (!q) return [];
  const exact = names.filter((n) => n.toLowerCase() === q);
  if (exact.length) return exact;
  const substr = names.filter((n) => n.toLowerCase().includes(q));
  if (substr.length) return substr;
  return names.filter((n) => isSubsequence(q, n.toLowerCase()));
}

function resolveOrExit(query, names, kind) {
  if (!names.length) {
    console.error(`No ${kind} found yet.`);
    process.exit(1);
  }
  const matches = fuzzyMatches(query, names);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    console.error(`"${query}" is ambiguous — matches multiple ${kind}s:`);
    for (const n of matches) console.error(`  ${n}`);
    process.exit(1);
  }
  console.error(`No ${kind} matches "${query}". Available:`);
  for (const n of names) console.error(`  ${n}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Pipeline state
// ---------------------------------------------------------------------------
function pipelineState(name) {
  const music = musicPaths(name);
  const fit = fitPaths(name);
  const scores = scoresPaths(name);
  const htmlPath = join(ROUNDS_DIR, `${name}.html`);
  const txtPath = join(ROUNDS_DIR, `${name}.txt`);

  const hasHtml = existsSync(htmlPath);
  const hasTxt = existsSync(txtPath);
  const hasInput = hasHtml || hasTxt;
  const inputPath = hasHtml ? htmlPath : txtPath;
  const hasParse = existsSync(music.md) && existsSync(music.json);
  const hasMusicHtml = existsSync(music.html);
  const hasFitJson = existsSync(fit.json);
  const hasFitHtml = existsSync(fit.html);
  const hasScoresJson = existsSync(scores.json);
  const hasScoresHtml = existsSync(scores.html);

  let musicHtmlFresh = false;
  if (existsSync(music.json) && hasMusicHtml) {
    musicHtmlFresh = statSync(music.html).mtimeMs >= statSync(music.json).mtimeMs;
  }
  let fitHtmlFresh = false;
  if (hasFitJson && hasFitHtml) {
    fitHtmlFresh = statSync(fit.html).mtimeMs >= statSync(fit.json).mtimeMs;
  }
  let scoresHtmlFresh = false;
  if (hasScoresJson && hasScoresHtml) {
    scoresHtmlFresh = statSync(scores.html).mtimeMs >= statSync(scores.json).mtimeMs;
  }

  let missingScores = 0;
  let hasPick = false;
  let pickSummary = null;
  const readPick = (jsonPath) => {
    try {
      const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
      if (Array.isArray(data.songs)) {
        missingScores = data.songs.filter((s) => s.needsUserInput).length;
      }
      if (data.pick) {
        hasPick = true;
        const n = data.pick.options?.length;
        pickSummary = data.pick.chosen
          ? `${data.pick.chosen}${n ? ` (${n} options kept)` : ''}`
          : 'recorded';
      }
    } catch {
      // unreadable JSON
    }
  };
  if (hasParse) readPick(music.json);
  if (!hasPick && hasScoresJson) readPick(scores.json);

  return {
    name,
    htmlPath,
    txtPath,
    inputPath,
    music,
    fit,
    scores,
    hasHtml,
    hasTxt,
    hasInput,
    hasParse,
    hasMusicHtml,
    musicHtmlFresh,
    hasFitJson,
    hasFitHtml,
    fitHtmlFresh,
    hasScoresJson,
    hasScoresHtml,
    scoresHtmlFresh,
    missingScores,
    hasPick,
    pickSummary,
  };
}

function nextStep(st) {
  if (!st.hasInput) {
    return {
      kind: 'manual',
      label: `export the round to ${st.htmlPath} (or paste round text to ${st.txtPath})`,
    };
  }
  if (!st.hasParse) {
    return {
      kind: 'parse',
      label: `parse the round → ${st.music.md} + ${st.music.json}`,
    };
  }
  if (!st.hasFitJson) {
    if (!st.hasPick && st.hasParse) {
      return {
        kind: 'pick',
        label: `pick a distribution → just pick ${st.name} <A|B|C> --reason "…" (see ${st.music.md})`,
      };
    }
    if (st.hasPick) {
      if (!st.hasMusicHtml || !st.musicHtmlFresh) {
        const why = !st.hasMusicHtml ? 'missing' : 'stale';
        return { kind: 'final', label: `render music report (${why}) → ${st.music.html}` };
      }
      return {
        kind: 'done',
        label: `done — open ${st.music.md} or ${st.music.html}`,
      };
    }
    return {
      kind: 'advisory',
      label:
        `music-only round: open ${st.music.md} for draft votes; ` +
        `thematic rounds only: fit research → ${st.fit.json}`,
    };
  }
  if (!st.hasScoresJson) {
    return {
      kind: 'merge',
      label: `merge fit + music → ${st.scores.json} (just merge ${st.name})`,
    };
  }
  if (!st.hasPick) {
    return {
      kind: 'pick',
      label: `pick a distribution → just pick ${st.name} <A|B|C> --reason "…"`,
    };
  }
  if (!st.hasScoresHtml || !st.scoresHtmlFresh) {
    const why = !st.hasScoresHtml ? 'missing' : 'stale';
    return { kind: 'scores', label: `render merged scores (${why}) → ${st.scores.html}` };
  }
  if (!st.hasFitHtml || !st.fitHtmlFresh) {
    const why = !st.hasFitHtml ? 'missing' : 'stale';
    return { kind: 'fit', label: `render fit-only report (${why}) → ${st.fit.html}` };
  }
  return { kind: 'done', label: `done — open ${st.scores.html} (deliverable) or ${st.fit.html} (fit-only)` };
}

function warnMissingScores(st) {
  if (st.missingScores > 0) {
    const s = st.missingScores === 1 ? '' : 's';
    console.log(
      `  ⚠ ${st.missingScores} song${s} missing a score — re-export after the page autosaves + reloads`
    );
  }
}

function runScript(scriptName, args) {
  const res = spawnSync('node', [join(SCRIPTS_DIR, scriptName), ...args], {
    stdio: 'inherit',
  });
  return res.status ?? 1;
}

function cmdMerge(name, flags) {
  const base = resolveOrExit(name, listAllRoundIds(), 'round');
  process.exit(runScript('merge-scores.mjs', [base, ...flags]));
}

function cmdPick(name, option, flags) {
  const base = resolveOrExit(name, listAllRoundIds(), 'round');
  if (!option) {
    console.error('Usage: ml pick <name> <A|B|C> [--reason "…"] [--pin …]');
    process.exit(1);
  }
  process.exit(runScript('pick-round.mjs', [base, option, ...flags]));
}

function cmdParse(name, flags) {
  const base = resolveOrExit(name, listRoundInputIds(), 'round');
  process.exit(runScript('parse-round.mjs', [inputPathFor(base), ...flags]));
}

function cmdFit(name, flags) {
  const base = resolveOrExit(name, listAllRoundIds(), 'round');
  const fitJson = fitPaths(base).json;
  if (!existsSync(fitJson)) {
    console.error(`No fit JSON at ${fitJson}.`);
    process.exit(1);
  }
  process.exit(
    runScript('render-fit-html.mjs', [fitJson, '--out', fitPaths(base).html, ...flags])
  );
}

function cmdScores(name, flags) {
  const base = resolveOrExit(name, listAllRoundIds(), 'round');
  const scoresJson = scoresPaths(base).json;
  if (!existsSync(scoresJson)) {
    console.error(`No scores JSON at ${scoresJson}. Run merge first (just merge ${base}).`);
    process.exit(1);
  }
  // The merged scores deliverable ranks by the blended combinedScore (with music as
  // the secondary axis), not fit alone — default to it unless the caller overrode.
  const orderDefault =
    flags.includes('--order') || flags.some((f) => f.startsWith('--order=')) ? [] : ['--order', 'combined'];
  process.exit(
    runScript('render-fit-html.mjs', [scoresJson, '--out', scoresPaths(base).html, ...flags, ...orderDefault])
  );
}

function cmdFinal(name, flags) {
  const base = resolveOrExit(name, listAllRoundIds(), 'round');
  const st = pipelineState(base);
  if (st.hasScoresJson) {
    process.exit(
      runScript('render-fit-html.mjs', [
        st.scores.json,
        '--out',
        st.scores.html,
        ...flags.filter((f) => !f.startsWith('--order=') && f !== '--order'),
        ...(flags.includes('--order') ? [] : ['--order', 'combined']),
      ])
    );
  }
  if (st.hasFitJson && !st.hasScoresJson) {
    const mergeCode = runScript('merge-scores.mjs', [base]);
    if (mergeCode !== 0) process.exit(mergeCode);
    process.exit(
      runScript('render-fit-html.mjs', [
        st.scores.json,
        '--out',
        st.scores.html,
        ...flags.filter((f) => !f.startsWith('--order=') && f !== '--order'),
        ...(flags.includes('--order') ? [] : ['--order', 'combined']),
      ])
    );
  }
  if (!existsSync(st.music.json)) {
    console.error(`No music JSON at ${st.music.json}. Run "ml parse ${base}" first.`);
    process.exit(1);
  }
  process.exit(
    runScript('render-final-html.mjs', [st.music.json, '--out', st.music.html, ...flags])
  );
}

function cmdRun(name) {
  // Tidy first so artifacts generate under the dated name, then resolve against
  // the fresh listing. Archive runs after we know which round to keep active.
  applyDateSlugs({ log: console.log });
  const base = resolveOrExit(name, listAllRoundIds(), 'round');
  archiveStaleRounds({ keep: new Set([base]), log: console.log });
  const st = pipelineState(base);
  const step = nextStep(st);

  switch (step.kind) {
    case 'parse':
      return process.exit(runScript('parse-round.mjs', [st.inputPath]));
    case 'merge':
      console.log(`${base}: ${step.label}`);
      warnMissingScores(st);
      return process.exit(runScript('merge-scores.mjs', [base]));
    case 'pick':
      console.log(`${base}: ${step.label}`);
      warnMissingScores(st);
      break;
    case 'final':
      return process.exit(
        runScript('render-final-html.mjs', [st.music.json, '--out', st.music.html])
      );
    case 'scores':
      return process.exit(
        runScript('render-fit-html.mjs', [st.scores.json, '--out', st.scores.html, '--order', 'combined'])
      );
    case 'fit':
      return process.exit(runScript('render-fit-html.mjs', [st.fit.json, '--out', st.fit.html]));
    case 'manual':
    case 'advisory':
      console.log(`${base}: ${step.label}`);
      warnMissingScores(st);
      break;
    case 'done':
      console.log(`${base}: ${step.label}`);
      warnMissingScores(st);
      break;
  }
}

function cmdTidy(flags) {
  let dryRun = false;
  let name = true;
  let archive = true;
  let ageDays;
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    if (f === '--dry-run' || f === '-n') dryRun = true;
    else if (f === '--no-name') name = false;
    else if (f === '--no-archive') archive = false;
    else if (f === '--age') ageDays = Number(flags[++i]);
    else if (f.startsWith('--age=')) ageDays = Number(f.slice('--age='.length));
    else {
      console.error(`Unknown tidy option "${f}".`);
      process.exit(1);
    }
  }
  const opts = { name, archive, dryRun, log: console.log };
  if (ageDays !== undefined) opts.ageDays = ageDays;
  const { named, archived } = tidyRounds(opts);
  if (!named.length && !archived.length) {
    console.log(dryRun ? 'Nothing to tidy.' : 'Nothing to tidy — rounds are already dated and current.');
  }
}

function checkbox(done, stale = false) {
  if (stale) return '[~]';
  return done ? '[x]' : '[ ]';
}

function cmdStatusOne(name) {
  const st = pipelineState(name);
  const step = nextStep(st);
  const inputLabel = st.hasHtml
    ? st.htmlPath + (st.hasTxt ? ' (+ .txt)' : '')
    : st.hasTxt
      ? st.txtPath
      : st.htmlPath;
  console.log(`Round: ${name}`);
  console.log(`  ${checkbox(st.hasInput)} Round input    ${inputLabel}`);
  console.log(`  ${checkbox(st.hasParse)} Parse (music)  ${st.music.md} + ${st.music.json}`);
  console.log(
    `  ${checkbox(st.hasFitJson)} Fit research   ${st.fit.json}   (thematic rounds only)`
  );
  console.log(`  ${checkbox(st.hasScoresJson)} Merge (scores) ${st.scores.json}`);
  console.log(
    `  ${checkbox(st.hasPick)} Pick recorded  ${st.hasPick ? st.pickSummary : '(just pick <name> <A|B|C>)'}`
  );
  console.log(
    `  ${checkbox(st.hasScoresHtml, st.hasScoresHtml && !st.scoresHtmlFresh)} Scores HTML    ${st.scores.html}` +
      (st.hasScoresHtml && !st.scoresHtmlFresh ? '   (stale — re-render)' : '')
  );
  console.log(
    `  ${checkbox(st.hasFitHtml, st.hasFitHtml && !st.fitHtmlFresh)} Fit HTML       ${st.fit.html}` +
      (st.hasFitHtml && !st.fitHtmlFresh ? '   (stale — re-render)' : '')
  );
  // Music-only deliverable (ml final on a non-thematic round). Optional row —
  // shown only once produced, since most rounds end at scores.html instead.
  if (st.hasMusicHtml) {
    console.log(
      `  ${checkbox(true, !st.musicHtmlFresh)} Music HTML     ${st.music.html}` +
        (!st.musicHtmlFresh ? '   (stale — re-render)' : '')
    );
  }
  warnMissingScores(st);
  console.log(`  Next: ${step.label}`);
}

function cmdStatusAll() {
  const bases = listAllRoundIds();
  if (!bases.length) {
    console.log('No rounds yet. Add a round export to rounds/NAME.html to start.');
    return;
  }
  for (const name of bases) {
    const st = pipelineState(name);
    const step = nextStep(st);
    const marks =
      checkbox(st.hasInput) +
      checkbox(st.hasParse) +
      checkbox(st.hasFitJson) +
      checkbox(st.hasScoresJson) +
      checkbox(st.hasPick) +
      checkbox(st.hasScoresHtml, st.hasScoresHtml && !st.scoresHtmlFresh);
    const warn = st.missingScores > 0 ? `  ⚠ ${st.missingScores} missing score(s)` : '';
    console.log(`${marks}  ${name}  → ${step.label}${warn}`);
  }
}

function usage() {
  cmdHelp(null);
}

const HELP = {
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
  ml parse | merge | pick | fit | scores | final | run | status | tidy | help

<name> is a fuzzy match (e.g. "tarot" or "2026-06-09").
Run "ml help <cmd>" for flags and an example.`,
  parse: `ml parse <name> [flags]

Parse a saved round HTML or text file → music.md + music.json.
Does NOT write pick or scores. Does NOT read fit.json.

Flags (explore allocation before pick):
  --mode objective|subjective
  --shape auto|bell|balanced|top-heavy|compressed|relative
  --tier-count <n>       force distinct point tiers
  --bucket-count <n>     force funded tier count
  --pin <i>:<v>          pin a song's up/down votes (raw order index)
  --favorite-band <min>  merge scores ≥ min into one top tier (default 80)
  --no-favorite-band     disable favorite-band merge
  --no-json              skip music.json
  --lenient              tolerate Live Text / pasted text input

Deprecated (warns, use separate stage):
  --fit, --option, --reason

Example:
  just parse kpop-favorite --shape auto`,
  merge: `ml merge <name> [flags]

Merge music.json + fit.json → scores.json. Never reads HTML.

Flags (thematic profile + allocation knobs):
  --rank combined|fit|music
  --weights <fit>:<music>   e.g. 3:2
  --gate passFail|passFailMaybe
  --cutoff <axis>:<min>     e.g. fit:70
  --shape, --down-shape, --pin, --tier-count, --bucket-count
  --favorite-band, --no-favorite-band

Example:
  just merge tarot --rank combined --weights 3:2`,
  pick: `ml pick <name> <A|B|C> [flags]

Record a distribution choice. JSON-only — never re-reads HTML.
Writes pick to music.json (music-only) or scores.json (thematic with --scores),
refreshes the markdown report, and appends picks.jsonl.

Flags:
  --reason "why"           rationale stored in the pick record
  --pin <i>:<v>            pin after applying the option
  --down-shape flat|curved|concentrated
  --shape, --tier-count, --bucket-count  (replay allocation)
  --scores                 write pick to scores.json (thematic default path)
  --dry-run                show pick without writing

Example:
  just pick tarot C --reason "thematic standouts land on 75 anchor"`,
  final: `ml final <name> [flags]

Render the draft-vote HTML deliverable:
  - scores.json → scores.html when merge has run (thematic)
  - music.json → music.html for music-only rounds
  Auto-runs merge first if fit.json exists but scores.json does not.

Flags:
  --out <path>
  --order combined|fit|raw|votes|score   (renderer sort order)

Example:
  just final tarot`,
};

function cmdHelp(topic) {
  const key = topic?.toLowerCase();
  if (!key) {
    console.log(HELP.overview);
    return;
  }
  const text = HELP[key];
  if (!text) {
    console.error(`Unknown help topic "${topic}". Try: parse, merge, pick, final\n`);
    console.log(HELP.overview);
    process.exit(1);
  }
  console.log(text);
}

function main() {
  const [, , cmd, ...rest] = process.argv;
  const name = rest[0];
  const flags = rest.slice(1);

  switch (cmd) {
    case 'parse':
      if (!name) return usage();
      return cmdParse(name, flags);
    case 'merge':
      if (!name) return usage();
      return cmdMerge(name, flags);
    case 'pick': {
      if (!name) return usage();
      const option = flags[0] && !flags[0].startsWith('-') ? flags.shift() : null;
      return cmdPick(name, option, flags);
    }
    case 'fit':
      if (!name) return usage();
      return cmdFit(name, flags);
    case 'scores':
      if (!name) return usage();
      return cmdScores(name, flags);
    case 'final':
      if (!name) return usage();
      return cmdFinal(name, flags);
    case 'run':
    case 'next':
      if (!name) return usage();
      return cmdRun(name);
    case 'status':
      return name ? cmdStatusOne(resolveOrExit(name, listAllRoundIds(), 'round')) : cmdStatusAll();
    case 'tidy':
      return cmdTidy(rest);
    case 'help':
      return cmdHelp(name);
    case undefined:
    case '-h':
    case '--help':
      return usage();
    default:
      console.error(`Unknown command "${cmd}".\n`);
      usage();
      process.exit(1);
  }
}

main();
