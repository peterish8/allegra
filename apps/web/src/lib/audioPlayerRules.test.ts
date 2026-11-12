import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

import { afterSourceSwap, isCurrentMediaGeneration, playbackRejectionMessage, reopensQueueEnd, shouldHandlePlayerShortcut, shownAsPlaying, takeNextUnvisited, type RecoveryCursor } from './audioPlayerRules';

describe('afterSourceSwap', () => {
  it('a swap where neither source opened leaves nothing playing or waiting to play', () => {
    assert.equal(afterSourceSwap({ opened: false, wasPlaying: true, wantsPlay: true }), 'dead');
    assert.equal(afterSourceSwap({ opened: false, wasPlaying: false, wantsPlay: false }), 'dead');
  });

  it('resumes only when it was playing and nobody paused during the switch', () => {
    assert.equal(afterSourceSwap({ opened: true, wasPlaying: true, wantsPlay: true }), 'resume');
    assert.equal(afterSourceSwap({ opened: true, wasPlaying: true, wantsPlay: false }), 'stay');
    assert.equal(afterSourceSwap({ opened: true, wasPlaying: false, wantsPlay: true }), 'stay');
  });
});

describe('reopensQueueEnd', () => {
  it('reopens a queue that ended once the listener gives it somewhere to go', () => {
    // The last song ended with repeat off: the latch is set and no new song is loading.
    assert.equal(reopensQueueEnd({ latched: true, activeGeneration: 7, loadedGeneration: 7 }), true);
  });

  it('keeps the latch while a move to the next song is still loading', () => {
    // The near-end check already picked the next song; the old source must not advance twice.
    assert.equal(reopensQueueEnd({ latched: true, activeGeneration: 8, loadedGeneration: 7 }), false);
  });

  it('has nothing to reopen when the latch is not set', () => {
    assert.equal(reopensQueueEnd({ latched: false, activeGeneration: 7, loadedGeneration: 7 }), false);
  });

  it('is applied by every edit that can give an ended queue a next song', () => {
    const hook = readFileSync(new URL('../hooks/useAudioPlayer.ts', import.meta.url), 'utf8');
    for (const name of ['appendQueue', 'replaceUpcoming', 'cycleRepeat', 'toggleShuffle']) {
      const start = hook.indexOf(`const ${name} = useCallback(`);
      assert.ok(start >= 0, `${name} exists`);
      const body = hook.slice(start, hook.indexOf('\n  }, [', start));
      assert.match(body, /reopenQueueEnd\(\)/, `${name} reopens an ended queue`);
    }
  });
});

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
