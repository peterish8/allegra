import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { continuePlainLyrics, plainLyricsProgress, plainLyricsScroll } from '../../../../packages/shared/plainLyrics.ts';
import { LyricsPanel } from '../components/LyricsPanel.tsx';
import { PlayheadStore } from './playhead.ts';
import { parseSettings } from './settings.ts';

test('plain lyrics scroll steadily after the intro and clamp at either end', () => {
  assert.equal(plainLyricsProgress(5, 210), 0);
  assert.equal(plainLyricsProgress(110, 210), 0.5);
  assert.equal(plainLyricsScroll(110, 210, 1600, 600), 500);
  assert.equal(plainLyricsScroll(999, 210, 1600, 600), 1000);
  assert.equal(plainLyricsScroll(-20, 210, 1600, 600), 0);
  assert.equal(plainLyricsScroll(110, 210, 400, 600), 0);
  assert.equal(plainLyricsProgress(100, 0), 0);
  assert.equal(plainLyricsProgress(100, NaN), 0);
  assert.equal(plainLyricsProgress(2.5, 5), 0.5);
});

test('after a manual scroll, reading continues from that place at the same pace', () => {
  assert.equal(continuePlainLyrics(110, 210, 1600, 600, 110, 800), 800);
  assert.equal(continuePlainLyrics(120, 210, 1600, 600, 110, 800), 850);
  assert.equal(continuePlainLyrics(120, 210, 1600, 600, 110, 200), 250);
  assert.equal(continuePlainLyrics(210, 210, 1600, 600, 110, 800), 1000);
  assert.equal(continuePlainLyrics(6, 210, 1600, 600, 4, 500), 510, 'manual reading also overrides the intro hold');
});

test('plain lyrics stay readable without presenting estimated timestamps as seek buttons or sung words', () => {
  const markup = renderToStaticMarkup(createElement(LyricsPanel, {
    lines: [{ timestamp: 0, text: 'First line', lineOrder: 0 }, { timestamp: 4, text: 'Second line', lineOrder: 1 }],
    type: 'plain', duration: 210, playhead: new PlayheadStore(), loading: false, error: null,
    onRetry: () => {}, onSeek: () => {},
  }));
  assert.match(markup, /<p[^>]*is-plain[^>]*>First line/);
  assert.doesNotMatch(markup, /aria-current|lyric-word__fill|Adjust lyrics timing/);
  assert.match(markup, /Pause lyrics auto-scroll/);
});

test('plain lyric auto-scroll defaults on and preserves the listener choice', () => {
  assert.equal(parseSettings(null).autoScrollPlainLyrics, true);
  assert.equal(parseSettings('{"autoScrollPlainLyrics":false}').autoScrollPlainLyrics, false);
  assert.equal(parseSettings('{"autoScrollPlainLyrics":"off"}').autoScrollPlainLyrics, true);
});
