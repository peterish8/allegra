import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

// Owner, 1.69.0: the player sheet follows the finger in both directions at any speed, from the mini player and back.
// The drag-follow used to sit behind an "experimental" switch that was off by default, so a swipe up on the pill did
// nothing until the finger lifted.
describe('the player sheet follows the finger', () => {
  it('always opens a drag from the mini player under the finger, with no setting in the way', () => {
    const pill = read('components/PillPlayer.tsx');
    expect(pill).toMatch(/const tracksFinger = !!onOpenTracking;/);
    expect(pill).toMatch(/const open = tracksFinger \? fluidOpen : classicOpen;/);
    expect(pill).not.toMatch(/fluidPlayer/);
    expect(read('navigation/usePlayerSheetMotion.ts')).toMatch(/takeOpenTracking\(\) && playerDrag\.tracking\.value/);
    for (const sheet of ['screens/NowPlayingScreen.tsx', 'components/connect/ConnectRemotePlayer.tsx']) {
      expect(read(sheet)).toMatch(/usePlayerSheetMotion\(restY, route\.params\.instant === true, reduceMotion, revealPill\)/);
    }
  });

  it('has no Fluid player switch left that would do nothing', () => {
    expect(read('screens/SettingsScreen.tsx')).not.toMatch(/Fluid player/);
    expect(read('store/settingsStore.ts')).not.toMatch(/fluidPlayer/);
  });

  it('moves every sheet drag through the one 1:1 rule, local and Connect alike', () => {
    for (const sheet of ['screens/NowPlayingScreen.tsx', 'components/connect/ConnectRemotePlayer.tsx']) {
      const text = read(sheet);
      expect(text.match(/sheetY\.value = sheetYForDrag\(grabY\.value, e(vent)?\.translationY, restY\)/g)).toHaveLength(2);
      expect(text).not.toMatch(/rubberBand\(y, 120\)/);
    }
    expect(read('navigation/usePlayerSheetMotion.ts')).toMatch(/sheetY\.value = sheetYForDrag\(y, 0, restY\)/);
  });

  it('rides the mini player on the sheet’s top edge, so the close lands on one surface', () => {
    expect(read('components/PillPlayer.tsx')).toMatch(/translateY: miniRideY\(playerSheetProgress\.value, restY, reduceMotion\)/);
  });

  // Owner-approved 2026-11-12: a tap shares the artwork with the player too (Apple Music).
  it('shares the artwork on a tap as well as on a drag', () => {
    const sheet = read('screens/NowPlayingScreen.tsx');
    expect(sheet).toMatch(/const movingCover = !reduceMotion && playerCoverFrom\.value\.width > 0;/);
    const pill = read('components/PillPlayer.tsx');
    expect(pill).toMatch(/const openMeasured = \(\) => measureCover\(\(\) => onOpen\(\)\);/);
    expect(pill).toMatch(/measureCover\(\(\) => onOpen\(Math\.max\(0, -e\.velocityY\)\)\)/);
  });
});
