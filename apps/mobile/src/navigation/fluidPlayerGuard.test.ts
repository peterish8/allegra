import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('the fluid player stays opt-in', () => {
  it('is off by default', () => {
    expect(read('store/settingsStore.ts').match(/fluidPlayer: (true|false),/g)).toEqual(['fluidPlayer: false,', 'fluidPlayer: false,']);
  });

  it('only changes the mini player and the sheet when the setting is on', () => {
    expect(read('components/PillPlayer.tsx')).toMatch(/const open = fluid \? fluidOpen : classicOpen;/);
    expect(read('components/PillPlayer.tsx')).toMatch(/useSettingsStore\(s => s\.fluidPlayer\)/);
    const sheet = read('screens/NowPlayingScreen.tsx');
    expect(sheet).toMatch(/takeOpenTracking\(\) && fluid/);
    expect(sheet).toMatch(/const movingCover = fluid &&/);
  });

  it('is switched from Settings', () => {
    expect(read('screens/SettingsScreen.tsx')).toMatch(/Fluid player \(experimental\)/);
  });
});
