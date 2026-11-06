/** The values Settings → Navigation and shortcuts shows beside its rows (1.41.0). */

/** "Off", or the playlist's name; a playlist that is gone reads as Off. */
export const holdSummary = (id: string | null, names: ReadonlyMap<string, string>): string =>
  (id && names.get(id)) || 'Off';

/** "Sleep, Focus" or "None yet": the pinned playlists that still exist, in pinned order. */
export const pinnedSummary = (ids: readonly string[], names: ReadonlyMap<string, string>): string => {
  const shown = ids.flatMap(id => (names.has(id) ? [names.get(id) as string] : []));
  return shown.length ? shown.join(', ') : 'None yet';
};
