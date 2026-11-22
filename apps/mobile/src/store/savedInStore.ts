/**
 * Which song the "Saved in" sheet is open for (`components/SavedInSheet`, mounted once in RootNavigator).
 * Any surface opens it with `openSavedIn(song)`: the mini player's ⊕ / ✓, the song menu, the player's menu.
 */
import { create } from 'zustand';

import type { Song } from '../types/song';

interface SavedInState {
  song: Song | null;
  /** Each opening gets a fresh sheet, even for the same song. */
  openedAt: number;
  /** Settles once a like started before opening has landed, so the sheet reads the saved state after it. */
  ready: Promise<unknown>;
  open: (song: Song, ready?: Promise<unknown>) => void;
  close: () => void;
}

export const useSavedInStore = create<SavedInState>(set => ({
  song: null,
  openedAt: 0,
  ready: Promise.resolve(),
  open: (song, ready) => set({ song, openedAt: Date.now(), ready: ready ?? Promise.resolve() }),
  close: () => set({ song: null }),
}));

export const openSavedIn = (song: Song, ready?: Promise<unknown>): void => useSavedInStore.getState().open(song, ready);
