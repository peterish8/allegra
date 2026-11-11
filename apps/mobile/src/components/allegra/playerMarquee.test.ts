import {
  MARQUEE_SPEED, PLAYER_ARTIST_REST_MS, PLAYER_TITLE_REST_MS, PLAYER_TITLE_SPEED, marqueeLoop, miniPlayerLine,
  swapMarqueeDirection, swapMarqueeKey,
} from './marqueeMath';

describe('scrolling song lines (1.41.0)', () => {
  it('rests 5 seconds between title loops and 3 between artist loops, and scrolls slower than the default', () => {
    expect(PLAYER_TITLE_REST_MS).toBe(5000);
    expect(PLAYER_ARTIST_REST_MS).toBe(3000);
    expect(PLAYER_TITLE_SPEED).toBeLessThan(MARQUEE_SPEED);
  });

  it('scrolls only a line that does not fit', () => {
    expect(marqueeLoop(200, 300).distance).toBe(0);
    const loop = marqueeLoop(500, 300, 48, PLAYER_TITLE_SPEED);
    expect(loop.distance).toBe(548);
    expect(loop.duration).toBe(Math.round((548 / PLAYER_TITLE_SPEED) * 1000));
  });

  it('shows the mini player as one line, "Song • Artist", like Spotify', () => {
    expect(miniPlayerLine('Low Tide', 'Harbor Kids')).toBe('Low Tide • Harbor Kids');
    expect(miniPlayerLine('Low Tide', '')).toBe('Low Tide');
    expect(miniPlayerLine('Low Tide', undefined)).toBe('Low Tide');
    expect(miniPlayerLine('  ', 'Someone')).toBe('Not playing • Someone');
  });

  it('keys title swaps by song and text, while same-song metadata changes settle neutrally', () => {
    expect(swapMarqueeKey('song-a', 'Intro')).not.toBe(swapMarqueeKey('song-b', 'Intro'));
    expect(swapMarqueeKey('song-a', 'Old title')).not.toBe(swapMarqueeKey('song-a', 'New title'));
    expect(swapMarqueeDirection('song-a', 'song-a', -1)).toBe(0);
    expect(swapMarqueeDirection('song-a', 'song-b', -1)).toBe(-1);
  });
});
