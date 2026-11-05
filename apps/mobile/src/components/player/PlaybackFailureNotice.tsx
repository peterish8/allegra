import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlaybackStatus } from '../../hooks/usePlaybackStatus';
import { playbackErrorMessage } from '../../playback/playbackStatus';
import { usePlayerStore } from '../../store/playerStore';
import { Button, Sheet, Signal, Surface, Tactile, Text } from '../../ui';

/** A cover inset keeps failures out of the title/scrubber layout. The transport owns Retry. */
export function PlaybackFailureNotice({ width, height, hidden, onRetry }: { width: number; height: number; hidden: boolean; onRetry: () => void }) {
  const insets = useSafeAreaInsets();
  const status = usePlaybackStatus();
  const error = usePlayerStore(s => s.playbackError);
  const songId = usePlayerStore(s => s.currentSongId);
  const [details, setDetails] = useState(false);
  useEffect(() => { setDetails(false); }, [songId, error]);
  if (status !== 'error' || hidden) return null;
  const top = insets.top + 52;
  const card = Math.min(width - 48, 342, Math.max(160, height - top - 360));
  return <>
    <Tactile style={[styles.notice, { width: card - 24, left: (width - card) / 2 + 12, top: top + card - 52 }]}
      onPress={() => setDetails(true)} accessibilityRole="button" accessibilityLabel="Could not play. Show details">
      <Text variant="secondary">Couldn?t play ? Details</Text>
    </Tactile>
    <Sheet visible={details} title="Couldn?t play this song" onClose={() => setDetails(false)}>
      <Text variant="body" tone="secondary">{playbackErrorMessage(error ?? '')}</Text>
      <Button label="Try again" icon="refresh" onPress={() => { setDetails(false); onRetry(); }} />
    </Sheet>
  </>;
}
const styles = StyleSheet.create({ notice: { position: 'absolute', minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: Surface.deep, borderWidth: StyleSheet.hairlineWidth, borderColor: Signal.inkMuted } });
