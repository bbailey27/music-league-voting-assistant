import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseWikiReleased,
  resolveGate,
  wikiSearchUrl,
  wikiTitleArtist,
  yearOf,
} from '../scripts/release-year-gate.mjs';

test('yearOf: extracts calendar year from ISO dates', () => {
  assert.equal(yearOf('2023-04-24'), 2023);
  assert.equal(yearOf('2023'), 2023);
  assert.equal(yearOf(null), null);
});

test('parseWikiReleased: common infobox released formats', () => {
  assert.equal(parseWikiReleased('April 24, 2023'), '2023-04-24');
  assert.equal(parseWikiReleased('24 April 2023'), '2023-04-24');
  assert.equal(parseWikiReleased('2023'), '2023');
  assert.equal(parseWikiReleased('{{Start date|2023|7|10}}'), '2023-07-10');
});

test('resolveGate: maybe when unverified or missing', () => {
  assert.equal(resolveGate({ earliestReleaseDate: '2023-04-24', confidence: 'verified', earliestSource: 'https://en.wikipedia.org/wiki/Foo' }, 2023), 'pass');
  assert.equal(resolveGate({ earliestReleaseDate: '2022-01-01', confidence: 'verified', earliestSource: 'https://en.wikipedia.org/wiki/Foo', note: 'MusicBrainz 2022; Wikipedia 2022 — both off-year.' }, 2023), 'fail');
  assert.equal(resolveGate({ earliestReleaseDate: '2024-04-29', confidence: 'verified', earliestSource: 'https://musicbrainz.org/recording/x' }, 2023), 'maybe');
  assert.equal(resolveGate({ earliestReleaseDate: '2023-04-24', confidence: 'needs-review' }, 2023), 'maybe');
  assert.equal(resolveGate({ earliestReleaseDate: null }, 2023), 'maybe');
  assert.equal(resolveGate({ earliestReleaseDate: '2023', confidence: 'fuzzy' }, 2023), 'maybe');
});

test('wikiTitleArtist: strips feat and version suffixes', () => {
  assert.deepEqual(wikiTitleArtist('Seven (feat. Latto) (Clean Ver.)', 'Jung Kook, Latto'), {
    cleanTitle: 'Seven',
    cleanArtist: 'Jung Kook',
  });
  assert.deepEqual(wikiTitleArtist('BOUNCY (K-HOT CHILLI PEPPERS)', 'ATEEZ'), {
    cleanTitle: 'BOUNCY',
    cleanArtist: 'ATEEZ',
  });
});

test('wikiSearchUrl: builds a human check link', () => {
  assert.match(wikiSearchUrl('Super', 'SEVENTEEN'), /wikipedia\.org.*Super.*SEVENTEEN/);
});
