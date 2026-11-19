import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { listenForEscape } from './escapeLayer';

/** A document and a window as plain event targets, with the listener calls on the document recorded. */
function fakePage() {
  const document = new EventTarget();
  const window = new EventTarget();
  const captured: Array<{ listener: EventListener; capture: boolean }> = [];
  const target = {
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      captured.push({ listener: listener as EventListener, capture: options === true });
      document.addEventListener(type, listener, options);
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
      document.removeEventListener(type, listener, options);
    }
  };
  return { document, window, target, captured };
}

describe('Escape on a layer above the player', () => {
  it('registers in the capture phase and removes the same listener on cleanup', () => {
    const { target, captured } = fakePage();
    const removed: unknown[] = [];
    const spy = { ...target, removeEventListener: (...args: unknown[]) => { removed.push(args); } };
    const stop = listenForEscape(spy as never, () => undefined);
    assert.equal(captured.length, 1);
    assert.equal(captured[0]!.capture, true);
    stop();
    assert.equal(removed.length, 1);
    assert.equal((removed[0] as unknown[])[1], captured[0]!.listener);
    assert.equal((removed[0] as unknown[])[2], true);
  });

  it('closes the layer on Escape and keeps the player behind it from hearing the key', () => {
    const { document, window, target } = fakePage();
    let closed = 0;
    let playerCollapsed = 0;
    // The player's handler listens on the window in the bubble phase.
    window.addEventListener('keydown', () => { playerCollapsed += 1; });
    listenForEscape(target, () => { closed += 1; });
    // Real events bubble document -> window; mimic that and honour stopPropagation.
    const press = (key: string): Event => {
      const event = new Event('keydown', { cancelable: true }) as Event & { key: string };
      event.key = key;
      document.dispatchEvent(event);
      if (!event.cancelBubble) window.dispatchEvent(event);
      return event;
    };
    const first = press('Escape');
    assert.equal(closed, 1);
    assert.equal(playerCollapsed, 0, 'the player must not collapse on the first Escape');
    assert.equal(first.defaultPrevented, true);
    press('a');
    assert.equal(closed, 1);
    assert.equal(playerCollapsed, 1, 'other keys still reach the player');
  });

  it('is what the karaoke info popover uses, and gives focus back to its button', () => {
    const source = readFileSync(new URL('../components/PlayerPanel.tsx', import.meta.url), 'utf8');
    const popover = source.slice(source.indexOf('function KaraokeStatus'));
    assert.match(popover, /listenForEscape\(document,/);
    assert.match(popover, /infoButtonRef\.current\?\.focus\(\)/);
  });
});
