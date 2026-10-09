import type { CSSProperties } from 'react';

import type { DjEmotion } from '../../hooks/useDjSession';
import type { Palette } from '../../lib/palette';

/** The DJ's moods, plus the closed-eyed rest used while the local model is not loaded (plan 01-07). */
export type DjMascotEmotion = DjEmotion | 'sleeping';

export interface DjMascotProps {
  /** `stage` fills its container (the /dj hero); `mini` is a 44px mark for the mini player and prompt. */
  readonly size: 'stage' | 'mini';
  readonly emotion: DjMascotEmotion;
  /** Colours of the playing cover. `null` falls back to the page's darkened tone colours. */
  readonly palette: Palette | null;
  /** The playing cover, shown on the record's label. */
  readonly cover: string | null;
  /** True while music plays: the orb becomes a spinning record. */
  readonly playing: boolean;
  /** 0..1. When given, the orb fills from the bottom like a glass being poured (model download). */
  readonly progress?: number;
}

/**
 * The DJ: a clear-glass orb tinted by the playing cover that becomes a record while music plays.
 *
 * Plain DOM and CSS; every transform lives on its own layer so none fight. The audio reaches it only
 * through the `--dj-bass` and `--dj-onset` custom properties an ancestor sets (see `useDjPulse`), so
 * a beat never re-renders anything. The eyes sit on a layer that does not rotate, over the label.
 */
export function DjMascot({ size, emotion, palette, cover, playing, progress }: DjMascotProps) {
  const style: CSSProperties & Record<string, string | number> = {};
  if (palette) {
    style['--m-a'] = palette.primary;
    style['--m-b'] = palette.secondary;
  }
  if (progress !== undefined) style['--m-p'] = Math.min(1, Math.max(0, progress)).toFixed(3);

  return (
    <div
      className={`dj-m dj-m--${size}`}
      data-emotion={emotion}
      data-playing={playing ? 'true' : 'false'}
      style={style}
      aria-hidden="true"
    >
      <div className="dj-m-kick">
        <span className="dj-m-glow" />
        <span className="dj-m-ring" />
        <div className="dj-m-orb">
          <span className="dj-m-sheen" />
          {progress !== undefined ? <span className="dj-m-fill" /> : null}
        </div>
        <div className="dj-m-record">
          <div className="dj-m-disc">
            <span className="dj-m-label">
              {cover ? (
                <img
                  key={cover}
                  src={cover}
                  alt=""
                  crossOrigin="anonymous"
                  draggable={false}
                  onError={(event) => { event.currentTarget.style.display = 'none'; }}
                />
              ) : null}
            </span>
          </div>
        </div>
        <div className="dj-m-eyes">
          <span className="dj-m-eye dj-m-eye--left" />
          <span className="dj-m-eye dj-m-eye--right" />
        </div>
      </div>
    </div>
  );
}
