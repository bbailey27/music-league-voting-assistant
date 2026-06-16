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
  if (hasParse) {
    try {
      const data = JSON.parse(readFileSync(music.json, 'utf8'));
      if (Array.isArray(data.songs)) {
        missingScores = data.songs.filter((s) => s.needsUserInput).length;
      }
    } catch {
      // unreadable JSON
    }
  }

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
    return {
      kind: 'advisory',
      label:
        `music-only round: done — open ${st.music.md} for draft votes; ` +
        `thematic rounds only: fit research → ${st.fit.json}`,
    };
  }
  if (!st.hasScoresJson) {
    return {
      kind: 'merge',
      label: `merge fit + music → ${st.scores.json} (node scripts/parse-round.mjs ${st.inputPath} --fit ${st.fit.json})`,
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
    console.error(`No scores JSON at ${scoresJson}. Run merge first (--fit).`);
    process.exit(1);
  }
  process.exit(
    runScript('render-fit-html.mjs', [scoresJson, '--out', scoresPaths(base).html, ...flags])
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
  if (!existsSync(st.music.json)) {
    console.error(`No music JSON at ${st.music.json}. Run "ml parse ${base}" first.`);
    process.exit(1);
  }
  const fitArg = st.hasFitJson ? ['--fit', st.fit.json] : [];
  process.exit(
    runScript('render-final-html.mjs', [
      st.music.json,
      ...fitArg,
      '--out',
      st.hasFitJson ? st.scores.html : st.music.html,
      ...flags,
    ])
  );
}

function cmdRun(name) {
  const base = resolveOrExit(name, listAllRoundIds(), 'round');
  const st = pipelineState(base);
  const step = nextStep(st);

  switch (step.kind) {
    case 'parse':
      return process.exit(runScript('parse-round.mjs', [st.inputPath]));
    case 'merge':
      console.log(`${base}: ${step.label}`);
      warnMissingScores(st);
      break;
    case 'scores':
      return process.exit(runScript('render-fit-html.mjs', [st.scores.json, '--out', st.scores.html]));
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
      checkbox(st.hasScoresHtml, st.hasScoresHtml && !st.scoresHtmlFresh);
    const warn = st.missingScores > 0 ? `  ⚠ ${st.missingScores} missing score(s)` : '';
    console.log(`${marks}  ${name}  → ${step.label}${warn}`);
  }
}

function usage() {
  console.log(`Usage:
  ml parse  <name> [--mode objective|subjective] [--no-json]
  ml fit    <name> [--out <path>] [--order fit|combined|raw]
  ml scores <name> [--out <path>] [--order fit|combined|raw]
  ml final  <name> [--out <path>] [--order votes|score|raw]
  ml run    <name>     (alias: next) — run the next scriptable step
  ml status [name]     — pipeline checklist + next step (no name = all rounds)

<name> is a fuzzy match against round files (e.g. "tarot" or "2026-06-09").`);
}

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
