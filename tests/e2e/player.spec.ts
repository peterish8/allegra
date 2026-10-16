import { collectPageErrors, expect, expectPlaying, startPlayback, test } from './helpers';
import type { Locator, Page } from '@playwright/test';

const bar = '[aria-label="Player bar"]';

async function openPlayer(page: Page): Promise<Locator> {
  await page.locator(bar).getByRole('button', { name: 'Expand player', exact: true }).click();
  const player = page.getByRole('dialog').filter({ has: page.getByRole('tablist', { name: 'Player surfaces' }) });
  await expect(player).toBeVisible();
  return player;
}

/** Holds for a few seconds: the bug this guards flipped back about a second after the click. */
async function expectStays(locator: Locator, ms = 4000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await expect(locator).toBeVisible({ timeout: 1000 });
    await locator.page().waitForTimeout(250);
  }
}

// Regression (2026-10-11): liking the playing song on Now Playing showed liked, then a library
// reload that had skipped our own write rebuilt the likes without it and the heart went empty.
test('liking the playing song on Now Playing stays liked, and unliking stays unliked', async ({ page }) => {
  const errors = collectPageErrors(page);
  await startPlayback(page);
  const player = await openPlayer(page);

  const like = player.getByRole('button', { name: 'Add to likes' }).first();
  await expect(like).toBeVisible();
  await like.click();
  await expect(player.getByRole('button', { name: 'Remove from likes' }).first()).toBeVisible();
  // What reloaded the library a moment later in the field: another device's change, an account
  // refresh or a session flip. Each re-reads likes; our own write must survive it.
  await page.waitForTimeout(800);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('allegra:library')));
  await expectStays(player.getByRole('button', { name: 'Remove from likes' }).first());

  // A later library reload (here: leaving and coming back) must still know about the like.
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Your library' }).first().click();
  await page.getByRole('link', { name: 'Home' }).first().click();
  const again = await openPlayer(page);
  await expect(again.getByRole('button', { name: 'Remove from likes' }).first()).toBeVisible();

  await again.getByRole('button', { name: 'Remove from likes' }).first().click();
  await expectStays(again.getByRole('button', { name: 'Add to likes' }).first());
  await expectPlaying(page);
  expect(errors).toEqual([]);
});

test('lyrics switch between letter by letter and line by line, by the menu and by a triple tap', async ({ page }) => {
  await startPlayback(page);
  const player = await openPlayer(page);
  const lyricsTab = player.getByRole('tab', { name: 'Lyrics' });
  await lyricsTab.click();

  const readHighlight = (): Promise<string | null> => page.evaluate(() => {
    try { return (JSON.parse(localStorage.getItem('allegra-settings-v1') ?? '{}') as { lyricsHighlight?: string }).lyricsHighlight ?? null; }
    catch { return null; }
  });
  const before = (await readHighlight()) ?? 'letters';

  // Three quick taps on the Lyrics tab flip the style and say so.
  await lyricsTab.click({ clickCount: 1 });
  await lyricsTab.click({ clickCount: 1 });
  await lyricsTab.click({ clickCount: 1 });
  await expect(player.getByRole('status').filter({ hasText: before === 'letters' ? 'Line by line' : 'Letter by letter' })).toBeVisible();
  await expect.poll(readHighlight).toBe(before === 'letters' ? 'lines' : 'letters');

  // The direct switch in the lyrics options does the same, and shows its state. On a wide screen the
  // options fold into a ⋯ pill, so open it first.
  const foldedOptions = page.getByRole('button', { name: 'Lyrics options', exact: true });
  if (await foldedOptions.isVisible()) await foldedOptions.click();
  const lineByLine = page.getByRole('button', { name: /Line by line/ }).first();
  await lineByLine.click();
  await expect.poll(readHighlight).toBe(before);
  await expectPlaying(page);
});

test('DJ settings: every dropdown opens, picks by mouse and keyboard, and the custom endpoint asks for a URL', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/dj');
  await page.getByRole('button', { name: 'DJ settings', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'DJ settings' });
  await expect(sheet).toBeVisible();

  // Provider: open with the mouse, pick OpenAI; the model list follows it.
  const provider = sheet.getByRole('button', { name: /^Provider/ });
  await provider.click();
  await sheet.getByRole('option', { name: /^OpenAI/ }).click();
  await expect(provider).toContainText('OpenAI');
  const model = sheet.getByRole('button', { name: /^Model/ }).first();
  await expect(model).toContainText('GPT-4o mini');
  await expect(sheet.getByRole('link', { name: /Get one at OpenAI/ })).toHaveAttribute('href', 'https://platform.openai.com/api-keys');

  // Model by keyboard: open, End (Other…), Enter opens the free-text field.
  await model.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(sheet.getByRole('textbox', { name: /Model: type an ID/ })).toBeVisible();

  // Escape closes an open list without changing the choice, and leaves the settings open
  // (regression: the page's own Escape closed the whole sheet too).
  await provider.click();
  await page.keyboard.press('Escape');
  await expect(sheet.getByRole('listbox')).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await expect(provider).toContainText('OpenAI');

  // Custom endpoint: needs a URL; plain http off this computer is refused.
  await provider.click();
  await sheet.getByRole('option', { name: /^Custom endpoint/ }).click();
  const url = sheet.getByRole('textbox', { name: 'Endpoint URL' });
  await url.fill('http://192.168.1.4:20128/v1');
  await expect(url).toHaveAttribute('aria-invalid', 'true');
  await url.fill('http://localhost:20128/v1');
  await expect(url).toHaveAttribute('aria-invalid', 'false');
  await expect(sheet.getByRole('button', { name: 'Load models' })).toBeEnabled();

  // Back to free on-device so later tests start clean.
  await provider.click();
  await sheet.getByRole('option', { name: /^On this device/ }).click();
  expect(errors).toEqual([]);
});

test('DJ set controls: shape and exploration cycle, and a ruled-out artist chip can be removed', async ({ page }) => {
  await page.goto('/dj');
  const shape = page.getByRole('button', { name: /^Set shape:/ });
  await expect(shape).toHaveAccessibleName(/Steady|Build up|Wind down|Dynamic/);
  const first = await shape.textContent();
  await shape.click();
  await expect(shape).not.toHaveText(first ?? '');
  const explore = page.getByRole('button', { name: /^Exploration:/ });
  const was = await explore.textContent();
  await explore.click();
  await expect(explore).not.toHaveText(was ?? '');

  // The choices survive a reload of the tab.
  const shapeNow = await shape.textContent();
  await page.reload();
  await expect(page.getByRole('button', { name: /^Set shape:/ })).toHaveText(shapeNow ?? '');
});
