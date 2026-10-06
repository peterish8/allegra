jest.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) } }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../NativeAudioPlayer', () => {
  const listeners = new Set<(event: { playWhenReady?: boolean; isPlaying?: boolean; finished?: boolean }) => void>();
  return {
    NativeAudioPlayer: {
      addListener: (_name: string, listener: (event: { playWhenReady?: boolean; isPlaying?: boolean; finished?: boolean }) => void) => {
        listeners.add(listener);
        return { remove: () => listeners.delete(listener) };
      },
      refreshStatus: jest.fn(),
      hasQueue: () => false,
      isAvailable: () => false,
      setRepeatOne: jest.fn(),
      setPlaybackParameters: jest.fn(),
    },
    emitStatus: (event: { playWhenReady?: boolean; isPlaying?: boolean; finished?: boolean }) => listeners.forEach(listener => listener(event)),
  };
});
jest.mock('../../playback/positionBus', () => ({ positionSV: { value: 12 }, durationSV: { value: 180 } }));
jest.mock('../../database/queries', () => ({ getSongById: jest.fn().mockResolvedValue(null) }));
jest.mock('../../store/songsStore', () => ({ useSongsStore: { getState: () => ({ songs: [] }) } }));
jest.mock('../stream/StreamService', () => ({
  StreamService: { catalogFor: jest.fn(() => undefined), startRadio: jest.fn().mockResolvedValue(0) },
  setStreamQueueRouter: jest.fn(() => jest.fn()),
}));
jest.mock('../stream/streamSong', () => ({ toStreamSong: (song: unknown) => song }));
jest.mock('../ytmusic/resolver', () => ({ resolveToCatalog: jest.fn() }));
jest.mock('../MultiSourceSearchService', () => ({ searchMusic: jest.fn() }));
jest.mock('./client', () => ({
  acknowledgeOwnedLuvLinkPlaybackIntent: jest.fn().mockResolvedValue(undefined),
  acknowledgeOwnedLuvLinkSpeakerHandoff: jest.fn().mockResolvedValue(undefined),
  addOwnedLuvLinkQueueItem: jest.fn().mockResolvedValue({ entryId: 'added', revision: 1 }),
  commitOwnedLuvLinkPlayback: jest.fn().mockResolvedValue(undefined),
  ownedQueueEntryForSong: jest.fn(() => null),
  projectedOwnedLuvLinkPosition: jest.fn((anchor: { positionSec: number }) => anchor.positionSec),
  reportOwnedLuvLinkReady: jest.fn().mockResolvedValue(undefined),
  routeOwnedLuvLinkCatalogPick: jest.fn().mockResolvedValue(true),
}));

import type { LuvLinkPlaybackAnchor, LuvLinkRoomSnapshot, LuvLinkMemberSnapshot, LuvLinkQueueEntry } from '@shared/luvLink';
import { useLuvLinkStore } from '../../store/luvLinkStore';
import { playerControls, usePlayerStore } from '../../store/playerStore';
import { startOwnedLuvLinkSync, handleOwnedLuvLinkNext } from './sync';
import {
  acknowledgeOwnedLuvLinkPlaybackIntent,
  commitOwnedLuvLinkPlayback,
  reportOwnedLuvLinkReady,
} from './client';

const song = { ref: 'saavn:track-1', title: 'Track', artist: 'Artist', artwork: '', duration: 180 } as const;
const room = (mode: 'listen' | 'speaker', leaderUserId = 'me'): LuvLinkRoomSnapshot => ({
  roomId: 'room-1', hostUserId: 'me', leaderUserId, leaderEpoch: 4, mode, transport: 'convex-v1',
  protocolVersion: 1, revision: 2, expiresAtMs: Date.now() + 60_000, memberCount: 2, handoffFromUserId: null,
});
const member = (mode: 'listen' | 'speaker' = 'listen', canControl = true): LuvLinkMemberSnapshot => ({
  userId: 'me', displayName: 'M', role: 'host', mode, canControl, canSuggest: false, joinedAtMs: Date.now(),
});
const anchor = (patch: Partial<LuvLinkPlaybackAnchor> = {}): LuvLinkPlaybackAnchor => ({
  roomId: 'room-1', leaderUserId: 'me', leaderEpoch: 4, sequence: 7, trackEpoch: 2, queueEntryId: null,
  intent: 'control', intentByUserId: 'me', outputAppliedSequence: 0, barrierPending: false, song,
  positionSec: 12, serverAtMs: Date.now(), playing: false, effectiveAtMs: Date.now(), playbackRate: 1, ...patch,
});

