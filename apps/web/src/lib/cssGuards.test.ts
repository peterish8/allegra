import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import postcss, { type Declaration, type Root } from 'postcss';

const src = fileURLToPath(new URL('../', import.meta.url));
const styles = join(src, 'styles');
const baselineFile = join(src, 'lib', 'cssGuards.baseline.json');

const RULES = [
  'rawDuration',
  'rawBezier',
  'bannedTransition',
  'filterTransition',
  'ungatedHoverTransform',
  'smallFontSize',
  'highZIndex',
  'rawColor',
] as const;

type Rule = (typeof RULES)[number];
type RuleCounts = Record<Rule, number>;
type CssBaseline = Record<Rule, Record<string, number>> & {
  undefinedCustomProperty: Record<string, number>;
};

interface CssSource {
  readonly name: string;
  readonly source: string;
  readonly root: Root;
}

const RUNTIME_CUSTOM_PROPERTY_ALLOWLIST: Record<string, string> = {
  '--album-primary': 'AlbumPage supplies the current album palette.',
  '--ambient-accent': 'App supplies the active song palette to the ambient shell.',
  '--audio-level': 'App writes the live audio analyser level.',
  '--aura-primary': 'DynamicAura supplies the primary artwork palette.',
  '--aura-secondary': 'DynamicAura supplies the secondary artwork palette.',
  '--aura-tertiary': 'DynamicAura supplies the tertiary artwork palette.',
  '--bar': 'DJ session chips supply each live level bar.',
  '--bubble-accent': 'TasteOnboarding supplies each genre bubble accent.',
  '--card-tone': 'BlendStories supplies each member card glow tone.',
  '--cover': 'Album, artist, collection, and DJ tour views supply cover artwork.',
  '--disc': 'Blend member discs supply their generated tone.',
  '--dj-a': 'DjPage supplies the current song primary palette.',
  '--dj-b': 'DjPage supplies the current song secondary palette.',
  '--dj-bass': 'useDjMascot writes the live bass analysis value.',
  '--dj-blink': 'useDjMascot writes the mascot blink pose.',
  '--dj-blush': 'useDjMascot writes the mascot blush reaction.',
  '--dj-energy': 'useDjMascot writes the live energy analysis value.',
  '--dj-lift': 'useDjMascot writes the mascot lift pose.',
  '--dj-look-x': 'useDjMascot writes the mascot horizontal gaze pose.',
  '--dj-look-y': 'useDjMascot writes the mascot vertical gaze pose.',
  '--dj-nod': 'useDjMascot writes the mascot nod pose.',
  '--dj-onset': 'useDjMascot writes the live onset analysis value.',
  '--dj-roam-x': 'useDjMascot writes the mascot horizontal movement pose.',
  '--dj-roam-y': 'useDjMascot writes the mascot vertical movement pose.',
  '--dj-spin': 'useDjMascot writes the mascot spin pose.',
  '--dj-squash': 'useDjMascot writes the mascot squash pose.',
  '--dj-squint': 'useDjMascot writes the mascot squint reaction.',
  '--dj-sway': 'useDjMascot writes the mascot sway pose.',
  '--dj-voice': 'useDjMascot writes the live voice analysis value.',
  '--fill': 'Volume and playhead controls supply their current fill percentage.',
  '--hero-art': 'App supplies the active song artwork URL to the hero.',
  '--karaoke-coverage': 'Playhead views and PlayerPanel supply lyric coverage.',
  '--lag': 'BlendStage supplies each participant animation delay.',
  '--level': 'Settings and karaoke controls supply their current level percentage.',
  '--lyrics-lead': 'LyricsPanel measures and supplies the active line anchor.',
  '--lyrics-scale': 'LyricsPanel supplies the selected lyric text scale.',
  '--lyrics-scroll-bottom': 'LyricsPanel measures the active panel bottom gap.',
  '--lyrics-scroll-height': 'LyricsPanel measures the active lyric line height.',
  '--lyrics-scroll-top': 'LyricsPanel measures the active panel top offset.',
  '--m-a': 'DjMascot supplies the primary mascot palette color.',
  '--marquee-duration': 'PlayerPanel calculates duration from the overflowing title width.',
  '--marquee-shift': 'PlayerPanel supplies the overflowing title translation distance.',
  '--m-b': 'DjMascot supplies the secondary mascot palette color.',
  '--m-c': 'DjMascot supplies the tertiary mascot palette color.',
  '--mood-tint': 'HomePage supplies each mood card tint.',
  '--m-p': 'DjMascot supplies normalized song palette transition progress.',
  '--p': 'LyricsPanel and shared progress indicators supply normalized progress.',
  '--preview-tint': 'TasteOnboarding supplies the selected genre preview tint.',
  '--stripe': 'Blend and info scene views supply generated stripe colors.',
  '--tabs-shift': 'LyricsPanel measures and supplies the tab strip offset.',
  '--tone': 'Blend views supply generated member and lens tones.',
  '--tour-size': 'DjTour supplies the measured mascot size.',
  '--y': 'BlendStage supplies each participant vertical layout position.',
};

