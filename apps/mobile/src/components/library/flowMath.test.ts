import { flowOffset, focusFromDrag, settleFocus, tapSide } from './flowMath';

describe('focusFromDrag', () => {
  it('moves a card per step of drag, in the opposite direction to the finger', () => {
    expect(focusFromDrag(2, -100, 100, 6)).toBe(3);
    expect(focusFromDrag(2, 100, 100, 6)).toBe(1);
    expect(focusFromDrag(2, 0, 100, 6)).toBe(2);
  });

  it('resists past the first and last card instead of stopping dead', () => {
    expect(focusFromDrag(0, 100, 100, 6)).toBeCloseTo(-0.35);
    expect(focusFromDrag(5, -100, 100, 6)).toBeCloseTo(5.35);
  });
});

describe('settleFocus', () => {
  it('lands on the nearest card for a slow release', () => {
    expect(settleFocus(2.4, 0, 100, 6)).toBe(2);
    expect(settleFocus(2.6, 0, 100, 6)).toBe(3);
  });

  it('carries a flick on to the next card', () => {
    expect(settleFocus(2.2, -900, 100, 6)).toBe(4);
    expect(settleFocus(2.8, 900, 100, 6)).toBe(1);
  });

  it('never leaves the deck', () => {
    expect(settleFocus(-0.3, 800, 100, 6)).toBe(0);
    expect(settleFocus(5.4, -800, 100, 6)).toBe(5);
    expect(settleFocus(0, 0, 100, 0)).toBe(0);
  });
});

describe('flowOffset', () => {
  it('puts the centre at zero and neighbours a full step out on their own side', () => {
    expect(flowOffset(0, 100)).toBe(0);
    expect(flowOffset(1, 100)).toBe(100);
    expect(flowOffset(-1, 100)).toBe(-100);
  });

  it('crowds the outer cards closer together', () => {
    expect(flowOffset(2, 100)).toBe(150);
    expect(flowOffset(-3, 100)).toBe(-200);
  });

  it('moves smoothly between slots', () => {
    expect(flowOffset(0.5, 100)).toBe(50);
  });
});

describe('tapSide', () => {
  it('is the centre card inside its width, else the side it landed on', () => {
    expect(tapSide(180, 360, 200)).toBe(0);
    expect(tapSide(40, 360, 200)).toBe(-1);
    expect(tapSide(330, 360, 200)).toBe(1);
  });
});

describe('the looping row', () => {
  const { loops, wrapIndex, loopDistance, loopFocusFromDrag, loopSettleFocus, nearestPositionOf } = jest.requireActual('./flowMath');

  it('loops from three cards; one or two keep their ends', () => {
    expect(loops(2)).toBe(false);
    expect(loops(3)).toBe(true);
  });

  it('reads any position as a card, both ways round', () => {
    expect(wrapIndex(0, 8)).toBe(0);
    expect(wrapIndex(8, 8)).toBe(0);
    expect(wrapIndex(9, 8)).toBe(1);
    expect(wrapIndex(-1, 8)).toBe(7);
    expect(wrapIndex(-17, 8)).toBe(7);
    expect(wrapIndex(3.4, 8)).toBe(3);
  });

  it('puts the first card just after the last, and the last just before the first', () => {
    // Centred on the last card (7 of 8): the first card is one to its right.
    expect(loopDistance(0, 7, 8)).toBe(1);
    // Centred on the first: the last card is one to its left.
    expect(loopDistance(7, 0, 8)).toBe(-1);
    // Many times round, the same.
    expect(loopDistance(0, 23, 8)).toBe(1);
    expect(loopDistance(2, -6, 8)).toBe(0);
    // Mid-drag between cards.
    expect(loopDistance(0, 7.5, 8)).toBeCloseTo(0.5);
  });

  it('does not loop a row of two', () => {
    expect(loopDistance(0, 1, 2)).toBe(-1);
  });

  it('follows a drag past either end with no resistance', () => {
    expect(loopFocusFromDrag(0, 100, 100)).toBe(-1);
    expect(loopFocusFromDrag(7, -300, 100)).toBe(10);
  });

  it('settles a flick on the card it is heading for, past the end too', () => {
    expect(loopSettleFocus(7.2, -900, 100)).toBe(9);
    expect(loopSettleFocus(0.1, 900, 100)).toBe(-1);
  });

  it('brings a card to the middle the short way round', () => {
    // At position 15 (card 7 of 8), card 0 is one step on, not seven back.
    expect(nearestPositionOf(0, 15, 8)).toBe(16);
    expect(nearestPositionOf(6, 15, 8)).toBe(14);
    expect(nearestPositionOf(1, 2, 2)).toBe(1);
  });
});
