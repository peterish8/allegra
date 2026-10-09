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
  /** True while music plays: the orb becomes a spinning record. */
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
 * The DJ: a clear-glass orb tinted by the playing song that becomes a slowly turning record while
 * music plays. It shows the song's colours only, never its artwork.
 *
 * Plain DOM and CSS; every transform lives on its own layer so none fight: roam (translate), dance
 * (rotate, hop on beats), kick (scale on beats), then the record's spin. The audio and the wander
 * reach it only through custom properties an ancestor sets (`useDjPulse`, `useDjRoam`), so nothing
 * re-renders per frame. The eyes sit on a layer that does not spin with the record, over its label.
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
        <div className="dj-m-dance">
          <div className="dj-m-kick">
            <div className="dj-m-glow"><Tint slots={slots} className="dj-m-light" /></div>
            <div className="dj-m-ring"><Tint slots={slots} className="dj-m-ring-line" /></div>
            <div className="dj-m-orb">
              <span className="dj-m-sheen" />
              {progress !== undefined ? <Tint slots={slots} className="dj-m-fill" /> : null}
            </div>
            <div className="dj-m-record">
              <Tint slots={slots} className="dj-m-body" />
              <div className="dj-m-disc">
                <Tint slots={slots} className="dj-m-grooves" />
                <span className="dj-m-label"><Tint slots={slots} className="dj-m-label-fill" /></span>
              </div>
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
