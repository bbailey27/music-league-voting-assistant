import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayWidth, padEndDisplay, padStartDisplay, truncDisplay } from '../scripts/text-width.mjs';

test('displayWidth counts East Asian wide chars as two columns', () => {
  assert.equal(displayWidth('abc'), 3);
  assert.equal(displayWidth('말하자면'), 8);
  assert.equal(displayWidth('...말하자면'), 11);
});

test('padEndDisplay and padStartDisplay align by display width', () => {
  const col = 24;
  const en = padEndDisplay('Sexy, Free & Single', col);
  const ko = padEndDisplay('...말하자면', col);
  assert.equal(displayWidth(en), col);
  assert.equal(displayWidth(ko), col);
  assert.equal(padStartDisplay('73', 5), '   73');
});

test('truncDisplay limits by display width', () => {
  assert.equal(truncDisplay('short title', 24), 'short title');
  const long = 'A'.repeat(30);
  assert.equal(displayWidth(truncDisplay(long, 24)), 24);
  assert.match(truncDisplay(long, 24), /…$/);
});
