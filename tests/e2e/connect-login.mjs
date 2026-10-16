// Saves a signed-in session for tests/e2e/connect.spec.ts.
//
// Google refuses to sign in inside a browser Playwright launched ("This browser or app may not be
// secure"), so this opens your installed Chrome as a plain window with its own throwaway profile.
// You sign in there yourself; nothing is attached to the window until you press Enter here. Then
// it reads the app's session over Chrome's debugging port, writes it to output/playwright/
// (git-ignored) and closes the window. Nothing here types or reads a password.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { chromium } from '@playwright/test';

const baseURL = (process.env.E2E_BASE_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
const out = process.env.E2E_CONNECT_STATE ?? 'output/playwright/connect-state.json';
const profile = resolve('output/playwright/connect-login-profile');
const port = Number(process.env.E2E_LOGIN_PORT ?? 9333);
const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].filter(Boolean);
const chrome = candidates.find((path) => existsSync(path));
if (!chrome) {
  process.stderr.write('Chrome was not found. Set CHROME_PATH to chrome.exe and run again.\n');
  process.exit(1);
}

mkdirSync(profile, { recursive: true });
const chromeProcess = spawn(chrome, [
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  '--no-first-run',
  '--no-default-browser-check',
  baseURL
], { stdio: 'ignore', detached: false });

const prompt = createInterface({ input: process.stdin, output: process.stdout });
await prompt.question(`Sign in with Google in the Chrome window that opened (${baseURL}).\nWhen the app shows you signed in, press Enter here… `);
prompt.close();

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const context = browser.contexts()[0];
const app = context.pages().find((page) => page.url().startsWith(baseURL)) ?? await context.newPage();
if (!app.url().startsWith(baseURL)) await app.goto(baseURL);
const signedIn = await app.evaluate(() => Object.keys(window.localStorage).some((key) => key.startsWith('__convexAuthJWT')));
if (!signedIn) {
  process.stderr.write('No Allegra sign-in found in that window yet. Sign in on the app page, then run this again.\n');
  await browser.close();
  chromeProcess.kill();
  process.exit(1);
}
mkdirSync(dirname(out), { recursive: true });
await context.storageState({ path: out });
process.stdout.write(`Saved the signed-in session to ${out}. Run: npm run e2e\n`);
await browser.close();
chromeProcess.kill();
