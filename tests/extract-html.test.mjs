// Tests for the DOM extractor, including recovery of round markup that a
// rich-text editor double-wrapped (View Source pasted into TextEdit/Notes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseHTML } from 'linkedom';
import { parseRoundDocument, recoverEscapedSource } from '../scripts/extract-html.mjs';
import { buildMarkdown } from '../scripts/score-core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'regressions', name), 'utf8');

test('recoverEscapedSource rebuilds round markup from a Cocoa View-Source paste', () => {
  const { document } = parseHTML(fixture('cocoa-viewsource-wrapper.html'));

  // The wrapper itself has no song nodes — extraction must come up empty first.
  assert.equal(parseRoundDocument(document, 'objective').songs.length, 0);

  const recovered = recoverEscapedSource(document);
  assert.ok(recovered, 'expected recovered source string');

  const { document: recoveredDoc } = parseHTML(recovered);
  const parsed = parseRoundDocument(recoveredDoc, 'objective');

  assert.equal(parsed.budget.upvoteBankSize, 10);
  assert.equal(parsed.budget.maxUpvotesPerSong, 5);
  assert.equal(parsed.songs.length, 2);
  assert.deepEqual(
    parsed.songs.map((s) => s.title),
    ['First Track', 'Second Track']
  );
  assert.equal(parsed.songs[0].score, 64);
  assert.equal(parsed.songs[0].spotifyUri, 'spotify:track:AAA');
  assert.equal(parsed.songs[1].score, 80);
});

test('the user\u2019s own submission is recorded (not scored) so its raw index is visible', () => {
  const { document } = parseHTML(fixture('cocoa-viewsource-wrapper.html'));
  const recovered = recoverEscapedSource(document);
  const { document: recoveredDoc } = parseHTML(recovered);
  const parsed = parseRoundDocument(recoveredDoc, 'objective');

  // Own song stays out of the scored list but is captured in ownSongs.
  assert.equal(parsed.ownSkipped, 1);
  assert.equal(parsed.songs.length, 2);
  assert.equal(parsed.ownSongs.length, 1);
  assert.equal(parsed.ownSongs[0].title, 'My Own Track');
  assert.equal(parsed.ownSongs[0].rawOrderIndex, 2);
  assert.equal(parsed.ownSongs[0].isOwn, true);

  // The raw-order table interleaves the own song at its index so the ballot can't
  // be misaligned by an invisible gap.
  const md = buildMarkdown({ ...parsed, mode: 'objective', tradeoffs: [] });
  const rawOrder = md.split('## Raw order')[1];
  assert.match(rawOrder, /\|\s*2\s*\|\s*My Own Track\s*\|.*your song/);
});

test('recoverEscapedSource returns null for an ordinary saved round', () => {
  const { document } = parseHTML('<html><body><div class="song" id="song-0"></div></body></html>');
  assert.equal(recoverEscapedSource(document), null);
});
