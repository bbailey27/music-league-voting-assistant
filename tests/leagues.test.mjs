// Engine tests — facts live in a generic fixture (real registry: data/ref/leagues.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  leagueByName,
  leagueBySlug,
  leagueForRound,
  resolveScriptCmd,
  leagueNotesLines,
  leagueDetailLines,
  leagueSlugActivity,
  loadLeagueRegistry,
  upsertPlainLeague,
  deriveFamilyPrefix,
  rekeyPlainLeague,
  updateLeagueSlugs,
  mergeRoundIntoLeague,
} from '../scripts/leagues.mjs';
import { relatedExactFamilies } from '../scripts/save-round.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, 'fixtures', 'leagues-registry.json');
const execFileP = promisify(execFile);
const root = join(here, '..');

function withFixture() {
  process.env.ML_LEAGUES_JSON = FIXTURE;
}

test('fixture registry loads and every descriptor has the required shape', () => {
  withFixture();
  const leagues = loadLeagueRegistry();
  assert.equal(leagues.length, 3);
  const ids = new Set();
  for (const lg of leagues) {
    assert.ok(lg.id && !ids.has(lg.id), `unique id: ${lg.id}`);
    ids.add(lg.id);
    assert.ok(Array.isArray(lg.names));
    assert.ok(lg.slugFamily);
    assert.ok(Array.isArray(lg.slugPrefixes));
    assert.ok(['objective', 'thematic', null].includes(lg.mode));
  }
});

test('matching: by name, by slug prefix, and combined resolution', () => {
  withFixture();
  assert.equal(leagueByName('example series one').id, 'alpha-years');
  assert.equal(leagueBySlug('2026-07-15-alpha-2018').id, 'alpha-years');
  assert.equal(leagueForRound({ leagueName: 'no-such-league' }), null);
  assert.equal(leagueForRound({ roundId: 'unregistered-slug' }), null, 'unregistered slugs stay unclaimed');
  assert.equal(leagueForRound({ roundId: '2026-07-15-beta-x' }).id, 'beta-themed');
});

test('matching: equal-length prefix ties go to the last-listed (newest) family', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'ml-tie-'));
  const file = join(tmp, 'leagues.json');
  process.env.ML_LEAGUES_JSON = file;
  const mk = (order) => JSON.stringify({
    version: 1,
    leagues: order.map((id) => ({
      id,
      names: [],
      slugFamily: `${id}-<topic>`,
      slugPrefixes: ['tie-'],
      mode: null,
      summary: 'Auto-registered plain league.',
    })),
  }, null, 2);
  try {
    await mkdir(tmp, { recursive: true });
    await writeFile(file, mk(['tie-old', 'tie-new']));
    assert.equal(leagueBySlug('2026-10-21-tie-a').id, 'tie-new');
    await writeFile(file, mk(['tie-new', 'tie-old']));
    assert.equal(leagueBySlug('2026-10-21-tie-a').id, 'tie-old', 'position in the file, not the name, decides the tie');
  } finally {
    delete process.env.ML_LEAGUES_JSON;
    await rm(tmp, { recursive: true, force: true });
  }
});

test('matching: most-specific prefix wins over a broader overlapping family', () => {
  withFixture();
  assert.equal(leagueBySlug('2026-07-15-alpha-constraints-b-sides').id, 'alpha-constraints');
  assert.equal(leagueBySlug('2026-07-15-alpha-constraints-x').id, 'alpha-constraints');
  assert.equal(leagueBySlug('2026-07-15-alpha-other').id, 'alpha-years', 'non-constraint slugs stay on the broad family');
  assert.equal(leagueBySlug('alpha-constraints-gala').id, 'alpha-constraints', 'undated ids still resolve');
  assert.equal(leagueBySlug('alpha-constraints').id, 'alpha-years', 'a bare token missing the family dash falls to the broad prefix');
});

test('resolveScriptCmd fills <round> and derives <year>', () => {
  assert.equal(
    resolveScriptCmd('echo example <round> --year <year>', { roundId: '2026-07-15-alpha-2018' }),
    'echo example 2026-07-15-alpha-2018 --year 2018'
  );
  assert.equal(resolveScriptCmd('x <round> <year>', {}), 'x <round> <year>');
});

