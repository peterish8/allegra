/** A gesture belongs to the recording on which it began. */
export function seekTargetForGesture(startSong: string | null, currentSong: string | null, seconds: number, duration: number, loading: boolean): number | null {
  if (!startSong || startSong !== currentSong || loading || !Number.isFinite(seconds) || !Number.isFinite(duration) || duration <= 0) return null;
  return Math.max(0, Math.min(duration, seconds));
}
