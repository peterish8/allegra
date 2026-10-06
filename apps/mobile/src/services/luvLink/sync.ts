import { AppState } from 'react-native';
import { fromAllegraSong, fromMobileId, toMobileId, type SongSnapshot } from '@shared/songRef';
import { useLuvLinkStore } from '../../store/luvLinkStore';
import { playerControls, setOwnedRoomRouter, usePlayerStore, withoutOwnedRoomRouting } from '../../store/playerStore';
import { useSongsStore } from '../../store/songsStore';
import type { Song } from '../../types/song';
import { positionSV, durationSV } from '../../playback/positionBus';
import { NativeAudioPlayer } from '../NativeAudioPlayer';
import { setStreamQueueRouter, StreamService } from '../stream/StreamService';
import { toStreamSong } from '../stream/streamSong';
import { resolveToCatalog } from '../ytmusic/resolver';
import { searchMusic } from '../MultiSourceSearchService';
import { usePlaybackModesStore } from '../../store/playbackModesStore';
import { acknowledgeOwnedLuvLinkPlaybackIntent, acknowledgeOwnedLuvLinkSpeakerHandoff, addOwnedLuvLinkQueueItem, commitOwnedLuvLinkPlayback, ownedQueueEntryForSong, projectedOwnedLuvLinkPosition, reportOwnedLuvLinkReady, routeOwnedLuvLinkCatalogPick, type PlaybackCommit } from './client';

const state = () => useLuvLinkStore.getState();
const player = () => usePlayerStore.getState();
const canonicalRef = (song: { id: string; originId?: string }): string | null => {
  const catalog = StreamService.catalogFor(song.id);
  return (catalog ? fromAllegraSong(catalog) : null) ?? fromMobileId(song.id) ?? (song.originId?.includes(':') ? song.originId : null);
};
const snapshotFor = (song: ReturnType<typeof player>['currentSong']): SongSnapshot | null => {
  if (!song) return null;
  const ref = canonicalRef(song);
  if (!ref) return null;
  return { ref: ref as SongSnapshot['ref'], title: song.title, artist: song.artist ?? '', album: song.album, artwork: song.coverRemoteUri ?? song.coverImageUri ?? '', duration: Math.max(0, song.duration) };
};
const currentPos = () => Math.max(0, positionSV.value || 0);

let applyGeneration = 0;
let applyingAnchorUntil = 0;
let lastSeenSequence = -1;
let lastSeenBarrierPending: boolean | null = null;
let lastAdvanceEpoch = -1;
let handoffAcknowledgedEpoch = -1;
let handoffPendingEpoch = -1;
let checkpoint: ReturnType<typeof setInterval> | null = null;
let active = false;
let soloQueue: { playlistId: string | null; songs: ReturnType<typeof player>['playlistQueue']; index: number; repeatMode: ReturnType<typeof usePlaybackModesStore.getState>['repeatMode'] } | null = null;

function enterOwnedQueue(): void {
  if (soloQueue) return;
  const current = player();
  soloQueue = { playlistId: current.currentPlaylistId, songs: current.playlistQueue, index: current.currentQueueIndex, repeatMode: usePlaybackModesStore.getState().repeatMode };
  if (soloQueue.repeatMode !== 'off') usePlaybackModesStore.getState().setRepeatMode('off');
}

function restoreSoloQueue(): void {
  const saved = soloQueue;
  if (!saved) return;
  soloQueue = null;
  const current = player();
  const sameQueue = current.currentPlaylistId === saved.playlistId
    && (current.playlistQueue ?? []).map(song => song.id).join('\0') === (saved.songs ?? []).map(song => song.id).join('\0');
  if (!sameQueue && saved.songs?.length) {
    current.setPlaylistQueue(saved.playlistId ?? 'queue', saved.songs, Math.max(0, Math.min(saved.index, saved.songs.length - 1)), false);
  }
  if (usePlaybackModesStore.getState().repeatMode !== saved.repeatMode) usePlaybackModesStore.getState().setRepeatMode(saved.repeatMode);
}

function isCurrent(userId: string, sequence: number, generation: number): boolean {
  const current = state();
  return active && applyGeneration === generation && current.ownedRoomId === current.ownedRoom?.roomId
    && current.ownedPlayback?.sequence === sequence && current.ownedUserId === userId;
}

