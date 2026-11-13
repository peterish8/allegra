import { test as plain, type Page } from '@playwright/test';

import { audioState, collectPageErrors, expect, expectPlaying, startPlayback, test } from './helpers';

const bar = '[aria-label="Player bar"]';

plain('an opened album separates hover, playback, likes, and playlist membership', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page);
  const artwork = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><rect width="600" height="600" fill="#73436d"/><circle cx="300" cy="300" r="160" fill="#d8a46d"/></svg>')}`;
  const sampleRate = 8_000;
  const pcm = Buffer.alloc(sampleRate * 8, 128);
  const wave = Buffer.alloc(44 + pcm.length);
  wave.write('RIFF', 0);
  wave.writeUInt32LE(36 + pcm.length, 4);
  wave.write('WAVE', 8);
  wave.write('fmt ', 12);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(sampleRate, 24);
  wave.writeUInt32LE(sampleRate, 28);
  wave.writeUInt16LE(1, 32);
  wave.writeUInt16LE(8, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(pcm.length, 40);
  const audioUrl = '/api/stream/album-fixture';
  const song = (id: string, title: string) => ({
    id,
    title,
    artist: 'Mira Vale',
    album: 'Quiet Satellites',
    albumId: 'album-fixture',
    artwork,
    streamUrl: audioUrl,
    duration: 184,
    hasLyrics: false,
    playCount: 42,
    source: 'Saavn' as const,
    language: 'English'
  });
  const tracks = [song('album-track-1', 'North Window'), song('album-track-2', 'Paper Satellites'), song('album-track-3', 'Low Tide')];
  const album = {
    id: 'album-fixture',
    name: 'Quiet Satellites',
    artist: 'Mira Vale',
    artwork,
    year: '2024',
    language: 'English',
    songCount: tracks.length,
    songs: tracks
  };
  const playlist = { id: 'fixture-night-set', name: 'Night set', isPublic: false, songIds: [], createdAt: new Date(0).toISOString() };
  const ok = (data: unknown) => ({ success: true, data });

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/search/suggest') return route.fulfill({ json: ok({ results: tracks }) });
    if (path === '/api/search') return route.fulfill({ json: ok({ results: tracks, source: 'Saavn' }) });
    if (path === '/api/search/albums') return route.fulfill({ json: ok({ results: [] }) });
    if (path === '/api/albums/album-fixture') return route.fulfill({ json: ok(album) });
    if (path === '/api/stream/album-fixture') return route.fulfill({ status: 200, contentType: 'audio/wav', body: wave });
    if (path === '/api/libraries' && route.request().method() === 'GET') return route.fulfill({ json: ok([playlist]) });
    if (path === '/api/libraries' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { name: string };
      return route.fulfill({ json: ok({ ...playlist, id: 'fixture-album-copy', name: body.name }) });
    }
    if (path === '/api/me/library/changes') return route.fulfill({ json: ok({ rev: 0, changes: [], more: false }) });
    if (path === '/api/me/library/ops') {
      const body = route.request().postDataJSON() as { ops?: readonly unknown[] };
      return route.fulfill({ json: ok({ rev: 1, rejected: [], superseded: [], applied: body.ops?.length ?? 1 }) });
    }
    if (path === '/api/me/liked' && route.request().method() === 'GET') return route.fulfill({ json: ok([]) });
    if (path === '/api/me/liked') return route.fulfill({ json: ok({ liked: true }) });
    if (path === '/api/me/recently-played' && route.request().method() === 'GET') return route.fulfill({ json: ok([]) });
    if (path === '/api/me/recently-played') return route.fulfill({ json: ok(null) });
    return route.continue();
  });

  await page.goto('/');
  const notNow = page.getByRole('button', { name: /^(Not now|Skip for now)$/ });
  if (await notNow.count()) await notNow.first().click();
  await page.getByRole('button', { name: 'Search music' }).first().click();
  await page.getByRole('combobox').fill('Fixture');
  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('option').first().click();
  await page.getByRole('button', { name: 'Open album Quiet Satellites' }).click();
  await expect(page.locator('.album-page')).toBeVisible();
  await expect(page.locator('.album-track')).toHaveCount(3);
  await expect(page.locator('.album-tracklist__head')).toBeVisible();
  await expect(page.locator('.album-hero__meta')).toContainText('2024');
  await expect(page.locator('.album-hero__meta')).toContainText('3 Songs');
  await expect(page.locator('.album-tracklist__head')).toContainText('Plays');

  const firstRow = page.locator('.album-track').nth(0);
  const firstMain = firstRow.locator('.album-track__main');
  const firstPlaylist = firstRow.locator('.album-track__playlist-trigger');

  await page.getByRole('button', { name: 'Like album' }).click();
  await expect(page.getByRole('button', { name: 'Remove album from likes' })).toBeVisible();
  await expect(firstRow.getByRole('button', { name: 'Remove North Window from likes' })).toHaveAttribute('aria-pressed', 'true');
  await expect(firstPlaylist).toHaveAttribute('aria-pressed', 'false');

  await firstRow.getByRole('button', { name: 'Remove North Window from likes' }).click();
  await expect(firstRow.getByRole('button', { name: 'Add North Window to likes' })).toHaveAttribute('aria-pressed', 'false');
  await expect(firstPlaylist).toHaveAttribute('aria-pressed', 'false');

  await firstPlaylist.focus();
  await page.keyboard.press('Enter');
  const playlistSheet = page.getByRole('dialog');
  await expect(playlistSheet).toBeVisible();
  const nightSet = playlistSheet.getByRole('checkbox', { name: /Night set/ });
  await nightSet.click();
  await expect(nightSet).toHaveAttribute('aria-checked', 'true');
  await expect(firstPlaylist).toHaveAttribute('aria-pressed', 'true');
  await expect(firstPlaylist).toHaveAttribute('aria-label', 'Saved in Night set. Manage playlists for North Window');
  await playlistSheet.getByRole('button', { name: 'Close' }).click();
  await expect(playlistSheet).toBeHidden();

  await firstPlaylist.click();
  const removeFromPlaylist = page.getByRole('dialog').getByRole('checkbox', { name: /Night set/ });
  await expect(removeFromPlaylist).toHaveAttribute('aria-checked', 'true');
  await removeFromPlaylist.click();
  await expect(removeFromPlaylist).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(firstPlaylist).toHaveAttribute('aria-pressed', 'false');
  await expect(firstRow.getByRole('button', { name: 'Add North Window to likes' })).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('button', { name: 'Save as playlist' }).click();
  const saveAlbumSheet = page.getByRole('dialog', { name: 'Save as playlist' });
  const playlistName = saveAlbumSheet.getByRole('textbox', { name: 'Playlist name' });
  await expect(playlistName).toHaveValue('Quiet Satellites');
  await playlistName.fill('Night drive album copy');
  await saveAlbumSheet.getByRole('button', { name: 'Save playlist' }).click();
  await expect(page.getByRole('status')).toContainText('Saved 3 songs');
  await expect(page.locator('.album-track').nth(2).locator('.album-track__playlist-trigger')).toHaveAttribute('aria-label', 'Saved in Night drive album copy. Manage playlists for Low Tide');

  const secondRow = page.locator('.album-track').nth(1);
  const secondMain = secondRow.locator('.album-track__main');
  await secondMain.focus();
  await expect(secondRow.locator('.album-track__index-hover')).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await expect(secondRow).toHaveClass(/is-current/);
  await expect(secondRow).toHaveAttribute('data-playing', 'true');
  await expect(secondMain).toHaveAttribute('aria-current', 'true');
  await expect(secondMain).toHaveAttribute('aria-pressed', 'true');
  await expect(secondMain).toHaveAccessibleName('Pause Paper Satellites');

  await firstRow.hover();
  await expect(firstRow.locator('.album-track__index-hover')).toHaveCSS('opacity', '1');
  await expect(firstRow.locator('.album-track__index-number')).toHaveCSS('opacity', '0');
  await expect(firstMain).not.toHaveAttribute('aria-current', 'true');
  await expect(firstRow).not.toHaveAttribute('data-playing');
  await expect(secondRow).toHaveClass(/is-current/);
  await expect(secondRow).toHaveAttribute('data-playing', 'true');

  await page.getByRole('button', { name: 'Play Quiet Satellites' }).click();
  await expect(page.locator('.album-track[data-playing="true"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Shuffle Quiet Satellites' }).click();
  await expect(page.locator('.album-track[data-playing="true"]')).toHaveCount(1);

  await secondMain.focus();
  await page.keyboard.press('Enter');
  await expect(secondRow).toHaveAttribute('data-playing', 'true');
  await firstRow.hover();
  await expect(firstRow.locator('.album-track__index-hover')).toHaveCSS('opacity', '1');
  await expect(secondRow).toHaveAttribute('data-playing', 'true');

  const viewports = [
    { width: 360, height: 800, name: '360' },
    { width: 768, height: 900, name: '768' },
    { width: 1280, height: 860, name: '1280' },
    { width: 1920, height: 1080, name: '1920' }
  ] as const;
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.locator('.album-hero').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`album-after-${viewport.name}.png`) });
    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasHorizontalOverflow, `album has horizontal overflow at ${viewport.width}px`).toBe(false);
    if (viewport.width <= 640) await expect(page.locator('.album-toolbar__save > svg')).toBeVisible();
    const savePlaylist = await page.getByRole('button', { name: 'Save as playlist' }).boundingBox();
    const playerBar = await page.locator(bar).boundingBox();
    if (viewport.width <= 768 && savePlaylist && playerBar) {
      expect(savePlaylist.y + savePlaylist.height, `album save action clears the player at ${viewport.width}px`).toBeLessThanOrEqual(playerBar.y);
    }

    await page.evaluate(() => {
      const scrollingElement = document.scrollingElement;
      if (scrollingElement) window.scrollTo({ top: scrollingElement.scrollHeight, behavior: 'instant' });
    });
    const clearance = await page.evaluate(() => {
      const lastTrack = document.querySelector('.album-track:last-child')?.getBoundingClientRect();
      const player = document.querySelector('[aria-label="Player bar"]')?.getBoundingClientRect();
      return { trackBottom: lastTrack?.bottom ?? 0, playerTop: player?.top ?? window.innerHeight, playerVisible: Boolean(player && player.top < window.innerHeight) };
    });
    if (clearance.playerVisible) expect(clearance.trackBottom, `last album track clears the player at ${viewport.width}px`).toBeLessThanOrEqual(clearance.playerTop);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  }

  await page.setViewportSize({ width: 1280, height: 860 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedMotionPlay = page.getByRole('button', { name: 'Play Quiet Satellites' });
  await expect(reducedMotionPlay).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('album-after-reduced-motion.png') });
  await reducedMotionPlay.click();
  await expect(page.locator('.album-track[data-playing="true"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

plain('a first visit offers taste onboarding and "Not now" dismisses it', async ({ page }) => {
  await page.goto('/');
  const dialog = page.getByRole('dialog').filter({ has: page.locator('#taste-title') });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Not now' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Search music' }).first()).toBeVisible();
});

