import { getLyricsFriendlyError, lyricaService } from './LyricaService';
import { continuePlainLyrics, plainLyricsScroll } from '@shared/plainLyrics';

describe('plain lyrics', () => {
  it('preserves words without inventing sung-line times', () => {
    const lines = lyricaService.parseLrc('First line\n\nSecond line', 210);
    expect(lines.map(line => line.timestamp)).toEqual([0, 0]);
    expect(lines.map(line => line.text)).toEqual(['First line', 'Second line']);
  });
  it('keeps real line timings intact', () => {
    expect(lyricaService.parseLrc('[00:12.00]First line\n[00:17.00]Second line').map(line => line.timestamp)).toEqual([12, 17]);
  });
  it('scrolls proportionally after the intro, independently of the number of words', () => {
    expect(plainLyricsScroll(110, 210, 1600, 600)).toBe(500);
    expect(plainLyricsScroll(2, 210, 1600, 600)).toBe(0);
    expect(plainLyricsScroll(210, 210, 1600, 600)).toBe(1000);
  });
  it('continues from the place the reader scrolled to, without jumping back', () => {
    expect(continuePlainLyrics(110, 210, 1600, 600, 110, 800)).toBe(800);
    expect(continuePlainLyrics(120, 210, 1600, 600, 110, 800)).toBe(850);
    expect(continuePlainLyrics(6, 210, 1600, 600, 4, 500)).toBe(510);
  });
});

describe('getLyricsFriendlyError', () => {
  it('returns network message for fetch failures', () => {
    expect(getLyricsFriendlyError(new Error('Failed to fetch')))
      .toBe('No internet connection. Check your network and try again.');
  });

  it('returns timeout message for timed out errors', () => {
    expect(getLyricsFriendlyError(new Error('Request timed out')))
      .toBe('Lyrics request timed out. Please check connection and try again.');
  });

  it('returns provider-down message for 500 errors', () => {
    expect(getLyricsFriendlyError(new Error('500 server error')))
      .toBe('Lyrics service is temporarily unavailable. Please retry in a moment.');
  });

  it('returns rate limit message for 429 errors', () => {
    expect(getLyricsFriendlyError(new Error('429 rate limit exceeded')))
      .toBe('Too many requests. Please wait a moment and try again.');
  });

  it('returns not found message for 404 errors', () => {
    expect(getLyricsFriendlyError(new Error('404 not found')))
      .toBe('No lyrics found for this song.');
  });

  it('returns unavailable message for unknown errors', () => {
    expect(getLyricsFriendlyError(new Error('Something weird happened')))
      .toBe('Lyrics service is temporarily unavailable. Please retry in a moment.');
  });

  it('handles non-Error values gracefully', () => {
    expect(getLyricsFriendlyError('string error'))
      .toBe('Lyrics service is temporarily unavailable. Please retry in a moment.');
    expect(getLyricsFriendlyError(null))
      .toBe('Lyrics service is temporarily unavailable. Please retry in a moment.');
    expect(getLyricsFriendlyError(undefined))
      .toBe('Lyrics service is temporarily unavailable. Please retry in a moment.');
  });
});
