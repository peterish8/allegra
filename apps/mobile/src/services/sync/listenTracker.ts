export interface HeardSong {
  readonly id: string;
  readonly title: string;
  readonly artist?: string;
  readonly album?: string;
  readonly artwork?: string;
  /** The catalog's https cover, for a song whose own cover is a file on this phone. */
  readonly coverRemoteUri?: string;
  readonly duration?: number;
  readonly originId?: string;
}

export interface PlaybackObservation {
  readonly song: HeardSong | null;
  readonly positionSec: number;
  readonly isPlaying: boolean;
  readonly at: number;
}

interface ListenSession {
  song: HeardSong;
  seconds: number;
  startedAt: string;
  recentReported: boolean;
  lastPositionSec: number;
  lastAt: number;
  lastWasPlaying: boolean;
}

const MAX_TICK_GAP_MS = 2_500;
const MAX_POSITION_STEP_SEC = 2.5;

/** Counts only forward audio progress between nearby playing status updates. */
export function createListenTracker(
  onHeard: (song: HeardSong, seconds: number, startedAt: string) => void,
  onRecent: (song: HeardSong, startedAt: string) => void = () => undefined,
) {
  let current: ListenSession | null = null;

  const finish = (): void => {
    if (current && current.seconds >= 5) onHeard(current.song, current.seconds, current.startedAt);
    current = null;
  };

  return {
    observe(observation: PlaybackObservation): void {
      const { song, isPlaying } = observation;
      const positionSec = Number.isFinite(observation.positionSec) ? Math.max(0, observation.positionSec) : 0;

      if (!song) {
        finish();
        return;
      }
      if (current && current.song.id !== song.id) finish();

      if (!isPlaying) {
        finish();
        return;
      }

      if (!current) {
        current = {
          song,
          seconds: 0,
          startedAt: new Date(observation.at).toISOString(),
          recentReported: false,
          lastPositionSec: positionSec,
          lastAt: observation.at,
          lastWasPlaying: true,
        };
        return;
      }

      const elapsedMs = observation.at - current.lastAt;
      const advanced = positionSec - current.lastPositionSec;
      const plausibleTick = current.lastWasPlaying
        && elapsedMs > 0
        && elapsedMs <= MAX_TICK_GAP_MS
        && advanced > 0
        && advanced <= MAX_POSITION_STEP_SEC
        && advanced <= elapsedMs / 1000 * 1.6 + 0.25;
      if (plausibleTick) current.seconds += Math.min(advanced, elapsedMs / 1000 * 1.6);

      // Always move the baseline. A seek, buffering gap, or backward jump is not listening time.
      current.lastPositionSec = positionSec;
      current.lastAt = observation.at;
      current.lastWasPlaying = true;
      current.song = song;
      if (!current.recentReported && current.seconds >= 5) {
        current.recentReported = true;
        onRecent(current.song, current.startedAt);
      }
    },
    finish,
  };
}
