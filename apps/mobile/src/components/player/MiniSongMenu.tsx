import React, { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import type { SongSnapshot } from '@shared/songRef';
import { creditedArtists } from '@shared/identity';
import { Button, Sheet, SheetIdentity, SheetScrollView, SheetOption, SheetDivider, Space, Control, Text, identityMeta } from '../../ui';
import type { Song } from '../../types/song';
import type { PlayerMenuAction, PlayerRequest } from './playerMenuAction';
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
import { songActionGroups, songActionRows, type SongActionRow } from './songActionRows';
import { RecentCovers } from './RecentCovers';

/**
 * What only the library can do to a song file on this phone. Present for a song opened from Library, a playlist,
 * the mini player or Now Playing; the sheet then adds the lyrics search, version, cover, edit, hide and delete rows.
 * Each handler opens its own modal after the sheet has closed (see `useSongActions`).
 */
export interface LibrarySongHandlers {
  /** Present only while this phone has a queue the song can join. */
  readonly playNext?: () => void;
  readonly findLyrics: () => void;
  readonly version: () => void;
  readonly shareLink: () => void;
  readonly shareFile: () => void;
  readonly pickCover: () => void;
  readonly findCover: () => void;
  readonly recentArts: readonly string[];
  readonly useRecentArt: (uri: string) => void;
  readonly removeCover: () => void;
  readonly edit: () => void;
  /** Present only when the sheet was opened from a playlist. */
  readonly removeFromPlaylist?: () => void;
  readonly hide: () => void;
  readonly remove: () => void;
}

interface Props {
  song: Song;
  visible: boolean;
  onClose: () => void;
  remote?: SongSnapshot;
  /** False for a song picked from a list: it gets Play next / Add to queue instead of the playing song's rows. */
  current?: boolean;
  /** The catalog song behind a stream `song` that is not playing (needed to queue it). */
  catalog?: UnifiedSong;
  /** A song file on this phone: adds the library rows. */
  library?: LibrarySongHandlers;
  /** Now Playing handles its own sheets; elsewhere the request opens Now Playing. */
  onPlayer?: (request: PlayerRequest) => void;
}

type Item = { icon: string; label: string; onPress: () => void; selected?: boolean; chevron?: boolean; destructive?: boolean };

/**
 * The one song sheet (owner, 2026-11-13): a long press on any song row, in the mini player and Now Playing's
 * ••• open it. Download comes first and large, then Like and Share, then the rows from `songActionGroups` in their
 * categories. What shows is decided by `songActionRows`; playback stays with its current owner.
 */
export function MiniSongMenu({ song, visible, onClose, remote, current = true, catalog, library, onPlayer }: Props) {
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
  const rows = songActionRows({
    current, remote: !!remote, stream, native, ringtone: canSetRingtone(song), artist: !!artist, appendable,
    library: !!library, fromPlaylist: !!library?.removeFromPlaylist, canPlayNext: library ? !!library.playNext : true,
  });
  const queue = (where: 'next' | 'end') => {
    if (library?.playNext && where === 'next') { library.playNext(); return; }
    if (!catalog) return;
    if (where === 'next') StreamService.playNext(catalog);
    else StreamService.append([catalog]);
    setNotice(where === 'next' ? 'Playing next' : 'Added to the queue');
  };
  const toPlayer = (request: PlayerRequest) => {
    onClose();
    if (onPlayer) onPlayer(request);
    else if (navigationRef.isReady()) navigationRef.navigate('NowPlaying', { songId: song.id, ...request });
  };
  const playerAction = (action: PlayerMenuAction) => toPlayer({ action });
  /** A library action that opens something else: the sheet closes first. */
  const leave = (fn?: () => void) => () => { onClose(); fn?.(); };
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

  /** One entry per row the model can return; a row the host cannot do has no entry and is skipped. */
  const spec = (row: SongActionRow): Item | null => {
    switch (row) {
      case 'playNext': return { icon: 'return-down-forward', label: 'Play next', onPress: () => queue('next') };
      case 'addToQueue': return { icon: 'list-outline', label: 'Add to queue', onPress: () => queue('end') };
      case 'addToPlaylist': return { icon: 'add-outline', label: 'Add to playlist', onPress: () => {
        if (stream) { void save(); setNotice('Download this song first, then add it to a playlist from your library.'); }
        else { onClose(); if (navigationRef.isReady()) navigationRef.navigate('AddToPlaylist', { songId: song.id }); }
      } };
      case 'radio': return { icon: 'radio-outline', label: 'Start song radio', onPress: () => { void StreamService.startRadio(song).then(n => setNotice(n ? 'Song radio started' : 'Could not start radio')).catch(() => setNotice('Could not start radio')); } };
      case 'artist': return { icon: 'person-outline', label: `Go to ${artist}`, chevron: true, onPress: artistPage };
      case 'upNext': return { icon: 'list-outline', label: 'Up next', onPress: () => toPlayer({ sheet: 'queue' }) };
      case 'sleepTimer': return { icon: 'moon-outline', label: 'Sleep timer', onPress: () => toPlayer({ sheet: 'timer' }) };
      case 'shuffleUpcoming': return { icon: 'shuffle-outline', label: 'Shuffle upcoming songs', onPress: () => setNotice(shuffleUpcoming() ? 'Shuffled upcoming songs' : 'Nothing queued to shuffle') };
      case 'repeat': return { icon: 'repeat-outline', label: repeat ? 'Turn off repeat song' : 'Repeat this song', selected: repeat, onPress: () => usePlaybackModesStore.getState().setRepeatOne(!repeat) };
      case 'reload': return { icon: 'refresh-outline', label: 'Reload audio', onPress: () => { void refetchCurrent().then(ok => setNotice(ok ? 'Audio reloaded' : 'Could not reload audio')).catch(() => setNotice('Could not reload audio')); } };
      case 'findLyrics': return library ? { icon: 'text-outline', label: 'Find lyrics', onPress: leave(library.findLyrics) } : null;
      case 'lyrics': return { icon: 'text-outline', label: 'Find or change lyrics', onPress: () => playerAction('lyrics') };
      case 'version': return library ? { icon: 'language-outline', label: 'Another language or version', onPress: leave(library.version) } : null;
      case 'details': return { icon: 'information-circle-outline', label: 'Song details and cover', onPress: () => playerAction('details') };
      case 'ambient': return { icon: 'expand-outline', label: 'Ambient player', onPress: () => playerAction('ambient') };
      case 'ringtone': return { icon: 'notifications-outline', label: 'Set as ringtone', onPress: () => { void setAsRingtone(song).then(setNotice).catch(() => setNotice('Could not set ringtone')); } };
      case 'shareFile': return library ? { icon: 'document-outline', label: 'Share the audio file', onPress: leave(library.shareFile) } : null;
      case 'coverPhoto': return library ? { icon: 'image-outline', label: 'Cover from your photos', onPress: leave(library.pickCover) } : null;
      case 'coverOnline': return library ? { icon: 'globe-outline', label: 'Find a cover online', onPress: leave(library.findCover) } : null;
      case 'coverRemove': return library ? { icon: 'close-circle-outline', label: 'Remove the cover', onPress: leave(library.removeCover) } : null;
      case 'luvLink': return { icon: 'people-outline', label: 'LuvLink', onPress: () => playerAction('together') };
      case 'devices': return { icon: 'laptop-outline', label: 'Connect devices', onPress: () => { onClose(); connect.openDevices(); } };
      case 'output': return { icon: 'volume-high-outline', label: 'Audio output', onPress: () => { if (!NativeAudioPlayer.openOutputSwitcher()) setNotice('No other devices found'); } };
      case 'equalizer': return { icon: 'options-outline', label: 'Equalizer', onPress: () => { if (!NativeAudioPlayer.openEqualizer()) setNotice('No equalizer on this phone'); } };
      case 'tempo': return { icon: 'speedometer-outline', label: 'Tempo and pitch', onPress: () => playerAction('advanced') };
      case 'editInfo': return library ? { icon: 'create-outline', label: 'Edit title and artist', onPress: leave(library.edit) } : null;
      case 'removeFromPlaylist': return library?.removeFromPlaylist ? { icon: 'remove-circle-outline', label: 'Remove from this playlist', onPress: leave(library.removeFromPlaylist) } : null;
      case 'hide': return library ? { icon: 'eye-off-outline', label: 'Hide this song', onPress: leave(library.hide) } : null;
      case 'delete': return library ? { icon: 'trash-outline', label: 'Delete song', destructive: true, onPress: leave(library.remove) } : null;
      default: return null;
    }
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
          <Button style={styles.quickButton} icon="share-outline" label="Share" onPress={() => { if (library) leave(library.shareLink)(); else void shareSong(song); }} />
        </View>
        {songActionGroups(rows).map(group => (
          <React.Fragment key={group.id}>
            {group.title ? <><SheetDivider /><Text variant="meta" tone="muted">{group.title}</Text></> : null}
            {group.rows.map(row => {
              const item = spec(row);
              if (!item) return null;
              return (
                <React.Fragment key={row}>
                  <SheetOption icon={item.icon as never} label={item.label} selected={item.selected} chevron={item.chevron} destructive={item.destructive} onPress={item.onPress} />
                  {row === 'coverOnline' && library && library.recentArts.length > 0 ? <RecentCovers uris={library.recentArts} onSelect={uri => leave(() => library.useRecentArt(uri))()} /> : null}
                </React.Fragment>
              );
            })}
          </React.Fragment>
        ))}
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
