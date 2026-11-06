/**
 * A playlist page's offline control (1.41.0): Download → "Downloading 3 of 20" → "Downloaded". A downloaded playlist
 * plays with no connection (and from the home-screen widget). Tapping "Downloaded" offers to remove the download; a
 * playlist only partly offline (a song the catalog couldn't find) offers to try the rest again.
 */
import React, { useEffect, useRef, useState } from 'react';
import { downloadPlaylist, removePlaylistDownload } from '../../services/offlinePlaylist';
import { hasLocalAudio, offlineLabel, offlineState } from '../../services/offlinePlaylistPlan';
import { useDownloadQueueStore } from '../../store/downloadQueueStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { Song } from '../../types/song';
import { Button, ConfirmSheet, Haptics, Sheet, SheetOption } from '../../ui';

/** Playlist-only downloads still waiting or running for this playlist. */
const useQueuedFor = (playlistId: string): number =>
  useDownloadQueueStore(s => s.queue.filter(q => q.playlistOnly && q.targetPlaylistId === playlistId
    && q.status !== 'completed' && q.status !== 'failed').length);

export const OfflineControl: React.FC<{ playlistId: string; name: string; songs: readonly Song[]; onChanged: () => void; onNotice: (text: string) => void }> = ({
  playlistId, name, songs, onChanged, onNotice,
}) => {
  const marked = useSettingsStore(s => s.offlinePlaylistIds.includes(playlistId));
  const queued = useQueuedFor(playlistId);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [partialMenu, setPartialMenu] = useState(false);
  const ready = songs.filter(hasLocalAudio).length;
  const state = offlineState(marked, ready, songs.length, queued);

  // Each finished download lands in the playlist: reload it as the queue drains.
  const lastQueued = useRef(queued);
  useEffect(() => {
    if (queued < lastQueued.current) onChanged();
    lastQueued.current = queued;
  }, [queued, onChanged]);

  const download = async () => {
    setBusy(true);
    Haptics.toggle();
    try {
      const run = await downloadPlaylist(playlistId);
      onChanged();
      if (run.queued === 0 && run.missing > 0) onNotice(`Couldn’t find ${run.missing} ${run.missing === 1 ? 'song' : 'songs'} to download. Try again when you’re online.`);
      else if (run.queued === 0) onNotice(`“${name}” plays offline`);
      else onNotice(`Downloading ${run.queued} ${run.queued === 1 ? 'song' : 'songs'} for offline`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setConfirm(false);
    setPartialMenu(false);
    setBusy(true);
    try {
      await removePlaylistDownload(playlistId);
      onChanged();
      onNotice('Download removed. Songs you saved yourself stay.');
    } finally {
      setBusy(false);
    }
  };

  if (songs.length === 0) return null;
  const icon = state.kind === 'ready' ? 'checkmark-circle' : state.kind === 'none' ? 'arrow-down-circle-outline' : 'cloud-download-outline';
  return (
    <>
      <Button label={offlineLabel(state)} icon={icon} size="compact" busy={busy || state.kind === 'downloading'}
        accessibilityLabel={state.kind === 'none' ? `Download ${name} to play offline` : `${offlineLabel(state)}. ${name}`}
        onPress={() => {
          if (state.kind === 'none') download();
          else if (state.kind === 'ready') setConfirm(true);
          else if (state.kind === 'partial') setPartialMenu(true);
        }} />
      <ConfirmSheet visible={confirm} title={`Remove “${name}” from offline?`}
        body="Its songs stream again. Songs you saved yourself stay on this phone."
        confirmLabel="Remove download" destructive onConfirm={remove} onClose={() => setConfirm(false)} />
      <Sheet visible={partialMenu} onClose={() => setPartialMenu(false)} title={offlineLabel(state)}>
        <SheetOption label="Download the rest" icon="cloud-download-outline" onPress={() => { setPartialMenu(false); download(); }} />
        <SheetOption label="Remove download" icon="trash-outline" destructive onPress={remove} />
      </Sheet>
    </>
  );
};
