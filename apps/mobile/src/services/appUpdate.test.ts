import { LATEST_APK_URL, parseRelease, releasedAgo, standingOf, type LatestBuild } from './appUpdate';

describe('parseRelease', () => {
  it('reads the date and the APK from a release', () => {
    const build = parseRelease({
      published_at: '2026-09-27T18:49:06Z',
      assets: [
        { name: 'notes.txt', browser_download_url: 'https://example.com/notes.txt' },
        { name: 'LuvLyrics.apk', browser_download_url: 'https://example.com/LuvLyrics.apk' },
      ],
    });
    expect(build?.publishedAt.toISOString()).toBe('2026-09-27T18:49:06.000Z');
    expect(build?.downloadUrl).toBe('https://example.com/LuvLyrics.apk');
  });

  it('falls back to the stable download link when the release lists no APK', () => {
    expect(parseRelease({ published_at: '2026-09-27T18:49:06Z', assets: [] })?.downloadUrl).toBe(LATEST_APK_URL);
  });

  it('has nothing to offer without a usable date', () => {
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease({})).toBeNull();
    expect(parseRelease({ published_at: 'not a date' })).toBeNull();
  });
});

describe('releasedAgo', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  it('says today, yesterday and a few days ago in words', () => {
    expect(releasedAgo(new Date('2026-09-29T08:00:00Z'), now)).toBe('today');
    expect(releasedAgo(new Date('2026-09-28T08:00:00Z'), now)).toBe('yesterday');
    expect(releasedAgo(new Date('2026-09-25T08:00:00Z'), now)).toBe('4 days ago');
  });
});

describe('release commit', () => {
  it('reads the commit the release was built from', () => {
    const sha = 'A8577AFE8904ACD4CDF191765C208C8EA7DEA455';
    expect(parseRelease({ published_at: '2026-09-30T08:02:11Z', target_commitish: sha })?.commit).toBe(sha.toLowerCase());
  });

  it('ignores a branch name in place of a commit', () => {
    expect(parseRelease({ published_at: '2026-09-30T08:02:11Z', target_commitish: 'main' })?.commit).toBeNull();
  });
});

describe('standingOf', () => {
  const sha = 'a8577afe8904acd4cdf191765c208c8ea7dea455';
  const release = (publishedAt: string, commit: string | null = null): LatestBuild =>
    ({ publishedAt: new Date(publishedAt), downloadUrl: LATEST_APK_URL, commit });

  it('knows the release is the build already installed', () => {
    expect(standingOf(release('2026-10-01T12:05:00Z', sha), { commit: sha, builtAt: new Date('2026-10-01T12:00:00Z') })).toBe('current');
  });

  it('never offers a main release from before a newer feature-branch build', () => {
    // The phone runs a feature build from today; apk-latest is yesterday's main build.
    expect(standingOf(release('2026-09-30T08:02:11Z', 'b'.repeat(40)), { commit: sha, builtAt: new Date('2026-10-01T10:56:37Z') })).toBe('older');
  });

  it('offers a main release published after this build', () => {
    expect(standingOf(release('2026-10-02T09:00:00Z', 'c'.repeat(40)), { commit: sha, builtAt: new Date('2026-10-01T10:56:37Z') })).toBe('update');
  });

  it('offers the release when nothing is known about this build', () => {
    expect(standingOf(release('2026-09-30T08:02:11Z'), { commit: null, builtAt: null })).toBe('update');
  });
});
