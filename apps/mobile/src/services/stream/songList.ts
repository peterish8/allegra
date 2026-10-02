/**
 * A pasted list of songs, as Stream's "Add a list" reads it.
 *
 * People paste what they have: a playlist copied from a chat, a note, a numbered top-ten.
 *
 *   Tum Hi Ho - Arijit Singh        title, then artist
 *   1. Kesariya by Arijit Singh     numbering is dropped; "by" splits as well as a dash
 *   Channa Mereya                   a title alone is fine: the search finds the song
 *   [{"title": "...", "artist": "..."}]   the old JSON form still works
 *
 * Pure, so the rules are tested without a screen.
 */
export interface ListEntry {
  readonly title: string;
  readonly artist: string;
}

/** More than this is a mistake (a whole document pasted), and each line is a search. */
export const LIST_LIMIT = 60;

const LEADING = /^\s*(?:\d{1,3}\s*[.)\]:-]\s*|[-*•·]\s+)/;
const SPLITTERS = [/\s+[-–—]\s+/, /\s+by\s+/i, /\s*\|\s*/];

function fromLine(raw: string): ListEntry | null {
  const line = raw.replace(LEADING, '').replace(/\s+/g, ' ').trim();
  if (line.length < 2) return null;
  for (const splitter of SPLITTERS) {
    const parts = line.split(splitter).map(part => part.trim()).filter(Boolean);
    if (parts.length >= 2) return { title: parts[0] as string, artist: parts.slice(1).join(' ') };
  }
  return { title: line, artist: '' };
}

function fromJson(text: string): ListEntry[] | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('[')) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return null;
    const entries: ListEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const { title, artist } = item as { title?: unknown; artist?: unknown };
      if (typeof title === 'string' && title.trim()) entries.push({ title: title.trim(), artist: typeof artist === 'string' ? artist.trim() : '' });
    }
    return entries;
  } catch {
    return null;
  }
}

/** The songs in `text`, in order, without repeats, at most LIST_LIMIT. */
export function parseSongList(text: string): ListEntry[] {
  const entries = fromJson(text) ?? text.split(/\r?\n/).map(fromLine).filter((entry): entry is ListEntry => entry !== null);
  const seen = new Set<string>();
  const unique: ListEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.title}|${entry.artist}`.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
    if (unique.length >= LIST_LIMIT) break;
  }
  return unique;
}

/** What to search for an entry: both parts when there are two, the title alone otherwise. */
export const queryFor = (entry: ListEntry): string => `${entry.title} ${entry.artist}`.trim();
