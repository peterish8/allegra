/**
 * "Update app" in the About sheet. New builds are published by CI to the
 * `apk-latest` release of the public Allegra repo (root .github/workflows/mobile-apk.yml);
 * this reads that release and hands back where to download it.
 */
const RELEASE_API = 'https://api.github.com/repos/peterish8/allegra/releases/tags/apk-latest';
/** Canonical release channel in the owner fork. */
export const RELEASES_URL = 'https://github.com/peterish8/allegra/releases/tag/apk-latest';
export const LATEST_APK_URL = 'https://github.com/peterish8/allegra/releases/download/apk-latest/LuvLyrics.apk';

export interface LatestBuild {
  publishedAt: Date;
  downloadUrl: string;
  /** The commit CI built it from (the release targets it). Null on older releases. */
  commit: string | null;
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
  published_at?: string;
  target_commitish?: string;
  assets?: { name?: string; browser_download_url?: string }[];
}

/** Pure: the newest build from GitHub's release JSON, or null if it has none. */
export const parseRelease = (json: ReleaseJson | null | undefined): LatestBuild | null => {
  if (!json?.published_at) return null;
  const publishedAt = new Date(json.published_at);
  if (Number.isNaN(publishedAt.getTime())) return null;
  const apk = json.assets?.find(a => a.name?.toLowerCase().endsWith('.apk') && a.browser_download_url);
  const commit = json.target_commitish && /^[0-9a-f]{40}$/i.test(json.target_commitish) ? json.target_commitish.toLowerCase() : null;
  return { publishedAt, downloadUrl: apk?.browser_download_url ?? LATEST_APK_URL, commit };
};

/** "today", "yesterday", "3 days ago", or the date. */
export const releasedAgo = (when: Date, now: Date = new Date()): string => {
  const days = Math.floor((now.getTime() - when.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

export const fetchLatestBuild = async (): Promise<LatestBuild | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(RELEASE_API, { signal: controller.signal, headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    return parseRelease((await res.json()) as ReleaseJson);
  } catch { return null; }
  finally { clearTimeout(timeout); }
};
