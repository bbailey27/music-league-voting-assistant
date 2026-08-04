import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LEAGUES,
  leagueByName,
  leagueBySlug,
  leagueForRound,
  resolveScriptCmd,
  leagueNotesLines,
  leagueDetailLines,
} from '../scripts/leagues.mjs';

test('leagues: every descriptor has the required shape', () => {
  const ids = new Set();
  for (const lg of LEAGUES) {
    assert.ok(lg.id && !ids.has(lg.id), `unique id: ${lg.id}`);
    ids.add(lg.id);
    assert.ok(Array.isArray(lg.names));
    assert.ok(lg.slugFamily);
    assert.ok(Array.isArray(lg.slugPrefixes));
    assert.ok(['objective', 'thematic'].includes(lg.mode));
    assert.ok(lg.summary);
  }
});

test('leagues: resolve by exact league name (case-insensitive)', () => {
  assert.equal(leagueByName('Kpop Boy Group Years')?.id, 'bg-years');
  assert.equal(leagueByName('kpop boy group years')?.id, 'bg-years');
  assert.equal(leagueByName('Chill Western Astrology League')?.id, 'astrology');
  assert.equal(leagueByName('Not A Real League'), null);
  assert.equal(leagueByName(null), null);
});

test('leagues: resolve by round slug prefix', () => {
  assert.equal(leagueBySlug('2026-07-15-bg-2018')?.id, 'bg-years');
  assert.equal(leagueBySlug('bg-2018')?.id, 'bg-years');
  assert.equal(leagueBySlug('2026-07-14-story-9')?.id, 'story-chain');
  assert.equal(leagueBySlug('2026-06-09-tarot-hanged-man')?.id, 'tarot');
  assert.equal(leagueBySlug('2026-06-18-lfm-new')?.id, 'lastfm');
  assert.equal(leagueBySlug('2026-06-30-aaa-east')?.id, 'aaa');
  assert.equal(leagueBySlug('kpop-ost')?.id, 'kpop-themed');
  assert.equal(leagueBySlug('2026-01-01-mystery-round'), null);
});

test('leagues: name wins over slug, slug is the fallback', () => {
  // A bg round whose name is present resolves via name even if slug were ambiguous.
  assert.equal(
    leagueForRound({ roundId: '2026-07-15-bg-2018', leagueName: 'Kpop Boy Group Years' })?.id,
    'bg-years'
  );
  // No name → slug fallback.
  assert.equal(leagueForRound({ roundId: '2026-07-14-story-9' })?.id, 'story-chain');
  // Neither → null.
  assert.equal(leagueForRound({ roundId: 'x-unknown' }), null);
});

test('leagues: bg-years carries the standing DQ + release-year reminders', () => {
  const bg = leagueByName('Kpop Boy Group Years');
  const remindersText = bg.reminders.join(' ');
  assert.match(remindersText, /girl-group/i);
  assert.match(remindersText, /male soloists/i);
  assert.match(remindersText, /subunits/i);
  assert.match(remindersText, /co-ed/i);
  assert.match(remindersText, /AKMU/i);
  assert.doesNotMatch(remindersText, /male-female collab/i);
  assert.match(remindersText, /version-earliest/i);
});

test('resolveScriptCmd: fills <round> and derives <year> from a bg-YYYY slug', () => {
  const cmd = 'node scripts/release-year-gate.mjs <round> --year <year> [--fetch]';
  assert.equal(
    resolveScriptCmd(cmd, { roundId: '2026-07-15-bg-2018' }),
    'node scripts/release-year-gate.mjs 2026-07-15-bg-2018 --year 2018 [--fetch]'
  );
  // No round id: template unchanged.
  assert.equal(resolveScriptCmd(cmd, {}), cmd);
  // Non-year slug: <round> filled, <year> left as-is.
  assert.equal(
    resolveScriptCmd('x <round> <year>', { roundId: 'story-9' }),
    'x story-9 <year>'
  );
});

test('leagueNotesLines: null league → empty; bg round → label, reminders, scripts, ref', () => {
  assert.deepEqual(leagueNotesLines(null), []);
  const lines = leagueNotesLines(leagueByName('Kpop Boy Group Years'), {
    roundId: '2026-07-15-bg-2018',
  });
  assert.match(lines[0], /^League: Kpop Boy Group Years/);
  assert.ok(lines.some((l) => l.includes('girl-group')));
  assert.ok(lines.some((l) => l.includes('co-ed')));
  assert.ok(lines.some((l) => l.includes('male soloists')));
  assert.ok(lines.some((l) => l.includes('--year 2018')));
  assert.equal(lines.at(-1), '  See: spec/leagues.md');
});

test('leagueDetailLines: includes id header and section labels', () => {
  const lines = leagueDetailLines(leagueByName('Kpop Boy Group Years'));
  const text = lines.join('\n');
  assert.match(lines[0], /^bg-years {2}\(bg-<year>, objective\)/);
  assert.match(text, /Reminders:/);
  assert.match(text, /Scripts:/);
  assert.deepEqual(leagueDetailLines(null), []);
});
