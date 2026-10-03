import { formatLrcTime, hasLrcTimestamps, parseClock, toLineLrc, toTimedLrc, ttmlToLrc } from './lrc';
import { lyricaService } from '../LyricaService';
import { parseTimestampedLyrics } from '../../utils/timestampParser';

describe('formatLrcTime', () => {
  it('formats milliseconds as [mm:ss.xx]', () => {
    expect(formatLrcTime(0)).toBe('[00:00.00]');
    expect(formatLrcTime(83_456)).toBe('[01:23.45]');
    expect(formatLrcTime(-5)).toBe('[00:00.00]');
  });
});

describe('parseClock', () => {
  it('handles every TTML clock form', () => {
    expect(parseClock('12.5s')).toBe(12_500);
    expect(parseClock('340ms')).toBe(340);
    expect(parseClock('01:02.345')).toBe(62_345);
    expect(parseClock('1:02:03.4')).toBe(3_723_400);
    expect(parseClock('7.5')).toBe(7_500);
  });

  it('rejects garbage', () => {
    expect(parseClock(undefined)).toBeNull();
    expect(parseClock('abc')).toBeNull();
    expect(parseClock('1::2')).toBeNull();
  });
});

describe('ttmlToLrc', () => {
  const ttml = `<tt xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div>
    <p begin="00:01.000" end="00:03.000"><span begin="00:01.000">Hello</span> <span begin="00:01.500">world</span></p>
    <p begin="4.25s"><span>Main</span> <span ttm:role="x-bg"><span>(ooh</span> <span>yeah)</span></span> <span>line</span></p>
    <p begin="00:06.000">Tom &amp; Jerry&#39;s</p>
    <p>no timing</p>
  </div></body></tt>`;

  it('keeps word spans as word tags, drops background vocals and decodes entities', () => {
    expect(ttmlToLrc(ttml)).toBe(
      [
        '[00:01.00]<00:01.000>Hello <00:01.500>world<00:01.800>',
        '[00:04.25]Main line',
        "[00:06.00]Tom & Jerry's",
      ].join('\n'),
    );
  });

  it('keeps syllables of one word together', () => {
    const syllabic = '<p begin="2s"><span begin="2s" end="2.2s">Beau</span><span begin="2.2s" end="2.4s">ti</span><span begin="2.4s" end="2.9s">ful</span> <span begin="3s" end="3.5s">day</span></p>';
    expect(ttmlToLrc(syllabic)).toBe('[00:02.00]<00:02.000>Beau<00:02.200>ti<00:02.400>ful <00:02.900><00:03.000>day<00:03.500>');
  });

  it('produces text the app parser reads as synced lines', () => {
    const lines = parseTimestampedLyrics(ttmlToLrc(ttml));
    expect(lines.map(l => [l.timestamp, l.text])).toEqual([
      [1, 'Hello world'],
      [4.25, 'Main line'],
      [6, "Tom & Jerry's"],
    ]);
  });

  it('reaches the player as lines with their word timings', () => {
    const lines = lyricaService.parseLrc(ttmlToLrc(ttml), 200);
    expect(lines[0].text).toBe('Hello world');
    expect(lines[0].words).toEqual([
      { text: 'Hello ', start: 1, end: 1.5 },
      { text: 'world', start: 1.5, end: 1.8 },
    ]);
    expect(lines[1].words).toBeUndefined();
  });
});

describe('toTimedLrc', () => {
  it('keeps word timings, drops bg markers and metadata tags', () => {
    expect(toTimedLrc('[ar:x]\n[00:10.00]{bg}<00:10.00>Word <00:10.50>by')).toBe('[00:10.00]<00:10.00>Word <00:10.50>by');
  });
});

describe('toLineLrc', () => {
  it('strips word timings, bg markers and metadata tags', () => {
    const enhanced = [
      '[ar:Someone]',
      '[offset:0]',
      '[00:10.00]{bg}<00:10.00>Word <00:10.50>by <00:11.00>word',
      '',
      '[00:12.00]Plain line',
    ].join('\n');
    expect(toLineLrc(enhanced)).toBe('[00:10.00]Word by word\n[00:12.00]Plain line');
  });
});

describe('hasLrcTimestamps', () => {
  it('detects synced text', () => {
    expect(hasLrcTimestamps('[00:01.00]hi')).toBe(true);
    expect(hasLrcTimestamps('just words\nmore words')).toBe(false);
  });
});
