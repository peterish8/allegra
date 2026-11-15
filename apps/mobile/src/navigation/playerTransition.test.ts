import { SHEET_OVERPULL, cardCoverRect, coverFrame, coverRadius, ghostVisible, heroCoverRect, miniContentOpacity, miniRideY, playerContentOpacity, settleTarget, sheetProgressAt, sheetYForDrag, type Rect } from './playerTransition';

const mini: Rect = { x: 8, y: 700, width: 48, height: 48 };
const card: Rect = { x: 20, y: 120, width: 340, height: 340 };

describe('settleTarget', () => {
  it('lets a fast flick decide, whatever the distance', () => {
    expect(settleTarget(0.1, -1200, 600)).toBe('open');
    expect(settleTarget(0.9, 1200, 600)).toBe('closed');
  });

  it('goes where the finger was heading: past half opens, short of it closes', () => {
    expect(settleTarget(0.62, 0, 600)).toBe('open');
    expect(settleTarget(0.4, 0, 600)).toBe('closed');
  });

  it('adds a little momentum, so a slow upward drift tips a drag that stopped just short', () => {
    expect(settleTarget(0.45, -500, 600)).toBe('open');
    expect(settleTarget(0.55, 500, 600)).toBe('closed');
  });

  it('can be reversed midway: the same position settles either way depending on the last movement', () => {
    expect(settleTarget(0.5, -300, 600)).toBe('open');
    expect(settleTarget(0.5, 300, 600)).toBe('closed');
  });
});

describe('the cover on its way', () => {
  it('starts on the mini cover and ends on the player cover, never leaving the line between them', () => {
    expect(coverFrame(0, mini, card)).toEqual(mini);
    expect(coverFrame(1, mini, card)).toEqual(card);
    const half = coverFrame(0.5, mini, card);
    expect(half.width).toBeCloseTo(194, 1);
    expect(half.y).toBeCloseTo(410, 1);
  });

  it('stays inside the sheet as it travels from the measured mini cover', () => {
    // Sheet starts at y=680; the cover starts 20px inside it and lands at y=0.
    const hero = { x: 0, y: 0, width: 360, height: 400 };
    for (const p of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(coverFrame(p, mini, hero).y).toBeGreaterThanOrEqual(680 * (1 - p));
    }
  });

  it('keeps a square cover square all the way', () => {
    for (const p of [0.1, 0.33, 0.5, 0.8]) {
      const f = coverFrame(p, mini, card);
      expect(f.width).toBeCloseTo(f.height, 5);
    }
  });

  it('clamps outside 0..1, so a rubber-banded drag past the top never overshoots the cover', () => {
    expect(coverFrame(-0.2, mini, card)).toEqual(mini);
    expect(coverFrame(1.3, mini, card)).toEqual(card);
  });

  it('eases the corner radius from the mini cover\'s to the player\'s', () => {
    expect(coverRadius(0, 8, 14)).toBe(8);
    expect(coverRadius(1, 8, 14)).toBe(14);
    expect(coverRadius(0.5, 8, 14)).toBeCloseTo(9.5, 5);
  });
});

describe('what fades when', () => {
  it('clears the mini player\'s text before the cover grows over it', () => {
    expect(miniContentOpacity(0)).toBe(1);
    expect(miniContentOpacity(0.09)).toBeCloseTo(0.5, 5);
    expect(miniContentOpacity(0.18)).toBe(0);
    expect(miniContentOpacity(1)).toBe(0);
  });

  it('brings the player\'s text in only once the cover has mostly arrived', () => {
    expect(playerContentOpacity(0.3)).toBe(0);
    expect(playerContentOpacity(0.34)).toBe(0);
    expect(playerContentOpacity(0.53)).toBeCloseTo(0.5, 5);
    expect(playerContentOpacity(0.75)).toBe(1);
  });

  it('shows the moving cover only between the ends', () => {
    expect(ghostVisible(0)).toBe(false);
    expect(ghostVisible(0.4)).toBe(true);
    expect(ghostVisible(1)).toBe(false);
  });
});

