import { cardCoverRect, coverFrame, coverRadius, ghostVisible, heroCoverRect, miniContentOpacity, playerContentOpacity, settleTarget, type Rect } from './playerTransition';

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
    expect(half.width).toBeCloseTo(194, 5);
    expect(half.y).toBeCloseTo(410, 5);
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
    expect(miniContentOpacity(0.125)).toBeCloseTo(0.5, 5);
    expect(miniContentOpacity(0.25)).toBe(0);
    expect(miniContentOpacity(1)).toBe(0);
  });

  it('brings the player\'s text in only once the cover has mostly arrived', () => {
    expect(playerContentOpacity(0.5)).toBe(0);
    expect(playerContentOpacity(0.6)).toBe(0);
    expect(playerContentOpacity(0.75)).toBeCloseTo(0.5, 5);
    expect(playerContentOpacity(0.9)).toBe(1);
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
