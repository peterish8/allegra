import { collectPageErrors, expect, startPlayback, test } from './helpers';

const mobileRoutes = ['/', '/discover', '/dj', '/library', '/liked', '/artist/Arijit%20Singh'];

test('360px routes render without page errors or horizontal scrolling', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 360, height: 812 });

  for (const route of mobileRoutes) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBeLessThan(400);
    await expect(page.locator('#main-content'), route).toBeVisible();
    const widths = await page.evaluate(() => ({
      scroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewport: window.innerWidth,
    }));
    expect(widths.scroll, `${route} should not scroll horizontally`).toBeLessThanOrEqual(widths.viewport);
  }

  expect(errors).toEqual([]);
});

test('the mini player does not cover the last Browse row at 360px', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 360, height: 812 });
  await startPlayback(page);
  await page.goto('/discover');

  const browseChart = page.locator('#browse-chart');
  const lastRow = browseChart.locator('.track-row').last();
  const playerBar = page.getByRole('region', { name: 'Player bar' });
  await expect(lastRow).toBeVisible({ timeout: 30_000 });
  await expect(playerBar).toBeVisible();
  await lastRow.evaluate((row) => {
    let ancestor = row.parentElement;
    while (ancestor) {
      const style = window.getComputedStyle(ancestor);
      if (/(auto|scroll)/.test(style.overflowY) && ancestor.scrollHeight > ancestor.clientHeight) break;
      ancestor = ancestor.parentElement;
    }
    if (ancestor) ancestor.scrollTop = ancestor.scrollHeight;
    else window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
  });

  const geometry = await lastRow.evaluate((row) => {
    const rowBottom = row.getBoundingClientRect().bottom;
    const bar = document.querySelector('[aria-label="Player bar"]');
    return { rowBottom, barTop: bar?.getBoundingClientRect().top ?? Number.NEGATIVE_INFINITY };
  });
  expect(geometry.rowBottom, 'last row bottom should stay above the mini player').toBeLessThanOrEqual(geometry.barTop);
  expect(errors).toEqual([]);
});