function readyPlayer(isPlaying = false): void {
  usePlayerStore.setState({
    currentSong: { id: 'saavn:track-1', originId: 'saavn:track-1', title: 'Track', artist: 'Artist', duration: 180 } as never,
    currentSongId: 'saavn:track-1', loadedAudioId: 'saavn:track-1', currentPlaylistId: 'luv-link',
    playlistQueue: [{ id: 'saavn:track-1', title: 'Track', duration: 180 } as never], currentQueueIndex: 0, isPlaying,
  });
}

function setRoom(nextRoom: LuvLinkRoomSnapshot, playback: LuvLinkPlaybackAnchor): void {
  useLuvLinkStore.setState({
    ownedRoomId: 'room-1', ownedRoom: nextRoom, ownedUserId: 'me', ownedMembers: [member()],
    ownedPlayback: playback, ownedQueue: { revision: 1, entries: [] },
  });
}

describe('first-party LuvLink playback', () => {
  let stop: (() => void) | undefined;
  let originalPlay: typeof playerControls.play;
  let originalPause: typeof playerControls.pause;
  let originalSeek: typeof playerControls.seekTo;

  beforeEach(() => {
    originalPlay = playerControls.play;
    originalPause = playerControls.pause;
    originalSeek = playerControls.seekTo;
    playerControls.play = jest.fn();
    playerControls.pause = jest.fn();
    playerControls.seekTo = jest.fn().mockResolvedValue(undefined);
    jest.clearAllMocks();
    readyPlayer();
    useLuvLinkStore.setState({ ownedRoomId: null, ownedRoom: null, ownedUserId: null, ownedMembers: [], ownedPlayback: null, ownedQueue: { revision: 0, entries: [] } });
  });

  afterEach(() => {
    stop?.(); stop = undefined;
    playerControls.play = originalPlay;
    playerControls.pause = originalPause;
    playerControls.seekTo = originalSeek;
    useLuvLinkStore.setState({ ownedRoomId: null, ownedRoom: null, ownedUserId: null, ownedMembers: [], ownedPlayback: null, ownedQueue: { revision: 0, entries: [] } });
  });

  it('reports a loaded member ready while the track barrier stays paused', async () => {
    setRoom(room('listen'), anchor({ barrierPending: true }));
    stop = startOwnedLuvLinkSync();
    await Promise.resolve();

    expect(reportOwnedLuvLinkReady).toHaveBeenCalledWith(2, true);
    expect(playerControls.play).not.toHaveBeenCalled();
  });

  it('applies a remote track and reports ready without publishing a pause intent', async () => {
    const loadSong = usePlayerStore.getState().loadSong;
    const match = { id: 'saavn:track-2', originId: 'saavn:track-2', title: 'Track 2', artist: 'Artist', duration: 180 } as never;
    (jest.requireMock('../ytmusic/resolver').resolveToCatalog as jest.Mock).mockResolvedValue(match);
    usePlayerStore.setState({
      currentSong: { id: 'saavn:track-old', originId: 'saavn:track-old', title: 'Old', artist: 'Artist', duration: 180 } as never,
      currentSongId: 'saavn:track-old', loadedAudioId: 'saavn:track-old', currentPlaylistId: 'solo',
      loadSong: jest.fn(async (id: string) => { usePlayerStore.setState({ loadedAudioId: id }); }),
    });
    setRoom(room('listen'), anchor({ sequence: 8, trackEpoch: 3, song: { ...song, ref: 'saavn:track-2' as typeof song.ref, title: 'Track 2' }, barrierPending: true }));
    stop = startOwnedLuvLinkSync();
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(reportOwnedLuvLinkReady).toHaveBeenCalledWith(3, true);
    expect(commitOwnedLuvLinkPlayback).not.toHaveBeenCalled();
    usePlayerStore.setState({ loadSong });
  });

  it('cancels an unresolved catalog match before it can replace the player after leave', async () => {
    let finishLookup!: (song: never) => void;
    const resolveToCatalog = jest.requireMock('../ytmusic/resolver').resolveToCatalog as jest.Mock;
    resolveToCatalog.mockImplementation(() => new Promise(resolve => { finishLookup = resolve; }));
    const originalLoadSong = usePlayerStore.getState().loadSong;
    const loadSong = jest.fn(async () => undefined);
    usePlayerStore.setState({
      currentSong: { id: 'saavn:track-old', originId: 'saavn:track-old', title: 'Old', artist: 'Artist', duration: 180 } as never,
      currentSongId: 'saavn:track-old', loadedAudioId: 'saavn:track-old', currentPlaylistId: 'solo', loadSong,
    });
    setRoom(room('listen'), anchor({ sequence: 9, trackEpoch: 4, song: { ...song, ref: 'saavn:track-2' as typeof song.ref, title: 'Track 2' } }));
    stop = startOwnedLuvLinkSync();
    await Promise.resolve();
    expect(resolveToCatalog).toHaveBeenCalledTimes(1);

    stop(); stop = undefined;
    finishLookup({ id: 'saavn:track-2', title: 'Track 2', artist: 'Artist', duration: 180 } as never);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(loadSong).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().currentSongId).toBe('saavn:track-old');
    expect(reportOwnedLuvLinkReady).not.toHaveBeenCalled();
    expect(commitOwnedLuvLinkPlayback).not.toHaveBeenCalled();
    usePlayerStore.setState({ loadSong: originalLoadSong });
  });

  it('keeps the room song playing where it is when the room ends', () => {
    const setPlaylistQueue = jest.fn();
    const originalSetQueue = usePlayerStore.getState().setPlaylistQueue;
    const old = { id: 'saavn:track-old', originId: 'saavn:track-old', title: 'Old', artist: 'Artist', duration: 180 } as never;
    usePlayerStore.setState({ currentSong: old, currentSongId: 'saavn:track-old', currentPlaylistId: 'solo', playlistQueue: [old], currentQueueIndex: 0 });
    setRoom(room('listen'), anchor());
    stop = startOwnedLuvLinkSync();
    readyPlayer(true);
    usePlayerStore.setState({ setPlaylistQueue });

    useLuvLinkStore.getState().setOwnedRoomId(null);

    expect(setPlaylistQueue).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().currentSongId).toBe('saavn:track-1');
    expect(jest.requireMock('../stream/StreamService').StreamService.startRadio).toHaveBeenCalledWith(expect.objectContaining({ id: 'saavn:track-1' }));
    usePlayerStore.setState({ setPlaylistQueue: originalSetQueue });
  });

  it('keeps controller-only members out of audio resolution and readiness', () => {
    readyPlayer(true);
    setRoom(room('speaker', 'other'), anchor({ leaderUserId: 'other', playing: true }));
    useLuvLinkStore.setState({ ownedMembers: [member()] });
    stop = startOwnedLuvLinkSync();

    expect(playerControls.pause).toHaveBeenCalledTimes(1);
    expect(reportOwnedLuvLinkReady).not.toHaveBeenCalled();
  });

  it('acknowledges a speaker control only after native playback confirms it', async () => {
    setRoom(room('speaker'), anchor({ playing: true, outputAppliedSequence: 6 }));
    playerControls.play = jest.fn(() => {
      (jest.requireMock('../NativeAudioPlayer') as { emitStatus: (event: { playWhenReady: boolean; isPlaying: boolean }) => void })
        .emitStatus({ playWhenReady: true, isPlaying: true });
    });
    stop = startOwnedLuvLinkSync();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(acknowledgeOwnedLuvLinkPlaybackIntent).toHaveBeenCalledWith(7, 4);
  });

  it('publishes one natural-end advance with the server queue entry id', async () => {
    const next: LuvLinkQueueEntry = { entryId: 'entry-1', roomId: 'room-1', order: 0, song: { ...song, ref: 'saavn:track-2' as typeof song.ref }, addedByUserId: 'guest', addedByName: 'G', createdAtMs: Date.now() };
    setRoom(room('listen'), anchor({ playing: true }));
    useLuvLinkStore.setState({ ownedQueue: { revision: 2, entries: [next] } });

    await handleOwnedLuvLinkNext('natural_end');
    await handleOwnedLuvLinkNext('natural_end');

    expect(commitOwnedLuvLinkPlayback).toHaveBeenCalledTimes(1);
    expect(commitOwnedLuvLinkPlayback).toHaveBeenCalledWith(expect.objectContaining({ intent: 'natural_end', queueEntryId: 'entry-1', song: next.song }));
  });
});
