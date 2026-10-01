#!/usr/bin/env node
/**
 * Vercel's build command. A production build pushes the Convex functions and schema first, so the
 * website and API never ship ahead of the backend they call. On 2026-10-01 they did: production
 * Vercel ran a8577af against Convex from 5abdde0, `connect:register` refused the new
 * `protocolVersion` argument, and no device could join Connect.
 *
 * Production needs CONVEX_DEPLOY_KEY (Convex dashboard → Settings → Deploy keys, production) in
 * Vercel's Production environment. Without it the build stops rather than shipping ahead.
 * Preview and development builds only build the website.
 */
import { spawnSync } from 'node:child_process';

const webBuild = 'npm --prefix apps/web run build';

function run(command) {
  const result = spawnSync(command, { stdio: 'inherit', shell: true });
  process.exit(result.status ?? 1);
}

if (process.env.VERCEL_ENV === 'production') {
  if (!process.env.CONVEX_DEPLOY_KEY) {
    console.error('CONVEX_DEPLOY_KEY is not set for Production. Add the production deploy key in Vercel so Convex deploys before the website.');
    process.exit(1);
  }
  run(`npx convex deploy --cmd "${webBuild}"`);
} else {
  run(webBuild);
}