// 2026-10-12: genre picks used to stay in the browser; they are now saved with the listener's taste.
plain('onboarding saves the genres the listener picked', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');
  const dialog = page.getByRole('dialog').filter({ has: page.locator('#taste-title') });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  const bollywood = dialog.getByRole('button', { name: 'Bollywood' });
  await bollywood.click();
  await expect(bollywood).toHaveAttribute('aria-pressed', 'true');
  // Bollywood seeds its artists, so the artist step can go on at once.
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  const saved = page.waitForResponse((response) => response.url().endsWith('/api/me/taste/seed') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Build my Home' }).click();
  const body = (await (await saved).json()) as { data?: { genres?: string[] } };
  expect(body.data?.genres).toEqual(['bollywood']);
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

test('a genre sleeve on Browse searches for that sound, and a result opens the playlist sheet above the page', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/discover');
  const sleeve = page.getByRole('button', { name: /^Bollywood: / });
  await expect(sleeve).toBeVisible({ timeout: 30_000 });
  await sleeve.click();
  await expect(sleeve).toBeHidden();

  const add = page.getByRole('button', { name: /(to the queue or a playlist|to a playlist)$/ }).first();
  await expect(add).toBeVisible({ timeout: 20_000 });
  await add.click();
  const sheet = page.getByRole('dialog', { name: /Save to playlist|Add to queue or playlist/ });
  await expect(sheet).toBeVisible();
  // Portalled to the page root, so no list row or scroll container can clip it.
  await expect(page.locator('body > .sheet-backdrop')).toHaveCount(1);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();
  expect(errors).toEqual([]);
});

// 2026-10-17: Browse's top 10 plays here (no outside chart links), and a shelf with more tiles fades at its edge.
test('Browse: a top 10 row plays in Now Playing, and an overflowing shelf fades instead of cutting a tile', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/discover');
  const chart = page.locator('#browse-chart').locator('xpath=ancestor::section[1]');
  const first = chart.getByRole('button', { name: /^Play / }).first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  await expect(chart.locator('a[href^="http"]')).toHaveCount(0);
  const title = ((await first.getAttribute('aria-label')) ?? '').replace(/^Play /, '');
  await first.click();
  await expect(page.locator(bar)).toContainText(title, { timeout: 20_000 });
  await expectPlaying(page);

  const shelf = page.locator('.shelf.has-after').first();
  await expect(shelf).toBeVisible({ timeout: 20_000 });
  expect(await shelf.evaluate((element) => getComputedStyle(element).maskImage)).toContain('linear-gradient');
  expect(errors).toEqual([]);
});

