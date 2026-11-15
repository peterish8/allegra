/**
 * Settings → Playback → Song cache (Android, 1.69.0): how much streamed audio the phone keeps so songs replay without
 * data, and a way to clear it. The cache itself is native (`playback/StreamCache.kt`); this only sets its ceiling.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { NativeAudioPlayer } from '../../services/NativeAudioPlayer';
import { streamCacheKeyFor } from '../../playback/streamCacheKey';
import { usePlayerStore } from '../../store/playerStore';
import { STREAM_CACHE_LIMITS, type StreamCacheLimit, useSettingsStore } from '../../store/settingsStore';
import { Action, Choice } from './SettingsKit';

const label = (mb: StreamCacheLimit): string => (Number(mb) >= 1024 ? `${Number(mb) / 1024} GB` : `${mb} MB`);
const OPTIONS = STREAM_CACHE_LIMITS.map(value => ({ value, label: label(value) }));

/** Used space in whole MB for the Clear row. */
export const usedLabel = (bytes: number): string => `${Math.round(Math.max(0, bytes) / (1024 * 1024))} MB used`;

export const SongCacheSettings: React.FC = () => {
  const limit = useSettingsStore(s => s.streamCacheLimitMb);
  const setLimit = useSettingsStore(s => s.setStreamCacheLimitMb);
  const [used, setUsed] = useState(0);
  const refresh = useCallback(() => {
    void NativeAudioPlayer.getStreamCacheInfo().then(info => setUsed(info.usedBytes));
  }, []);
  useEffect(refresh, [refresh]);

  const change = useCallback((next: StreamCacheLimit) => {
    setLimit(next);
    void NativeAudioPlayer.setStreamCacheLimitMb(Number(next)).then(refresh);
  }, [setLimit, refresh]);

  const clear = useCallback(() => {
    const song = usePlayerStore.getState().currentSong;
    const keep = song?.audioUri ? streamCacheKeyFor(song.id, song.audioUri) : null;
    void NativeAudioPlayer.clearStreamCache(keep).then(refresh);
  }, [refresh]);

  if (Platform.OS !== 'android') return null;
  return (
    <>
      <Choice<StreamCacheLimit>
        label="Song cache"
        hint="Songs you stream are kept on this phone so they replay without data."
        value={limit}
        options={OPTIONS}
        onChange={change}
      />
      <Action label="Clear song cache" hint="The song playing now stays." value={usedLabel(used)} onPress={clear} />
    </>
  );
};
