/**
 * Stream shows its own shelves first and YouTube Music's home shelves under them. YouTube Music names one of
 * them "Quick picks" too, which put two "Quick picks" on one page (owner, 2026-11-13: "both same name so
 * confusing"). A catalog shelf whose title repeats one of ours gets a distinct one.
 */
const RENAMED: Readonly<Record<string, string>> = {
  'quick picks': 'More picks for you',
};

const key = (title: string): string => title.trim().toLowerCase();

/** The title to show for a YouTube Music shelf, given the titles Stream's own shelves already use. */
export function catalogShelfTitle(title: string, ours: Iterable<string>): string {
  const taken = new Set([...ours].map(key));
  if (!taken.has(key(title))) return title;
  return RENAMED[key(title)] ?? `More ${title.trim().charAt(0).toLowerCase()}${title.trim().slice(1)}`;
}
