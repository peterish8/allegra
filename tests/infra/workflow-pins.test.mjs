import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const SHA = /^[0-9a-f]{40}$/;

test('every remote action is pinned to a full commit SHA with a version comment', async () => {
  const dir = new URL('../../.github/workflows/', import.meta.url);
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.yml')) continue;
    const text = await readFile(new URL(name, dir), 'utf8');
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      const match = line.match(/^\s*-?\s*uses:\s*([^\s#]+)(\s*#\s*(\S+))?/);
      if (!match || match[1].startsWith('./')) continue;
      const ref = match[1].split('@')[1] ?? '';
      assert.match(ref, SHA, `${name}:${index + 1} uses ${match[1]} (pin to a SHA)`);
      assert.ok(match[3], `${name}:${index + 1} needs a "# vX.Y.Z" comment`);
    }
  }
});
