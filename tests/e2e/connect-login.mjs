// Saves a signed-in session for tests/e2e/connect.spec.ts. Opens the app in a visible browser;
// sign in with Google there yourself. The session is written to output/playwright/ (git-ignored)
// once Convex Auth has stored its token. Nothing here types or reads a password.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';

const baseURL = (process.env.E2E_BASE_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
const out = process.env.E2E_CONNECT_STATE ?? 'output/playwright/connect-state.json';
const channel = process.env.E2E_CHANNEL;

const browser = await chromium.launch({ headless: false, ...(channel ? { channel } : {}) });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(baseURL);
process.stdout.write(`Sign in with Google in the window that opened (${baseURL}). Waiting up to 5 minutes…\n`);
await page.waitForFunction(
  () => Object.keys(window.localStorage).some((key) => key.startsWith('__convexAuthJWT')),
  undefined,
  { timeout: 5 * 60_000, polling: 1_000 }
);
mkdirSync(dirname(out), { recursive: true });
await context.storageState({ path: out });
process.stdout.write(`Saved the signed-in session to ${out}\n`);
await browser.close();
