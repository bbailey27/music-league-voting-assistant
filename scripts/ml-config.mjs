// Local CLI preferences (`.ml-config.json` at repo root; gitignored).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { displayWidth } from './text-width.mjs';

export const ML_CONFIG_FILE = '.ml-config.json';
export const DEFAULT_CLI_COMMENT_WIDTH = 28;
export const CLI_TABLE_INDENT = 4;

export function readMlConfig() {
  if (!existsSync(ML_CONFIG_FILE)) return {};
  try {
    const data = JSON.parse(readFileSync(ML_CONFIG_FILE, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export function writeMlConfig(updates) {
  const next = { ...readMlConfig(), ...updates };
  for (const k of Object.keys(next)) {
    if (next[k] == null) delete next[k];
  }
  if (Object.keys(next).length) {
    writeFileSync(ML_CONFIG_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  } else if (existsSync(ML_CONFIG_FILE)) {
    writeFileSync(ML_CONFIG_FILE, '', 'utf8');
  }
}

export function terminalColumns() {
  const cols = process.stdout.columns;
  return typeof cols === 'number' && cols > 0 ? cols : 80;
}

/** Comment column width: auto fills terminal; fixed caps at preference when wider. */
export function computeCliCommentWidth(headers, rows, opts = {}) {
  const config = opts.config ?? readMlConfig();
  const term = opts.terminalWidth ?? terminalColumns();
  const commentIdx = headers.indexOf('Comment');
  if (commentIdx < 0) return DEFAULT_CLI_COMMENT_WIDTH;

  const all = [headers, ...rows];
  const gutter = (headers.length - 1) * 2;
  let fixed = gutter + CLI_TABLE_INDENT;
  for (let i = 0; i < headers.length; i++) {
    if (i === commentIdx) continue;
    fixed += Math.max(...all.map((r) => displayWidth(r[i] ?? '')));
  }

  const available = Math.max(DEFAULT_CLI_COMMENT_WIDTH, term - fixed);
  const pref = config.cliCommentWidth;
  if (pref == null || pref === 'auto') return available;
  const n = Number(pref);
  if (!Number.isFinite(n) || n < DEFAULT_CLI_COMMENT_WIDTH) return DEFAULT_CLI_COMMENT_WIDTH;
  return Math.min(n, available);
}

export function formatConfigDisplay(config = readMlConfig()) {
  const w = config.cliCommentWidth;
  return {
    cliCommentWidth: w == null ? 'auto' : w,
    configFile: ML_CONFIG_FILE,
  };
}
