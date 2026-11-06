/**
 * Keeps the home-screen widgets current, and answers the links they open.
 * Mounted once in RootNavigator; Android only.
 *
 * Refreshes are cheap but not free (a RemoteViews rebuild per widget), so they
 * run on real changes — song, play state, like, playlists — plus a slow 20s
 * tick while playing, for the progress bar. Nothing ticks while paused.
 */
import { useEffect, useRef } from 'react';
import { Linking, Platform, Share } from 'react-native';
import { requestWidgetUpdate } from 'react-native-android-widget';
import React from 'react';
import { usePlayerStore } from '../store/playerStore';
import { usePlaylistStore } from '../store/playlistStore';
import { routeSongPick } from '../services/connect/playbackIntents';
import { positionSV, durationSV } from '../playback/positionBus';
import { openPlayerSheet } from '../navigation/playerSheet';
import { NowPlayingWidget, PlaylistWidget } from './SongWidget';
import { WIDGET_NOW_PLAYING, WIDGET_PLAYLIST } from './widgetTaskHandler';
import {
  readSnapshot,
  widgetCover,
  writeSnapshot,
  WIDGET_PLAYLIST_SONGS,
  WidgetPlaylist,
  widgetPins,
  WidgetSnapshot,
} from './widgetData';
import { useSettingsStore } from '../store/settingsStore';

const PROGRESS_TICK_MS = 20_000;

const pushToWidgets = async (snapshot: WidgetSnapshot) => {
  await writeSnapshot(snapshot);
  await Promise.all([
    requestWidgetUpdate({
      widgetName: WIDGET_NOW_PLAYING,
      renderWidget: info => React.createElement(NowPlayingWidget, { snapshot, width: info.width, height: info.height }),
    }),
    requestWidgetUpdate({
      widgetName: WIDGET_PLAYLIST,
      renderWidget: info => React.createElement(PlaylistWidget, { snapshot, width: info.width, height: info.height }),
    }),
  ]).catch(() => {});
};

/**
 * The widget's tiles need a name, a count and a cover (1.41.0). It used to read every song of every playlist (one
 * query per song, lyrics included) on each playlist change; now only the shown tiles without a cover of their own
 * read their songs, for the first song's cover.
 */
const loadPlaylists = async (pinnedIds: readonly string[]): Promise<WidgetPlaylist[]> => {
  const { playlists } = usePlaylistStore.getState();
  if (playlists.length === 0) return [];
  const base: WidgetPlaylist[] = playlists.map(p => ({
    id: p.id,
    name: p.isDefault ? 'Liked songs' : p.name,
    cover: widgetCover(p.coverImageUri),
    songCount: p.songCount ?? 0,
    songs: [],
  }));
  const shown = new Set(widgetPins(pinnedIds, base).pins.map(p => p.id));
  const { getPlaylistSongs } = await import('../database/playlistQueries');
  return Promise.all(base.map(async p => {
    if (p.cover || !shown.has(p.id)) return p;
    const songs = await getPlaylistSongs(p.id).catch(() => []);
    const first = songs.find(s => widgetCover(s.coverImageUri));
    return { ...p, cover: widgetCover(first?.coverImageUri), songs: songs.slice(0, WIDGET_PLAYLIST_SONGS).map(s => ({
      id: s.id, title: s.title, artist: s.artist ?? '', cover: widgetCover(s.coverImageUri),
    })) };
  }));
};

export const useWidgetSync = (): void => {
  const songId = usePlayerStore(s => s.currentSong?.id);
  const title = usePlayerStore(s => s.currentSong?.title);
  const artist = usePlayerStore(s => s.currentSong?.artist);
  const cover = usePlayerStore(s => s.currentSong?.coverImageUri);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const liked = usePlaylistStore(s => (songId ? s.likedSongIds.has(songId) : false));
  const playlists = usePlaylistStore(s => s.playlists);
  const pinnedIds = useSettingsStore(s => s.widgetPinnedPlaylistIds);
  const playlistCache = useRef<WidgetPlaylist[]>([]);

  // Playlists and the pinned tiles: rebuilt only when the playlist set or the pins change.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let alive = true;
    loadPlaylists(pinnedIds).then(async list => {
      if (!alive) return;
      playlistCache.current = list;
      const prev = await readSnapshot();
      const { pins, chosen } = widgetPins(pinnedIds, list);
      await pushToWidgets({ ...prev, playlists: list, pinned: pins, pinnedChosen: chosen });
    }).catch(() => {});
    return () => { alive = false; };
  }, [playlists, pinnedIds]);

  // Song / play state / like, plus the slow progress tick while playing.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const push = async () => {
      const prev = await readSnapshot();
      await pushToWidgets({
        ...prev,
        playlists: playlistCache.current.length ? playlistCache.current : prev.playlists,
        song: songId && title ? { id: songId, title, artist: artist ?? '', cover: widgetCover(cover) } : null,
        // A new song or state answers the last widget tap; its notice has done its job.
        notice: null,
        isPlaying,
        liked,
        position: positionSV.value,
        duration: durationSV.value,
      });
    };
    push();
    if (!isPlaying) return;
    const timer = setInterval(push, PROGRESS_TICK_MS);
    return () => clearInterval(timer);
  }, [songId, title, artist, cover, isPlaying, liked]);
};

/** lyricflow://widget/… links opened by widget taps. */
export const useWidgetLinks = (): void => {
  useEffect(() => {
    const handle = async (url: string | null) => {
      if (!url || !url.startsWith('lyricflow://widget/')) return;
      const [path, query = ''] = url.replace('lyricflow://widget/', '').split('?');
      const params = new URLSearchParams(query);
      const player = usePlayerStore.getState();

      if (path === 'play') {
        const playlistId = params.get('playlist');
        if (!playlistId) return;
        const { getPlaylistSongs } = await import('../database/playlistQueries');
        const songs = await getPlaylistSongs(playlistId).catch(() => []);
        if (songs.length === 0) return;
        const songId = params.get('song');
        const index = Math.max(0, songId ? songs.findIndex(s => s.id === songId) : 0);
        // The phone's own paused song included: while another device plays, the tap goes there.
        if (player.currentSongId === songs[index].id) {
          if (!routeSongPick({ playlistId, songs, startIndex: index })) player.requestPlayback(true);
        } else player.setPlaylistQueue(playlistId, songs, index);
        openPlayerSheet(songs[index].id);
      } else if (path === 'now-playing') {
        if (player.currentSongId) openPlayerSheet(player.currentSongId);
      } else if (path === 'share') {
        const song = player.currentSong;
        if (song) Share.share({ message: `${song.title} — ${song.artist ?? ''} · via LuvLyrics` }).catch(() => {});
      }
    };
    // Navigation may not be ready on a cold start; give it a moment.
    Linking.getInitialURL().then(url => setTimeout(() => handle(url), 600)).catch(() => {});
    const sub = Linking.addEventListener('url', e => { handle(e.url); });
    return () => sub.remove();
  }, []);
};
