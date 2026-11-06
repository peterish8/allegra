/**
 * Headless handler for both home-screen widgets: renders them from the saved
 * snapshot and answers their buttons.
 *
 * Transport buttons act on the player when the app's JS runtime is alive
 * (music playing in the background keeps it alive). A pinned playlist's tile
 * (PLAY_PLAYLIST) plays even from a cold start, without opening the app: the
 * headless task hands its downloaded songs to the native queue engine.
 * Share and "now playing" are deep links that open the app.
 */
import React from 'react';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { NowPlayingWidget, PlaylistWidget } from './SongWidget';
import { readSnapshot, widgetCover, writeSnapshot, WidgetSnapshot } from './widgetData';

export const WIDGET_NOW_PLAYING = 'NowPlaying';
export const WIDGET_PLAYLIST = 'Playlist';

const render = (props: WidgetTaskHandlerProps, snapshot: WidgetSnapshot) => {
  const { widgetInfo } = props;
  if (widgetInfo.widgetName === WIDGET_PLAYLIST) {
    props.renderWidget(<PlaylistWidget snapshot={snapshot} width={widgetInfo.width} height={widgetInfo.height} />);
  } else {
    props.renderWidget(<NowPlayingWidget snapshot={snapshot} width={widgetInfo.width} height={widgetInfo.height} />);
  }
};

/** Runs a transport action if the player is loaded in this JS runtime. */
const act = async (action: string, snapshot: WidgetSnapshot): Promise<WidgetSnapshot> => {
  const { usePlayerStore } = await import('../store/playerStore');
  const player = usePlayerStore.getState();
  if (!player.currentSong) return snapshot; // cold start: nothing loaded to control
  switch (action) {
    case 'TOGGLE_PLAY': {
      const next = !player.isPlaying;
      player.requestPlayback(next);
      return { ...snapshot, isPlaying: next };
    }
    case 'NEXT':
      await player.nextInPlaylist();
      return snapshot;
    case 'PREVIOUS':
      await player.previousInPlaylist();
      return snapshot;
    case 'TOGGLE_LIKE': {
      const { useSongsStore } = await import('../store/songsStore');
      await useSongsStore.getState().toggleLike(player.currentSong.id);
      return { ...snapshot, liked: !snapshot.liked };
    }
    default:
      return snapshot;
  }
};

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  let snapshot = await readSnapshot();
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      render(props, snapshot);
      break;
    case 'WIDGET_CLICK': {
      const action = props.clickAction ?? '';
      if (action === 'PLAY_PLAYLIST') {
        // A pinned playlist: it plays here, in the background, without opening the app (1.41.0).
        const data = (props.clickActionData ?? {}) as { playlistId?: unknown; name?: unknown };
        const playlistId = typeof data.playlistId === 'string' ? data.playlistId : '';
        const name = typeof data.name === 'string' ? data.name : 'this playlist';
        if (playlistId) {
          const { playPinnedPlaylist } = await import('./playPinned');
          const result = await playPinnedPlaylist(playlistId, name).catch(() => ({ ok: false, notice: 'Couldn’t start that playlist', first: undefined }));
          snapshot = result.ok && result.first
            ? {
              ...snapshot,
              notice: null,
              isPlaying: true,
              position: 0,
              song: { id: result.first.id, title: result.first.title, artist: result.first.artist ?? '', cover: widgetCover(result.first.coverImageUri) },
            }
            : { ...snapshot, notice: result.notice ?? null };
          await writeSnapshot(snapshot);
        }
      } else if (action === 'NEXT_PLAYLIST') {
        snapshot = { ...snapshot, playlistIndex: snapshot.playlistIndex + 1 };
        await writeSnapshot(snapshot);
      } else {
        // Optimistic frame first, so the button answers at once.
        snapshot = await act(action, snapshot).catch(() => snapshot);
      }
      render(props, snapshot);
      break;
    }
    default:
      break;
  }
}
