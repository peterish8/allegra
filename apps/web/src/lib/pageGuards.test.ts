import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import nextConfig from '../../next.config';

describe('page guards', () => {
  it('lets this origin use the microphone (the DJ recorder) but keeps camera and location off', async () => {
    const rules = await nextConfig.headers?.();
    const policy = rules
      ?.flatMap((rule) => rule.headers)
      .find((header) => header.key === 'Permissions-Policy')?.value;
    assert.ok(policy, 'a Permissions-Policy header is set');
    assert.match(policy, /microphone=\(self\)/);
    assert.match(policy, /camera=\(\)/);
    assert.match(policy, /geolocation=\(\)/);
  });

  it('keeps one transport keyboard handler: the audio hook must not listen for keys itself', () => {
    const hook = readFileSync(new URL('../hooks/useAudioPlayer.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(hook, /addEventListener\(\s*'keydown'/);
  });
});