test('banner lines: label, reminder, script, spec pointer', () => {
  withFixture();
  const alpha = leagueByName('Example Series One');
  const lines = leagueNotesLines(alpha, { roundId: '2026-07-15-alpha-2018' });
  assert.match(lines[0], /^League: Example Series One/);
  assert.ok(lines.some((l) => l.includes('Example standing reminder')));
  assert.ok(lines.some((l) => l.includes('--year 2018')));
  assert.equal(lines.at(-1), '  See: spec/leagues.md');
  assert.deepEqual(leagueNotesLines(null), []);
});

test('detail lines include the id header and sections', () => {
  withFixture();
  const lines = leagueDetailLines(leagueByName('Example Series One'));
  assert.match(lines[0], /^alpha-years {2}\(alpha-<year>, objective\)/);
  assert.ok(lines.join('\n').includes('Reminders:'));
  assert.deepEqual(leagueDetailLines(null), []);
});

test('slug activity: active window, previous-first recent[] order, unregistered ignored', () => {
  withFixture();
  const now = new Date(2026, 9, 22, 9, 0);
  const ids = [
    '2026-10-11-alpha-halloween',
    '2026-10-20-alpha-curses',
    '2026-10-19-alpha-paint',
    '2026-10-22-beta-fresh',
    '2026-10-22-alpha-constraints-badge',
    'story-9',
  ];
  const act = leagueSlugActivity(ids, { now });
  const byId = Object.fromEntries(act.map((a) => [a.league.id, a]));
  assert.equal(byId['alpha-years'].latest.bare, 'alpha-curses');
  assert.equal(byId['alpha-years'].ageDays, 2);
  assert.equal(byId['alpha-years'].active, true);
  assert.deepEqual(
    byId['alpha-years'].recent.map((r) => r.bare),
    ['alpha-curses', 'alpha-paint', 'alpha-halloween']
  );
  assert.equal(byId['beta-themed'].latest.bare, 'beta-fresh');
  assert.equal(byId['beta-themed'].active, true);
  assert.equal(byId['alpha-constraints'].latest.bare, 'alpha-constraints-badge', 'activity picks the owning family');
  assert.ok(
    !byId['alpha-years'].recent.some((r) => r.bare === 'alpha-constraints-badge'),
    'broad family must not re-claim the narrower league rounds in its recency'
  );
});

test('matching: exact-slug families own one-off leagues without claiming the broad tree', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'ml-exact-'));
  const file = join(tmp, 'leagues.json');
  process.env.ML_LEAGUES_JSON = file;
  try {
    await mkdir(tmp, { recursive: true });
    await writeFile(file, JSON.stringify({
      version: 1,
      leagues: [
        { id: 'one-off', names: [], slugFamily: 'group-one', slugPrefixes: ['group-one'], mode: null, summary: 'One-round family.' },
        { id: 'group', names: [], slugFamily: 'group-<topic>', slugPrefixes: ['group-'], mode: null, summary: 'Open token family.' },
      ],
    }, null, 2));
    assert.equal(leagueBySlug('2026-10-30-group-one').id, 'one-off', 'the exact family owns its saved slug');
    assert.equal(leagueBySlug('2026-10-30-group-two').id, 'group', 'other slugs stay on the open family');
    assert.equal(leagueBySlug('2026-10-30-group-one-covers').id, 'one-off', 'same-league sub-slugs ride the exact prefix');
  } finally {
    delete process.env.ML_LEAGUES_JSON;
    await rm(tmp, { recursive: true, force: true });
  }
});

test('deriveFamilyPrefix takes the first dash token; single-token slugs exact-match', () => {
  assert.equal(deriveFamilyPrefix('2026-10-20-vim-26-mar'), 'vim-');
  assert.equal(deriveFamilyPrefix('2026-09-22-sm-bside'), 'sm-');
  assert.equal(deriveFamilyPrefix('2026-05-09-pride'), 'pride-');
});

