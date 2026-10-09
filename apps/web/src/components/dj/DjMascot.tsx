import { useState, type CSSProperties } from 'react';

import type { DjEmotion } from '../../hooks/useDjSession';
import type { DjDanceVibe } from '../../lib/djDance';
import type { Palette } from '../../lib/palette';

/** The DJ's moods, plus the closed-eyed rest used while the local model is not loaded (plan 01-07). */
export type DjMascotEmotion = DjEmotion | 'sleeping';

export interface DjMascotProps {
  /** `stage` fills its container (the /dj hero); `mini` is a 44px mark for the mini player and prompt. */
  readonly size: 'stage' | 'mini';
  readonly emotion: DjMascotEmotion;
  /** The mascot's colours: the playing cover's palette, or the vibe's tone colours when nothing plays. */
  readonly palette: Palette;
  /** True while music plays: faint song marks drift up behind the orb. */
  readonly playing: boolean;
  /** How it dances while music plays (stage only). */
  readonly vibe?: DjDanceVibe;
  /** 0..1. When given, the orb fills from the bottom like a glass being poured (model download). */
  readonly progress?: number;
}

type Slot = 0 | 1;

interface Slots {
  readonly palettes: readonly [Palette, Palette];
  readonly active: Slot;
}

const keyOf = (palette: Palette): string => `${palette.primary}|${palette.secondary}|${palette.tertiary}`;

/**
 * Two colour slots that cross-fade. A new palette is written into the idle slot and the slot flips,
 * so every coloured layer dissolves from the old colours to the new by opacity alone: nothing snaps,
 * and no colour is ever animated.
 */
function useColourSlots(palette: Palette): Slots {
  const [slots, setSlots] = useState<Slots>({ palettes: [palette, palette], active: 0 });
  if (keyOf(slots.palettes[slots.active]) !== keyOf(palette)) {
    const next: Slot = slots.active === 0 ? 1 : 0;
    setSlots({
      palettes: next === 0 ? [palette, slots.palettes[1]] : [slots.palettes[0], palette],
      active: next
    });
  }
  return slots;
}

function slotStyle(palette: Palette): CSSProperties {
  return { '--m-a': palette.primary, '--m-b': palette.secondary, '--m-c': palette.tertiary } as CSSProperties;
}

/** One coloured layer, drawn once per slot; only the active slot is visible. */
function Tint({ slots, className }: { readonly slots: Slots; readonly className: string }) {
  return (
    <>
      {slots.palettes.map((palette, index) => (
        <span key={index} className="dj-m-slot" data-on={slots.active === index ? 'true' : 'false'} style={slotStyle(palette)}>
          <span className={className} />
        </span>
      ))}
    </>
  );
}

/**
 * Faint song marks that drift up behind the orb while music plays: a few thin notes and soft motes of
 * light, slow and barely there. Each has its own lane (--n-x, -1..1 of the orb's width), drift, size and
 * start delay, so the stream never repeats visibly.
 */
const NOTES: readonly { readonly kind: 'note' | 'mote'; readonly glyph: string; readonly style: CSSProperties }[] = [
  { kind: 'note', glyph: '♪', style: { '--n-x': -0.36, '--n-drift': 1, '--n-size': 1, '--n-delay': 0 } as CSSProperties },
  { kind: 'mote', glyph: '', style: { '--n-x': 0.22, '--n-drift': -1, '--n-size': 0.8, '--n-delay': 0.3 } as CSSProperties },
  { kind: 'note', glyph: '♫', style: { '--n-x': 0.42, '--n-drift': -1, '--n-size': 0.85, '--n-delay': 0.55 } as CSSProperties },
  { kind: 'mote', glyph: '', style: { '--n-x': -0.14, '--n-drift': 1, '--n-size': 0.6, '--n-delay': 0.8 } as CSSProperties }
];

/**
 * The DJ: a clear-glass orb tinted by the playing song. While music plays, faint song marks in its
 * colours drift up behind it. It shows the song's colours only, never its artwork.
 *
 * Plain DOM and CSS; every transform lives on its own layer so none fight: roam (translate), dance
 * (rotate, hop on beats), kick (scale on beats). The notes ride on the roam layer, so they come out of
 * wherever the mascot is but ignore its squash. The audio and the wander reach it only through custom
 * properties an ancestor sets (`useDjPulse`, `useDjRoam`), so nothing re-renders per frame.
 */
export function DjMascot({ size, emotion, palette, playing, vibe = 'steady', progress }: DjMascotProps) {
  const slots = useColourSlots(palette);
  const style: CSSProperties = progress !== undefined ? ({ '--m-p': Math.min(1, Math.max(0, progress)).toFixed(3) } as CSSProperties) : {};

  return (
    <div
      className={`dj-m dj-m--${size}`}
      data-emotion={emotion}
      data-playing={playing ? 'true' : 'false'}
      data-vibe={vibe}
      style={style}
      aria-hidden="true"
    >
      {size === 'stage' ? <div className="dj-m-stage-glow"><Tint slots={slots} className="dj-m-halo" /></div> : null}
      <div className="dj-m-roam">
        {size === 'stage' ? (
          <div className="dj-m-notes" style={slotStyle(palette)}>
            {NOTES.map((note, index) => <span key={index} className={`dj-m-note dj-m-note--${note.kind}`} style={note.style}>{note.glyph}</span>)}
          </div>
        ) : null}
        <div className="dj-m-dance">
          <div className="dj-m-kick">
            <div className="dj-m-glow"><Tint slots={slots} className="dj-m-light" /></div>
            <div className="dj-m-ring"><Tint slots={slots} className="dj-m-ring-line" /></div>
            <div className="dj-m-orb">
              <span className="dj-m-sheen" />
              {progress !== undefined ? <Tint slots={slots} className="dj-m-fill" /> : null}
            </div>
            <div className="dj-m-eyes">
              <span className="dj-m-eye dj-m-eye--left" />
              <span className="dj-m-eye dj-m-eye--right" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
