import React from 'react';
import type { Song } from '../../types/song';
jest.mock('react', () => ({ ...jest.requireActual('react'), useState: (value: unknown) => [value, jest.fn()] }));
jest.mock('react-native', () => ({ Platform: { OS: 'android' }, StyleSheet: { create: (s: unknown) => s }, View: 'View' }));
jest.mock('./RecentCovers', () => ({ RecentCovers: 'RecentCovers' }));
jest.mock('../../ui', () => ({
  Button: 'Button', Sheet: 'Sheet', SheetIdentity: 'Identity', SheetScrollView: 'Scroll', SheetOption: 'Option', SheetDivider: 'Divider', Text: 'Text',
  Space: { sm: 8, md: 16, lg: 24 }, Control: { target: 48 }, identityMeta: (...parts: string[]) => parts.join(' · '),
}));
const mockSave = jest.fn((..._args: unknown[]) => true);
const mockNavigate = jest.fn();
const mockPhase = { phase: 'idle' };
jest.mock('../../hooks/useDownloadState', () => ({ useDownloadState: () => mockPhase }));
jest.mock('../../hooks/useIsSongLiked', () => ({ useSongLikeState: () => ({ liked: false }) }));
const mockPlayNext = jest.fn();
const mockAppend = jest.fn();
const mockPlayer = { currentPlaylistId: 'stream' as string | null };
jest.mock('../../services/stream/StreamService', () => ({ StreamService: {
  save: (...args: unknown[]) => mockSave(...args),
  playNext: (...args: unknown[]) => mockPlayNext(...args),
  append: (...args: unknown[]) => mockAppend(...args),
} }));
jest.mock('../../store/playerStore', () => ({ usePlayerStore: { getState: () => mockPlayer } }));
jest.mock('../../store/songsStore', () => ({ useSongsStore: { getState: () => ({ toggleLike: jest.fn() }) } }));
jest.mock('../../store/playbackModesStore', () => ({ usePlaybackModesStore: Object.assign((select: (s: unknown) => unknown) => select({ repeatOne: false }), { getState: () => ({ setRepeatOne: jest.fn() }) }) }));
jest.mock('../../services/NativeAudioPlayer', () => ({ NativeAudioPlayer: { isAvailable: () => true } }));
jest.mock('../../services/player/playerMenuActions', () => ({ canSetRingtone: () => false, shareSong: jest.fn(), refetchCurrent: jest.fn(), setAsRingtone: jest.fn(), shuffleUpcoming: jest.fn() }));
jest.mock('../../services/connect/ConnectProvider', () => ({ useConnect: () => ({ openDevices: jest.fn() }) }));
jest.mock('../../services/connect/songMatcher', () => ({ matchConnectSong: jest.fn() }));
jest.mock('../../services/sync/onlineLike', () => ({ toggleOnlineLike: jest.fn() }));
jest.mock('../../utils/navigationService', () => ({ navigationRef: { isReady: () => true, navigate: (...args: unknown[]) => mockNavigate(...args) } }));
import { MiniSongMenu } from './MiniSongMenu';

type NodeProps = { children?: React.ReactNode; label?: string; disabled?: boolean; onPress?: () => void };
function nodes(tree: React.ReactNode): NodeProps[] {
  return React.Children.toArray(tree).flatMap(child => {
    if (!React.isValidElement<NodeProps>(child)) return [];
    return [child.props, ...nodes(child.props.children)];
  });
}
const song: Song = { id: 'stream:saavn:abc', title: 'Song', artist: 'Artist', duration: 120, lyrics: [], gradientId: '0', dateCreated: '', dateModified: '', playCount: 0 };
const render = (remote = false) => nodes(MiniSongMenu({ song, visible: true, onClose: jest.fn(), remote: remote ? { ref: 'saavn:abc', title: song.title, artist: 'Artist', artwork: '', duration: 120 } : undefined }));
beforeEach(() => { jest.clearAllMocks(); mockPhase.phase = 'idle'; mockPlayer.currentPlaylistId = 'stream'; });

// A song long-pressed on a shelf (owner, 2026-11-13: the same full menu everywhere).
const catalog = { id: 'abc', title: 'Song', artist: 'Artist', duration: 120, source: 'saavn' } as never;
const renderShelf = () => nodes(MiniSongMenu({ song, visible: true, onClose: jest.fn(), current: false, catalog }));

test('a shelf song gets Play next and Add to queue, and not the playing song’s controls', () => {
  const labels = renderShelf().map(n => n.label);
  expect(labels).toEqual(expect.arrayContaining(['Play next', 'Add to queue', 'Add to playlist', 'Start song radio', 'Go to Artist', 'Download song']));
  for (const label of ['Reload audio', 'Up next', 'Find or change lyrics', 'Connect devices']) expect(labels).not.toContain(label);
});

test('Play next and Add to queue hand the catalog song to the stream queue', () => {
  renderShelf().find(n => n.label === 'Play next')?.onPress?.();
  expect(mockPlayNext).toHaveBeenCalledWith(catalog);
  renderShelf().find(n => n.label === 'Add to queue')?.onPress?.();
  expect(mockAppend).toHaveBeenCalledWith([catalog]);
});

