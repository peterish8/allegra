import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../', import.meta.url));
const auditedComponents = [
  'components/PlayerPanel.tsx',
  'components/PlaylistControls.tsx',
  'components/ui.tsx',
  'components/ArtistPreviewCard.tsx',
  'components/InfoTour.tsx',
  'components/infoScenes.tsx',
  'components/blend/BlendsInfo.tsx',
  'components/TasteOnboarding.tsx',
];

describe('motion rules', () => {
  it('uses named motion tokens for durations and spring stiffness in audited components', () => {
    const bad = auditedComponents.flatMap((file) => {
      const text = readFileSync(join(src, file), 'utf8');
      return text.match(/(?:duration|stiffness)\s*[:=]\s*(?:\d+(?:\.\d*)?|\.\d+)/g)?.map((hit) => `${file}: ${hit}`) ?? [];
    });
    assert.deepEqual(bad, []);
  });

  it('keeps one final rail cascade after its duplicate was removed', () => {
    const css = readFileSync(join(src, 'styles/global.css'), 'utf8');
    const marker = '/* Final rail cascade: these rules intentionally sit after the legacy route layers. */';
    assert.equal(css.split(marker).length - 1, 1);
    assert.ok(css.indexOf('.site-header-top {', css.indexOf(marker)) > css.indexOf(marker));
  });
});
