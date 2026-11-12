import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

describe.each(['screens/MixScreen.tsx', 'screens/CollectionScreen.tsx'])('%s keeps the list on solid black', (file) => {
  const source = read(file);

  it('sets the fixed immersive black on the page and the list, with no cover glow', () => {
    expect(source).toMatch(/Surface\.immersive/);
    expect(source).toMatch(/staticGlow=\{false\}/);
  });

  it('never reads the cover\'s colours or blurs it behind the list', () => {
    expect(source).not.toMatch(/useArtworkPalette|playlistWash|blurRadius|BlurView|Frosted/);
  });
});

it('the hero itself never reads the cover\'s colours', () => {
  expect(read('components/playlist/ImmersiveHero.tsx')).not.toMatch(/useArtworkPalette|palette|blurRadius|BlurView/);
});
