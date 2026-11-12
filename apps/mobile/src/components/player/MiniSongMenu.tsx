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
import { isStreamSongId, parseStreamId, STREAM_QUEUE_ID } from '../../services/stream/streamSong';
import { useSongsStore } from '../../store/songsStore';
import { usePlaybackModesStore } from '../../store/playbackModesStore';
import { NativeAudioPlayer } from '../../services/NativeAudioPlayer';
import { canSetRingtone, refetchCurrent, setAsRingtone, shareSong, shuffleUpcoming } from '../../services/player/playerMenuActions';
import { useConnect } from '../../services/connect/ConnectProvider';
import { matchConnectSong } from '../../services/connect/songMatcher';
import { toggleOnlineLike } from '../../services/sync/onlineLike';
import { navigationRef } from '../../utils/navigationService';
import type { UnifiedSong } from '../../types/song';
import { usePlayerStore } from '../../store/playerStore';
import { songActionRows } from './songActionRows';

interface Props {
  song: Song;
  visible: boolean;
  onClose: () => void;
  remote?: SongSnapshot;
  /** False for a song picked from a list: it gets Play next / Add to queue instead of the playing song's rows. */
  current?: boolean;
  /** The catalog song behind a stream `song` that is not playing (needed to queue it). */
  catalog?: UnifiedSong;
}

/**
 * The one song actions sheet (owner, 2026-11-13): long press on the mini player, on Stream's shelves, in Search
 * and on mixes. Everything that applies to the song; the playing song also gets Now Playing's playback, lyrics
 * and sound rows. Rows come from `songActionRows`. Playback remains with its current owner.
 */
export function MiniSongMenu({ song, visible, onClose, remote, current = true, catalog }: Props) {
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
  const appendable = usePlayerStore.getState().currentPlaylistId === STREAM_QUEUE_ID;
  const rows = songActionRows({ current, remote: !!remote, stream, native, ringtone: canSetRingtone(song), artist: !!artist, appendable });
  const queue = (where: 'next' | 'end') => {
    if (!catalog) return;
    if (where === 'next') StreamService.playNext(catalog);
    else StreamService.append([catalog]);
    setNotice(where === 'next' ? 'Playing next' : 'Added to the queue');
  };
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
        {rows.has('playNext') ? <SheetOption icon="return-down-forward" label="Play next" onPress={() => queue('next')} /> : null}
        {rows.has('addToQueue') ? <SheetOption icon="list-outline" label="Add to queue" onPress={() => queue('end')} /> : null}
        <SheetOption icon="add-outline" label="Add to playlist" onPress={() => {
          if (stream) { void save(); setNotice('Download this song first, then add it to a playlist from your library.'); }
          else { onClose(); if (navigationRef.isReady()) navigationRef.navigate('AddToPlaylist', { songId: song.id }); }
        }} />
        {rows.has('radio') ? <SheetOption icon="radio-outline" label="Start song radio" onPress={() => { void StreamService.startRadio(song).then(n => setNotice(n ? 'Song radio started' : 'Could not start radio')).catch(() => setNotice('Could not start radio')); }} /> : null}
        {rows.has('artist') ? <SheetOption icon="person-outline" label={`Go to ${artist}`} chevron onPress={artistPage} /> : null}
        {rows.has('upNext') ? <>
          <SheetDivider /><Text variant="meta" tone="muted">Playback</Text>
          <SheetOption icon="list-outline" label="Up next" onPress={() => { onClose(); if (navigationRef.isReady()) navigationRef.navigate('NowPlaying', { songId: song.id, sheet: 'queue' }); }} />
          <SheetOption icon="moon-outline" label="Sleep timer" onPress={() => { onClose(); if (navigationRef.isReady()) navigationRef.navigate('NowPlaying', { songId: song.id, sheet: 'timer' }); }} />
          <SheetOption icon="shuffle-outline" label="Shuffle upcoming songs" onPress={() => setNotice(shuffleUpcoming() ? 'Shuffled upcoming songs' : 'Nothing queued to shuffle')} />
          <SheetOption icon="repeat-outline" label={repeat ? 'Turn off repeat song' : 'Repeat this song'} selected={repeat} onPress={() => usePlaybackModesStore.getState().setRepeatOne(!repeat)} />
          <SheetOption icon="refresh-outline" label="Reload audio" onPress={() => { void refetchCurrent().then(ok => setNotice(ok ? 'Audio reloaded' : 'Could not reload audio')).catch(() => setNotice('Could not reload audio')); }} />
          <SheetDivider /><Text variant="meta" tone="muted">Lyrics and song</Text>
          <SheetOption icon="text-outline" label="Find or change lyrics" onPress={() => playerAction('lyrics')} />
          <SheetOption icon="information-circle-outline" label="Song details and cover" onPress={() => playerAction('details')} />
          <SheetOption icon="expand-outline" label="Ambient player" onPress={() => playerAction('ambient')} />
          {rows.has('ringtone') ? <SheetOption icon="notifications-outline" label="Set as ringtone" onPress={() => { void setAsRingtone(song).then(setNotice).catch(() => setNotice('Could not set ringtone')); }} /> : null}
        </> : null}
        {rows.has('devices') ? <><SheetDivider /><Text variant="meta" tone="muted">Listen together and sound</Text></> : null}
        {rows.has('luvLink') ? <SheetOption icon="people-outline" label="LuvLink" onPress={() => playerAction('together')} /> : null}
        {rows.has('devices') ? <SheetOption icon="laptop-outline" label="Connect devices" onPress={() => { onClose(); connect.openDevices(); }} /> : null}
        {rows.has('output') ? <>
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
