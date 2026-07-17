#!/usr/bin/env node
// Friendly front-end for the Music League workflow: fuzzy round names,
// input-type inference, and next-step guidance so you don't have to type full
// paths or remember which script wants which file.
//
// Usage:
//   node scripts/ml.mjs parse  <name> [--mode objective|subjective] [--no-json] [--fit [tier|gate]]
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
  readCurrentRound,
  writeCurrentRound,
} from './paths.mjs';
import { applyDateSlugs, archiveStaleRounds, tidyRounds } from './maintain-rounds.mjs';
import { downShapeFromShort, parsePickSpec } from './cli-commands.mjs';
import {
  formatConfigDisplay,
  readMlConfig,
  writeMlConfig,
  DEFAULT_CLI_COMMENT_WIDTH,
} from './ml-config.mjs';
import { HELP, HELP_TOPICS, cmdHelpText } from './cli-help.mjs';
import { LEAGUES, leagueForRound, leagueDetailLines } from './leagues.mjs';

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

const VALUE_FLAGS = new Set([
  '--mode',
  '--shape',
  '--down-shape',
  '--fit',
  '--rank',
  '--gate',
  '--cutoff',
  '--weights',
  '--pin',
  '--tier-count',
  '--bucket-count',
  '--favorite-band',
  '--option',
  '--reason',
  '--out',
  '--order',
  '--age',
]);

function nextFlagValue(argv, i, flag) {
  if (flag.includes('=') || !VALUE_FLAGS.has(flag)) return null;
  if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) return argv[++i];
  return null;
}

/** Split positional round name from flags; name may be omitted (uses current round). */
function splitRoundArgs(rest) {
  let name = null;
  const flags = [];
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t.startsWith('-')) {
      flags.push(t);
      const v = nextFlagValue(rest, i, t);
      if (v != null) {
        flags.push(v);
        i++;
      }
    } else if (name == null) {
      name = t;
    } else {
      console.error(`Unexpected argument "${t}".`);
      process.exit(1);
    }
  }
  return { name, flags };
}

/** Pick: optional name, required A|B|C [cv|fl|cc], then flags (any order). */
function splitPickArgs(rest) {
  let name = null;
  let option = null;
  const flags = [];
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t.startsWith('-')) {
      flags.push(t);
      const v = nextFlagValue(rest, i, t);
      if (v != null) {
        flags.push(v);
        i++;
      }
    } else if (option == null) {
      const parsed = parsePickSpec(t);
      if (parsed.letter) {
        option = parsed.letter;
        if (parsed.downShape) flags.push('--down-shape', parsed.downShape);
      } else if (name == null) {
        name = t;
      } else {
        console.error(`Unexpected argument "${t}".`);
        process.exit(1);
      }
    } else {
      const down = downShapeFromShort(t);
      if (down && !flags.includes('--down-shape')) {
        flags.push('--down-shape', down);
      } else {
        console.error(`Unexpected argument "${t}".`);
        process.exit(1);
      }
    }
  }
  return { name, option, flags };
}