function shouldOutput(): boolean {
  const current = state();
  const room = current.ownedRoom;
  const member = current.ownedMembers.find(item => item.userId === current.ownedUserId);
  if (!room || !member) return false;
  if (room.mode === 'speaker') return room.leaderUserId === current.ownedUserId;
  return member.mode === 'listen';
}

async function pauseNativeOutputAndConfirm(): Promise<boolean> {
  return new Promise(resolve => {
    let done = false;
    const finish = (paused: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      subscription.remove();
      resolve(paused);
    };
    const subscription = NativeAudioPlayer.addListener('onPlaybackStatus', (event: { playWhenReady?: boolean; isPlaying?: boolean }) => {
      if (event.playWhenReady === false && event.isPlaying === false) finish(true);
    });
    const timer = setTimeout(() => finish(false), 1_800);
    withoutOwnedRoomRouting(() => player().requestPlayback(false));
    NativeAudioPlayer.refreshStatus();
  });
}

async function waitForTransportApplied(playing: boolean): Promise<boolean> {
  return new Promise(resolve => {
    let done = false;
    const finish = (applied: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      subscription.remove();
      resolve(applied);
    };
    const subscription = NativeAudioPlayer.addListener('onPlaybackStatus', (event: { playWhenReady?: boolean; isPlaying?: boolean }) => {
      if (playing ? event.playWhenReady === true && event.isPlaying === true : event.playWhenReady === false && event.isPlaying === false) finish(true);
    });
    const timer = setTimeout(() => finish(false), 1_800);
    withoutOwnedRoomRouting(() => player().requestPlayback(playing));
    NativeAudioPlayer.refreshStatus();
  });
}

async function acknowledgeHandoffIfOldSpeaker(): Promise<void> {
  const current = state();
  const room = current.ownedRoom;
  if (!room || room.mode !== 'speaker' || room.handoffFromUserId !== current.ownedUserId || handoffAcknowledgedEpoch === room.leaderEpoch || handoffPendingEpoch === room.leaderEpoch) return;
  handoffPendingEpoch = room.leaderEpoch;
  const paused = await pauseNativeOutputAndConfirm();
  if (!paused) {
    handoffPendingEpoch = -1;
    current.announce('The old speaker has not confirmed pause yet. The new output will wait.');
    return;
  }
  try {
    await acknowledgeOwnedLuvLinkSpeakerHandoff(room.leaderEpoch);
    handoffAcknowledgedEpoch = room.leaderEpoch;
  } catch { current.announce('Could not confirm the speaker handoff. Keep LuvLink open and try again.'); }
  finally { handoffPendingEpoch = -1; }
}

async function resolveMobileSong(song: SongSnapshot, generation: number, sequence: number): Promise<string | null> {
  const local = useSongsStore.getState().songs.find(item =>
    canonicalRef(item) === song.ref && item.audioUri,
  );
  if (local) {
    if (!isCurrent(state().ownedUserId ?? '', sequence, generation)) return null;
    withoutOwnedRoomRouting(() => player().setPlaylistQueue('luv-link', [local], 0, false));
    return local.id;
  }
  const mobileId = toMobileId(song.ref);
  const meta = StreamService.catalogFor(mobileId);
  if (meta) {
    if (!isCurrent(state().ownedUserId ?? '', sequence, generation)) return null;
    withoutOwnedRoomRouting(() => player().setPlaylistQueue('luv-link', [toStreamSong(meta)], 0, false));
    return player().currentSongId;
  }
  const match = await resolveToCatalog({
    videoId: song.ref,
    title: song.title,
    artists: song.artist.split(/\s*(?:,|&)\s*/).filter(Boolean),
    album: song.album,
    duration: song.duration,
    thumbnail: song.artwork,
  }, query => searchMusic(query)).catch(() => null);
  if (!match || !isCurrent(state().ownedUserId ?? '', sequence, generation)) return null;
  withoutOwnedRoomRouting(() => player().setPlaylistQueue('luv-link', [toStreamSong(match)], 0, false));
  return player().currentSongId;
}

