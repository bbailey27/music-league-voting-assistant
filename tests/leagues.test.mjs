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
} from '../scripts/leagues.mjs';

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
  assert.equal(leagues.length, 2);
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
    assert.deepEqual(saved.leagues[0].slugPrefixes, ['vim-']);

    const byParse = upsertPlainLeague({ roundId: now.roundId, leagueName: now.leagueName, mode: 'objective' });
    assert.equal(byParse.added, false, 'parse fills the existing nameless entry instead of a duplicate');
    const savedAfterName = JSON.parse(await readFile(file, 'utf8'));
    const entry = savedAfterName.leagues.find((l) => (l.names || []).includes('Sample Plain League'));
    assert.ok(entry, 'official name landed on the same family entry');
    assert.equal(entry.mode, 'objective');
    assert.deepEqual(entry.slugPrefixes, ['vim-']);
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

test('upsertPlainLeague: a nameless family matches future rounds of the same prefix', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'ml-plain-prefix-'));
  const file = join(tmp, 'leagues.json');
  process.env.ML_LEAGUES_JSON = file;
  try {
    const a = upsertPlainLeague({ roundId: '2026-10-12-sample-a', leagueName: 'Some League X' });
    assert.equal(a.added, true);
    const b = upsertPlainLeague({ roundId: '2026-10-13-sample-b', leagueName: 'Some League X' });
    assert.equal(b.added, false, 'covered-name now (prefix registration was the earlier one)');
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(saved.leagues.filter((l) => (l.names || []).includes('Some League X')).length, 1);
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

test('e2e: ml leagues lists fixture families with recency and registers from history', async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'ml-leagues-e2e-'));
  const dataDir = join(tmpRoot, 'data');
  const registryFile = join(tmpRoot, 'registry.json');
  try {
    await copyFile(join(here, 'fixtures', 'leagues-registry.json'), registryFile);
    await mkdir(join(dataDir, 'analysis', 'archive', '2026-10-11-alpha-halloween'), { recursive: true });
    await writeFile(join(dataDir, 'analysis', 'archive', '2026-10-11-alpha-halloween', 'music.json'), JSON.stringify({
      round: { league: 'Stupendous Unregistered League' },
    }));
    const { stdout } = await execFileP(process.execPath, ['scripts/ml.mjs', 'leagues'], {
      cwd: root,
      env: { ...process.env, ML_DATA_DIR: dataDir, ML_LEAGUES_JSON: registryFile },
    });
    assert.match(stdout, /alpha-years {2}/, 'fixture family listed');
    assert.match(stdout, /latest: alpha-halloween \(11d ago\)/, 'archived names count toward recency');
    const saved = JSON.parse(await readFile(registryFile, 'utf8'));
    assert.ok(
      saved.leagues.some((lg) => (lg.names || []).includes('Stupendous Unregistered League')),
      'backfill registered the unlisted league from existing analysis metadata'
    );
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});