test('upsertPlainLeague: unknown official name registers; repeat parses are idempotent', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'ml-plain-'));
  const file = join(tmp, 'leagues.json');
  process.env.ML_LEAGUES_JSON = file;
  const now = { roundId: '2026-10-20-vim-26-mar', leagueName: 'Sample Plain League' };
  try {
    const first = upsertPlainLeague({ roundId: now.roundId, leagueName: null });
    assert.equal(first.added, true, 'save-time entry registers nameless immediately (file auto-created)');
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(saved.leagues.filter((l) => (l.names || []).length === 0).length, 1, 'one nameless family entry');
    assert.deepEqual(saved.leagues[0].slugPrefixes, ['vim-26-mar'], 'unknown league registers a 1-round (exact-slug) family');
    assert.equal(saved.leagues[0].slugFamily, 'vim-26-mar');

    const byParse = upsertPlainLeague({ roundId: now.roundId, leagueName: now.leagueName, mode: 'objective' });
    assert.equal(byParse.added, false, 'parse fills the existing nameless entry instead of a duplicate');
    const savedAfterName = JSON.parse(await readFile(file, 'utf8'));
    const entry = savedAfterName.leagues.find((l) => (l.names || []).includes('Sample Plain League'));
    assert.ok(entry, 'official name landed on the same family entry');
    assert.equal(entry.mode, 'objective');
    assert.deepEqual(entry.slugPrefixes, ['vim-26-mar'], 'name-proof parse of the same round touches nothing');
    assert.deepEqual(entry.reminders, []);

    const second = upsertPlainLeague({ roundId: now.roundId, leagueName: now.leagueName, mode: 'objective' });
    assert.equal(second.added, false, 'covered-name after registration');
    const saved2 = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(saved2.leagues.filter((l) => (l.names || []).includes('Sample Plain League')).length, 1, 'no duplicate rows');
  } finally {
    delete process.env.ML_LEAGUES_JSON;
    await rm(tmp, { recursive: true, force: true });
  }
});

test('upsertPlainLeague: covered-by-slug uses the most-specific family', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'ml-plain-specific-'));
  const file = join(tmp, 'leagues.json');
  process.env.ML_LEAGUES_JSON = file;
  try {
    await copyFile(join(here, 'fixtures', 'leagues-registry.json'), file);
    const res = upsertPlainLeague({
      roundId: '2026-10-21-alpha-constraints-round',
      leagueName: 'Fresh Constraints League',
      mode: 'objective',
    });
    assert.equal(res.added, false, 'the narrow family claims the slug, no new descriptor');
    const saved = JSON.parse(await readFile(file, 'utf8'));
    const narrow = saved.leagues.find((l) => l.id === 'alpha-constraints');
    const broad = saved.leagues.find((l) => l.id === 'alpha-years');
    assert.ok(narrow.names.includes('Fresh Constraints League'), 'name lands on the owning family');
    assert.ok(!broad.names.includes('Fresh Constraints League'), 'broad family untouched');
  } finally {
    delete process.env.ML_LEAGUES_JSON;
    await rm(tmp, { recursive: true, force: true });
  }
});

test('upsertPlainLeague: a nameless family matches future rounds of the same prefix', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'ml-plain-prefix-'));
  const file = join(tmp, 'leagues.json');
  process.env.ML_LEAGUES_JSON = file;
  try {
    const a = upsertPlainLeague({ roundId: '2026-10-12-sample-a', leagueName: 'Some League X' });
    assert.equal(a.added, true);
    const mid = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(mid.leagues[0].slugPrefixes, ['sample-a'], '1-round family first');
    const b = upsertPlainLeague({ roundId: '2026-10-13-sample-b', leagueName: 'Some League X' });
    assert.equal(b.added, false, 'covered-name now (prefix registration was the earlier one)');
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(saved.leagues.filter((l) => (l.names || []).includes('Some League X')).length, 1);
    assert.deepEqual(
      saved.leagues[0].slugPrefixes,
      ['sample-'],
      'official-name proof widens the 1-round family to the common token prefix'
    );
    assert.equal(saved.leagues[0].slugFamily, 'sample-<topic>');
    const c = upsertPlainLeague({ roundId: '2026-10-14-sample-c', leagueName: 'Some League X' });
    assert.equal(c.added, false, 'third round is plain covered-name');
    const final = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(final.leagues[0].slugPrefixes, ['sample-'], 'owned rounds do not re-shape the family');
  } finally {
    delete process.env.ML_LEAGUES_JSON;
    await rm(tmp, { recursive: true, force: true });
  }
});

