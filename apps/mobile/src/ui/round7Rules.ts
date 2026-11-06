/**
 * Round 7's small rules in plain TypeScript, so tests can hold them without loading native views. The components
 * (`SongRow`, `Chip`, `Button`, `SheetIdentity`) import them from here.
 */

/** A song row's second line: the artist and the caller's note. Never the title again; never an empty part. */
export const songRowSubtitle = (artist?: string, meta?: string, playing?: boolean): string =>
  [artist, meta, playing ? 'Playing' : undefined].filter(Boolean).join(' · ');

/** What a chip shows before its label: the caller's icon, or a check once it is chosen (not colour alone). */
export const chipLeadingIcon = <T extends string>(selected: boolean, icon?: T): T | 'checkmark' | undefined =>
  icon ?? (selected ? 'checkmark' : undefined);

/** A compact capsule's drawn height (Shuffle beside Play); its target stays 48. */
export const COMPACT_HEIGHT = 40;

/** "Song · Mira Vale · 3:33": the kind first, then whatever the caller knows, never an empty part. */
export const identityMeta = (kind: string, ...parts: (string | undefined | null | false)[]): string =>
  [kind, ...parts].filter((part): part is string => typeof part === 'string' && part.trim().length > 0).join(' · ');
