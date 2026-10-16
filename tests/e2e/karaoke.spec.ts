import { audioState, collectPageErrors, expect, expectPlaying, startPlayback, test } from './helpers';

test('karaoke turns on within the press and off again without touching playback', async ({ page }) => {
  const errors = collectPageErrors(page);
  // Never pull the ~752 MB model in a test run.
  await page.route(/\.onnx(\.data)?(\?|$)/, (route) => route.abort());
  await startPlayback(page);
  const src = (await audioState(page)).src;

  await page.getByRole('button', { name: 'Expand player' }).click();
  await page.getByRole('button', { name: 'Turn karaoke on' }).first().click();

  // Devices that could run the AI model are asked first; this test stays on the light remover.
  const keepBasic = page.getByRole('button', { name: 'Keep Basic' });
  if (await keepBasic.isVisible({ timeout: 3000 }).catch(() => false)) await keepBasic.click();

  // The live bridge sounds at once: no loading state between the press and "on".
  await expect(page.getByRole('button', { name: /^Turn karaoke off/ }).first()).toBeVisible();
  await expect(page.locator('[aria-live]').filter({ hasText: /^Karaoke on/ }).first()).toBeAttached();
  await expectPlaying(page);
  // The bridge works in the audio graph: the element keeps its source.
  expect((await audioState(page)).src).toBe(src);

  await page.getByRole('button', { name: /^Turn karaoke off/ }).first().click();
  await expect(page.getByRole('button', { name: 'Turn karaoke on' }).first()).toBeVisible();
  await expectPlaying(page);
  expect((await audioState(page)).src).toBe(src);
  expect(errors).toEqual([]);
});