function emptyCounts(): RuleCounts {
  return {
    rawDuration: 0,
    rawBezier: 0,
    bannedTransition: 0,
    filterTransition: 0,
    ungatedHoverTransform: 0,
    smallFontSize: 0,
    highZIndex: 0,
    rawColor: 0,
  };
}

function parseCss(name: string, source: string): CssSource {
  return { name, source, root: postcss.parse(source, { from: name }) };
}

function readCssSources(): CssSource[] {
  return readdirSync(styles, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.css'))
    .map((entry) => parseCss(entry.name, readFileSync(join(styles, entry.name), 'utf8')))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function hasHoverMedia(declaration: Declaration): boolean {
  let parent = declaration.parent;
  while (parent) {
    if (parent.type === 'atrule' && parent.name.toLowerCase() === 'media' && /\(\s*hover\s*:\s*hover\s*\)/i.test(parent.params)) {
      return true;
    }
    parent = parent.parent;
  }
  return false;
}

function countCssViolations(name: string, source: string): RuleCounts {
  const counts = emptyCounts();
  const root = postcss.parse(source, { from: name });
  const motionProperty = /^(?:-webkit-)?(?:transition|animation)(?:-|$)/i;
  const forbiddenTransitionProperty = /\b(?:all|box-shadow|filter|width|height|top|left|right|bottom|margin(?:-[\w-]+)?|padding(?:-[\w-]+)?|border-radius)\b/gi;
  const rawDuration = /(?<![\w.-])-?(?:\d+(?:\.\d+)?|\.\d+)\s*(?:ms|s)\b/gi;
  const colorLiteral = /#[\da-f]{3,4}(?:[\da-f]{2}){0,2}\b|rgba?\(\s*[^)]*\)/gi;

  root.walkDecls((declaration) => {
    const property = declaration.prop.toLowerCase().replace(/^-webkit-/, '');
    const value = declaration.value;

    if (motionProperty.test(declaration.prop)) {
      counts.rawDuration += value.match(rawDuration)?.length ?? 0;
    }
    if (name !== 'tokens.css') {
      counts.rawBezier += value.match(/cubic-bezier\s*\(/gi)?.length ?? 0;
    }
    if (property === 'transition' || property === 'transition-property') {
      counts.bannedTransition += value.match(forbiddenTransitionProperty)?.length ?? 0;
      counts.filterTransition += value
        .split(',')
        .filter((item) => /^(?:-webkit-)?filter\b/i.test(item.trim()))
        .length;
    }
    if (property === 'transform' && declaration.parent?.type === 'rule') {
      const hasHoverSelector = declaration.parent.selector
        .split(',')
        .some((selector) => /:hover\b/i.test(selector) && !/:(?:not|is|where)\(\s*:hover\s*\)/i.test(selector));
      if (hasHoverSelector && !hasHoverMedia(declaration)) counts.ungatedHoverTransform += 1;
    }
    if (property === 'font-size') {
      const pixelValues = value.matchAll(/(-?(?:\d+(?:\.\d+)?|\.\d+))\s*px\b/gi);
      for (const size of pixelValues) {
        if (Number(size[1]) < 12) counts.smallFontSize += 1;
      }
    }
    if (property === 'z-index') {
      const valueNumber = Number.parseInt(value, 10);
      if (Number.isFinite(valueNumber) && valueNumber >= 1000) counts.highZIndex += 1;
    }
    if (name !== 'tokens.css') {
      const withoutUrls = value.replace(/url\([^)]*\)/gi, '');
      counts.rawColor += withoutUrls.match(colorLiteral)?.length ?? 0;
    }
  });

  return counts;
}

function sourceCounts(sources: readonly CssSource[]): Record<string, RuleCounts> {
  return Object.fromEntries(sources.map(({ name, source }) => [name, countCssViolations(name, source)]));
}

function baselineFromCounts(
  counts: Record<string, RuleCounts>,
  undefinedProperties: Record<string, number>,
): CssBaseline {
  const baseline = Object.fromEntries(RULES.map((rule) => [rule, {}])) as CssBaseline;
  baseline.undefinedCustomProperty = undefinedProperties;
  for (const [file, fileCounts] of Object.entries(counts)) {
    for (const rule of RULES) {
      if (fileCounts[rule] > 0) baseline[rule][file] = fileCounts[rule];
    }
  }
  return baseline;
}

function baselineIncreases(current: CssBaseline, previous: CssBaseline): string[] {
  const increases: string[] = [];
  for (const rule of RULES) {
    const files = new Set([...Object.keys(current[rule] ?? {}), ...Object.keys(previous[rule] ?? {})]);
    for (const file of files) {
      const before = previous[rule]?.[file] ?? 0;
      const after = current[rule]?.[file] ?? 0;
      if (after > before) increases.push(`${rule}/${file}: ${before} -> ${after}`);
    }
  }
  const previousProperties = previous.undefinedCustomProperty ?? {};
  const currentProperties = current.undefinedCustomProperty ?? {};
  for (const property of new Set([...Object.keys(currentProperties), ...Object.keys(previousProperties)])) {
    const before = previousProperties[property] ?? 0;
    const after = currentProperties[property] ?? 0;
    if (after > before) increases.push(`undefinedCustomProperty/${property}: ${before} -> ${after}`);
  }
  return increases;
}

function undefinedCustomPropertyCounts(sources: readonly CssSource[]): Record<string, number> {
  const definitions = new Set<string>();
  const uses = new Map<string, number>();

  for (const { root } of sources) {
    root.walkDecls((declaration) => {
      if (declaration.prop.startsWith('--')) definitions.add(declaration.prop);
    });
  }

  for (const { root } of sources) {
    root.walkDecls((declaration) => {
      for (const match of declaration.value.matchAll(/var\(\s*(--[\w-]+)/g)) {
        const property = match[1];
        if (!definitions.has(property) && !RUNTIME_CUSTOM_PROPERTY_ALLOWLIST[property]) {
          uses.set(property, (uses.get(property) ?? 0) + 1);
        }
      }
    });
  }

  return Object.fromEntries([...uses.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function checkBaselineUpdate(current: CssBaseline): void {
  if (process.env.UPDATE_CSS_BASELINE !== '1') return;

  if (existsSync(baselineFile)) {
    const previous = JSON.parse(readFileSync(baselineFile, 'utf8')) as CssBaseline;
    assert.deepEqual(baselineIncreases(current, previous), [], 'CSS baseline may only fall; remove new debt before recording it');
  }
  writeFileSync(baselineFile, `${JSON.stringify(current, null, 2)}\n`);
}

const cssSources = readCssSources();
const counts = sourceCounts(cssSources);
const undefinedProperties = undefinedCustomPropertyCounts(cssSources);
const measuredBaseline = baselineFromCounts(counts, undefinedProperties);
checkBaselineUpdate(measuredBaseline);
const baseline = JSON.parse(readFileSync(baselineFile, 'utf8')) as CssBaseline;

describe('CSS guards', () => {
  it('audits every web style sheet, including the app, DJ, Blend, and component sheets', () => {
    const names = cssSources.map(({ name }) => name);
    for (const name of ['app.css', 'dj.css', 'blend.css', 'components.css', 'global.css', 'tokens.css']) {
      assert.ok(names.includes(name), `${name} must be included in the CSS guard`);
    }
  });

  for (const rule of RULES) {
    it(`${rule}: no CSS file rises above its baseline, and lower counts are recorded`, () => {
      const current = Object.fromEntries(
        Object.entries(counts)
          .filter(([, fileCounts]) => fileCounts[rule] > 0)
          .map(([file, fileCounts]) => [file, fileCounts[rule]]),
      );
      const allowed = baseline[rule] ?? {};
      const above = Object.entries(current)
        .filter(([file, count]) => count > (allowed[file] ?? 0))
        .map(([file, count]) => `${file}: ${count} (allowed ${allowed[file] ?? 0})`);
      const below = Object.entries(allowed)
        .filter(([file, count]) => (current[file] ?? 0) < count)
        .map(([file, count]) => `${file}: ${current[file] ?? 0} (baseline ${count}) — lower the baseline`);
      assert.deepEqual(above, [], `${rule} may not rise`);
      assert.deepEqual(below, [], `${rule} fell; update cssGuards.baseline.json to record the reduction`);
    });
  }

  it('keeps undefined CSS custom property counts at or below their named baseline', () => {
    const allowed = baseline.undefinedCustomProperty ?? {};
    const properties = new Set([...Object.keys(undefinedProperties), ...Object.keys(allowed)]);
    const above = [...properties]
      .filter((property) => (undefinedProperties[property] ?? 0) > (allowed[property] ?? 0))
      .map((property) => `${property}: ${undefinedProperties[property]} (allowed ${allowed[property] ?? 0})`);
    const below = [...properties]
      .filter((property) => (undefinedProperties[property] ?? 0) < (allowed[property] ?? 0))
      .map((property) => `${property}: ${undefinedProperties[property] ?? 0} (baseline ${allowed[property]})`);
    assert.deepEqual(above, [], `Undefined custom properties may not rise: ${above.join(', ')}`);
    assert.deepEqual(below, [], `Undefined custom properties fell; lower cssGuards.baseline.json: ${below.join(', ')}`);
  });

  it('detects a scratch box-shadow transition and raw duration, then clears both when removed', () => {
    const scratch = countCssViolations('scratch.css', '.button:hover { transition: box-shadow 200ms; }');
    assert.equal(scratch.bannedTransition, 1);
    assert.equal(scratch.rawDuration, 1);

    const filterScratch = countCssViolations('scratch.css', '.button { transition: filter 120ms; }');
    assert.equal(filterScratch.filterTransition, 1);

    const cleaned = countCssViolations('scratch.css', '.button:hover { transition: opacity var(--d-fast); }');
    assert.deepEqual(cleaned, emptyCounts());
  });

  it('detects and clears an undefined scratch custom property', () => {
    const missing = undefinedCustomPropertyCounts([
      parseCss('scratch.css', '.button { color: var(--scratch-ink); }'),
    ]);
    assert.deepEqual(missing, { '--scratch-ink': 1 });

    const defined = undefinedCustomPropertyCounts([
      parseCss('scratch.css', ':root { --scratch-ink: white; } .button { color: var(--scratch-ink); }'),
    ]);
    assert.deepEqual(defined, {});
  });

  it('requires hover transforms to be gated to hover-capable devices', () => {
    const outsideHoverMedia = countCssViolations('scratch.css', '.button:hover { transform: scale(1.02); }');
    const insideHoverMedia = countCssViolations('scratch.css', '@media (hover: hover) { .button:hover { transform: scale(1.02); } }');
    assert.equal(outsideHoverMedia.ungatedHoverTransform, 1);
    assert.equal(insideHoverMedia.ungatedHoverTransform, 0);
  });

  it('counts small font sizes, high z-index values, and raw colors outside tokens.css', () => {
    const scratch = countCssViolations('scratch.css', '.caption { font-size: 10px; z-index: 1000; color: #fff; background: rgba(0, 0, 0, 0.5); }');
    assert.equal(scratch.smallFontSize, 1);
    assert.equal(scratch.highZIndex, 1);
    assert.equal(scratch.rawColor, 2);

    const tokenSheet = countCssViolations('tokens.css', ':root { --ink: #fff; --ease: cubic-bezier(0, 0, 1, 1); }');
    assert.equal(tokenSheet.rawColor, 0);
    assert.equal(tokenSheet.rawBezier, 0);
  });
});
