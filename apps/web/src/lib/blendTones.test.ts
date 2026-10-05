import assert from 'node:assert/strict';
import test from 'node:test';

import { memberTones } from './blendTones.ts';

test('every member of a full Blend gets a different colour, and a member keeps theirs', () => {
  const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((userId) => ({ userId }));
  const tones = memberTones(six);
  assert.equal(new Set(tones.values()).size, 6);
  assert.equal(memberTones([{ userId: 'a' }]).get('a'), tones.get('a'));
});