function resolveRoundName(explicitName, candidates, kind) {
  if (explicitName) {
    const resolved = resolveOrExit(explicitName, candidates, kind);
    writeCurrentRound(resolved);
    return resolved;
  }
  const stored = readCurrentRound();
  if (stored) {
    if (!candidates.includes(stored)) {
      console.error(
        `Current round "${stored}" is not available for this command. Name a round explicitly.`
      );
      process.exit(1);
    }
    console.log(`(current round: ${stored})`);
    return stored;
  }
  console.error(`No round name — name one explicitly (e.g. just parse story-6).`);
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
  let missingFit = 0;
  let hasPick = false;
  let pickSummary = null;
  const readPick = (jsonPath) => {
    try {
      const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
      if (Array.isArray(data.songs)) {
        missingScores = data.songs.filter((s) => s.needsUserInput).length;
        missingFit = data.songs.filter((s) => s.needsFitScore).length;
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
    missingFit,
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
  if (st.missingFit > 0) {
    const s = st.missingFit === 1 ? '' : 's';
    console.log(
      `  ⚠ ${st.missingFit} song${s} missing a fit signal — add a fit score, tier, or gate word and re-parse`
    );
  }
}

function runScript(scriptName, args) {
  const res = spawnSync('node', [join(SCRIPTS_DIR, scriptName), ...args], {
    stdio: 'inherit',
  });
  return res.status ?? 1;
}

function cmdMerge(explicitName, flags) {
  const base = resolveRoundName(explicitName, listAllRoundIds(), 'round');
  process.exit(runScript('merge-scores.mjs', [base, ...flags]));
}

function cmdPick(explicitName, option, flags) {
  const base = resolveRoundName(explicitName, listAllRoundIds(), 'round');
  if (!option) {
    console.error('Usage: ml pick [<name>] <A|B|C> [--reason "…"] [--pin …]');
    process.exit(1);
  }
  process.exit(runScript('pick-round.mjs', [base, option, ...flags]));
}

function cmdRescore(explicitName, flags) {
  const base = resolveRoundName(explicitName, listAllRoundIds(), 'round');
  process.exit(runScript('rescore-round.mjs', [base, ...flags]));
}

function cmdParse(explicitName, flags) {
  const base = resolveRoundName(explicitName, listRoundInputIds(), 'round');
  process.exit(runScript('parse-round.mjs', [inputPathFor(base), ...flags]));
}

function cmdFit(explicitName, flags) {
  const base = resolveRoundName(explicitName, listAllRoundIds(), 'round');
  const fitJson = fitPaths(base).json;
  if (!existsSync(fitJson)) {
    console.error(`No fit JSON at ${fitJson}.`);
    process.exit(1);
  }
  process.exit(
    runScript('render-fit-html.mjs', [fitJson, '--out', fitPaths(base).html, ...flags])
  );
}

function cmdScores(explicitName, flags) {
  const base = resolveRoundName(explicitName, listAllRoundIds(), 'round');
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

function cmdFinal(explicitName, flags) {
  const base = resolveRoundName(explicitName, listAllRoundIds(), 'round');
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

function cmdRun(explicitName, flags) {
  // Tidy first so artifacts generate under the dated name, then resolve against
  // the fresh listing. Archive runs after we know which round to keep active.
  applyDateSlugs({ log: console.log });
  const base = resolveRoundName(explicitName, listAllRoundIds(), 'round');
  archiveStaleRounds({ keep: new Set([base]), log: console.log });
  const st = pipelineState(base);
  const step = nextStep(st);

  switch (step.kind) {
    case 'parse':
      return process.exit(runScript('parse-round.mjs', [st.inputPath, ...flags]));
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
  const league = leagueForRound({ roundId: name, leagueName: readLeagueName(st.music.json) });
  if (league) console.log(`  League: ${league.names[0] || league.slugFamily}  (ml leagues ${league.id})`);
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
  const current = readCurrentRound();
  if (current) console.log(`Current round: ${current}\n`);
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
    const warnParts = [];
    if (st.missingScores > 0) warnParts.push(`${st.missingScores} missing score(s)`);
    if (st.missingFit > 0) warnParts.push(`${st.missingFit} missing fit`);
    const warn = warnParts.length ? `  ⚠ ${warnParts.join(', ')}` : '';
    console.log(`${marks}  ${name}  → ${step.label}${warn}`);
  }
}

/** Read the league name recorded in a round's music.json (null when absent). */
function readLeagueName(jsonPath) {
  try {
    return JSON.parse(readFileSync(jsonPath, 'utf8'))?.round?.league ?? null;
  } catch {
    return null;
  }
}

function cmdLeagues(query) {
  if (!query) {
    console.log('Recurring leagues (see spec/leagues.md):\n');
    for (const lg of LEAGUES) {
      console.log(`  ${lg.id.padEnd(12)} ${lg.slugFamily.padEnd(16)} ${lg.summary}`);
    }
    console.log('\nRun "ml leagues <name>" for reminders, scripts, and fit profiles.');
    return;
  }
  const q = query.trim().toLowerCase();
  const matches = LEAGUES.filter(
    (lg) =>
      lg.id.includes(q) ||
      lg.names.some((n) => n.toLowerCase().includes(q)) ||
      lg.slugFamily.toLowerCase().includes(q) ||
      (lg.slugPrefixes || []).some((p) => p && q.startsWith(p))
  );
  if (!matches.length) {
    console.error(`No league matches "${query}". Known: ${LEAGUES.map((l) => l.id).join(', ')}`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`"${query}" is ambiguous — matches: ${matches.map((l) => l.id).join(', ')}`);
    process.exit(1);
  }
  console.log(leagueDetailLines(matches[0]).join('\n'));
}

function usage() {
  cmdHelp(null);
}

function cmdHelp(topic) {
  const text = cmdHelpText(topic);
  if (text) {
    console.log(text);
    return;
  }
  console.error(`Unknown help topic "${topic}". Try: ${HELP_TOPICS.join(', ')}\n`);
  console.log(HELP.overview);
  process.exit(1);
}

function cmdConfig(rest) {
  const [key, value] = rest;
  if (!key) {
    const shown = formatConfigDisplay();
    console.log(`config file: ${shown.configFile}`);
    console.log(`cliCommentWidth: ${shown.cliCommentWidth}`);
    console.log('\nRun "ml help config" for options.');
    return;
  }
  if (key !== 'comment-width') {
    console.error(`Unknown config key "${key}". Supported: comment-width\n`);
    console.log(HELP.config);
    process.exit(1);
  }
  if (value == null) {
    console.log(formatConfigDisplay().cliCommentWidth);
    return;
  }
  if (value === 'auto' || value === 'unset') {
    writeMlConfig({ cliCommentWidth: null });
    console.log('cliCommentWidth → auto');
    return;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < DEFAULT_CLI_COMMENT_WIDTH) {
    console.error(`comment-width must be auto or an integer ≥ ${DEFAULT_CLI_COMMENT_WIDTH}.`);
    process.exit(1);
  }
  writeMlConfig({ cliCommentWidth: n });
  console.log(`cliCommentWidth → ${n}`);
}

function main() {
  const [, , cmd, ...rest] = process.argv;

  switch (cmd) {
    case 'parse': {
      const { name, flags } = splitRoundArgs(rest);
      return cmdParse(name, flags);
    }
    case 'merge': {
      const { name, flags } = splitRoundArgs(rest);
      return cmdMerge(name, flags);
    }
    case 'pick': {
      const { name, option, flags } = splitPickArgs(rest);
      return cmdPick(name, option, flags);
    }
    case 'rescore': {
      const { name, flags } = splitRoundArgs(rest);
      return cmdRescore(name, flags);
    }
    case 'fit': {
      const { name, flags } = splitRoundArgs(rest);
      return cmdFit(name, flags);
    }
    case 'scores': {
      const { name, flags } = splitRoundArgs(rest);
      return cmdScores(name, flags);
    }
    case 'final': {
      const { name, flags } = splitRoundArgs(rest);
      return cmdFinal(name, flags);
    }
    case 'run':
    case 'next': {
      const { name, flags } = splitRoundArgs(rest);
      return cmdRun(name, flags);
    }
    case 'status': {
      const { name } = splitRoundArgs(rest);
      return name
        ? cmdStatusOne(resolveRoundName(name, listAllRoundIds(), 'round'))
        : cmdStatusAll();
    }
    case 'tidy':
      return cmdTidy(rest);
    case 'leagues':
    case 'league': {
      const { name } = splitRoundArgs(rest);
      return cmdLeagues(name);
    }
    case 'config':
      return cmdConfig(rest);
    case 'help':
      return cmdHelp(rest[0]);
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