// 2026-10-17: a playlist is a folder of its covers in Library, and opens a page led by its cover.
test('Library: a new playlist is a folder card that opens its own page, cover first', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/library');
  const name = `Folder ${Date.now()}`;
  await page.getByLabel('New playlist name').fill(name);
  await page.getByRole('button', { name: 'Create playlist' }).click();
  const folder = page.getByRole('article', { name: `Playlist ${name}` });
  await expect(folder).toBeVisible({ timeout: 20_000 });
  await expect(folder).toContainText('0 songs');
  await folder.getByRole('link', { name: `Open ${name}` }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.collection-cover')).toBeVisible();
  expect(errors).toEqual([]);
});

test('every section renders without a page error', async ({ page }) => {
  const errors = collectPageErrors(page);
  for (const path of ['/', '/discover', '/library', '/liked', '/artist/Arijit%20Singh', '/not-a-real-page']) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBeLessThan(400);
    await expect(page.locator('#main-content'), path).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse' }).first(), path).toBeVisible();
  }
  expect(errors).toEqual([]);
});

// A11Y-001: the account dialog used to leave keyboard focus on the page behind it.
test('the account dialog takes focus, keeps Tab inside it both ways, and hands focus back on close', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');
  const opener = page.getByRole('button', { name: /Sign in or create an account|Checking your account|Open your account/ });
  await expect(opener).toBeVisible({ timeout: 30_000 });
  await opener.focus();
  await opener.click();

  const dialog = page.getByRole('dialog', { name: /^(Sign in|Your account)$/ });
  await expect(dialog).toBeVisible();
  const focusInside = async (): Promise<boolean> =>
    dialog.evaluate((node) => node.contains(document.activeElement) && document.activeElement !== node);

  // Initial focus lands inside the dialog, not on the page behind it.
  await expect.poll(focusInside).toBe(true);

  // Tab forward past the last control, and Shift+Tab back past the first: focus never leaves.
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press('Tab');
    expect(await focusInside(), `Tab ${step + 1}`).toBe(true);
  }
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press('Shift+Tab');
    expect(await focusInside(), `Shift+Tab ${step + 1}`).toBe(true);
  }

  // Escape closes it and the opener has focus again.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  expect(errors).toEqual([]);
});

