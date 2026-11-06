import * as fs from 'fs';
import * as path from 'path';
import { DISPLAY_SIZES, scaleForSize, sizeForScale } from './displaySize';

describe('display size', () => {
  it('maps every offered size to its scale and back', () => {
    for (const size of DISPLAY_SIZES) expect(sizeForScale(scaleForSize(size.value))).toBe(size.value);
  });

  it('snaps an unexpected native value to the nearest size and treats bad values as the default', () => {
    expect(sizeForScale(0.86)).toBe('compact');
    expect(sizeForScale(0.95)).toBe('small');
    expect(sizeForScale(2)).toBe('large');
    expect(sizeForScale(undefined)).toBe('default');
    expect(sizeForScale(Number.NaN)).toBe('default');
    expect(sizeForScale(0)).toBe('default');
  });

  it('offers exactly the native steps', () => {
    const kotlin = fs.readFileSync(
      path.join(__dirname, '../../android/app/src/main/java/com/lyricflow/app/startup/DisplayScale.kt'), 'utf8');
    const found = kotlin.match(/CHOICES = floatArrayOf\(([^)]*)\)/);
    const native = found?.[1].split(',').map(v => parseFloat(v));
    expect(native).toEqual(DISPLAY_SIZES.map(s => s.scale));
  });
});
