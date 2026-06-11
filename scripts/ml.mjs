#!/usr/bin/env node
// Friendly front-end for the Music League workflow: fuzzy round names,
// input-type inference, and next-step guidance so you don't have to type full
// paths or remember which script wants which file.
//
// Usage:
//   node scripts/ml.mjs parse  <name> [--mode objective|subjective] [--no-json]
//   node scripts/ml.mjs fit    <name> [--out <path>] [--order fit|combined|raw]
//   node scripts/ml.mjs final  <name> [--out <path>] [--order votes|score|raw]
//   node scripts/ml.mjs run    <name>        (alias: next) — runs the next scriptable step
//   node scripts/ml.mjs status [name]        — pipeline checklist + next step (no name = all rounds)
//
// The real scripts (parse-round.mjs, render-fit-html.mjs, render-final-html.mjs)
// are spawned as-is; this dispatcher only resolves names and decides what to run.

import { readdirSync, existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROUNDS_DIR = 'rounds';
const ANALYSIS_DIR = 'analysis';
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

// exact > case-insensitive substring > subsequence. Returns the best non-empty
// tier of matches (so callers can tell "one match" from "ambiguous").
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
// File discovery
// ---------------------------------------------------------------------------
function baseNames(dir, suffix) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => !f.startsWith('.') && f.endsWith(suffix))
    .map((f) => f.slice(0, -suffix.length))
    .sort();
}

// A round's input can be a saved HTML export or pasted round text.
function roundNames() {
  return [
    ...new Set([
      ...baseNames(ROUNDS_DIR, '.html'),
      ...baseNames(ROUNDS_DIR, '.txt'),
    ]),
  ].sort();
}

// The file to feed the parser: prefer the richer HTML export, fall back to text.
function inputPathFor(name) {
  const html = join(ROUNDS_DIR, `${name}.html`);
  const txt = join(ROUNDS_DIR, `${name}.txt`);
  if (existsSync(html)) return html;
  if (existsSync(txt)) return txt;
  return html; // default for messaging when neither exists yet
}

function fitBaseNames() {
  return baseNames(ANALYSIS_DIR, '-fit.json');
}

// Round identity = round HTML bases plus any fit-JSON bases (minus -fit).
function roundBases() {
  return [...new Set([...roundNames(), ...fitBaseNames()])].sort();
}

// ---------------------------------------------------------------------------
// Pipeline state
// ---------------------------------------------------------------------------
function pipelineState(name) {
  const htmlPath = join(ROUNDS_DIR, `${name}.html`);
  const txtPath = join(ROUNDS_DIR, `${name}.txt`);
  const mdPath = join(ANALYSIS_DIR, `${name}.md`);
  const jsonPath = join(ANALYSIS_DIR, `${name}.json`);
  const fitJsonPath = join(ANALYSIS_DIR, `${name}-fit.json`);
  const fitHtmlPath = join(ANALYSIS_DIR, `${name}-fit.html`);

  const hasHtml = existsSync(htmlPath);
  const hasTxt = existsSync(txtPath);
  const hasInput = hasHtml || hasTxt;
  const inputPath = hasHtml ? htmlPath : txtPath;
  const hasParse = existsSync(mdPath) && existsSync(jsonPath);
  const hasFitJson = existsSync(fitJsonPath);
  const hasFitHtml = existsSync(fitHtmlPath);

  let fitHtmlFresh = false;
  if (hasFitJson && hasFitHtml) {
    fitHtmlFresh = statSync(fitHtmlPath).mtimeMs >= statSync(fitJsonPath).mtimeMs;
  }

  // Anomaly (not a stage): blank score boxes in the parse output.
  let missingScores = 0;
  if (hasParse) {
    try {
      const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
      if (Array.isArray(data.songs)) {
        missingScores = data.songs.filter((s) => s.needsUserInput).length;
      }
    } catch {
      // unreadable JSON: leave missingScores at 0, parse step still counts as done
    }
  }

  return {
    name,
    htmlPath,
    txtPath,
    inputPath,
    mdPath,
    jsonPath,
    fitJsonPath,
    fitHtmlPath,
    hasHtml,
    hasTxt,
    hasInput,
    hasParse,
    hasFitJson,
    hasFitHtml,
    fitHtmlFresh,
    missingScores,
  };
}

// Next *scriptable* step, or a manual/advisory reminder. Blank-score boxes
// never gate this — they only surface as a warning.
function nextStep(st) {
  if (!st.hasInput) {
    return {
      kind: 'manual',
      label: `export the round to ${st.htmlPath} (or paste round text to ${st.txtPath})`,
    };
  }
  if (!st.hasParse) {
    return { kind: 'parse', label: `parse the round → ${st.mdPath} + ${st.jsonPath}` };
  }
  if (!st.hasFitJson) {
    return {
      kind: 'advisory',
      label:
        `music-only round: done — open ${st.mdPath} for draft votes; ` +
        `thematic rounds only: fit research → ${st.fitJsonPath}`,
    };
  }
  if (!st.hasFitHtml || !st.fitHtmlFresh) {
    const why = !st.hasFitHtml ? 'missing' : 'stale';
    return { kind: 'render', label: `render the fit report (${why}) → ${st.fitHtmlPath}` };
  }
  return { kind: 'done', label: `done — open ${st.fitHtmlPath}` };
}

