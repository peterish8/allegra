import { checkedAgo, formatSize, LATEST_APK_URL, NO_NOTES, notesFromBody, parseChangelog, parseRelease, releasedAgo, shouldAutoCheck, standingOf, type LatestBuild } from './appUpdate';

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
    ({ publishedAt: new Date(publishedAt), downloadUrl: LATEST_APK_URL, commit, sizeBytes: null, version: null, changelogUrl: null, notes: NO_NOTES });

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

describe('release size, version and changelog file', () => {
  const release = {
    name: 'LuvLyrics 0.2.0 — latest build',
    published_at: '2026-10-01T16:51:09Z',
    assets: [
      { name: 'LuvLyrics.apk', size: 64_800_000, browser_download_url: 'https://example.com/LuvLyrics.apk' },
      { name: 'changelog.json', size: 400, browser_download_url: 'https://example.com/changelog.json' },
    ],
  };

  it('reads the APK size, the version from the title and the changelog file', () => {
    const build = parseRelease(release);
    expect(build?.sizeBytes).toBe(64_800_000);
    expect(build?.version).toBe('0.2.0');
    expect(build?.changelogUrl).toBe('https://example.com/changelog.json');
  });

  it('copes with a release that has none of them', () => {
    const build = parseRelease({ published_at: '2026-10-01T16:51:09Z', name: 'LuvLyrics — latest build' });
    expect(build).toMatchObject({ sizeBytes: null, version: null, changelogUrl: null });
    expect(build?.notes).toEqual(NO_NOTES);
  });
});

describe('formatSize', () => {
  it('speaks in megabytes the way a download list does', () => {
    expect(formatSize(64_800_000)).toBe('61.8 MB');
    expect(formatSize(150 * 1024 * 1024)).toBe('150 MB');
    expect(formatSize(300 * 1024)).toBe('300 KB');
  });
});

describe('parseChangelog', () => {
  it('reads the sections and the description', () => {
    expect(parseChangelog({
      description: ' A big one. ',
      changelog: [{ title: 'New', items: ['Queue editing', ' Goodbye '] }, { title: 'Fixed', items: ['Seek'] }],
    })).toEqual({
      description: 'A big one.',
      sections: [{ title: 'New', items: ['Queue editing', 'Goodbye'] }, { title: 'Fixed', items: ['Seek'] }],
    });
  });

  it('skips what is not a section and refuses what is not a changelog', () => {
    expect(parseChangelog({ changelog: [{ title: 'New', items: [] }, { title: 3, items: ['x'] }, null, { title: 'Fixed', items: ['Seek', 4, ''] }] }))
      .toEqual({ description: null, sections: [{ title: 'Fixed', items: ['Seek'] }] });
    expect(parseChangelog(null)).toBeNull();
    expect(parseChangelog({ description: 'x' })).toBeNull();
    expect(parseChangelog('nope')).toBeNull();
  });
});

describe('notesFromBody', () => {
  it('turns a release text into sections, leaving out its title and footer', () => {
    const body = [
      '# LuvLyrics 0.2.0', '', '## New', '- Queue editing', '- Goodbye', '', '## Fixed', '* Seek', '',
      'Built from `main` at 417a62c. Download LuvLyrics.apk below.', 'Direct link: https://example.com/LuvLyrics.apk',
    ].join('\r\n');
    expect(notesFromBody(body)).toEqual({
      description: null,
      sections: [{ title: 'New', items: ['Queue editing', 'Goodbye'] }, { title: 'Fixed', items: ['Seek'] }],
    });
  });

  it('keeps plain text before the first heading as the description', () => {
    expect(notesFromBody('Small improvements and fixes.\n\n## Fixed\n- Seek').description).toBe('Small improvements and fixes.');
    expect(notesFromBody('')).toEqual(NO_NOTES);
    expect(notesFromBody(undefined)).toEqual(NO_NOTES);
  });
});

describe('shouldAutoCheck', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  it('looks when it never has, or when the last look was long ago', () => {
    expect(shouldAutoCheck(null, now)).toBe(true);
    expect(shouldAutoCheck('2026-10-02T05:00:00Z', now)).toBe(true);
    expect(shouldAutoCheck('garbage', now)).toBe(true);
  });
  it('leaves it alone when it looked recently', () => {
    expect(shouldAutoCheck('2026-10-02T09:00:00Z', now)).toBe(false);
  });
});

describe('checkedAgo', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  it('is exact for the last hour and plain after it', () => {
    expect(checkedAgo(new Date('2026-10-02T11:59:40Z'), now)).toBe('just now');
    expect(checkedAgo(new Date('2026-10-02T11:48:00Z'), now)).toBe('12 min ago');
    expect(checkedAgo(new Date('2026-10-02T08:00:00Z'), now)).toBe('today');
    expect(checkedAgo(new Date('2026-10-01T08:00:00Z'), now)).toBe('yesterday');
  });
});