test('search finds a song and plays it', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Search music' }).first().click();
  const box = page.getByRole('combobox');
  await expect(box).toBeVisible();
  await box.fill('Tum Hi Ho');
  const option = page.getByRole('option').first();
  await expect(option).toBeVisible({ timeout: 20_000 });
  await option.click();
  const playResult = page.getByRole('button', { name: /^Play Tum Hi Ho/ }).first();
  await expect(playResult).toBeVisible({ timeout: 20_000 });
  await playResult.click();
  await expectPlaying(page);
  expect((await audioState(page)).src).toContain('/api/stream/');
  expect(errors).toEqual([]);
});

test('pause stays paused and play resumes (one playback funnel)', async ({ page }) => {
  await startPlayback(page);
  await page.locator(bar).getByRole('button', { name: 'Pause' }).click();
  // Invariant 2: a load effect keyed on isPlaying would resume this within a tick.
  await page.waitForTimeout(1500);
  expect((await audioState(page)).paused).toBe(true);
  await page.locator(bar).getByRole('button', { name: 'Play', exact: true }).click();
  await expectPlaying(page);
});

test('music keeps playing across page navigation', async ({ page }) => {
  await startPlayback(page);
  // Tag the element: a remount would replace it and stop the music.
  await page.evaluate(() => {
    (document.querySelector('audio') as HTMLAudioElement & { __e2e?: boolean }).__e2e = true;
  });
  for (const name of ['Browse', 'Your library', 'Home']) {
    await page.getByRole('link', { name }).first().click();
    await expectPlaying(page);
  }
  const same = await page.evaluate(
    () => (document.querySelector('audio') as HTMLAudioElement & { __e2e?: boolean }).__e2e === true
  );
  expect(same).toBe(true);
});

