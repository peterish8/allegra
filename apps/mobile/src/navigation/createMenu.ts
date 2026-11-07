/**
 * The Create (+) tab's sheet (1.42.0, owner: Spotify's positions, "in plus btn keep luvs").
 *
 * Spotify's Create sheet lists Playlist, Collaborative playlist, Blend and Jam. Ours puts Luvs first (it left the
 * tab bar for this sheet), then Playlist, Blend and LuvLink, our Jam. Pure data, so the order is tested.
 */
import type { IconName } from '../ui';

export type CreateAction = 'luvs' | 'playlist' | 'blend' | 'luvlink';

export interface CreateItem {
  id: CreateAction;
  title: string;
  subtitle: string;
  icon: IconName;
}

export const CREATE_ITEMS: readonly CreateItem[] = [
  { id: 'luvs', title: 'Luvs', subtitle: 'Swipe through songs picked for your taste', icon: 'heart-outline' },
  { id: 'playlist', title: 'Playlist', subtitle: 'Make a playlist of your songs', icon: 'musical-notes-outline' },
  { id: 'blend', title: 'Blend', subtitle: "Mix your taste with a friend's", icon: 'git-merge-outline' },
  { id: 'luvlink', title: 'LuvLink', subtitle: 'Listen together in sync', icon: 'people-outline' },
];

/** The four tabs, in Spotify's order. "Create" opens the sheet above; it is never a page. */
export const NAV_TABS = ['Stream', 'Search', 'Library', 'Create'] as const;
export type NavTab = typeof NAV_TABS[number];
export const CREATE_TAB: NavTab = 'Create';

/**
 * Which tab is lit for a route. Pages that are not tabs keep the tab they were opened from (Luvs from Create, an
 * artist from Search); Settings and the DJ come from the profile menu, so they keep it too.
 */
export const litTab = (route: string, previous: NavTab): NavTab =>
  route === 'Stream' || route === 'Search' || route === 'Library' ? route : previous === CREATE_TAB ? 'Stream' : previous;
