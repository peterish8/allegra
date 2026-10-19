jest.mock('./nativeModule', () => ({ getNativeModule: jest.fn() }));

import { getNativeModule } from './nativeModule';
import { notifyIslandAppShown, notifyIslandAppShownAfterDraw, setIslandLyrics } from './NativeDynamicIsland';

const nativeModule = jest.mocked(getNativeModule);
const appShown = jest.fn();
const frames = new Map<number, (time: number) => void>();
const originalRequest = globalThis.requestAnimationFrame;
const originalCancel = globalThis.cancelAnimationFrame;
let frameId = 0;

const drawFrame = () => {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach(frame => frame(0));
};

beforeEach(() => {
  frames.clear();
  frameId = 0;
  appShown.mockReset();
  nativeModule.mockReset().mockReturnValue({ appShown });
  globalThis.requestAnimationFrame = callback => {
    frames.set(++frameId, callback);
    return frameId;
  };
  globalThis.cancelAnimationFrame = id => { frames.delete(id); };
});

afterAll(() => {
  globalThis.requestAnimationFrame = originalRequest;
  globalThis.cancelAnimationFrame = originalCancel;
});

it('leaves the launch overlay up until Now Playing has had two frames to draw', () => {
  notifyIslandAppShownAfterDraw();
  expect(appShown).not.toHaveBeenCalled();
  drawFrame();
  expect(appShown).not.toHaveBeenCalled();
  drawFrame();
  expect(appShown).toHaveBeenCalledTimes(1);
});

it.each([0, 1])('never acknowledges an unmounted player after %i frames', elapsed => {
  const cancel = notifyIslandAppShownAfterDraw();
  if (elapsed) drawFrame();
  cancel();
  drawFrame();
  drawFrame();
  expect(appShown).not.toHaveBeenCalled();
});

it('keeps the native readiness fallback usable on builds without the handshake', () => {
  nativeModule.mockReturnValue(null);
  expect(notifyIslandAppShown()).toBe(false);
  nativeModule.mockReturnValue({});
  expect(notifyIslandAppShown()).toBe(false);
  nativeModule.mockReturnValue({ appShown: () => { throw new Error('context released'); } });
  expect(notifyIslandAppShown()).toBe(false);
});

it('sends word timing to an island that reads it, and plain line times to an older one', () => {
  const setLyrics = jest.fn();
  const setLyricsTiming = jest.fn();
  nativeModule.mockReturnValue({ setLyrics, setLyricsTiming });
  setIslandLyrics('song', [1000], ['Line'], '{"highlight":"letters","lines":[]}');
  expect(setLyricsTiming).toHaveBeenCalledWith('song', '{"highlight":"letters","lines":[]}');
  expect(setLyrics).not.toHaveBeenCalled();
  // An APK built before the timing call still gets its lines, so the island never goes blank.
  nativeModule.mockReturnValue({ setLyrics });
  setIslandLyrics('song', [1000], ['Line'], '{"highlight":"letters","lines":[]}');
  expect(setLyrics).toHaveBeenCalledWith('song', [1000], ['Line']);
});
