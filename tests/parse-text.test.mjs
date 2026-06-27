// Regression tests for the footer-anchored lenient (Live Text) text parser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseRoundText } from '../scripts/parse-text.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'regressions', name), 'utf8');

test('lenient parser anchors on the N/1000 footer (Live Text K-pop sample)', () => {
  const parsed = parseRoundText(fixture('livetext-kpop-group.txt'), 'subjective');

  // Budget survives the noisy "00 OF 10 %" header line.
  assert.equal(parsed.budget.upvoteBankSize, 10);

  // Seven songs recovered (six with footers + the cut-off trailing one).
  assert.equal(parsed.songs.length, 7);

  const byTitle = (t) => parsed.songs.find((s) => s.title === t);

  // Footer-count checksum picks the right comment line.
  assert.equal(byTitle('Gashina').userComment, 'Test'); // 4/1000
  assert.equal(byTitle('QUINTESSENCE').userComment, '67 fake score'); // 13/1000
  assert.equal(byTitle('QUINTESSENCE').score, 67);

  // "7-?" -> 70 with minus; ? qualifies the minus, not the score.
  const maria = byTitle('María');
  assert.equal(maria.userComment, '7-?');
  assert.equal(maria.score, 70);
  assert.equal(maria.minus, true);
  assert.equal(maria.minusUncertain, true);
  assert.equal(maria.uncertain, false);

  // Empty boxes (0/1000 + "What did you think about this song?") -> needs input.
  assert.equal(byTitle('MOVE').userComment, '');
  assert.equal(byTitle('MOVE').needsUserInput, true);
  assert.equal(byTitle('Any song').needsUserInput, true);

  // All-caps "TODO" placeholder comment is also flagged for input.
  const killThisLove = byTitle('Kill This Love');
  assert.equal(killThisLove.userComment, 'TODO');
  assert.equal(killThisLove.needsUserInput, true);
  assert.equal(killThisLove.score, null);

  // Trailing song whose footer was cut off is still recovered.
  const tito = byTitle('TITO');
  assert.ok(tito, 'cut-off trailing song recovered');
  assert.equal(tito.needsUserInput, true);

  // Every lenient row is flagged for review.
  for (const s of parsed.songs) assert.equal(s.needsReview, true);
});
