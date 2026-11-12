import React from 'react';
import type { Song } from '../../types/song';
jest.mock('react', () => ({ ...jest.requireActual('react'), useState: (value: unknown) => [value, jest.fn()] }));
jest.mock('react-native', () => ({ Platform: { OS: 'android' }, StyleSheet: { create: (s: unknown) => s }, View: 'View' }));
jest.mock('../../ui', () => ({
  Button: 'Button', Sheet: 'Sheet', SheetIdentity: 'Identity', SheetScrollView: 'Scroll', SheetOption: 'Option', SheetDivider: 'Divider', Text: 'Text',
  Space: { sm: 8, md: 16, lg: 24 }, Control: { target: 48 }, identityMeta: (...parts: string[]) => parts.join(' · '),
}));
const mockSave = jest.fn((..._args: unknown[]) => true);
const mockNavigate = jest.fn();
const mockPhase = { phase: 'idle' };
jest.mock('../../hooks/useDownloadState', () => ({ useDownloadState: () => mockPhase }));
jest.mock('../../hooks/useIsSongLiked', () => ({ useSongLikeState: () => ({ liked: false }) }));
jest.mock('../../services/stream/StreamService', () => ({ StreamService: { save: (...args: unknown[]) => mockSave(...args) } }));
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
beforeEach(() => { jest.clearAllMocks(); mockPhase.phase = 'idle'; });

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