test('mergeRoundIntoLeague: token-anchored families take sibling exact slugs, never widen below the anchor', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'ml-anchor-'));
  const file = join(tmp, 'leagues.json');
  process.env.ML_LEAGUES_JSON = file;
  try {
    await mkdir(tmp, { recursive: true });
    await writeFile(file, JSON.stringify({
      version: 1,
      leagues: [{
        id: 'anchored',
        names: [],
        slugFamily: 'group-constraints-<topic>',
        slugPrefixes: ['group-constraints-'],
        mode: null,
        summary: 'x',
      }],
    }, null, 2));
    const res = mergeRoundIntoLeague('anchored', '2026-10-30-group-free-1');
    assert.equal(res.merged, true);
    assert.deepEqual(
      res.entry.slugPrefixes,
      ['group-constraints-', 'group-free-1'],
      'anchor preserved; sibling joins as its own exact slug'
    );
    assert.equal(res.entry.slugFamily, 'group-constraints-<topic>', 'shape unchanged');
  } finally {
    delete process.env.ML_LEAGUES_JSON;
    await rm(tmp, { recursive: true, force: true });
  }
});

test('upsertPlainLeague: forceFresh + freshPrefix stakes an owner-chosen family root', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'ml-root-'));
  const file = join(tmp, 'leagues.json');
  process.env.ML_LEAGUES_JSON = file;
  try {
    const res = upsertPlainLeague({
      roundId: '2026-10-30-kpop-test-run',
      leagueName: 'Sample Rooted League',
      forceFresh: true,
      freshPrefix: 'kpop-test-',
    });
    assert.equal(res.added, true);
    assert.equal(res.descriptor.slugFamily, 'kpop-test-<topic>', 'root declared at save becomes a series family');
    assert.deepEqual(res.descriptor.slugPrefixes, ['kpop-test-']);
    assert.equal(leagueBySlug('2026-11-02-kpop-test-gala')?.id, 'kpop-test-plain', 'later rounds of the staked root resolve to it');
  } finally {
    delete process.env.ML_LEAGUES_JSON;
    await rm(tmp, { recursive: true, force: true });
  }
});

test('relatedExactFamilies: any family sharing the first token is a merge candidate', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'ml-related-'));
  const file = join(tmp, 'leagues.json');
  process.env.ML_LEAGUES_JSON = file;
  try {
    await mkdir(tmp, { recursive: true });
    await writeFile(file, JSON.stringify({
      version: 1,
      leagues: [
        { id: 'one', names: [], slugFamily: 'group-one', slugPrefixes: ['group-one'], mode: null, summary: 'x' },
        { id: 'booster', names: [], slugFamily: 'group-<topic>', slugPrefixes: ['group-'], mode: null, summary: 'x' },
        { id: 'elsewhere', names: [], slugFamily: 'halloween-kpop', slugPrefixes: ['halloween-kpop'], mode: null, summary: 'x' },
      ],
    }, null, 2));
    const rel = relatedExactFamilies('2026-10-31-group-two-cats', loadLeagueRegistry()).map((l) => l.id);
    assert.deepEqual(rel, ['one', 'booster'], '1-round and token families alike are candidates, other trees are not');
    assert.deepEqual(
      relatedExactFamilies('2026-10-31-unknown-league', loadLeagueRegistry()),
      [],
      'no candidate when no family shares the first token'
    );
  } finally {
    delete process.env.ML_LEAGUES_JSON;
    await rm(tmp, { recursive: true, force: true });
  }
});

