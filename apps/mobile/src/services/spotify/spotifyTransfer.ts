/**
 * The phone's one Spotify transfer job. It lives here, not in the Import screen, so going back or
 * switching tabs never cancels a run: the panel and the Stream tray only show it.
 */
import { useSyncExternalStore } from 'react';

import { createSpotifyTransfer, type TransferDeps, type TransferState } from '@shared/spotifyTransfer';
import { useOnlineLibraryStore } from '../../store/onlineLibraryStore';
import { SpotifyApiError, syncSpotifyPlaylist } from './spotifyApi';

export const spotifyTransfer = createSpotifyTransfer();

export const useSpotifyTransfer = (): TransferState =>
  useSyncExternalStore(spotifyTransfer.subscribe, spotifyTransfer.getState, spotifyTransfer.getState);

export const spotifyTransferDeps = (token: string, errorText: (error: unknown) => string): TransferDeps => ({
  sync: (id, signal) => syncSpotifyPlaylist(token, id, signal),
  errorText,
  stopsRun: (error) => (error instanceof SpotifyApiError && (error.status === 401 || error.status === 429) ? { reconnect: error.status === 401 } : null),
  onLanded: () => { useOnlineLibraryStore.getState().load().catch(() => undefined); },
});