test('seeking moves the playhead and playback carries on', async ({ page }) => {
  await startPlayback(page);
  const before = (await audioState(page)).time;
  const slider = page.locator(bar).getByRole('slider', { name: 'Track position', exact: true });
  await slider.focus();
  for (let i = 0; i < 6; i++) await slider.press('ArrowRight');
  await slider.blur();
  await expect.poll(async () => (await audioState(page)).time, { timeout: 10_000 }).toBeGreaterThan(before + 10);
  // Invariant 3: seek pauses, then always resumes.
  await expectPlaying(page);
});

test('the full player opens with lyrics and closes again', async ({ page }) => {
  const errors = collectPageErrors(page);
  await startPlayback(page);
  await page.locator(bar).getByRole('button', { name: 'Expand player', exact: true }).click();
  const player = page.getByRole('dialog').filter({
    has: page.getByRole('tablist', { name: 'Player surfaces' }),
  });
  await expect(player).toBeVisible();
  await expect(player.getByRole('tab', { name: 'Lyrics' })).toBeVisible();
  await player.getByRole('tab', { name: 'Queue' }).click();
  await page.keyboard.press('Escape');
  await expect(player).toBeHidden();
  await expectPlaying(page);
  expect(errors).toEqual([]);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  // Work and live-state indicators may keep moving (spinners, the DJ listening pulse). Anything else
  // that loops forever means a class rule beat the site-wide collapse again.
  const INDICATORS = [
    '.spin', '.is-spinning', '.cmdk-spinner', '.ctrl-play-wait', '.dj-spin',
    '.lyric-sync-jobs__spinner', '.import-chip__spinner', '.lucide-loader-circle',
    '.dj-dots i', '.dj-mic-button', '.dj-quick-icon', '.am-dj', '.dj-m-orbit i', '.dj-now-dot',
  ].join(', ');

  async function loopingOutsideIndicators(page: Page): Promise<string[]> {
    return page.evaluate((indicators) =>
      document.getAnimations().flatMap((animation) => {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        const looping = animation.playState === 'running' && animation.effect?.getComputedTiming().iterations === Infinity;
        if (!looping || (target && target.matches(indicators))) return [];
        const name = animation instanceof CSSAnimation ? animation.animationName : 'script';
        return [`${name} on ${target?.tagName.toLowerCase() ?? '?'}.${target?.className ?? ''}`];
      }), INDICATORS);
  }

  test('Home and the listening room run no infinite animation outside the indicator allowlist', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /^Play .+/ }).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    expect(await loopingOutsideIndicators(page), 'Home').toEqual([]);

    await startPlayback(page);
    await page.locator(bar).getByRole('button', { name: 'Expand player', exact: true }).click();
    await expect(page.getByRole('dialog').filter({ has: page.getByRole('tablist', { name: 'Player surfaces' }) })).toBeVisible();
    await page.waitForTimeout(500);
    expect(await loopingOutsideIndicators(page), 'listening room').toEqual([]);
  });
});

test('Library: the playlist layout toggle works from the keyboard and the choice survives a reload', async ({ page }) => {
  await page.goto('/library');
  const toggle = page.getByRole('group', { name: 'Playlist layout' });
  const grid = toggle.getByRole('button', { name: 'Show as grid', exact: true });
  const list = toggle.getByRole('button', { name: 'Show as list', exact: true });
  await expect(grid).toHaveAttribute('aria-pressed', 'true');
  await list.focus();
  await page.keyboard.press('Enter');
  await expect(list).toHaveAttribute('aria-pressed', 'true');
  await expect(grid).toHaveAttribute('aria-pressed', 'false');
  for (const button of [grid, list]) {
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(40);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
  }
  await page.reload();
  await expect(page.getByRole('group', { name: 'Playlist layout' }).getByRole('button', { name: 'Show as list', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('group', { name: 'Playlist layout' }).getByRole('button', { name: 'Show as grid', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Playlist layout' }).getByRole('button', { name: 'Show as grid', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('Home: the loading shelf has the same tile box as the loaded one, so nothing jumps', async ({ page }) => {
  // Hold the shelves back long enough to measure the skeleton, then let them through.
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/home*', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('/');
  const skeleton = page.getByRole('region', { name: 'Loading your shelves' });
  await expect(skeleton).toBeVisible({ timeout: 30_000 });
  const before = await skeleton.locator('.tile').first().boundingBox();
  release();
  await expect(skeleton).toBeHidden({ timeout: 30_000 });
  const loaded = page.locator('.home-section .shelf .tile').first();
  await expect(loaded).toBeVisible({ timeout: 30_000 });
  const after = await loaded.boundingBox();
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(Math.round(after!.width)).toBe(Math.round(before!.width));
  expect(Math.round(after!.height)).toBe(Math.round(before!.height));
});