test('mergeRoundIntoLeague: owner-confirmed sibling folds a 1-round family wider', async () => {  const tmp = await mkdtemp(join(tmpdir(), 'ml-merge-'));
  const file = join(tmp, 'leagues.json');
  process.env.ML_LEAGUES_JSON = file;
  try {
    await mkdir(tmp, { recursive: true });
    await writeFile(file, JSON.stringify({
      version: 1,
      leagues: [{
        id: 'one-off',
        names: ['Sample One-Off'],
        slugFamily: 'group-one',
        slugPrefixes: ['group-one'],
        mode: 'thematic',
        summary: 'Auto-registered plain league.',
      }],
    }, null, 2));
    const noop = mergeRoundIntoLeague('one-off', '2026-10-30-group-one-covers');
    assert.equal(noop.merged, false, 'exact prefix already claims its own sub-slugs — nothing to change');
    assert.deepEqual(noop.entry.slugPrefixes, ['group-one']);

    const sibling = mergeRoundIntoLeague('one-off', '2026-10-31-group-two-cats');
    assert.equal(sibling.merged, true, 'confirmed sibling folds in');
    assert.equal(sibling.upgraded, true, 'family widens to the common token run');
    assert.equal(sibling.entry.slugFamily, 'group-<topic>');
    assert.deepEqual(sibling.entry.slugPrefixes, ['group-']);

    const stray = mergeRoundIntoLeague('one-off', '2026-11-01-cross-tree-other');
    assert.ok(stray.merged, 'still records the round');
    assert.deepEqual(
      stray.entry.slugPrefixes,
      ['group-', 'cross-tree-other'],
      'no common token run → exact-slug add, no broad first-token prefix'
    );
  } finally {
    delete process.env.ML_LEAGUES_JSON;
    await rm(tmp, { recursive: true, force: true });
  }
});

test('corrupt registry fails soft: empty engine, single warning, no command crash', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'ml-corrupt-'));
  const file = join(tmp, 'leagues.json');
  process.env.ML_LEAGUES_JSON = file;
  await writeFile(file, '{ not json at all');
  const errors = [];
  const origErr = console.error;
  console.error = (m) => errors.push(String(m));
  try {
    assert.deepEqual(loadLeagueRegistry(), []);
    assert.equal(loadLeagueRegistry().length, 0);
    assert.ok(errors.length >= 1 && errors.some((m) => m.includes('unreadable')));
    assert.equal(errors.filter((m) => m.includes('unreadable')).length, 1, 'one warning per process');
  } finally {
    console.error = origErr;
    delete process.env.ML_LEAGUES_JSON;
    await rm(tmp, { recursive: true, force: true });
  }
});

test('rekeyPlainLeague follows a slug rename (exact-prefix entry)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'ml-rekey-'));
  const file = join(tmp, 'leagues.json');
  process.env.ML_LEAGUES_JSON = file;
  try {
    await mkdir(tmp, { recursive: true });
    await writeFile(file, JSON.stringify({
      version: 1,
      leagues: [{
        id: 'stupendous-plain',
        names: ['Stupendous League'],
        slugFamily: 'foo-<topic>',
        slugPrefixes: ['foo-'],
        mode: null,
        summary: 'Auto-registered plain league.',
      }],
    }, null, 2));
    const res = rekeyPlainLeague('2026-10-12-foo-old', '2026-10-12-foo-new');
    assert.equal(res.rekeyed, true);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    const entry = saved.leagues[0];
    assert.deepEqual(entry.slugPrefixes, ['foo-']);
    assert.equal(entry.slugFamily, 'foo-<topic>');
  } finally {
    delete process.env.ML_LEAGUES_JSON;
    await rm(tmp, { recursive: true, force: true });
  }
});

