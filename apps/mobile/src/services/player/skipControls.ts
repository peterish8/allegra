/**
 * Next and previous for every on-screen control (the mini player, its pill, Now Playing's buttons and cover swipe),
 * so they all follow the same rules: a LuvLink room this phone owns decides first, then the queue owner.
 *
 * "Previous" past 3 s starts the song over. On Android the Kotlin queue engine applies that rule itself (and
 * `previousInPlaylist` moves the screen to match), so nothing here second-guesses it. With the JavaScript queue
 * (iPhone) the restart is a seek, told to LuvLink like any other seek, and playback resumes through
 * `requestPlayback` — never a bare `play()` (playback invariant 1).
 */
import { isSeeking, positionSV } from '../../playback/positionBus';
import { usePlayerStore, playerControls, usesNativeQueue } from '../../store/playerStore';
import { notifyLuvLinkUserSeek } from '../luvLink/legacy/sync';
import { handleOwnedLuvLinkNext, handleOwnedLuvLinkPrevious, handleOwnedLuvLinkSeek, notifyOwnedLuvLinkUserSeek } from '../luvLink/sync';

/** Past this many seconds into a song, "previous" starts it over (`QueueMath.PREVIOUS_RESTART_MS`). */
export const RESTART_AFTER_SECONDS = 3;

export async function skipForward(): Promise<void> {
  if (await handleOwnedLuvLinkNext()) return;
  await usePlayerStore.getState().nextInPlaylist();
}

export async function skipBackward(): Promise<void> {
  if (await handleOwnedLuvLinkPrevious()) return;
  // positionSV, not playerControls.getPosition: it is the playhead on every platform.
  if (usesNativeQueue() || positionSV.value <= RESTART_AFTER_SECONDS) {
    usePlayerStore.getState().previousInPlaylist();
    return;
  }
  if (await handleOwnedLuvLinkSeek(0)) return;
  const wasPlaying = usePlayerStore.getState().isPlaying;
  isSeeking.value = true;
  positionSV.value = 0;
  try {
    // seekTo pauses on iOS: restarting the song must not silently stop it.
    await playerControls.seekTo(0);
    await notifyOwnedLuvLinkUserSeek(0);
    notifyLuvLinkUserSeek(0);
    if (wasPlaying) usePlayerStore.getState().requestPlayback(true);
  } finally {
    isSeeking.value = false;
  }
}
