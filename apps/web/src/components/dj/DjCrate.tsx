import { GripVertical, Play, Sparkles, X } from 'lucide-react';
import { Reorder, motion, useDragControls } from 'motion/react';
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react';

import type { UnifiedSong } from '@shared/types';

import type { DjPick } from '../../hooks/useDjSession';
import { moveId, orderByIds } from '../../lib/djSession';
import { motionTokens, reducedTransition } from '../../motion';
import { Artwork } from '../ui';

/** How long after a drag a click is still the drag finishing, not a tap. */
const DRAG_TAIL_MS = 90;
/** Rows past this index arrive together instead of queueing up for seconds. */
const MAX_STAGGERED = 8;
/** A row rises this far (px) while it fades in. */
const RISE_PX = 8;

export interface DjCrateProps {
  readonly items: readonly DjPick[];
  /** False for songs the DJ did not pick (an album queue): they play, but cannot be moved or removed. */
  readonly editable: boolean;
  readonly reduced: boolean;
  readonly label: string;
  /** Title, count, and the one action (Start this set / Save playlist). */
  readonly header: ReactNode;
  /** Shown above the header: the song playing now. */
  readonly lead?: ReactNode;
  /** Shown instead of the list when there is nothing in it. */
  readonly empty?: ReactNode;
  readonly onPlay: (song: UnifiedSong) => void;
  /** Called once a drag or a keyboard move settles. Return false when the move was refused, so the list snaps back. */
  readonly onReorder: (ids: readonly string[]) => boolean | void;
  readonly onRemove: (id: string) => void;
}

/**
 * The DJ's queue box: the song playing now on top (`lead`), then what comes next, one song per line:
 * position, cover, title over artist, the reason for the pick, and the controls. Tap or Enter anywhere
 * on a row plays from that song; the grip (or Alt + up/down) reorders; the cross removes. The list owns
 * only the order while it is being changed.
 */
export function DjCrate({ items, editable, reduced, label, header, lead, empty, onPlay, onReorder, onRemove }: DjCrateProps) {
  const unique = useMemo(() => {
    const seen = new Set<string>();
    return items.filter((pick) => !seen.has(pick.song.id) && Boolean(seen.add(pick.song.id)));
  }, [items]);
  const ids = useMemo(() => unique.map((pick) => pick.song.id), [unique]);
  const key = ids.join('\u0000');

  // The order shown while dragging. It resets to the real one whenever the real one changes.
  const [order, setOrder] = useState<readonly string[]>(ids);
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    setSeenKey(key);
    setOrder(ids);
  }
  const orderRef = useRef(order);
  orderRef.current = order;
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const [announcement, setAnnouncement] = useState('');
  const draggedRef = useRef(false);

  const ordered = useMemo(() => orderByIds(unique, order, (pick) => pick.song.id), [order, unique]);

  const commit = useCallback((next: readonly string[]): void => {
    if (next.join('\u0000') === idsRef.current.join('\u0000')) return;
    if (onReorder(next) === false) {
      setOrder(idsRef.current);
      orderRef.current = idsRef.current;
    }
  }, [onReorder]);

  const dragOrder = useCallback((next: string[]): void => {
    orderRef.current = next;
    setOrder(next);
  }, []);

  const moveBy = useCallback((id: string, delta: number): void => {
    const next = moveId(orderRef.current, id, delta);
    if (next.join('\u0000') === orderRef.current.join('\u0000')) return;
    orderRef.current = next;
    setOrder(next);
    commit(next);
    const pick = unique.find((item) => item.song.id === id);
    setAnnouncement(`${pick?.song.title ?? 'Song'} moved to position ${next.indexOf(id) + 1} of ${next.length}.`);
  }, [commit, unique]);

  const startDrag = useCallback((): void => {
    draggedRef.current = true;
  }, []);

  const endDrag = useCallback((): void => {
    window.setTimeout(() => { draggedRef.current = false; }, DRAG_TAIL_MS);
    commit(orderRef.current);
  }, [commit]);

  const rows = ordered.map((pick, index) => (
    <Row
      key={pick.song.id}
      pick={pick}
      index={index}
      reduced={reduced}
      editable={editable}
      draggedRef={draggedRef}
      onPlay={onPlay}
      onRemove={onRemove}
      onMove={moveBy}
      onDragStart={startDrag}
      onDragEnd={endDrag}
    />
  ));

  return (
    <section className="dj-crate" aria-label={label}>
      {lead}
      <div className="dj-crate-head">{header}</div>
      {rows.length === 0 ? empty : editable ? (
        <Reorder.Group as="ul" className="dj-crate-list" axis="y" values={[...order]} onReorder={dragOrder}>
          {rows}
        </Reorder.Group>
      ) : (
        <ul className="dj-crate-list">{rows}</ul>
      )}
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    </section>
  );
}

interface RowProps {
  readonly pick: DjPick;
  readonly index: number;
  readonly reduced: boolean;
  readonly editable: boolean;
  readonly draggedRef: { readonly current: boolean };
  readonly onPlay: (song: UnifiedSong) => void;
  readonly onRemove: (id: string) => void;
  readonly onMove: (id: string, delta: number) => void;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
}

function Row({ pick, index, reduced, editable, draggedRef, onPlay, onRemove, onMove, onDragStart, onDragEnd }: RowProps) {
  const { song, reason } = pick;
  const controls = useDragControls();

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!editable || !event.altKey) return;
    const back = event.key === 'ArrowUp';
    const forward = event.key === 'ArrowDown';
    if (!back && !forward) return;
    event.preventDefault();
    onMove(song.id, back ? -1 : 1);
  };

  // A new row arrives with a small rise and a fade, one after another. Opacity alone under reduced motion.
  const delay = reduced ? 0 : Math.min(index, MAX_STAGGERED) * motionTokens.stagger;
  const body = (
    <motion.div
      className="dj-row"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: RISE_PX }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={reduced ? reducedTransition : { duration: motionTokens.duration.deal, delay, ease: motionTokens.ease.decelerate }}
    >
      <button
        type="button"
        className="dj-row-play"
        aria-label={`Play ${song.title} by ${song.artist}${reason ? `. ${reason}` : ''}`}
        onClick={() => { if (!draggedRef.current) onPlay(song); }}
        onKeyDown={onKeyDown}
      >
        <span className="dj-row-index" aria-hidden="true"><span>{index + 1}</span><Play size={13} fill="currentColor" /></span>
        <Artwork song={song} size="small" />
        <span className="dj-row-copy">
          <strong>{song.title}</strong>
          <small>{song.artist}</small>
          {reason ? <em title={reason}><Sparkles size={10} aria-hidden="true" />{reason}</em> : null}
        </span>
      </button>
      {editable ? (
        <span className="dj-row-tools">
          <span className="dj-row-grip" aria-hidden="true" onPointerDown={(event) => controls.start(event)}><GripVertical size={16} /></span>
          <button type="button" className="dj-row-remove" onClick={() => onRemove(song.id)} aria-label={`Remove ${song.title}`}><X size={15} /></button>
        </span>
      ) : null}
    </motion.div>
  );

  if (!editable) return <li className="dj-row-item" data-index={index}>{body}</li>;
  return (
    <Reorder.Item
      as="li"
      className="dj-row-item"
      data-index={index}
      value={song.id}
      transition={reduced ? { duration: 0 } : undefined}
      dragListener={false}
      dragControls={controls}
      whileDrag={reduced ? undefined : { scale: 1.02 }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {body}
    </Reorder.Item>
  );
}