function warnMissingScores(st) {
  if (st.missingScores > 0) {
    const s = st.missingScores === 1 ? '' : 's';
    console.log(
      `  ⚠ ${st.missingScores} song${s} missing a score — re-export after the page autosaves + reloads`
    );
  }
}

// ---------------------------------------------------------------------------
// Spawning the real scripts
// ---------------------------------------------------------------------------
function runScript(scriptName, args) {
  const res = spawnSync('node', [join(SCRIPTS_DIR, scriptName), ...args], {
    stdio: 'inherit',
  });
  return res.status ?? 1;
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------
function cmdParse(name, flags) {
  const base = resolveOrExit(name, roundNames(), 'round');
  process.exit(runScript('parse-round.mjs', [inputPathFor(base), ...flags]));
}

function cmdFit(name, flags) {
  const base = resolveOrExit(name, fitBaseNames(), 'fit JSON');
  process.exit(
    runScript('render-fit-html.mjs', [join(ANALYSIS_DIR, `${base}-fit.json`), ...flags])
  );
}

// Render the final draft-vote report (analysis/NAME.html) from the parse JSON,
// layering in the fit sidecar when the round had fit research.
function cmdFinal(name, flags) {
  const base = resolveOrExit(name, roundBases(), 'round');
  const jsonPath = join(ANALYSIS_DIR, `${base}.json`);
  if (!existsSync(jsonPath)) {
    console.error(`No parse JSON at ${jsonPath}. Run "ml parse ${base}" first.`);
    process.exit(1);
  }
  const fitJsonPath = join(ANALYSIS_DIR, `${base}-fit.json`);
  const fitArgs = existsSync(fitJsonPath) ? ['--fit', fitJsonPath] : [];
  process.exit(runScript('render-final-html.mjs', [jsonPath, ...fitArgs, ...flags]));
}

function cmdRun(name) {
  const base = resolveOrExit(name, roundBases(), 'round');
  const st = pipelineState(base);
  const step = nextStep(st);

  switch (step.kind) {
    case 'parse':
      process.exit(runScript('parse-round.mjs', [st.inputPath]));
      break;
    case 'render':
      process.exit(runScript('render-fit-html.mjs', [st.fitJsonPath]));
      break;
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
  console.log(`  ${checkbox(st.hasParse)} Parse          ${st.mdPath} + ${st.jsonPath}`);
  console.log(
    `  ${checkbox(st.hasFitJson)} Fit research   ${st.fitJsonPath}   (thematic rounds only)`
  );
  console.log(
    `  ${checkbox(st.hasFitHtml, st.hasFitHtml && !st.fitHtmlFresh)} Fit HTML       ${st.fitHtmlPath}` +
      (st.hasFitHtml && !st.fitHtmlFresh ? '   (stale — re-render)' : '')
  );
  warnMissingScores(st);
  console.log(`  Next: ${step.label}`);
}

function cmdStatusAll() {
  const bases = roundBases();
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
      checkbox(st.hasFitHtml, st.hasFitHtml && !st.fitHtmlFresh);
    const warn = st.missingScores > 0 ? `  ⚠ ${st.missingScores} missing score(s)` : '';
    console.log(`${marks}  ${name}  → ${step.label}${warn}`);
  }
}

function usage() {
  console.log(`Usage:
  ml parse  <name> [--mode objective|subjective] [--no-json]
  ml fit    <name> [--out <path>] [--order fit|combined|raw]
  ml final  <name> [--out <path>] [--order votes|score|raw]
  ml run    <name>     (alias: next) — run the next scriptable step
  ml status [name]     — pipeline checklist + next step (no name = all rounds)

<name> is a fuzzy match against round files (e.g. "tarot" or "2026-06-09").`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const [, , cmd, ...rest] = process.argv;
  const name = rest[0];
  const flags = rest.slice(1);

  switch (cmd) {
    case 'parse':
      if (!name) return usage();
      return cmdParse(name, flags);
    case 'fit':
      if (!name) return usage();
      return cmdFit(name, flags);
    case 'final':
      if (!name) return usage();
      return cmdFinal(name, flags);
    case 'run':
    case 'next':
      if (!name) return usage();
      return cmdRun(name);
    case 'status':
      return name ? cmdStatusOne(resolveOrExit(name, roundBases(), 'round')) : cmdStatusAll();
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      return usage();
    default:
      console.error(`Unknown command "${cmd}".\n`);
      usage();
      process.exit(1);
  }
}

main();
