/**
 * Which recording version a title names: live, remix, slowed, acoustic and so on. A lyric match
 * prefers the candidate whose version matches the song playing, so a live version gets live lyrics
 * and the studio song does not get a slowed upload's timing.
 */

export type VersionTag =
  | 'remix' | 'live' | 'acoustic' | 'instrumental' | 'karaoke' | 'cover' | 'slowed' | 'reverb'
  | 'sped-up' | 'lofi' | 'extended' | 'radio-edit' | 'remaster' | 'unplugged' | 'reprise';

const PATTERNS: ReadonlyArray<readonly [VersionTag, RegExp]> = [
  ['remix', /\b(?:remix|rmx|re-?edit|bootleg|flip|club mix|dub mix)\b/i],
  ['live', /\b(?:live|live at|live from|in concert|session)\b/i],
  ['acoustic', /\bacoustic\b/i],
  ['unplugged', /\bunplugged\b/i],
  ['instrumental', /\binstrumental\b/i],
  ['karaoke', /\bkaraoke\b/i],
  ['cover', /\bcover\b/i],
  ['slowed', /\bslowed\b/i],
  ['reverb', /\breverb\b/i],
  ['sped-up', /\b(?:sped[ -]?up|nightcore)\b/i],
  ['lofi', /\blo-?fi\b/i],
  ['extended', /\bextended\b/i],
  ['radio-edit', /\bradio (?:edit|version)\b/i],
  ['remaster', /\bremaster(?:ed)?\b/i],
  ['reprise', /\breprise\b/i]
];

/** An innermost bracket pair: its content holds no bracket characters of its own. */
const INNERMOST_BRACKETS = /[([{（]([^([{（)\]}）]*)[)\]}）]/;

const SEPARATOR = /\s[-–—|]\s/;

export const VERSION_PENALTY = { extra: -60, missing: -30, remaster: -5 } as const;

/** The parts of a title that can carry a version: bracketed groups and text after " - ". */
export function versionSegments(title: string): string[] {
  const groups: string[] = [];
  let rest = title;
  // Peel innermost groups first so an outer group such as "(feat. A (B))" is scanned too.
  while (INNERMOST_BRACKETS.test(rest)) {
    rest = rest.replace(INNERMOST_BRACKETS, (_whole: string, inner: string) => {
      groups.push(inner);
      return ' ';
    });
  }
  const afterSeparator = rest.split(SEPARATOR).slice(1);
  return [...groups, ...afterSeparator].map((segment) => segment.trim()).filter((segment) => segment.length > 0);
}

export function versionTags(title: string): ReadonlySet<VersionTag> {
  const segments = versionSegments(title);
  const tags = new Set<VersionTag>();
  for (const [tag, pattern] of PATTERNS) {
    if (segments.some((segment) => pattern.test(segment))) tags.add(tag);
  }
  return tags;
}

/** Zero when both titles name the same versions; negative when the candidate's version differs. */
export function versionPenalty(requestedTitle: string, candidateTitle: string): number {
  const requested = versionTags(requestedTitle);
  const candidate = versionTags(candidateTitle);
  let score = 0;
  for (const tag of candidate) {
    if (!requested.has(tag)) score += tag === 'remaster' ? VERSION_PENALTY.remaster : VERSION_PENALTY.extra;
  }
  for (const tag of requested) {
    if (!candidate.has(tag)) score += tag === 'remaster' ? VERSION_PENALTY.remaster : VERSION_PENALTY.missing;
  }
  return score;
}
