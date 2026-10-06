/**
 * The import crate: a small stack of the sources picked for transfer. Pure helpers shared by the
 * Spotify panel and the file import, so the stack order and the ticker copy are testable.
 */

/** How many sleeves the crate fans out; the rest are carried by the count badge. */
export const CRATE_FAN = 3;

/** The sleeves to draw, bottom to top: the last `fan` of `ids`. */
export function crateStack(ids: readonly string[], fan: number = CRATE_FAN): readonly string[] {
  return fan <= 0 ? [] : ids.slice(-fan);
}

/**
 * What the crate holds. While picking: the ticked sources in the order they were ticked, newest on
 * top. While transferring: the sources still to finish, the one running now on top. A finished
 * source has been dealt out; a failed one stays in the crate for the retry.
 */
export function crateIds(selected: Iterable<string>, queue: readonly string[], finished: ReadonlySet<string>, transferring: boolean): readonly string[] {
  if (transferring) return queue.filter((id) => !finished.has(id)).reverse();
  return [...selected].filter((id) => !finished.has(id));
}

interface StepCounts {
  readonly added: number;
  readonly skipped: number;
  readonly reviewNeeded: number;
}

/** The Spotify ticker line: the source being matched and its real counts (the step carries no titles). */
export function spotifyTickerText(name: string, step: StepCounts | null): string {
  if (!step) return `${name} · starting`;
  const parts = [`${step.added} added`];
  if (step.skipped > 0) parts.push(`${step.skipped} skipped`);
  if (step.reviewNeeded > 0) parts.push(`${step.reviewNeeded} not exact`);
  return `${name} · ${parts.join(' · ')}`;
}

interface FoundTrack {
  readonly track: { readonly title: string; readonly artist: string };
  readonly song: unknown;
}

/** The file import ticker line: the most recent track that found a match, or null before the first. */
export function latestFoundText(results: Iterable<FoundTrack>): string | null {
  let latest: FoundTrack | null = null;
  for (const match of results) if (match.song) latest = match;
  return latest ? `Found · ${latest.track.title} — ${latest.track.artist}` : null;
}
