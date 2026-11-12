import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('the fluid player stays opt-in', () => {
  it('is off by default', () => {
    expect(read('store/settingsStore.ts').match(/fluidPlayer: (true|false),/g)).toEqual(['fluidPlayer: false,', 'fluidPlayer: false,']);
  });

  it('only makes the sheet follow the finger from the mini player when the setting is on', () => {
    expect(read('components/PillPlayer.tsx')).toMatch(/const open = fluid \? fluidOpen : classicOpen;/);
    expect(read('components/PillPlayer.tsx')).toMatch(/useSettingsStore\(s => s\.fluidPlayer\)/);
    // The sheet's motion lives in the hook (it left NowPlayingScreen): tracking needs the setting, and the screen passes it.
    expect(read('navigation/usePlayerSheetMotion.ts')).toMatch(/takeOpenTracking\(\) && fluid && playerDrag\.tracking\.value/);
    expect(read('screens/NowPlayingScreen.tsx')).toMatch(/usePlayerSheetMotion\(restY, route\.params\.instant === true, fluid, reduceMotion, revealPill\)/);
    expect(read('components/connect/ConnectRemotePlayer.tsx')).toMatch(/usePlayerSheetMotion\(restY, route\.params\.instant === true, fluid, reduceMotion, revealPill\)/);
  });

  // Owner-approved 2026-11-12: a tap shares the artwork with the player too (Apple Music). Only the drag-follow is opt-in.
  it('shares the artwork on a tap whatever the setting says', () => {
    const sheet = read('screens/NowPlayingScreen.tsx');
    expect(sheet).toMatch(/const movingCover = !reduceMotion && playerCoverFrom\.value\.width > 0;/);
    expect(sheet).not.toMatch(/const movingCover = fluid/);
    // Both ways of opening measure the mini cover first, so the rectangle is there on a tap and on a swipe.
    const pill = read('components/PillPlayer.tsx');
    expect(pill).toMatch(/const openMeasured = \(\) => measureCover\(\(\) => onOpen\(\)\);/);
    expect(pill).toMatch(/measureCover\(\(\) => onOpen\(Math\.max\(0, -e\.velocityY\)\)\)/);
  });

  it('is switched from Settings', () => {
    expect(read('screens/SettingsScreen.tsx')).toMatch(/Fluid player \(experimental\)/);
  });
});
