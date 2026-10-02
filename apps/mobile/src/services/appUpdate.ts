/**
 * "Update app" in the About sheet. New builds are published by CI to the
 * `apk-latest` release of the public Allegra repo (root .github/workflows/mobile-apk.yml);
 * this reads that release and hands back where to download it and what changed.
 *
 * Like Echo Music's updater, the release carries everything the update screen shows: its date and
 * the APK's size come from GitHub, the version from the release title, and what changed from a
 * `changelog.json` asset CI builds from the commit subjects (scripts/mobile-release-notes.mjs).
 * A release without that file falls back to its own text.
 */
const RELEASE_API = 'https://api.github.com/repos/peterish8/allegra/releases/tags/apk-latest';
/** Canonical release channel in the owner fork. */
export const RELEASES_URL = 'https://github.com/peterish8/allegra/releases/tag/apk-latest';
/** Every release, newest first. */
export const ALL_RELEASES_URL = 'https://github.com/peterish8/allegra/releases';
export const LATEST_APK_URL = 'https://github.com/peterish8/allegra/releases/download/apk-latest/LuvLyrics.apk';

export interface ChangelogSection {
  readonly title: string;
  readonly items: readonly string[];
}

/** What changed in a build, as the update screen shows it. */
export interface ReleaseNotes {
  /** A sentence or two above the lists; null when there is none. */
  readonly description: string | null;
  readonly sections: readonly ChangelogSection[];
}

export const NO_NOTES: ReleaseNotes = { description: null, sections: [] };

export interface LatestBuild {
  publishedAt: Date;
  downloadUrl: string;
  /** The commit CI built it from (the release targets it). Null on older releases. */
  commit: string | null;
  /** The APK's size in bytes. Null when GitHub lists no APK. */
  sizeBytes: number | null;
  /** The app version CI stamped in the release title ("LuvLyrics 0.2.0 — latest build"). */
  version: string | null;
  /** Where the release's own `changelog.json` lives, when it has one. */
  changelogUrl: string | null;
  notes: ReleaseNotes;
}

/** The APK on this phone. CI stamps both (mobile-apk.yml); a local build has neither. */
export interface InstalledBuild {
  readonly commit: string | null;
  readonly builtAt: Date | null;
}

const asDate = (value: string | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const INSTALLED_BUILD: InstalledBuild = {
  commit: process.env.EXPO_PUBLIC_BUILD_COMMIT || null,
  builtAt: asDate(process.env.EXPO_PUBLIC_BUILD_TIME),
};

/**
 * Pure: what the latest release is to this phone. Every build is versionCode 1, so Android
 * installs an older build over a newer one without a word; this is the only guard.
 * - `current`: the release is the build already installed.
 * - `older`: it was published before this APK was built (a feature-branch build, say), so it
 *   cannot be newer. CI publishes a main build minutes after building it.
 * - `update`: newer, or nothing is known about this build (a local build).
 */
export const standingOf = (release: LatestBuild, installed: InstalledBuild): 'current' | 'older' | 'update' => {
  if (release.commit && installed.commit && release.commit === installed.commit) return 'current';
  if (installed.builtAt && release.publishedAt.getTime() <= installed.builtAt.getTime()) return 'older';
  return 'update';
};

interface ReleaseJson {
  name?: string;
  body?: string;
  published_at?: string;
  target_commitish?: string;
  assets?: { name?: string; size?: number; browser_download_url?: string }[];
}

const SECTION_HEADING = /^#{2,4}\s+(.+?)\s*$/;
const BULLET = /^\s*[-*•]\s+(.+?)\s*$/;

/**
 * Pure: notes from a release's own text, for a release that has no `changelog.json`. `## Heading`
 * starts a section, `- item` adds to it, and any other line before the first heading is the description.
 * The release's title line (`# LuvLyrics 0.2.0`) and the "Built from …" footer are not notes.
 */
export const notesFromBody = (body: string | null | undefined): ReleaseNotes => {
  if (!body) return NO_NOTES;
  const description: string[] = [];
  const sections: { title: string; items: string[] }[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^#\s/.test(line) || /^built from /i.test(line) || /^direct link:/i.test(line)) continue;
    const heading = line.match(SECTION_HEADING);
    if (heading?.[1]) { sections.push({ title: heading[1], items: [] }); continue; }
    const bullet = line.match(BULLET);
    const current = sections[sections.length - 1];
    if (bullet?.[1] && current) { current.items.push(bullet[1]); continue; }
    if (!current) description.push(line);
  }
  return {
    description: description.length > 0 ? description.join(' ') : null,
    sections: sections.filter(section => section.items.length > 0),
  };
};

/** Pure: notes from a `changelog.json` (the shape scripts/mobile-release-notes.mjs writes); null when it is not one. */
export const parseChangelog = (json: unknown): ReleaseNotes | null => {
  if (!json || typeof json !== 'object') return null;
  const { description, changelog } = json as { description?: unknown; changelog?: unknown };
  if (!Array.isArray(changelog)) return null;
  const sections: ChangelogSection[] = [];
  for (const entry of changelog) {
    if (!entry || typeof entry !== 'object') continue;
    const { title, items } = entry as { title?: unknown; items?: unknown };
    if (typeof title !== 'string' || !Array.isArray(items)) continue;
    const lines = items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim());
    if (lines.length > 0) sections.push({ title: title.trim(), items: lines });
  }
  return { description: typeof description === 'string' && description.trim() ? description.trim() : null, sections };
};

