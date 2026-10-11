import { collectPageErrors, expect, expectPlaying, startPlayback, test } from './helpers';
import type { Page } from '@playwright/test';

/**
 * Connect across two browsers signed in to one account: the two-tab harness in
 * docs/workflows.md, driven. Tab B opens with `?connectDevice=b` (development builds only) so it
 * registers as its own device.
 *
 * Needs a signed-in session: run `npm run e2e:connect-login` once, sign in with Google in the
 * window it opens, and it saves the session to output/playwright/connect-state.json. Without that
 * file (or E2E_CONNECT_STATE pointing at one) the journey is skipped, not failed.
 */
const statePath = process.env.E2E_CONNECT_STATE ?? 'output/playwright/connect-state.json';
/** The switch budget (2026-10-11): tap to sound on the other device. */
const BUDGET_MS = Number(process.env.E2E_CONNECT_BUDGET_MS ?? 1_000);

test.use({ storageState: statePath });

test.beforeAll(async () => {
  const { existsSync } = await import('node:fs');
  test.skip(!existsSync(statePath), `no signed-in session at ${statePath}: run npm run e2e:connect-login`);
});

async function openPicker(page: Page) {
  await page.getByRole('button', { name: /^Listen on a device/ }).first().click();
  const picker = page.getByRole('dialog', { name: 'Listen on' });
  await expect(picker).toBeVisible();
  return picker;
}

/** In-page clock: when the next press lands on the page, and when its audio then starts. */
async function armSwitchTimer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const marks = { tapped: 0, playing: 0 };
    (window as Window & { switchMarks?: typeof marks }).switchMarks = marks;
    window.addEventListener('pointerdown', () => { marks.tapped ||= performance.now(); }, { capture: true, once: true });
    document.querySelector('audio')?.addEventListener('playing', () => { marks.playing ||= performance.now(); });
  });
}

async function switchTime(page: Page): Promise<number> {
  await expect.poll(() => page.evaluate(() => (window as Window & { switchMarks?: { playing: number } }).switchMarks?.playing ?? 0), {
    timeout: 30_000, message: 'audio never started on the tab that took playback'
  }).toBeGreaterThan(0);
  return page.evaluate(() => {
    const marks = (window as Window & { switchMarks?: { tapped: number; playing: number } }).switchMarks;
    return marks ? marks.playing - marks.tapped : Number.NaN;
  });
}

test('playback moves to another browser in under a second, and the first one stops', async ({ context, page }, testInfo) => {
  const errorsA = collectPageErrors(page);
  await startPlayback(page);

  const tabB = await context.newPage();
  const errorsB = collectPageErrors(tabB);
  await tabB.goto('/?connectDevice=b');
  // B shows that A plays, then takes it with "This browser".
  const picker = await openPicker(tabB);
  await expect(picker.getByText('Playing on')).toBeVisible({ timeout: 30_000 });
  await armSwitchTimer(tabB);
  await picker.getByRole('button', { name: /This browser/ }).click();

  const elapsed = await switchTime(tabB);
  testInfo.annotations.push({ type: 'switch', description: `tap to sound: ${Math.round(elapsed)} ms` });
  await expectPlaying(tabB);
  await expect.poll(async () => (await page.evaluate(() => document.querySelector('audio')?.paused ?? true)), {
    message: 'the first tab kept playing after the switch'
  }).toBe(true);
  expect(elapsed, `tap to sound took ${Math.round(elapsed)} ms`).toBeLessThan(BUDGET_MS);

  // And back: A takes it again with the same budget.
  const pickerA = await openPicker(page);
  await expect(pickerA.getByText('Playing on')).toBeVisible();
  await armSwitchTimer(page);
  await pickerA.getByRole('button', { name: /This browser/ }).click();
  const back = await switchTime(page);
  testInfo.annotations.push({ type: 'switch back', description: `tap to sound: ${Math.round(back)} ms` });
  await expectPlaying(page);
  expect(back, `switching back took ${Math.round(back)} ms`).toBeLessThan(BUDGET_MS);

  expect(errorsA).toEqual([]);
  expect(errorsB).toEqual([]);
});