async function waitUntilLoaded(songId: string, generation: number, sequence: number): Promise<boolean> {
  const until = Date.now() + 8_000;
  while (Date.now() < until) {
    if (!isCurrent(state().ownedUserId ?? '', sequence, generation)) return false;
    if (player().loadedAudioId === songId && durationSV.value > 0) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

async function applyAnchor(): Promise<void> {
  const current = state();
  const room = current.ownedRoom;
  const anchor = current.ownedPlayback;
  if (room?.handoffFromUserId === current.ownedUserId) {
    void acknowledgeHandoffIfOldSpeaker();
    return;
  }
  if (room?.handoffFromUserId) return;
  if (!room || !anchor || !current.ownedUserId || (anchor.sequence === lastSeenSequence && anchor.barrierPending === lastSeenBarrierPending)) return;
  lastSeenSequence = anchor.sequence;
  lastSeenBarrierPending = anchor.barrierPending;
  if (!shouldOutput()) {
    if ((room.mode === 'speaker' && room.leaderUserId !== current.ownedUserId || current.ownedMembers.find(item => item.userId === current.ownedUserId)?.mode === 'speaker') && player().isPlaying) {
      applyingAnchorUntil = Date.now() + 1_200;
      withoutOwnedRoomRouting(() => player().requestPlayback(false));
    }
    return;
  }
  const generation = ++applyGeneration;
  applyingAnchorUntil = Date.now() + 2_500;
  if (!anchor.song) {
    withoutOwnedRoomRouting(() => player().requestPlayback(false));
    return;
  }
  let localId = player().currentSongId;
  if (anchor.song.ref !== canonicalRef(player().currentSong ?? { id: '' }) || player().currentPlaylistId !== 'luv-link') {
    if (anchor.song.ref === canonicalRef(player().currentSong ?? { id: '' }) && player().currentSong) {
      const sameSong = player().currentSong;
      withoutOwnedRoomRouting(() => player().setPlaylistQueue('luv-link', [sameSong], 0, false));
      localId = sameSong.id;
    } else {
      localId = await resolveMobileSong(anchor.song, generation, anchor.sequence) ?? null;
    }
    if (!localId || !isCurrent(current.ownedUserId, anchor.sequence, generation)) {
      state().announce(`Couldn’t load “${anchor.song.title}” yet. This device stays paused.`);
      return;
    }
  }
  const ready = !!localId && await waitUntilLoaded(localId, generation, anchor.sequence);
  if (!ready || !isCurrent(current.ownedUserId, anchor.sequence, generation)) {
    lastSeenSequence = -1;
    state().announce(`Couldn’t load “${anchor.song.title}” in time. This device stays paused.`);
    return;
  }
  if (anchor.barrierPending && (room.mode === 'listen' || room.leaderUserId === current.ownedUserId)) {
    await reportOwnedLuvLinkReady(anchor.trackEpoch, true).catch(() => undefined);
  }
  if (!isCurrent(current.ownedUserId, anchor.sequence, generation)) return;
  const freshAnchor = state().ownedPlayback;
  if (!freshAnchor || freshAnchor.barrierPending) return;
  const position = projectedOwnedLuvLinkPosition(freshAnchor);
  if (Math.abs(currentPos() - position) > 0.35) await playerControls.seekTo(position);
  if (room.mode === 'speaker') {
    const applied = await waitForTransportApplied(freshAnchor.playing);
    if (!applied) {
      state().announce('The shared speaker has not confirmed this control yet. Keep LuvLink open to retry.');
      return;
    }
    const latest = state().ownedPlayback;
    if (latest && latest.sequence === freshAnchor.sequence && latest.outputAppliedSequence < latest.sequence) {
      await acknowledgeOwnedLuvLinkPlaybackIntent(latest.sequence, latest.leaderEpoch).catch(() => undefined);
    }
  } else {
    withoutOwnedRoomRouting(() => player().requestPlayback(freshAnchor.playing));
  }
  lastSeenSequence = freshAnchor.sequence;
  lastSeenBarrierPending = freshAnchor.barrierPending;
  applyingAnchorUntil = Date.now() + 1_200;
}

function ownedControlAllowed(): boolean {
  const current = state();
  const member = current.ownedMembers.find(item => item.userId === current.ownedUserId);
  return !!current.ownedRoom && !!member && (member.canControl || member.role === 'host');
}

function isControllerOnly(): boolean {
  const current = state();
  return !!current.ownedRoom && (current.ownedRoom.mode === 'speaker' && current.ownedRoom.leaderUserId !== current.ownedUserId
    || current.ownedMembers.find(item => item.userId === current.ownedUserId)?.mode === 'speaker');
}

export async function notifyOwnedLuvLinkUserSeek(positionSec: number): Promise<void> {
  if (!state().ownedRoom || !ownedControlAllowed()) return;
  const anchor = state().ownedPlayback;
  const song = anchor?.song ?? snapshotFor(player().currentSong);
  if (!song) return;
  await commitOwnedLuvLinkPlayback({ song, queueEntryId: anchor?.queueEntryId ?? null, positionSec: Math.max(0, positionSec), playing: anchor?.playing ?? player().isPlaying, playbackRate: anchor?.playbackRate ?? 1 });
}

export async function handleOwnedLuvLinkSeek(positionSec: number): Promise<boolean> {
  const current = state();
  if (!current.ownedRoomId) return false;
  if (!current.ownedRoom) return true;
  if (!roomControlAllowed()) return true;
  if (!isControllerOnly()) return false;
  const anchor = current.ownedPlayback;
  if (anchor?.song) await commitOwnedLuvLinkPlayback({ song: anchor.song, queueEntryId: anchor.queueEntryId, positionSec: Math.max(0, positionSec), playing: anchor.playing, playbackRate: anchor.playbackRate });
  return true;
}

export async function handleOwnedLuvLinkToggle(): Promise<boolean> {
  const current = state();
  const anchor = current.ownedPlayback;
  if (!current.ownedRoomId) return false;
  if (!current.ownedRoom) return true;
  if (!roomControlAllowed()) return true;
  if (!isControllerOnly()) return false;
  if (!anchor?.song) return true;
  await commitOwnedLuvLinkPlayback({ song: anchor.song, queueEntryId: anchor.queueEntryId, positionSec: projectedOwnedLuvLinkPosition(anchor), playing: !anchor.playing, playbackRate: anchor.playbackRate });
  return true;
}

function submitControl(commit: PlaybackCommit): void {
  void commitOwnedLuvLinkPlayback(commit).catch(error => state().announce(error instanceof Error ? error.message : 'LuvLink control could not sync.'));
}

function roomControlAllowed(): boolean {
  if (ownedControlAllowed()) return true;
  if (state().ownedRoom) state().announce('You do not have permission to control this LuvLink.');
  return false;
}

function routeOwnedRoomPlayback(playing: boolean): boolean {
  const current = state();
  if (!current.ownedRoomId) return false;
  if (!current.ownedRoom) return true;
  if (!roomControlAllowed()) return true;
  const anchor = current.ownedPlayback;
  if (!anchor?.song) return true;
  submitControl({ song: anchor.song, queueEntryId: anchor.queueEntryId, positionSec: anchor.playing ? projectedOwnedLuvLinkPosition(anchor) : anchor.positionSec, playing, playbackRate: anchor.playbackRate });
  return true;
}

function routeOwnedRoomNext(automatic: boolean): boolean {
  const current = state();
  if (!current.ownedRoomId) return false;
  if (!current.ownedRoom) return true;
  if (automatic && current.ownedPlayback?.leaderUserId !== current.ownedUserId) return true;
  void handleOwnedLuvLinkNext(automatic ? 'natural_end' : 'control').catch(error => current.announce(error instanceof Error ? error.message : 'LuvLink skip could not sync.'));
  return true;
}

function routeOwnedRoomPrevious(): boolean {
  if (!state().ownedRoomId) return false;
  void handleOwnedLuvLinkPrevious().catch(error => state().announce(error instanceof Error ? error.message : 'LuvLink skip could not sync.'));
  return true;
}

function routeOwnedRoomSelection(input: { readonly playlistId: string; readonly songs: readonly Song[]; readonly startIndex: number }): boolean {
  const current = state();
  if (!current.ownedRoomId) return false;
  if (!current.ownedRoom) return true;
  if (!roomControlAllowed()) return true;
  const chosen = input.songs[input.startIndex];
  const song = chosen ? snapshotFor(chosen) : null;
  if (!song) { current.announce('This track has no verified catalog ID, so it cannot be played in LuvLink.'); return true; }
  void (async () => {
    for (const item of input.songs.slice(input.startIndex + 1, input.startIndex + 51)) {
      const queued = snapshotFor(item);
      if (queued) await addOwnedLuvLinkQueueItem(queued);
    }
    const anchor = state().ownedPlayback;
    const entry = ownedQueueEntryForSong(song);
    await commitOwnedLuvLinkPlayback({ song, queueEntryId: entry?.entryId ?? null, positionSec: 0, playing: true, playbackRate: anchor?.playbackRate ?? 1, forceTrackChange: true });
  })().catch(error => state().announce(error instanceof Error ? error.message : 'Could not play this pick in LuvLink.'));
  return true;
}

export async function handleOwnedLuvLinkNext(intent: 'control' | 'natural_end' = 'control'): Promise<boolean> {
  const current = state();
  const anchor = current.ownedPlayback;
  if (!current.ownedRoomId) return false;
  if (!current.ownedRoom) return true;
  if (!roomControlAllowed()) return true;
  if (intent === 'natural_end') {
    if (anchor?.leaderUserId !== current.ownedUserId || !anchor.playing || lastAdvanceEpoch === anchor.trackEpoch) return true;
    lastAdvanceEpoch = anchor.trackEpoch;
  }
  const next = current.ownedQueue.entries[0];
  if (next) {
    await commitOwnedLuvLinkPlayback({ song: next.song, queueEntryId: next.entryId, positionSec: 0, playing: true, playbackRate: anchor?.playbackRate ?? 1, forceTrackChange: true, intent });
  } else if (anchor?.song) {
    await commitOwnedLuvLinkPlayback({ song: anchor.song, queueEntryId: anchor.queueEntryId, positionSec: anchor.song.duration, playing: false, playbackRate: anchor.playbackRate });
  }
  return true;
}

export async function handleOwnedLuvLinkPrevious(): Promise<boolean> {
  const current = state();
  if (!current.ownedRoomId) return false;
  if (!current.ownedRoom) return true;
  if (!roomControlAllowed()) return true;
  const anchor = current.ownedPlayback;
  if (!anchor?.song) return true;
  if (isControllerOnly()) {
    await commitOwnedLuvLinkPlayback({ song: anchor.song, queueEntryId: anchor.queueEntryId, positionSec: 0, playing: anchor.playing, playbackRate: anchor.playbackRate });
  } else {
    await playerControls.seekTo(0);
    await notifyOwnedLuvLinkUserSeek(0);
  }
  return true;
}

export async function playOwnedLuvLinkQueueEntry(entryId: string): Promise<void> {
  const entry = state().ownedQueue.entries.find(item => item.entryId === entryId);
  const anchor = state().ownedPlayback;
  if (!entry || !ownedControlAllowed()) return;
  await commitOwnedLuvLinkPlayback({ song: entry.song, queueEntryId: entry.entryId, positionSec: 0, playing: true, playbackRate: anchor?.playbackRate ?? 1, forceTrackChange: true });
}

export const isOwnedLuvLinkActive = (): boolean => !!state().ownedRoom;
export const isOwnedLuvLinkControllerOnly = (): boolean => isControllerOnly();

function onPlayerIntent(next: ReturnType<typeof player>, prev: ReturnType<typeof player>): void {
  const current = state();
  if (!current.ownedRoom || !current.ownedPlayback || !ownedControlAllowed() || Date.now() < applyingAnchorUntil) return;
  const changedTrack = next.currentSongId !== prev.currentSongId;
  const changedPlay = next.isPlaying !== prev.isPlaying;
  if (!changedTrack && !changedPlay) return;
  const song = snapshotFor(next.currentSong);
  if (changedTrack && !song) {
    current.announce('This track is not available to share in LuvLink.');
    return;
  }
  const activeAnchor = current.ownedPlayback;
  const entry = ownedQueueEntryForSong(song ?? undefined);
  const commit: PlaybackCommit = {
    song: changedTrack ? song : activeAnchor.song,
    queueEntryId: changedTrack ? entry?.entryId ?? null : activeAnchor.queueEntryId,
    positionSec: changedTrack ? 0 : currentPos(),
    playing: next.isPlaying,
    playbackRate: activeAnchor.playbackRate || 1,
    forceTrackChange: changedTrack,
  };
  void commitOwnedLuvLinkPlayback(commit).catch(error => current.announce(error instanceof Error ? error.message : 'LuvLink playback could not sync.'));
}

/** Start one owned timeline observer. Position ticks stay local; only commands and a 30s leader checkpoint write. */
export function startOwnedLuvLinkSync(): () => void {
  active = true;
  if (state().ownedRoomId) enterOwnedQueue();
  lastSeenSequence = -1;
  lastSeenBarrierPending = null;
  const offRoom = useLuvLinkStore.subscribe((next, prev) => {
    if (next.ownedRoomId && !prev.ownedRoomId) enterOwnedQueue();
    if (!next.ownedRoomId && prev.ownedRoomId) restoreSoloQueue();
    if (next.ownedRoomId !== prev.ownedRoomId || next.ownedRoom?.leaderEpoch !== prev.ownedRoom?.leaderEpoch) {
      applyGeneration++;
      lastSeenSequence = -1;
      lastSeenBarrierPending = null;
    }
    if (next.ownedPlayback !== prev.ownedPlayback || next.ownedRoom?.mode !== prev.ownedRoom?.mode || next.ownedMembers !== prev.ownedMembers) void applyAnchor();
    if (next.ownedRoom && !next.ownedPlayback && next.ownedRoom.leaderUserId === next.ownedUserId && ownedControlAllowed()) {
      const initialSong = snapshotFor(player().currentSong);
      if (initialSong) void commitOwnedLuvLinkPlayback({ song: initialSong, queueEntryId: null, positionSec: currentPos(), playing: player().isPlaying, playbackRate: 1, forceTrackChange: true });
    }
  });
  const offPlayer = usePlayerStore.subscribe(onPlayerIntent);
  const stopRouter = setOwnedRoomRouter({
    select: routeOwnedRoomSelection,
    playback: routeOwnedRoomPlayback,
    next: routeOwnedRoomNext,
    previous: routeOwnedRoomPrevious,
  });
  const stopStreamRouter = setStreamQueueRouter((songs, next) => {
    if (!state().ownedRoomId) return false;
    const first = songs[0];
    if (first) void routeOwnedLuvLinkCatalogPick(first, next).catch(error => state().announce(error instanceof Error ? error.message : 'Could not add this track to LuvLink.'));
    return true;
  });
  const status = NativeAudioPlayer.addListener('onPlaybackStatus', (event: { finished?: boolean }) => {
    if (!event?.finished || !state().ownedRoom || !shouldOutput()) return;
    const anchor = state().ownedPlayback;
    if (!anchor || anchor.leaderUserId !== state().ownedUserId || lastAdvanceEpoch === anchor.trackEpoch) return;
    lastAdvanceEpoch = anchor.trackEpoch;
    void handleOwnedLuvLinkNext('natural_end');
  });
  checkpoint = setInterval(() => {
    const current = state();
    const anchor = current.ownedPlayback;
    if (AppState.currentState !== 'active' || !current.ownedRoom || !anchor?.playing || anchor.leaderUserId !== current.ownedUserId || !shouldOutput()) return;
    void commitOwnedLuvLinkPlayback({ song: anchor.song, queueEntryId: anchor.queueEntryId, positionSec: projectedOwnedLuvLinkPosition(anchor), playing: true, playbackRate: anchor.playbackRate, intent: 'checkpoint' });
  }, 30_000);
  if (state().ownedPlayback) void applyAnchor();
  return () => {
    active = false;
    applyGeneration++;
    offRoom(); offPlayer(); status.remove(); stopRouter(); stopStreamRouter();
    if (checkpoint) clearInterval(checkpoint);
    checkpoint = null;
    lastSeenSequence = -1;
    lastSeenBarrierPending = null;
    lastAdvanceEpoch = -1;
    handoffAcknowledgedEpoch = -1;
    handoffPendingEpoch = -1;
    applyingAnchorUntil = 0;
    restoreSoloQueue();
  };
}
