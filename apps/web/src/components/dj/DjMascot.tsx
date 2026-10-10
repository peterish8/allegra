import { useState, type CSSProperties, type Ref } from 'react';

import type { DjEmotion } from '../../hooks/useDjSession';
import type { DjDanceVibe } from '../../lib/djMascotMotion';
import type { Palette } from '../../lib/palette';

/** The DJ's moods, plus the closed-eyed rest it falls into after a long quiet spell. */
export type DjMascotEmotion = DjEmotion | 'sleeping';

export interface DjMascotProps {
  /** `stage` fills its container (the /dj stage); `mini` is a small mark for the player bar and the quick prompt. */
  readonly size: 'stage' | 'mini';
  readonly emotion: DjMascotEmotion;
  /** The mascot's colours: the playing cover's palette, or the session tone's colours when nothing plays. */
  readonly palette: Palette;
  /** True while music plays (the mini mascot sways; the stage one dances through its loop). */
  readonly playing: boolean;
  /** How it dances while music plays (stage only). */
  readonly vibe?: DjDanceVibe;
  /** 0..1. When given, the orb fills from the bottom like a glass being poured (model download). */
  readonly progress?: number;
  /** The orb itself, for the eyes to look out from. */
  readonly ref?: Ref<HTMLDivElement>;
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
 * A surface washed in the playing song's colours (never its artwork). `className` draws the wash from
 * `--m-a`, `--m-b` and `--m-c`; a new song's colours cross-fade in over `--d-atmosphere`.
 */
export function DjTint({ palette, className }: { readonly palette: Palette; readonly className: string }) {
  const slots = useColourSlots(palette);
  return <div className="dj-tint" aria-hidden="true"><Tint slots={slots} className={className} /></div>;
}

/**
 * The DJ: a glass sphere with the playing song's colours swirling inside it, two glowing eyes and a
 * blush. It drifts, nods along on the beat, looks at the pointer and blinks; it thinks with three motes
 * orbiting it and smiles with closed, curved eyes when it is pleased. Its small, soft smile only changes
 * with its mood; it never mouths along to the music.
 *
 * Plain DOM and CSS. The body moves through custom properties an ancestor writes every frame
 * (`useDjMascot`): roam (translate) > dance (squash, sway) > kick (scale on a beat). The mini size has
 * no loop; it breathes and blinks on CSS alone.
 */
export function DjMascot({ size, emotion, palette, playing, vibe = 'steady', progress, ref }: DjMascotProps) {
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
      {size === 'stage' ? <div className="dj-m-floor"><span /></div> : null}
      <div className="dj-m-roam">
        <div className="dj-m-dance">
          <div className="dj-m-kick" ref={ref}>
            <div className="dj-m-glow"><Tint slots={slots} className="dj-m-light" /></div>
            <div className="dj-m-orbit" style={slotStyle(palette)}><i /><i /><i /></div>
            <div className="dj-m-orb">
              <Tint slots={slots} className="dj-m-core" />
              <span className="dj-m-shade" />
              <span className="dj-m-sheen" />
              {progress !== undefined ? <Tint slots={slots} className="dj-m-fill" /> : null}
            </div>
            <div className="dj-m-face">
              <div className="dj-m-eyes">
                <span className="dj-m-eye dj-m-eye--left"><i /></span>
                <span className="dj-m-eye dj-m-eye--right"><i /></span>
              </div>
              <svg className="dj-m-smile" viewBox="0 0 24 12" aria-hidden="true"><path d="M5 4.5 Q12 10 19 4.5" /></svg>
              <div className="dj-m-cheeks"><i /><i /></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
