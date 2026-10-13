// Tests for the self-dating save-round target resolution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateSlug, effectiveDate } from '../scripts/maintain-rounds.mjs';
import { resolveSaveTarget } from '../scripts/save-round.mjs';

test('save-round snaps a bare slug to its unique dated sibling', () => {
  const target = resolveSaveTarget('lfm-4', ['2026-09-27-lfm-4', 'other']);
  assert.equal(target.id, '2026-09-27-lfm-4');
  assert.equal(target.created, false);
});

test('save-round rejects an ambiguous bare slug', () => {
  const target = resolveSaveTarget('lfm-4', [
    '2026-08-01-lfm-4',
    '2026-09-27-lfm-4',
  ]);
  assert.ok(target.error);
  assert.deepEqual(target.siblings, ['2026-08-01-lfm-4', '2026-09-27-lfm-4']);
});

test('save-round stamps today when no sibling exists', () => {
  const target = resolveSaveTarget('story-9', []);
  const stamp = formatDateSlug(effectiveDate());
  assert.equal(target.id, `${stamp}-story-9`);
  assert.equal(target.created, true);
});

test('save-round keeps an explicitly dated id verbatim', () => {
  const target = resolveSaveTarget('2026-01-02-disco', []);
  assert.equal(target.id, '2026-01-02-disco');
  assert.equal(target.created, true);
});
