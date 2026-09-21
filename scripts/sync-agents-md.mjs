#!/usr/bin/env node
// Generate AGENTS.md from .cursor/rules/*.mdc — the "copy mechanism" that gives
// opencode (and any AGENTS.md-reading agent) the same behavioral rules Cursor
// injects. Source of truth: .cursor/rules/ . Regenerate with `just agents`.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rulesDir = join(root, '.cursor/rules');
const outPath = join(root, 'AGENTS.md');

function parseRule(text) {
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fm) return { description: '', alwaysApply: null, body: text };
  const meta = {};
  for (const m of fm[1].matchAll(/^(description|alwaysApply|globs):\s*(.*)$/gm)) {
    meta[m[1]] = m[2].trim();
  }
  return {
    description: meta.description || '',
    alwaysApply: meta.alwaysApply === 'true' ? true : meta.alwaysApply === 'false' ? false : null,
    body: text.slice(fm[0].length).trim() + '\n',
  };
}

// Links inside the rules are inconsistent about their base depth — authors wrote
// some targets from .cursor/ (`../scripts/...`) and some from .cursor/rules/
// (`../../spec/...`, sibling `plan-lifecycle.mdc`). Resolve defensively: try
// rulesDir, then the .cursor/ dir, then the repo root, and use the first base
// where the target actually exists. Target paths stay untouched as a fallback.
function rewriteLinks(body) {
  return body.replace(/\]\(([^)#]+)(#[^)]*)?\)/g, (full, target, hash) => {
    if (/^(https?:|mailto:)/.test(target)) return full;
    for (const base of [rulesDir, join(rulesDir, '..'), root]) {
      const resolved = relative(root, normalize(join(base, target))).split(sep).join('/');
      if (!resolved.startsWith('../') && existsSync(join(root, resolved))) {
        return `](./${resolved}${hash || ''})`;
      }
    }
    return full;
  });
}

const render = (rules, withDescription, noteUnmarked) =>
  rules
    .map((r) => {
      const head = [`### ${r.file}`];
      if (withDescription && r.description) head.push('', `*${r.description}*`);
      if (noteUnmarked && r.description === '' && r.alwaysApply === null) {
        head.push('', '(No frontmatter — Cursor does not load this rule; kept here for reference.)');
      }
      head.push('', rewriteLinks(r.body));
      return head.join('\n');
    })
    .join('\n\n');

const files = (await readdir(rulesDir)).filter((f) => f.endsWith('.mdc')).sort();
const rules = [];
for (const f of files) {
  const text = await readFile(join(rulesDir, f), 'utf8');
  rules.push({ file: f, ...parseRule(text) });
  const r = rules[rules.length - 1];
  if (r.description === '' && r.alwaysApply === null) {
    console.error(`warning: ${f} has no frontmatter — Cursor may not load it`);
  }
}

const unmarked = (r) => r.description === '' && r.alwaysApply === null;
const always = rules.filter((r) => r.alwaysApply !== false && !unmarked(r));
const situational = rules.filter((r) => r.alwaysApply === false && !unmarked(r));
const orphaned = rules.filter(unmarked);

const doc = [
  '<!-- GENERATED FILE — do not edit by hand. Source: .cursor/rules/*.mdc — regenerate with: `just agents` -->',
  '',
  '# AGENTS.md',
  '',
  'Behavioral rules for agents working in this repo, synced verbatim from',
  '[`.cursor/rules/`](./.cursor/rules) so Cursor and AGENTS.md-reading tools (opencode, etc.)',
  'stay in agreement. Edit rules there, then run `just agents` (or: add/edit a rule and run',
  'any `just` command — `just lint` fails with a reminder if AGENTS.md is stale).',
  '',
  'Orientation:',
  '',
  '- Pipeline runs through [justfile](./justfile) (`just run <round>`, `just status`); stack: Node ESM scripts, no web framework.',
  '- Tests: `npm test` (node:test). Lint: `just lint` / `just fix`. Public repo — round data and personal lists live in the private `data/` submodule, never commit them here.',
  '- Durable specs live in [spec/](./spec); decision history in [spec/decisions.md](./spec/decisions.md).',
  '- After editing or adding any [.cursor/rules/](./.cursor/rules) rule, run `just agents` to regenerate this file before finishing.',
  '',
  `## Always-applied rules (${always.length})`,
  '',
  render(always, true, false),
  '',
  `## Situational rules (${situational.length}) — apply when the description matches the task`,
  '',
  render(situational, true, false),
  '',
  ...(orphaned.length ? [`## Rules without frontmatter (${orphaned.length})`, '', render(orphaned, false, true)] : []),
].join('\n') + '\n';

// `--check`: verify AGENTS.md is current instead of rewriting it; used by `just
// lint` so a stale sync surfaces on the first lint after a rule edit.
if (process.argv.includes('--check')) {
  const current = await readFile(outPath, 'utf8').catch(() => null);
  if (current === doc) {
    console.log('AGENTS.md is up to date');
  } else {
    console.error('AGENTS.md is stale — rules changed since the last `just agents`. Run: just agents');
    process.exit(1);
  }
} else {
  await writeFile(outPath, doc);
  console.log(`Synced ${rules.length} rules → AGENTS.md`);
}