test('updateLeagueSlugs narrows family/prefixes in place and busts the match cache', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'ml-edit-'));
  const file = join(tmp, 'leagues.json');
  process.env.ML_LEAGUES_JSON = file;
  try {
    await mkdir(tmp, { recursive: true });
    await writeFile(file, JSON.stringify({
      version: 1,
      leagues: [{
        id: 'sample-themed',
        names: ['Sample Themed League'],
        slugFamily: 'sample-<topic>',
        slugPrefixes: ['sample-'],
        mode: 'thematic',
        summary: 'Sample themed league (sample-<topic>).',
      }],
    }, null, 2));
    assert.equal(leagueBySlug('2026-10-30-sample-narrow').id, 'sample-themed', 'broad prefix matches before the edit');

    const { before, after } = updateLeagueSlugs('sample-themed', {
      family: 'sample-constraints-<topic>',
      prefixes: ['sample-constraints-'],
      summary: 'Sample themed league (sample-constraints-<topic>).',
    });
    assert.deepEqual(before.slugPrefixes, ['sample-']);
    assert.deepEqual(after.slugPrefixes, ['sample-constraints-']);
    assert.equal(after.slugFamily, 'sample-constraints-<topic>');

    const saved = JSON.parse(await readFile(file, 'utf8'));
    const entry = saved.leagues[0];
    assert.equal(entry.slugFamily, 'sample-constraints-<topic>');
    assert.deepEqual(entry.slugPrefixes, ['sample-constraints-']);

    // cache was busted: matching reflects the narrow prefix immediately in-process
    assert.equal(leagueBySlug('2026-10-30-sample-narrow'), null, 'old-era slug no longer claimed');
    assert.equal(leagueBySlug('2026-10-30-sample-constraints-narrow').id, 'sample-themed');
  } finally {
    delete process.env.ML_LEAGUES_JSON;
    await rm(tmp, { recursive: true, force: true });
  }
});

test('updateLeagueSlugs validates: unknown id, empty shape, empty prefix, dash append', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'ml-edit-'));
  const file = join(tmp, 'leagues.json');
  process.env.ML_LEAGUES_JSON = file;
  try {
    await mkdir(tmp, { recursive: true });
    await writeFile(file, JSON.stringify({
      version: 1,
      leagues: [{
        id: 'sample-themed',
        names: [],
        slugFamily: 'sample-<topic>',
        slugPrefixes: ['sample-'],
        mode: null,
        summary: 'Auto-registered plain league.',
      }],
    }, null, 2));
    assert.throws(() => updateLeagueSlugs('no-such', { family: 'x-<y>' }), /No league/);
    assert.throws(() => updateLeagueSlugs('sample-themed', { family: '' }), /non-empty shape/);
    assert.throws(() => updateLeagueSlugs('sample-themed', { prefixes: [''] }), /non-empty prefix/);
    assert.throws(() => updateLeagueSlugs('sample-themed', { summary: '' }), /non-empty text/);
    const untouched = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(untouched.leagues[0].slugFamily, 'sample-<topic>', 'failed edits write nothing');

    updateLeagueSlugs('sample-themed', { prefixes: ['sample'] }); // no dash = exact-slug family
    const patched = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(patched.leagues[0].slugPrefixes, ['sample'], 'exact-slug prefixes pass through as-is');
  } finally {
    delete process.env.ML_LEAGUES_JSON;
    await rm(tmp, { recursive: true, force: true });
  }
});