describe('where the cover lands', () => {
  it('centres the card and keeps it square within the screen\'s margins', () => {
    const r = cardCoverRect(360, 800, 100);
    expect(r.width).toBe(312);
    expect(r.x).toBe(24);
    expect(r.y).toBe(100);
    expect(r.width).toBe(r.height);
  });

  it('never grows past 342, and shrinks on a short screen so it clears the controls', () => {
    expect(cardCoverRect(600, 1000, 100).width).toBe(342);
    expect(cardCoverRect(360, 520, 100).width).toBe(160);
  });

  it('puts the hero across the top of the screen', () => {
    expect(heroCoverRect(360, 400)).toEqual({ x: 0, y: 0, width: 360, height: 400 });
  });
});

// Regression (1.69.0): the sheet must track the finger 1:1 both ways at any speed, settle on release by position and
// velocity, turn around mid-flight, and end on exactly one mini player (the pill rode nothing and was drawn over a
// sheet still sliding above it at the end of every close).
describe('the sheet under a finger', () => {
  const restY = 600;

  it('follows the finger continuously in both directions, whatever the step size', () => {
    const grab = 0;
    let previous = sheetProgressAt(sheetYForDrag(grab, 0, restY), restY);
    expect(previous).toBe(1);
    // Down in uneven steps (slow, then a fast jump), then back up over the same path.
    const path = [3, 7, 20, 90, 260, 300, 420, 300, 120, 40, 5, 0];
    for (let i = 0; i < path.length; i++) {
      const p = sheetProgressAt(sheetYForDrag(grab, path[i], restY), restY);
      expect(p).toBeCloseTo(1 - path[i] / restY, 6);
      const goingDown = i === 0 || path[i] > path[i - 1];
      if (goingDown) expect(p).toBeLessThan(previous); else expect(p).toBeGreaterThan(previous);
      previous = p;
    }
  });

  it('carries on from where it was grabbed, so a grab mid-spring never jumps', () => {
    expect(sheetYForDrag(240, 0, restY)).toBe(240);
    expect(sheetYForDrag(240, -100, restY)).toBe(140);
    expect(sheetYForDrag(240, 100, restY)).toBe(340);
  });

  it('stops at the mini player and resists past the open edge instead of detaching', () => {
    expect(sheetYForDrag(500, 400, restY)).toBe(restY);
    const over = sheetYForDrag(0, -400, restY);
    expect(over).toBeLessThan(0);
    expect(over).toBeGreaterThan(-SHEET_OVERPULL);
    expect(Math.abs(sheetYForDrag(0, -40, restY))).toBeLessThan(40);
    expect(sheetProgressAt(over, restY)).toBe(1);
  });

  it('settles on release by position and velocity, including after a reversal', () => {
    // Dragged most of the way down, then pushed back up: the upward release reopens it.
    const y = sheetYForDrag(0, 420, restY);
    expect(settleTarget(sheetProgressAt(y, restY), 0, restY)).toBe('closed');
    expect(settleTarget(sheetProgressAt(sheetYForDrag(y, -40, restY), restY), -900, restY)).toBe('open');
    // A short, fast flick down closes; a slow short drag springs back open.
    expect(settleTarget(sheetProgressAt(sheetYForDrag(0, 30, restY), restY), 1200, restY)).toBe('closed');
    expect(settleTarget(sheetProgressAt(sheetYForDrag(0, 30, restY), restY), 100, restY)).toBe('open');
  });

  it('keeps the mini player on the sheet’s top edge at every point of the travel', () => {
    for (const p of [0, 0.02, 0.09, 0.18, 0.5, 0.9, 1]) {
      const sheetTop = restY * (1 - p);
      expect(restY + miniRideY(p, restY, false)).toBeCloseTo(sheetTop, 6);
    }
  });

  it('ends on one full-width mini player: in place, fully shown, the sheet gone under it', () => {
    expect(miniRideY(0, restY, false)).toBe(0);
    expect(miniContentOpacity(0)).toBe(1);
    expect(sheetProgressAt(restY, restY)).toBe(0);
    expect(ghostVisible(0)).toBe(false);
    // Over the last 18% of a close the pill comes in, but it is riding the sheet, never parked under it.
    expect(miniContentOpacity(0.09)).toBeGreaterThan(0);
    expect(restY + miniRideY(0.09, restY, false)).toBeCloseTo(restY * 0.91, 6);
  });

  it('keeps the pill still under Reduce Motion, where the sheet fades instead of sliding', () => {
    expect(miniRideY(0.5, restY, true)).toBe(0);
    expect(miniRideY(0, restY, true)).toBe(0);
  });
});
