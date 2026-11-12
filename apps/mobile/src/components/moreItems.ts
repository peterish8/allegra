/**
 * What the ••• "More" menu lists. Plain data (no React), so the native payload builder and its test can read the real
 * menu without importing the menu's components. `MoreMenu` re-exports everything here.
 */
import type React from 'react';
import type { Ionicons } from '@expo/vector-icons';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
export type MoreIconName = IconName;

export interface MoreItem {
  key: string;
  label: string;
  icon: MoreIconName;
  /** Rows carry a one-line hint; tiles don't. */
  hint?: string;
}

/** The places people jump to most — big tiles across the top. */
export const MORE_TILES: readonly MoreItem[] = [
  { key: 'Search', label: 'Search', icon: 'search' },
  { key: 'Playlists', label: 'Playlists', icon: 'albums-outline' },
  { key: 'Settings', label: 'Settings', icon: 'settings-outline' },
];

/** Less frequent destinations, listed below the tiles. Empty while Your DJ is archived. */
export const MORE_ROWS: readonly MoreItem[] = [];

/** Everything behind •••, in the order people reach for it. */
export const MORE_ITEMS: readonly MoreItem[] = [...MORE_TILES, ...MORE_ROWS];
