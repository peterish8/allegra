import { coverCrop, roomSize } from './roomBlurMath';

describe('coverCrop', () => {
  it('crops the sides of a square cover for a tall room, keeping it centred', () => {
    expect(coverCrop(600, 600, 300, 600)).toEqual({ x: 150, y: 0, width: 300, height: 600 });
  });

  it('crops the top and bottom of a wide cover for a square box', () => {
    expect(coverCrop(800, 400, 100, 100)).toEqual({ x: 200, y: 0, width: 400, height: 400 });
    expect(coverCrop(400, 800, 100, 100)).toEqual({ x: 0, y: 200, width: 400, height: 400 });
  });
});

describe('roomSize', () => {
  it('draws a phone-sized room 48 pixels wide with the blur scaled to match', () => {
    const room = roomSize(651, 1131, 70, 48);
    expect(room.width).toBe(48);
    expect(room.height).toBe(83);
    expect(room.sigma).toBeCloseTo(70 * (48 / 651));
  });
});