test('Add to queue is only offered while a stream queue plays', () => {
  mockPlayer.currentPlaylistId = 'library';
  const labels = renderShelf().map(n => n.label);
  expect(labels).toContain('Play next');
  expect(labels).not.toContain('Add to queue');
});

test('the playing song keeps Now Playing’s rows', () => {
  const labels = render().map(n => n.label);
  expect(labels).toEqual(expect.arrayContaining(['Up next', 'Reload audio', 'Find or change lyrics', 'Equalizer', 'Start song radio']));
  expect(labels).not.toContain('Play next');
});

test('The mini player sheet downloads directly without opening the full player', () => {
  render().find(n => n.label === 'Download song')?.onPress?.();
  expect(mockSave).toHaveBeenCalledWith(song.id);
  expect(mockNavigate).not.toHaveBeenCalled();
});
test.each(['queued', 'downloading', 'saved'])('Download is disabled when %s', phase => {
  mockPhase.phase = phase;
  const button = render().find(n => n.label === (phase === 'saved' ? 'Downloaded on this phone' : 'Downloading…'));
  expect(button?.disabled).toBe(true);
});
test('Lyrics open the picker through the existing player owner', () => {
  render().find(n => n.label === 'Find or change lyrics')?.onPress?.();
  expect(mockNavigate).toHaveBeenCalledWith('NowPlaying', { songId: song.id, action: 'lyrics' });
});
test('Remote playback keeps local audio controls out of its song sheet', () => {
  const labels = render(true).map(n => n.label);
  expect(labels).toContain('Download song');
  expect(labels).toContain('Connect devices');
  expect(labels).not.toContain('Reload audio');
  expect(labels).not.toContain('Shuffle upcoming songs');
});

// A song file on this phone, long-pressed in Library or a playlist (owner, 2026-11-13: the same sheet as everywhere).
const fileSong: Song = { ...song, id: 'file-1' };
const handlers = () => ({
  playNext: jest.fn(), findLyrics: jest.fn(), version: jest.fn(), shareLink: jest.fn(), shareFile: jest.fn(),
  pickCover: jest.fn(), findCover: jest.fn(), recentArts: ['file:///a.jpg'], useRecentArt: jest.fn(), removeCover: jest.fn(),
  edit: jest.fn(), removeFromPlaylist: jest.fn(), hide: jest.fn(), remove: jest.fn(),
});
const renderFile = (library = handlers(), onClose = jest.fn()) => ({ library, onClose, nodes: nodes(MiniSongMenu({ song: fileSong, visible: true, onClose, current: false, library })) });

test('a library song gets the global rows and the library rows in one sheet', () => {
  const labels = renderFile().nodes.map(n => n.label);
  expect(labels).toEqual(expect.arrayContaining([
    'Downloaded on this phone', 'Play next', 'Add to playlist', 'Find lyrics', 'Another language or version', 'Share the audio file',
    'Cover from your photos', 'Find a cover online', 'Remove the cover', 'Edit title and artist', 'Remove from this playlist', 'Hide this song', 'Delete song',
  ]));
  expect(labels).not.toContain('Download song');
});

test('Delete is the last row and the library rows close the sheet before they act', () => {
  const { nodes: rendered, library, onClose } = renderFile();
  const rows = rendered.filter(n => n.label && n.onPress);
  expect(rows.at(-1)?.label).toBe('Delete song');
  rows.at(-1)?.onPress?.();
  expect(onClose).toHaveBeenCalled();
  expect(library.remove).toHaveBeenCalled();
});

test('Remove from this playlist only shows when the host passes it, and Play next only when it can queue', () => {
  const bare = { ...handlers(), removeFromPlaylist: undefined, playNext: undefined };
  const labels = renderFile(bare).nodes.map(n => n.label);
  expect(labels).not.toContain('Remove from this playlist');
  expect(labels).not.toContain('Play next');
});

test('Play next on a library song uses the library queue, not the stream queue', () => {
  const { nodes: rendered, library } = renderFile();
  rendered.find(n => n.label === 'Play next')?.onPress?.();
  expect(library.playNext).toHaveBeenCalled();
  expect(mockPlayNext).not.toHaveBeenCalled();
});

test('the playing library song keeps the picker and gets the player rows too', () => {
  const library = handlers();
  const labels = nodes(MiniSongMenu({ song: fileSong, visible: true, onClose: jest.fn(), current: true, library })).map(n => n.label);
  expect(labels).toEqual(expect.arrayContaining(['Find or change lyrics', 'Up next', 'Edit title and artist']));
  expect(labels).not.toContain('Find lyrics');
});

test('Now Playing answers the sheet’s player requests itself', () => {
  const onPlayer = jest.fn();
  nodes(MiniSongMenu({ song, visible: true, onClose: jest.fn(), onPlayer })).find(n => n.label === 'Up next')?.onPress?.();
  expect(onPlayer).toHaveBeenCalledWith({ sheet: 'queue' });
  expect(mockNavigate).not.toHaveBeenCalled();
});
