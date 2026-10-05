import { useState, type CSSProperties } from 'react';

import { usePlayhead, type Playhead } from '../lib/playhead';
import { formatTime } from '../lib/utils';

/**
 * The bottom bar's scrubber. It reads the playhead itself, so the four time reports a second
 * re-render this row and not the app around it. The thumb follows the finger and the audio only
 * seeks on release.
 */
export function BarScrubber({
  playhead,
  duration,
  onSeek
}: {
  readonly playhead: Playhead;
  readonly duration: number;
  readonly onSeek: (seconds: number) => void;
}) {
  const playing = usePlayhead(playhead);
  const [scrub, setScrub] = useState<number | null>(null);
  const time = scrub ?? playing;
  const span = Math.max(duration, 1);
  const commit = (): void => {
    if (scrub === null) return;
    setScrub(null);
    onSeek(scrub);
  };
  return (
    <div className="am-scrub">
      <time>{formatTime(time)}</time>
      <input
        type="range"
        className="am-range"
        aria-label="Track position"
        min={0}
        max={span}
        step={0.1}
        value={Math.min(time, span)}
        style={{ '--fill': `${duration > 0 ? (time / duration) * 100 : 0}%` } as CSSProperties}
        onChange={(event) => setScrub(Number(event.target.value))}
        onPointerUp={commit}
        onPointerCancel={() => setScrub(null)}
        onKeyUp={commit}
        onBlur={commit}
      />
      <time>-{formatTime(Math.max(0, duration - time))}</time>
    </div>
  );
}

/** Home's Now Playing card: a thin progress line and the time left. */
export function FeatureProgress({
  playhead,
  duration,
  current
}: {
  readonly playhead: Playhead;
  readonly duration: number;
  /** False when the card shows a song that is not the one loaded. */
  readonly current: boolean;
}) {
  const time = usePlayhead(playhead, current ? 0 : null);
  const live = current && duration > 0;
  return (
    <div className="feature-progress" aria-hidden="true">
      <span style={{ transform: `scaleX(${live ? Math.min(1, time / duration) : 0})` }} />
    </div>
  );
}

export function FeatureRemaining({
  playhead,
  duration,
  current
}: {
  readonly playhead: Playhead;
  readonly duration: number;
  readonly current: boolean;
}) {
  const live = current && duration > 0;
  const time = usePlayhead(playhead, live ? 1 : null);
  return <span>{formatTime(live ? Math.max(0, duration - time) : duration)} {live ? 'left' : 'total'}</span>;
}
