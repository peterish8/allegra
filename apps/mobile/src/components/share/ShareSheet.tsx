/**
 * Share (1.44.0, owner): what is being shared, its LuvLyrics code to scan from this screen, then Share link and Copy
 * link. The link opens LuvLyrics for someone who has it and the website for everyone else (services/share).
 *
 * A playlist gets its link from the account (it becomes public, as Share does on the website). Signed out, or for a
 * playlist the account does not hold, it can still go out as a list of its songs.
 */
import React, { useEffect, useState } from 'react';
import { Share, StyleSheet, useWindowDimensions, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { shareUrlFor, type ShareTarget } from '@shared/shareLinks';
import { GUTTER, Haptics, Sheet, SheetIdentity, SheetOption, Space, Text } from '../../ui';
import { pillTint } from '../allegra/palette';
import { useArtworkPalette } from '../allegra/useArtworkPalette';
import { codePayloadFor, playlistShareCode, shareMessage, songShareTarget } from '../../services/share/shareService';
import { playlistShareText } from '../playlist/playlistPage';
import { LIKED_PLAYLIST_ID } from '../../services/sync/plan';
import { countOf } from '../../utils/formatters';
import { exportFailureText, shareCodeImage } from '../../services/share/exportCode';
import { Signal } from '../../constants/allegraTheme';
import { LuvCode } from './LuvCode';
import type { Song } from '../../types/song';

export type ShareSubject =
  | { kind: 'song'; song: Pick<Song, 'id' | 'originId' | 'title' | 'artist' | 'coverImageUri'> }
  | { kind: 'playlist'; playlistId: string; name: string; cover: string | null; tint?: string; songs: readonly Pick<Song, 'title' | 'artist'>[] };

const CODE_MAX = 360;

export const ShareSheet: React.FC<{ visible: boolean; onClose: () => void; target: ShareSubject }> = ({ visible, onClose, target }) => {
  const { width } = useWindowDimensions();
  const cover = target.kind === 'song' ? target.song.coverImageUri : target.cover;
  const palette = useArtworkPalette(visible ? cover ?? undefined : undefined);
  const name = target.kind === 'song' ? target.song.title : target.name;
  const [share, setShare] = useState<ShareTarget | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'list'>('idle');
  const [copied, setCopied] = useState(false);
  const [imageState, setImageState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [imageNote, setImageNote] = useState<string | null>(null);
  const playlistId = target.kind === 'playlist' ? target.playlistId : null;
  const songKey = target.kind === 'song' ? target.song.id : null;

  useEffect(() => {
    if (!visible) { setCopied(false); setImageState('idle'); setImageNote(null); return; }
    if (target.kind === 'song') { setShare(songShareTarget(target.song)); setState('ready'); return; }
    if (target.playlistId === LIKED_PLAYLIST_ID) { setShare(null); setState('list'); return; }
    let live = true;
    setState('loading');
    void playlistShareCode(target.playlistId).then(code => {
      if (!live) return;
      setShare(code ? { kind: 'playlist', code } : null);
      setState(code ? 'ready' : 'list');
    });
    return () => { live = false; };
  // The subject's identity, not the object (rebuilt every render).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, playlistId, songKey]);

  const payload = share ? codePayloadFor(share) : null;
  const codeWidth = Math.min(width - GUTTER * 2, CODE_MAX);
  const meta = target.kind === 'song' ? `Song · ${target.song.artist ?? ''}` : `Playlist · ${countOf(target.songs.length, 'song')}`;

  const sendLink = () => {
    if (!share) return;
    void Share.share({ message: shareMessage(share, target.kind === 'song' ? `${name} · ${target.song.artist ?? ''}` : name) }).catch(() => undefined);
  };
  const copyLink = () => {
    if (!share) return;
    void Clipboard.setStringAsync(shareUrlFor(share)).then(() => { Haptics.success(); setCopied(true); });
  };
  const cardTint = target.kind === 'playlist' && target.tint ? pillTint(target.tint) : pillTint(palette.primary);
  const sendImage = () => {
    if (!payload || imageState === 'busy') return;
    setImageState('busy');
    setImageNote(null);
    void shareCodeImage(payload, { tint: cardTint, ink: Signal.ink, name }).then(result => {
      if (result.ok === true) { setImageState('idle'); return; }
      setImageState('failed');
      setImageNote(exportFailureText(result.reason));
    });
  };
  const sendList = () => {
    if (target.kind !== 'playlist') return;
    void Share.share({ message: playlistShareText(target.name, target.songs) }).catch(() => undefined);
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetIdentity title={name} meta={meta} artwork={{ uri: cover ?? undefined, title: name, artist: target.kind === 'song' ? target.song.artist : undefined }} onClose={onClose} />
      {payload ? (
        <View style={styles.code}>
          <LuvCode payload={payload} tint={target.kind === 'playlist' && target.tint ? pillTint(target.tint) : pillTint(palette.primary)} width={codeWidth} label={name} />
          <Text variant="caption" tone="secondary" align="center">Scan with LuvLyrics: Search, then the camera</Text>
        </View>
      ) : null}
      {state === 'loading' ? <Text variant="secondary" tone="secondary" style={styles.note}>Getting the playlist’s link…</Text> : null}
      {state === 'ready' ? (
        <>
          <SheetOption label="Share link" icon="share-social-outline" onPress={sendLink} />
          <SheetOption label={imageState === 'busy' ? 'Making the picture…' : 'Share code as a picture'} icon="image-outline" onPress={sendImage} />
          {imageNote ? <Text variant="secondary" tone="secondary" style={styles.note} accessibilityRole="alert">{imageNote}</Text> : null}
          <SheetOption label={copied ? 'Link copied' : 'Copy link'} icon={copied ? 'checkmark' : 'copy-outline'} onPress={copyLink} />
        </>
      ) : null}
      {state === 'list' ? (
        <>
          <Text variant="secondary" tone="secondary" style={styles.note}>
            {playlistId === LIKED_PLAYLIST_ID ? 'Liked songs stay private. You can send them as a list.' : 'Sign in, and sync this playlist, to share a link that opens it.'}
          </Text>
          <SheetOption label="Share as a list" icon="list-outline" onPress={sendList} />
        </>
      ) : null}
    </Sheet>
  );
};

const styles = StyleSheet.create({
  code: { alignItems: 'center', gap: Space.xs, paddingHorizontal: GUTTER, paddingVertical: Space.md },
  note: { paddingHorizontal: GUTTER, paddingVertical: Space.xs },
});
