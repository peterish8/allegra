import { readFileSync } from 'fs';
import { join } from 'path';
import { miniPlayerLabel } from './miniPlayerLabel';

// The broader smoke (mobile-smoke.yml) finds the mini player by this label: run 42126270194 failed from
// "C round 2" on because the V6 label no longer matched, so the probe never reopened the player.
const assertions = readFileSync(join(__dirname, '../../../../.github/scripts/player-assertions.sh'), 'utf8');

describe('miniPlayerLabel', () => {
  it('matches the pattern the player probe taps and reads', () => {
    const label = miniPlayerLabel('Another Day Of Sun');
    expect(assertions).toContain('content-desc="Now playing: [^"]*"');
    expect(`content-desc="${label}"`).toMatch(/content-desc="Now playing: [^"]*"/);
  });

  it('gives back exactly the title once the probe strips the frame', () => {
    const label = miniPlayerLabel('Ucha Lamba Kad');
    const shown = label.replace(/^Now playing: /, '').replace(/\. Open player$/, '');
    expect(shown).toBe('Ucha Lamba Kad');
  });
});
