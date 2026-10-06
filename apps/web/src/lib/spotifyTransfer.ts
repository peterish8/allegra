/**
 * The website's one Spotify transfer job. It lives here, not in the panel, so moving to another page
 * never cancels a run: the panel and the shell's import chip only show it.
 */
import { useSyncExternalStore } from 'react';

import { createSpotifyTransfer, type TransferDeps, type TransferState } from '@shared/spotifyTransfer';

import { ApiError, syncSpotifyPlaylist } from './api';
import { announceLibraryArrival } from './libraryArrival';

export const spotifyTransfer = createSpotifyTransfer();

export const useSpotifyTransfer = (): TransferState =>
  useSyncExternalStore(spotifyTransfer.subscribe, spotifyTransfer.getState, spotifyTransfer.getState);

export const spotifyTransferDeps = (errorText: (error: unknown) => string): TransferDeps => ({
  sync: (id, signal) => syncSpotifyPlaylist(id, signal),
  errorText,
  stopsRun: (error) => (error instanceof ApiError && (error.status === 401 || error.status === 429) ? { reconnect: error.status === 401 } : null),
  onLanded: () => announceLibraryArrival(),
});
