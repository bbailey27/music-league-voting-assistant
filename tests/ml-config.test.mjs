import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  computeCliCommentWidth,
  formatConfigDisplay,
  readMlConfig,
  writeMlConfig,
  ML_CONFIG_FILE,
  DEFAULT_CLI_COMMENT_WIDTH,
} from '../scripts/ml-config.mjs';

test('computeCliCommentWidth fills remaining terminal width in auto mode', () => {
  const headers = ['#', 'Song', 'Score', 'Mod', 'A', 'B', 'C', 'Comment'];
  const rows = [['12', 'TUNNEL VISION', '77', '·', '2', '3', '2', 'great song']];
  const w = computeCliCommentWidth(headers, rows, { config: {}, terminalWidth: 120 });
  assert.ok(w > DEFAULT_CLI_COMMENT_WIDTH);
  assert.ok(w < 120);
});

test('computeCliCommentWidth respects a fixed preference cap', () => {
  const headers = ['#', 'Song', 'Score', 'Comment'];
  const rows = [['1', 'Song A', '80', 'note']];
  const w = computeCliCommentWidth(headers, rows, {
    config: { cliCommentWidth: 50 },
    terminalWidth: 160,
  });
  assert.equal(w, 50);
});

test('writeMlConfig persists and unsets keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ml-config-'));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    writeMlConfig({ cliCommentWidth: 80 });
    assert.equal(readMlConfig().cliCommentWidth, 80);
    writeMlConfig({ cliCommentWidth: null });
    assert.equal(readMlConfig().cliCommentWidth, undefined);
    assert.equal(readFileSync(ML_CONFIG_FILE, 'utf8'), '');
  } finally {
    process.chdir(prev);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('formatConfigDisplay shows auto when unset', () => {
  assert.deepEqual(formatConfigDisplay({}), {
    cliCommentWidth: 'auto',
    configFile: ML_CONFIG_FILE,
  });
});
