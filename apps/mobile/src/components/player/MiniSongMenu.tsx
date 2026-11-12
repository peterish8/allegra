import React, { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import type { SongSnapshot } from '@shared/songRef';
import { creditedArtists } from '@shared/identity';
import { Button, Sheet, SheetIdentity, SheetScrollView, SheetOption, SheetDivider, Space, Control, Text, identityMeta } from '../../ui';
import type { Song } from '../../types/song';
import type { PlayerMenuAction } from './PlayerMenu';
import { useDownloadState } from '../../hooks/useDownloadState';
import { useSongLikeState } from '../../hooks/useIsSongLiked';
import { StreamService } from '../../services/stream/StreamService';
import { isStreamSongId, parseStreamId } from '../../services/stream/streamSong';
import { useSongsStore } from '../../store/songsStore';
import { usePlaybackModesStore } from '../../store/playbackModesStore';
import { NativeAudioPlayer } from '../../services/NativeAudioPlayer';
import { canSetRingtone, refetchCurrent, setAsRingtone, shareSong, shuffleUpcoming } from '../../services/player/playerMenuActions';
import { useConnect } from '../../services/connect/ConnectProvider';
import { matchConnectSong } from '../../services/connect/songMatcher';
import { toggleOnlineLike } from '../../services/sync/onlineLike';
import { navigationRef } from '../../utils/navigationService';

interface Props { song: Song; visible: boolean; onClose: () => void; remote?: SongSnapshot }

/** Song actions from the mini player; playback remains with its current owner. */
export function MiniSongMenu({ song, visible, onClose, remote }: Props) {
  const [notice, setNotice] = useState('');
  const [resolving, setResolving] = useState(false);
  const stream = isStreamSongId(song.id);
  const targetId = parseStreamId(song.id)?.providerId ?? song.id;
  const download = useDownloadState({ ...song, id: targetId });
  const like = useSongLikeState(song);
  const repeat = usePlaybackModesStore(s => s.repeatOne);
  const connect = useConnect();
  const artist = creditedArtists(song.artist)[0];
  const saved = !stream || download.phase === 'saved';
  const saving = resolving || download.phase === 'queued' || download.phase === 'downloading';
  const native = !remote && Platform.OS === 'android' && NativeAudioPlayer.isAvailable();
  const playerAction = (action: PlayerMenuAction) => {
    onClose();
    if (navigationRef.isReady()) navigationRef.navigate('NowPlaying', { songId: song.id, action });
  };
  const save = async () => {
    try {
      setResolving(true);
      let ok = false;
      if (remote) {
        const match = await matchConnectSong(remote);
        ok = match?.kind === 'catalog' && StreamService.save(match.song);
      } else ok = StreamService.save(song.id);
      setNotice(ok ? 'Downloading to your library. Lyrics will follow separately.' : 'Could not download this song. Try again.');
    } catch { setNotice('Could not download this song. Try again.'); }
    finally { setResolving(false); }
  };
  const toggleLike = async () => {
    try {
      if (remote) await toggleOnlineLike(remote);
      else await useSongsStore.getState().toggleLike(song.id);
    } catch { setNotice('Could not update Liked songs. Try again.'); }
  };
  const artistPage = () => {
    onClose();
    if (artist && navigationRef.isReady()) navigationRef.navigate('Main', { screen: 'Browse', params: { screen: 'Artist', params: { name: artist } } });
  };
  return (
    <Sheet visible={visible} onClose={onClose} tall tintUri={song.coverImageUri}>
      <SheetIdentity title={song.title} meta={identityMeta(remote ? 'Playing on another device' : 'Song', song.artist)}
        artwork={{ uri: song.coverImageUri, title: song.title, artist: song.artist }} onClose={onClose} />
      <SheetScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Button block variant={saved ? 'secondary' : 'primary'} style={styles.download}
          label={saved ? 'Downloaded on this phone' : saving ? 'Downloading…' : 'Download song'}
          icon={saved ? 'checkmark-circle-outline' : 'arrow-down-circle-outline'} disabled={saved || saving} busy={resolving} onPress={() => { void save(); }} />
        {notice ? <Text variant="meta" tone="muted" accessibilityLiveRegion="polite">{notice}</Text> : null}
        <View style={styles.quick}>
          <Button style={styles.quickButton} icon={like.liked ? 'heart' : 'heart-outline'} label={like.liked ? 'Liked' : 'Like'} onPress={() => { void toggleLike(); }} />
          <Button style={styles.quickButton} icon="share-outline" label="Share" onPress={() => { void shareSong(song); }} />
        </View>
        <SheetOption icon="add-outline" label="Add to playlist" onPress={() => {
          if (stream) { void save(); setNotice('Download this song first, then add it to a playlist from your library.'); }
          else { onClose(); if (navigationRef.isReady()) navigationRef.navigate('AddToPlaylist', { songId: song.id }); }
        }} />
        {!remote ? <>
          <SheetDivider /><Text variant="meta" tone="muted">Playback</Text>
          <SheetOption icon="list-outline" label="Up next" onPress={() => { onClose(); if (navigationRef.isReady()) navigationRef.navigate('NowPlaying', { songId: song.id, sheet: 'queue' }); }} />
          <SheetOption icon="moon-outline" label="Sleep timer" onPress={() => { onClose(); if (navigationRef.isReady()) navigationRef.navigate('NowPlaying', { songId: song.id, sheet: 'timer' }); }} />
          <SheetOption icon="radio-outline" label="Start song radio" onPress={() => { void StreamService.startRadio(song).then(n => setNotice(n ? 'Song radio started' : 'Could not start radio')).catch(() => setNotice('Could not start radio')); }} />
          <SheetOption icon="shuffle-outline" label="Shuffle upcoming songs" onPress={() => setNotice(shuffleUpcoming() ? 'Shuffled upcoming songs' : 'Nothing queued to shuffle')} />
          <SheetOption icon="repeat-outline" label={repeat ? 'Turn off repeat song' : 'Repeat this song'} selected={repeat} onPress={() => usePlaybackModesStore.getState().setRepeatOne(!repeat)} />
          <SheetOption icon="refresh-outline" label="Reload audio" onPress={() => { void refetchCurrent().then(ok => setNotice(ok ? 'Audio reloaded' : 'Could not reload audio')).catch(() => setNotice('Could not reload audio')); }} />
          <SheetDivider /><Text variant="meta" tone="muted">Lyrics and song</Text>
          <SheetOption icon="text-outline" label="Find or change lyrics" onPress={() => playerAction('lyrics')} />
          <SheetOption icon="information-circle-outline" label="Song details and cover" onPress={() => playerAction('details')} />
          <SheetOption icon="expand-outline" label="Ambient player" onPress={() => playerAction('ambient')} />
          {canSetRingtone(song) ? <SheetOption icon="notifications-outline" label="Set as ringtone" onPress={() => { void setAsRingtone(song).then(setNotice).catch(() => setNotice('Could not set ringtone')); }} /> : null}
        </> : null}
        {artist ? <SheetOption icon="person-outline" label={`Go to ${artist}`} chevron onPress={artistPage} /> : null}
        <SheetDivider /><Text variant="meta" tone="muted">Listen together and sound</Text>
        {!remote ? <SheetOption icon="people-outline" label="LuvLink" onPress={() => playerAction('together')} /> : null}
        <SheetOption icon="laptop-outline" label="Connect devices" onPress={() => { onClose(); connect.openDevices(); }} />
        {native ? <>
          <SheetOption icon="volume-high-outline" label="Audio output" onPress={() => { if (!NativeAudioPlayer.openOutputSwitcher()) setNotice('No other devices found'); }} />
          <SheetOption icon="options-outline" label="Equalizer" onPress={() => { if (!NativeAudioPlayer.openEqualizer()) setNotice('No equalizer on this phone'); }} />
          <SheetOption icon="speedometer-outline" label="Tempo and pitch" onPress={() => playerAction('advanced')} />
        </> : null}
      </SheetScrollView>
    </Sheet>
  );
}
const styles = StyleSheet.create({
  content: { gap: Space.sm, paddingBottom: Space.lg },
  download: { minHeight: Control.target + Space.md },
  quick: { flexDirection: 'row', gap: Space.sm },
  quickButton: { flex: 1 },
});
