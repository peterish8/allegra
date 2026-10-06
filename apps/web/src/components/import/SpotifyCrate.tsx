'use client';

import { AnimatePresence, motion } from 'motion/react';
import type { Variants } from 'motion/react';
import { Heart } from 'lucide-react';
import { useState } from 'react';
import type { Ref } from 'react';

import { SPOTIFY_LIKED_ID, type SpotifySourcePlaylist } from '@shared/spotify';

import { crateStack } from '@shared/importCrate';
import { motionTokens } from '../../motion';

/** Only Spotify's own https image hosts reach an <img>. */
export const safeCover = (url: string | null | undefined): string | null => (url && /^https:\/\/[a-z0-9.-]+\.(scdn\.co|spotifycdn\.com)\//i.test(url) ? url : null);

/** A source's cover as the list row and the crate both draw it. */
export function SourceCover({ playlist, size }: { readonly playlist: SpotifySourcePlaylist; readonly size: number }) {
  const cover = safeCover(playlist.imageUrl);
  if (playlist.kind === 'liked' || playlist.id === SPOTIFY_LIKED_ID) return <span className="spotify-source__cover is-liked" aria-hidden="true"><Heart size={size * 0.38} fill="currentColor" /></span>;
  if (cover) return <img className="spotify-source__cover" src={cover} alt="" width={size} height={size} loading="lazy" />;
  return <span className="spotify-source__cover is-blank" aria-hidden="true">{playlist.name.slice(0, 1).toUpperCase()}</span>;
}

/** Depth 0 is the top sleeve; each one under it fans a little further left and back. */
const fanned = (depth: number, lifted: boolean) => lifted
  ? { opacity: 1, x: 0, y: -8, rotate: -5, scale: 1 }
  : { opacity: 1, x: depth * -7, y: 0, rotate: depth * -7, scale: 1 - depth * 0.04 };

type Leave = 'deal' | 'drop';

/**
 * The crate in the transfer dock: the picked sources as a small fanned stack with a count. A sleeve
 * lands just as its flying cover arrives; while transferring, the source running now lifts out of
 * the stack and a finished one is dealt away. Decorative: the count is also in the text above.
 */
export function SpotifyCrate({ sources, ids, liftId, transferring, reduced, slotRef }: {
  readonly sources: ReadonlyMap<string, SpotifySourcePlaylist>;
  /** Everything in the crate, bottom to top. */
  readonly ids: readonly string[];
  readonly liftId: string | null;
  readonly transferring: boolean;
  readonly reduced: boolean;
  /** Where the top sleeve sits: the target of a cover flying in. */
  readonly slotRef: Ref<HTMLSpanElement>;
}) {
  const stack = crateStack(ids);
  const leave: Leave = transferring ? 'deal' : 'drop';
  return (
    <div className={`spotify-crate${ids.length === 0 ? ' is-empty' : ''}`} aria-hidden="true">
      <span className="spotify-crate__slot" ref={slotRef} />
      <AnimatePresence initial={false} custom={leave}>
        {stack.map((id, index) => {
          const playlist = sources.get(id);
          const depth = stack.length - 1 - index;
          return playlist ? <Sleeve key={id} playlist={playlist} layer={index + 1} depth={depth} lifted={depth === 0 && liftId === id} land={!transferring && !reduced} reduced={reduced} /> : null;
        })}
      </AnimatePresence>
      {ids.length > 0 ? <span className="spotify-crate__count">{ids.length}</span> : null}
    </div>
  );
}

const leaving: Variants = {
  gone: (how: Leave) => how === 'deal'
    ? { opacity: 0, x: 36, y: -22, rotate: 12, transition: { duration: motionTokens.duration.deal, ease: motionTokens.ease.accelerate } }
    : { opacity: 0, transition: { duration: motionTokens.duration.instant, ease: motionTokens.ease.standard } }
};
const leavingReduced: Variants = { gone: { opacity: 0, transition: { duration: motionTokens.duration.instant, ease: motionTokens.ease.standard } } };

function Sleeve({ playlist, layer, depth, lifted, land, reduced }: {
  readonly playlist: SpotifySourcePlaylist;
  readonly layer: number;
  readonly depth: number;
  readonly lifted: boolean;
  /** Picked just now: wait for the flying cover to arrive before appearing. */
  readonly land: boolean;
  readonly reduced: boolean;
}) {
  // Only the first appearance waits; later fan shifts move at once.
  const [delay, setDelay] = useState(land ? motionTokens.duration.flight : 0);
  return (
    <motion.span
      className="spotify-crate__sleeve"
      style={{ zIndex: layer }}
      variants={reduced ? leavingReduced : leaving}
      initial={{ opacity: 0, scale: reduced ? 1 : 0.92 }}
      animate={reduced ? { opacity: 1 } : fanned(depth, lifted)}
      exit="gone"
      transition={{ duration: reduced ? motionTokens.duration.instant : motionTokens.duration.base, ease: motionTokens.ease.decelerate, delay }}
      onAnimationComplete={() => { if (delay !== 0) setDelay(0); }}
    >
      <SourceCover playlist={playlist} size={44} />
    </motion.span>
  );
}
