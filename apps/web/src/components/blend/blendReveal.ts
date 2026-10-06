import { useEffect, useState } from 'react';

import type { BlendDetail } from '@shared/blendView';

import { mixPalettes } from '../../lib/blendPalette';
import { DEFAULT_PALETTE, extractPalette, type Palette } from '../../lib/palette';

type RevealIdentity = Pick<BlendDetail, 'id' | 'builtFor' | 'buildVersion' | 'members'>;

/** The reveal plays once per build; storage may be unavailable, in which case it simply plays. */
export function revealKey(detail: RevealIdentity): string {
  return `blend-revealed:${detail.members.find(member => member.isYou)?.userId ?? 'guest'}:${detail.id}:${detail.builtFor}:${detail.buildVersion ?? 0}`;
}

export function revealSeen(detail: RevealIdentity): boolean {
  try {
    return window.localStorage.getItem(revealKey(detail)) === '1';
  } catch {
    return false;
  }
}

export function markRevealSeen(detail: RevealIdentity): void {
  try {
    window.localStorage.setItem(revealKey(detail), '1');
  } catch {
    // Not remembered: the reveal plays again next visit.
  }
}

/** Each member's first own track's cover, mixed in OKLab. */
export function useBlendPalette(detail: BlendDetail): Palette | null {
  const [palette, setPalette] = useState<Palette | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const covers = detail.members.slice(0, 2).map((member) => detail.tracks.find((track) => track.for.includes(member.userId))?.song.artwork ?? '');
    void Promise.all(covers.map((src) => (src ? extractPalette(src, controller.signal).catch(() => DEFAULT_PALETTE) : Promise.resolve(DEFAULT_PALETTE))))
      .then(([a, b]) => { if (!controller.signal.aborted) setPalette(mixPalettes(a ?? DEFAULT_PALETTE, b ?? DEFAULT_PALETTE)); });
    return () => controller.abort();
  }, [detail]);
  return palette;
}