/** Pure: the newest build from GitHub's release JSON, or null if it has none. */
export const parseRelease = (json: ReleaseJson | null | undefined): LatestBuild | null => {
  if (!json?.published_at) return null;
  const publishedAt = new Date(json.published_at);
  if (Number.isNaN(publishedAt.getTime())) return null;
  const apk = json.assets?.find(a => a.name?.toLowerCase().endsWith('.apk') && a.browser_download_url);
  const changelog = json.assets?.find(a => a.name?.toLowerCase() === 'changelog.json' && a.browser_download_url);
  const commit = json.target_commitish && /^[0-9a-f]{40}$/i.test(json.target_commitish) ? json.target_commitish.toLowerCase() : null;
  const version = (json.name ?? '').match(/\b(\d+\.\d+\.\d+)\b/)?.[1] ?? null;
  return {
    publishedAt,
    downloadUrl: apk?.browser_download_url ?? LATEST_APK_URL,
    commit,
    sizeBytes: typeof apk?.size === 'number' && apk.size > 0 ? apk.size : null,
    version,
    changelogUrl: changelog?.browser_download_url ?? null,
    notes: notesFromBody(json.body),
  };
};

/** "61.8 MB". Whole numbers keep no decimal, as in Android's own download list. */
export const formatSize = (bytes: number): string => {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

/** "today", "yesterday", "3 days ago", or the date. */
export const releasedAgo = (when: Date, now: Date = new Date()): string => {
  const days = Math.floor((now.getTime() - when.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/** "just now", "12 min ago", "today", "yesterday" ... for when the app last looked for an update. */
export const checkedAgo = (at: Date, now: Date = new Date()): string => {
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return releasedAgo(at, now);
};

/** How often the app looks for a new build by itself. */
export const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Pure: whether it has been long enough since the last check to look again on its own. */
export const shouldAutoCheck = (lastCheckedAt: string | null, now: Date = new Date(), intervalMs: number = AUTO_CHECK_INTERVAL_MS): boolean => {
  const last = asDate(lastCheckedAt ?? undefined);
  return !last || now.getTime() - last.getTime() >= intervalMs;
};

const fetchJson = async (url: string, accept: string): Promise<unknown> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: accept } });
    return res.ok ? await res.json() : null;
  } catch { return null; }
  finally { clearTimeout(timeout); }
};

export const fetchLatestBuild = async (): Promise<LatestBuild | null> => {
  const build = parseRelease((await fetchJson(RELEASE_API, 'application/vnd.github+json')) as ReleaseJson | null);
  if (!build) return null;
  if (build.changelogUrl) {
    const notes = parseChangelog(await fetchJson(build.changelogUrl, 'application/json'));
    if (notes && (notes.sections.length > 0 || notes.description)) return { ...build, notes };
  }
  return build;
};
