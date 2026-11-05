// Native animation curves do not load in the Node test runner.
jest.mock('react-native-reanimated', () => ({ Easing: { bezier: () => (t: number) => t } }));

import * as fs from 'fs';
import * as path from 'path';
import { Control, Signal, Surface, Typography } from '../constants/allegraTheme';

const luminance = (hex: string): number => {
  const channels = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
const contrast = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

describe('reusable frontend system', () => {
  it('keeps every normal text tone readable on browse and reading surfaces', () => {
    for (const ink of [Signal.ink, Signal.inkSoft, Signal.inkMuted, Signal.danger]) {
      for (const background of [Surface.base, Surface.raised, Surface.control, Surface.deep]) {
        expect({ ink, background, readable: contrast(ink, background) >= 4.5 }).toEqual({ ink, background, readable: true });
      }
    }
  });

  it('keeps primary and destructive button labels readable on their fills', () => {
    expect(contrast(Signal.waveInk, Signal.wave)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(Signal.waveInk, Signal.danger)).toBeGreaterThanOrEqual(4.5);
  });

  it('reserves enough physical space for each shared control target', () => {
    expect(Control.target).toBeGreaterThanOrEqual(48);
    expect(Control.button).toBeGreaterThanOrEqual(Control.target);
    expect(Control.compactButton).toBeGreaterThanOrEqual(Control.target);
    expect(Control.option).toBeGreaterThanOrEqual(Control.target);
  });

  it('uses only bundled weights and leaves breathing room on every text role', () => {
    for (const role of Object.values(Typography)) {
      expect(['400', '600', '700']).toContain(role.fontWeight);
      expect(role.lineHeight).toBeGreaterThan(role.fontSize);
    }
  });

  it('keeps raw colours and duplicate type definitions out of shared primitives', () => {
    const failures: string[] = [];
    for (const file of fs.readdirSync(__dirname).filter(name => name.endsWith('.tsx'))) {
      const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
      if (/['"](?:#[\da-f]{3,8}|rgba?\()[^'"]*['"]/i.test(source)) failures.push(`${file}: raw colour`);
      if (/\bfontSize:\s*\d/.test(source)) failures.push(`${file}: duplicate type size`);
    }
    expect(failures).toEqual([]);
  });
});
