// Module-load smoke for scripts/cli-help.mjs — this file is imported by every
// command (help output + banner wording), so a syntax error there breaks the
// whole pipeline. A load + keys check catches it before `just run` does.
// (Real case: 2026-11-05 — backticks inside a template literal killed all
// commands; eslint caught it but tests didn't because nothing imported it.)
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('cli-help.mjs loads and exposes every documented command topic', async () => {
  const mod = await import('../scripts/cli-help.mjs');
  const required = [
    'overview', 'save-round', 'parse', 'merge', 'pick', 'rescore',
    'final', 'fit', 'scores', 'pin', 'flags', 'tidy', 'config', 'leagues',
  ];
  for (const topic of required) {
    assert.ok(typeof mod.HELP?.[topic] === 'string', `missing HELP topic: ${topic}`);
    assert.ok(mod.HELP[topic].length > 0, `empty HELP topic: ${topic}`);
  }
});
