// HTMLMediaElement ready states, spelled out so this module also loads where the DOM global does not.
const HAVE_METADATA = 1;
const HAVE_FUTURE_DATA = 3;

/**
 * The player points the element at a new song in an effect after React renders, so right after a
 * song is selected the element still holds the previous one. Resolves once `src` is the new stream
 * (the effect's `load()` fires `loadstart`); events rather than polling, since hidden tabs throttle timers.
 */
export function waitForAudioSource(audio: HTMLMediaElement, src: string, timeoutMs = 5_000): Promise<boolean> {
  if (audio.getAttribute('src') === src) return Promise.resolve(true);
  return new Promise(resolve => {
    const finish = (matches: boolean): void => {
      clearTimeout(timer);
      audio.removeEventListener('loadstart', onStart);
      resolve(matches);
    };
    const onStart = (): void => { if (audio.getAttribute('src') === src) finish(true); };
    const timer = setTimeout(() => finish(audio.getAttribute('src') === src), timeoutMs);
    audio.addEventListener('loadstart', onStart);
  });
}

/** Resolves once a seek can land: the element knows its duration. False on error or timeout. */
export function waitForAudioMetadata(audio: HTMLMediaElement, timeoutMs = 12_000): Promise<boolean> {
  if (audio.readyState >= HAVE_METADATA) return Promise.resolve(true);
  // A failed or emptied element sends no further events: start the load again.
  if (audio.error || audio.networkState === 3) audio.load();
  return new Promise(resolve => {
    const finish = (ready: boolean): void => {
      clearTimeout(timer);
      audio.removeEventListener('loadedmetadata', onReady);
      audio.removeEventListener('error', onError);
      resolve(ready);
    };
    const onReady = (): void => finish(true);
    const onError = (): void => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    audio.addEventListener('loadedmetadata', onReady);
    audio.addEventListener('error', onError);
  });
}

/**
 * Resolves true when the element could start this track the moment it is told to: enough data is
 * buffered (`canplay`). The player loads with `preload="metadata"`, so a paused track would stop at
 * the header; the preload hint is raised while waiting. Metadata alone does not mean audio can play.
 */
export function waitForAudioReady(audio: HTMLMediaElement, timeoutMs = 3_500): Promise<boolean> {
  if (audio.error) return Promise.resolve(false);
  if (audio.readyState >= HAVE_FUTURE_DATA) return Promise.resolve(true);
  const previousPreload = audio.preload;
  audio.preload = 'auto';
  return new Promise(resolve => {
    const finish = (ready: boolean): void => {
      clearTimeout(timer);
      audio.removeEventListener('canplay', onReady);
      audio.removeEventListener('error', onError);
      if (audio.preload === 'auto') audio.preload = previousPreload;
      resolve(ready);
    };
    const onReady = (): void => finish(true);
    const onError = (): void => finish(false);
    const timer = setTimeout(() => finish(!audio.error && audio.readyState >= HAVE_FUTURE_DATA), timeoutMs);
    audio.addEventListener('canplay', onReady);
    audio.addEventListener('error', onError);
  });
}