test('e2e: ml leagues --set-family/--set-prefixes/--summary edits and re-details the entry', async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'ml-leagues-edit-'));
  const registryFile = join(tmpRoot, 'registry.json');
  try {
    await copyFile(join(here, 'fixtures', 'leagues-registry.json'), registryFile);
    const { stdout } = await execFileP(process.execPath, [
      'scripts/ml.mjs', 'leagues', 'beta-themed',
      '--set-family', 'beta-constraints-<topic>',
      '--set-prefixes', 'beta-constraints-',
      '--summary', 'Example thematic league (narrowed).',
    ], {
      cwd: root,
      env: { ...process.env, ML_LEAGUES_JSON: registryFile },
    });
    assert.match(stdout, /slugFamily: beta-<topic> → beta-constraints-<topic>/, 'before → after diff');
    assert.match(stdout, /slugPrefixes: beta- → beta-constraints-/, 'prefix diff');
    assert.match(stdout, /beta-constraints-<topic>, thematic/, 're-details with the new shape');
    const saved = JSON.parse(await readFile(registryFile, 'utf8'));
    const entry = saved.leagues.find((l) => l.id === 'beta-themed');
    assert.equal(entry.slugFamily, 'beta-constraints-<topic>');
    assert.deepEqual(entry.slugPrefixes, ['beta-constraints-']);
    assert.equal(entry.summary, 'Example thematic league (narrowed).');
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test('e2e: ml leagues refuses edit flags without a league name and without a value', async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'ml-leagues-edit-'));
  const registryFile = join(tmpRoot, 'registry.json');
  try {
    await copyFile(join(here, 'fixtures', 'leagues-registry.json'), registryFile);
    const noName = await execFileP(process.execPath, ['scripts/ml.mjs', 'leagues', '--set-family', 'x-<y>'], {
      cwd: root,
      env: { ...process.env, ML_LEAGUES_JSON: registryFile },
    }).catch((e) => e);
    assert.match(String(noName.stderr), /Edit flags need a league name/);
    assert.doesNotMatch(String(noName.stdout), /Updated/, 'listing did not run');
    const noValue = await execFileP(process.execPath, ['scripts/ml.mjs', 'leagues', 'beta-themed', '--set-family'], {
      cwd: root,
      env: { ...process.env, ML_LEAGUES_JSON: registryFile },
    }).catch((e) => e);
    assert.match(String(noValue.stderr), /needs a value/);
    const saved = JSON.parse(await readFile(registryFile, 'utf8'));
    const entry = saved.leagues.find((l) => l.id === 'beta-themed');
    assert.equal(entry.slugFamily, 'beta-<topic>', 'no edit landed');
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test('e2e: ml leagues lists fixture families with recency and registers from history', async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'ml-leagues-e2e-'));
  const dataDir = join(tmpRoot, 'data');
  const registryFile = join(tmpRoot, 'registry.json');
  try {
    await copyFile(join(here, 'fixtures', 'leagues-registry.json'), registryFile);
    // Calendar-relative round date: an 11-day-old archived round must land in the
    // active window regardless of when the suite runs (hardcoded dates drift past it).
    const roundDate = new Date();
    roundDate.setDate(roundDate.getDate() - 11);
    const roundId = `${roundDate.toISOString().slice(0, 10)}-alpha-halloween`;
    await mkdir(join(dataDir, 'analysis', 'archive', roundId), { recursive: true });
    await writeFile(join(dataDir, 'analysis', 'archive', roundId, 'music.json'), JSON.stringify({
      round: { league: 'Unregistered Named League' },
    }));
    const roundId2 = `${roundDate.toISOString().slice(0, 10)}-alpha-constraints-legacy`;
    await mkdir(join(dataDir, 'analysis', 'archive', roundId2), { recursive: true });
    await writeFile(join(dataDir, 'analysis', 'archive', roundId2, 'music.json'), JSON.stringify({
      round: { league: 'Stupendous Unregistered League' },
    }));
    const { stdout } = await execFileP(process.execPath, ['scripts/ml.mjs', 'leagues'], {
      cwd: root,
      env: { ...process.env, ML_DATA_DIR: dataDir, ML_LEAGUES_JSON: registryFile },
    });
    assert.match(stdout, /alpha-constraints .*alpha-constraints-legacy/, 'fixture family listed');
    assert.match(stdout, /latest: alpha-constraints-legacy \(1[01]d ago\)/, 'archived names count toward recency');
    const saved = JSON.parse(await readFile(registryFile, 'utf8'));
    const named = saved.leagues.find((lg) => lg.id === 'alpha-constraints');
    assert.ok(
      (named.names || []).includes('Stupendous Unregistered League'),
      'backfill registers league names onto NAMELESS covered entries (parse-fill semantics)'
    );
    const broad = saved.leagues.find((lg) => lg.id === 'alpha-years');
    assert.ok(
      !(broad.names || []).includes('Unregistered Named League'),
      'a named family never gains an unconfirmed alias from history (owner proof required)'
    );
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});
