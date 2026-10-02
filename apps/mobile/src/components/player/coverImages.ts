/**
 * Decoded cover images for the Now Playing backdrop.
 *
 * Skia's own `useImage` keeps returning the previous cover until the next one has downloaded and
 * decoded, so a screen cannot tell "the new cover" from "the old one still standing in". This holds
 * the decoded covers by uri instead: a hook that answers only for the uri it was given, and a
 * prefetch the player calls for the song after the current one, so a skip finds its cover ready and
 * the backdrop changes together with the title instead of a beat behind it.
 *
 * Skia and expo-image are required lazily so the player store can import this in a plain Node test.
 */
import { useEffect, useState } from 'react';
import type { SkImage } from '@shopify/react-native-skia';
import { createImageCache } from './imageCache';

const COVER_RETRY_MS = 1500;

const decoded = createImageCache<SkImage>(async uri => {
  const { Skia } = require('@shopify/react-native-skia') as typeof import('@shopify/react-native-skia');
  const data = await Skia.Data.fromURI(uri);
  return Skia.Image.MakeImageFromEncoded(data);
});

/** Warm the next cover: the disk cache for the cover card, and the decoded copy for the backdrop. */
export function prefetchCover(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const { Image } = require('expo-image') as typeof import('expo-image');
    Image.prefetch(uri, 'memory-disk').catch(() => undefined);
  } catch { /* a missing native module is only a missed head start */ }
  decoded.load(uri).catch(() => undefined);
}

interface CoverImage {
  /** The decoded cover for exactly this uri, or null while it loads (never another song's). */
  readonly image: SkImage | null;
  /** The cover could not be loaded: show the song's colours instead. */
  readonly failed: boolean;
}

export function useCoverImage(uri: string | null | undefined): CoverImage {
  const [state, setState] = useState<{ uri: string | null | undefined; image: SkImage | null; failed: boolean }>(
    () => ({ uri, image: (uri ? decoded.peek(uri) : undefined) ?? null, failed: false }),
  );

  useEffect(() => {
    if (!uri) {
      setState({ uri, image: null, failed: false });
      return undefined;
    }
    const held = decoded.peek(uri);
    if (held) {
      setState({ uri, image: held, failed: false });
      return undefined;
    }
    let current = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setState({ uri, image: null, failed: false });
    // A cover that fails to load once (a dropped connection while the phone is busy streaming) is tried
    // again shortly, twice, before the player settles for the song's colours. It used to stay blank
    // until the player was closed and opened again.
    const attempt = (triesLeft: number): void => {
      decoded.load(uri).then(image => {
        if (!current) return;
        if (image === null && triesLeft > 0) { retry = setTimeout(() => attempt(triesLeft - 1), COVER_RETRY_MS); return; }
        setState({ uri, image, failed: image === null });
      }).catch(() => undefined);
    };
    attempt(2);
    return () => { current = false; if (retry) clearTimeout(retry); };
  }, [uri]);

  // The render before the effect runs still has the last uri's state: answer for this uri only.
  if (state.uri !== uri) {
    const held = uri ? decoded.peek(uri) : undefined;
    return { image: held ?? null, failed: false };
  }
  return { image: state.image, failed: state.failed };
}
