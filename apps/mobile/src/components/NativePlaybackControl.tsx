import React from 'react';
import { Platform, processColor, type StyleProp, type ViewStyle } from 'react-native';
import { requireNativeView } from 'expo';
import { useReducedMotion } from 'react-native-reanimated';
import { useLuvLinkStore } from '../store/luvLinkStore';
import { usePlayerStore, usesNativeQueue } from '../store/playerStore';
import { PlaybackButton } from '../ui/PlaybackButton';
import { Glass, Motion, Signal } from '../constants/allegraTheme';
import type { PlaybackStatus } from '../playback/playbackStatus';
interface NativeProps { plain: boolean; tint: number; surface: number; glyph: number; status: string; songId: string | null; reduceMotion: boolean; pressDuration: number; onFallback: () => void; style: StyleProp<ViewStyle> }
const load = (): React.ComponentType<NativeProps> | null => {
  if (Platform.OS !== 'android') return null;
  try { return requireNativeView<NativeProps>('NativeTransport'); } catch { return null; }
};
const NativeTransport = load();
export function NativePlaybackControl({ status, onPress, size = 84, plain = false, remote = false }: { status: PlaybackStatus; onPress: () => void; size?: number; plain?: boolean; remote?: boolean }) {
  const inRoom = useLuvLinkStore(s => !!s.ownedRoomId || !!s.room);
  const songId = usePlayerStore(s => s.currentSongId);
  const reduced = useReducedMotion();
  if (!NativeTransport || remote || inRoom || !usesNativeQueue() || status === 'error') return <PlaybackButton status={status} onPress={onPress} size={size} plain={plain} />;
  return <NativeTransport plain={plain} status={status} songId={songId} reduceMotion={!!reduced} pressDuration={Motion.duration.instant}
    tint={processColor(Signal.ink) as number} surface={processColor(Glass.fillPressed) as number} glyph={plain ? 26 : size > 48 ? 36 : 22}
    onFallback={onPress} style={{ width: size, height: size }} />;
}
