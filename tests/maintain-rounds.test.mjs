// Tests for the round tidy maintenance: date-slug naming + stale archiving.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  effectiveDate,
  formatDateSlug,
  slugAgeDays,
  ensureDateSlugForInput,
} from '../scripts/maintain-rounds.mjs';

const execFileP = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const script = join(root, 'scripts', 'maintain-rounds.mjs');

function slugFor(daysAgo) {
  const d = effectiveDate();
  d.setDate(d.getDate() - daysAgo);
  return formatDateSlug(d);
}

async function makeInput(cwd, id, ext = '.html') {
  const dir = join(cwd, 'data', 'rounds');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}${ext}`), '<!doctype html>', 'utf8');
}

async function makeAnalysis(cwd, id) {
  const dir = join(cwd, 'data', 'analysis', id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'music.json'), '{"songs":[]}', 'utf8');
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function tidy(cwd, args = []) {
  return execFileP(process.execPath, [script, ...args], { cwd });
}

test('effectiveDate rolls back to yesterday before 5am', () => {
  const before = new Date(2026, 5, 19, 1, 30);
  const after = new Date(2026, 5, 19, 9, 0);
  assert.equal(formatDateSlug(effectiveDate(before)), '2026-06-18');
  assert.equal(formatDateSlug(effectiveDate(after)), '2026-06-19');
});

test('slugAgeDays counts whole days from the effective today', () => {
  assert.equal(slugAgeDays(slugFor(0)), 0);
  assert.equal(slugAgeDays(slugFor(3)), 3);
  assert.equal(slugAgeDays('not-a-date'), null);
});

test('naming prepends the date to undated input + analysis together', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tidy-name-'));
  try {
    await makeInput(cwd, 'tarot-hermit', '.html');
    await makeInput(cwd, 'tarot-hermit', '.txt');
    await makeAnalysis(cwd, 'tarot-hermit');
    await tidy(cwd, ['--no-archive']);

    const stamp = formatDateSlug(effectiveDate());
    assert.ok(await exists(join(cwd, 'data', 'rounds', `${stamp}-tarot-hermit.html`)));
    assert.ok(await exists(join(cwd, 'data', 'rounds', `${stamp}-tarot-hermit.txt`)));
    assert.ok(await exists(join(cwd, 'data', 'analysis', `${stamp}-tarot-hermit`)));
    assert.ok(!(await exists(join(cwd, 'data', 'rounds', 'tarot-hermit.html'))));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('ensureDateSlugForInput renames an undated parse path without archiving', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tidy-ensure-'));
  const origCwd = process.cwd();
  try {
    await makeInput(cwd, 'story-5');
    process.chdir(cwd);
    const logs = [];
    const resolved = ensureDateSlugForInput('data/rounds/story-5.html', { log: (m) => logs.push(m) });
    const stamp = formatDateSlug(effectiveDate());
    assert.equal(resolved, `data/rounds/${stamp}-story-5.html`);
    assert.ok(logs.some((m) => /named story-5/.test(m)));
    assert.ok(await exists(join(cwd, 'data', 'rounds', `${stamp}-story-5.html`)));
    assert.ok(!(await exists(join(cwd, 'data', 'rounds', 'story-5.html'))));
    assert.ok(!(await exists(join(cwd, 'data', 'rounds', 'archive'))));
  } finally {
    process.chdir(origCwd);
    await rm(cwd, { recursive: true, force: true });
  }
});

test('naming joins undated input into an existing dated analysis sibling', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tidy-sibling-in-'));
  try {
    const stamp = slugFor(1);
    const dated = `${stamp}-lfm-art`;
    await makeAnalysis(cwd, dated);
    await makeInput(cwd, 'lfm-art');
    await tidy(cwd, ['--no-archive']);

    assert.ok(await exists(join(cwd, 'data', 'rounds', `${dated}.html`)));
    assert.ok(await exists(join(cwd, 'data', 'analysis', dated)));
    assert.ok(!(await exists(join(cwd, 'data', 'rounds', 'lfm-art.html'))));
    assert.ok(!(await exists(join(cwd, 'data', 'analysis', 'lfm-art'))));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('naming merges duplicate dated bare slugs into the earliest date', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tidy-dup-dated-'));
  try {
    const older = `${slugFor(2)}-lfm-art`;
    const newer = `${slugFor(0)}-lfm-art`;
    await makeAnalysis(cwd, older);
    await writeFile(join(cwd, 'data', 'analysis', older, 'fit.json'), '{"songs":[]}', 'utf8');
    await makeAnalysis(cwd, newer);
    await writeFile(join(cwd, 'data', 'analysis', newer, 'music.json'), '{"songs":[{"title":"x"}]}', 'utf8');
    await makeInput(cwd, newer);
    await tidy(cwd, ['--no-archive']);

    assert.ok(await exists(join(cwd, 'data', 'analysis', older, 'fit.json')));
    assert.ok(await exists(join(cwd, 'data', 'analysis', older, 'music.json')));
    assert.ok(await exists(join(cwd, 'data', 'rounds', `${older}.html`)));
    assert.ok(!(await exists(join(cwd, 'data', 'analysis', newer))));
    assert.ok(!(await exists(join(cwd, 'data', 'rounds', `${newer}.html`))));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('ensureDateSlugForInput joins into an existing dated sibling', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tidy-ensure-sibling-'));
  const origCwd = process.cwd();
  try {
    const stamp = slugFor(1);
    const dated = `${stamp}-story-5`;
    await makeAnalysis(cwd, dated);
    await makeInput(cwd, 'story-5');
    process.chdir(cwd);
    const logs = [];
    const resolved = ensureDateSlugForInput('data/rounds/story-5.html', { log: (m) => logs.push(m) });
    assert.equal(resolved, `data/rounds/${dated}.html`);
    assert.ok(logs.some((m) => /merged story-5/.test(m)));
    assert.ok(await exists(join(cwd, 'data', 'rounds', `${dated}.html`)));
  } finally {
    process.chdir(origCwd);
    await rm(cwd, { recursive: true, force: true });
  }
});

test('naming leaves already-dated rounds untouched', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tidy-dated-'));
  try {
    await makeInput(cwd, '2026-01-02-disco');
    await tidy(cwd, ['--no-archive']);
    assert.ok(await exists(join(cwd, 'data', 'rounds', '2026-01-02-disco.html')));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('dry-run reports without moving files', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tidy-dry-'));
  try {
    await makeInput(cwd, 'undated');
    const { stdout } = await tidy(cwd, ['--dry-run', '--no-archive']);
    assert.match(stdout, /would name undated/);
    assert.ok(await exists(join(cwd, 'data', 'rounds', 'undated.html')));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('archiving moves stale rounds and keeps recent ones', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tidy-arch-'));
  try {
    const stale = `${slugFor(5)}-old-round`;
    const fresh = `${slugFor(1)}-new-round`;
    const edge = `${slugFor(2)}-edge-round`;
    for (const id of [stale, fresh, edge]) {
      await makeInput(cwd, id);
      await makeAnalysis(cwd, id);
    }
    await tidy(cwd, ['--no-name']);

    assert.ok(await exists(join(cwd, 'data', 'rounds', 'archive', `${stale}.html`)));
    assert.ok(await exists(join(cwd, 'data', 'analysis', 'archive', stale)));
    assert.ok(await exists(join(cwd, 'data', 'rounds', `${fresh}.html`)));
    // age 2 == threshold default, kept (only > 2 archived)
    assert.ok(await exists(join(cwd, 'data', 'rounds', `${edge}.html`)));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('--age tunes the archive window', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tidy-age-'));
  try {
    const id = `${slugFor(2)}-edge-round`;
    await makeInput(cwd, id);
    await tidy(cwd, ['--no-name', '--age', '1']);
    assert.ok(await exists(join(cwd, 'data', 'rounds', 'archive', `${id}.html`)));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('undated rounds are never archived (unknown age)', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tidy-undated-'));
  try {
    await makeAnalysis(cwd, 'no-date-here');
    await tidy(cwd, ['--no-name']);
    assert.ok(await exists(join(cwd, 'data', 'analysis', 'no-date-here')));
    assert.ok(!(await exists(join(cwd, 'data', 'analysis', 'archive', 'no-date-here'))));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('no-op tidy reports nothing to do', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tidy-noop-'));
  try {
    await makeInput(cwd, `${slugFor(0)}-today-round`);
    const { stdout } = await tidy(cwd, []);
    assert.match(stdout, /Nothing to tidy/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
