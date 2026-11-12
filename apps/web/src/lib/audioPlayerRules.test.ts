import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isCurrentMediaGeneration, playbackRejectionMessage, shouldHandlePlayerShortcut, shownAsPlaying, takeNextUnvisited, type RecoveryCursor } from './audioPlayerRules';

describe('shownAsPlaying', () => {
  it('an element that plays is shown as playing, even if its early play event was ignored', () => {
    assert.equal(shownAsPlaying({ paused: false, wantsPlay: true, shown: false }), true);
  });

  it('a paused element with a play request in flight keeps what is shown', () => {
    assert.equal(shownAsPlaying({ paused: true, wantsPlay: true, shown: true }), true);
    assert.equal(shownAsPlaying({ paused: true, wantsPlay: true, shown: false }), false);
  });

  it('a paused element with no play request is paused', () => {
    assert.equal(shownAsPlaying({ paused: true, wantsPlay: false, shown: true }), false);
  });
});

describe('audio player media event generations', () => {
  const current = {
    activeGeneration: 4,
    loadedGeneration: 4,
    activeSongId: 'song-b',
    loadedSongId: 'song-b',
    expectedSource: 'https://audio.test/b.mp3',
    currentSource: 'https://audio.test/b.mp3',
  };

  it('accepts events only from the loaded source for the active song', () => {
    assert.equal(isCurrentMediaGeneration(current), true);
    assert.equal(isCurrentMediaGeneration({ ...current, loadedGeneration: 3 }), false);
    assert.equal(isCurrentMediaGeneration({ ...current, loadedSongId: 'song-a' }), false);
    assert.equal(isCurrentMediaGeneration({ ...current, currentSource: 'https://audio.test/a.mp3' }), false);
  });

  it('distinguishes a blocked autoplay from a source that cannot load', () => {
    assert.match(playbackRejectionMessage('NotAllowedError'), /needs a tap/i);
    assert.match(playbackRejectionMessage('NotSupportedError'), /could not be loaded/i);
  });
});

describe('bounded recovery after an automatic track fails', () => {
  it('skips a failed track once and stops after each queue item has been visited', () => {
    const tracks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    let cursor: RecoveryCursor = { remaining: 2, visited: new Set(['a']) };
    const first = takeNextUnvisited(tracks.slice(1), cursor);
    assert.equal(first.candidate?.id, 'b');
    cursor = first.cursor;
    const second = takeNextUnvisited(tracks, cursor);
    assert.equal(second.candidate?.id, 'c');
    cursor = second.cursor;
    assert.equal(takeNextUnvisited(tracks, cursor).candidate, null);
  });
});

describe('global player keyboard shortcuts', () => {
  it('works on the page and ignores editing controls and overlays', () => {
    const page = { closest: () => null } as unknown as Element;
    assert.equal(shouldHandlePlayerShortcut(page, 'ArrowRight'), true);
    for (const selector of ['input', 'textarea', 'button', '[role="dialog"]', '[role="menu"]', '[role="slider"]', '[contenteditable="true"]']) {
      const target = { closest: (query: string) => query.includes(selector) ? {} : null } as unknown as Element;
      assert.equal(shouldHandlePlayerShortcut(target, 'ArrowRight'), false);
    }
    assert.equal(shouldHandlePlayerShortcut(page, 'Escape'), false);
  });
});
