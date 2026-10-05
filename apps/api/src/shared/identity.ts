// GENERATED from packages/shared/identity.ts by `npm run sync:shared`. Do not edit here.
/**
 * When two catalog rows are the same song, and who is credited on it. Blend, Import, the taste
 * tally, catalog dedupe and the player's queue all ask these two questions; one answer keeps them
 * from disagreeing.
 */

/** Recording title and credited artist names. Preserve version evidence and words within names. */
export function identityKey(title: string, artist: string): string {
  // Film/marketing labels are not recording versions; live/remix/acoustic labels are.
  const normalTitle = flatten(title.replace(/[([]\s*(?:from\s+|official\s+(?:video|audio)|lyrics?\b)[^)\]]*[)\]]/giu, ' '));
  const artists = creditedArtists(artist).map(flatten).sort().join(',');
  return `${normalTitle}|${artists}`;
}

/** "A, B & C feat. D" → ["A", "B", "C", "D"]. */
export function creditedArtists(artist: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of artist.split(/,|&| feat\.? | ft\.? | x /i)) {
    const name = part.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** Lower-cased, trimmed artist key, as Blend's artist maps use. */
export function artistKey(name: string): string {
  return name.trim().toLowerCase();
}

function flatten(value: string): string {
  // Combining marks belong to the preceding letter (for example, many Indic vowel signs).
  // Keep them with the letter instead of turning them into identity separators.
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}
