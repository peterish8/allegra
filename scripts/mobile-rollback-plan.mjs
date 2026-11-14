#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { rollbackBuildPlan } from './mobile-release-notes.mjs';
import { fileURLToPath } from 'node:url';

function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((pairs, value, index, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]]] : pairs), []),
  );
  const { history = 'apps/mobile/update-history.json', assets, out = 'rollback-plan.json' } = args;
  if (!assets) throw new Error('--assets <json-file> is required');
  const app = JSON.parse(readFileSync('apps/mobile/app.json', 'utf8'));
  const entries = JSON.parse(readFileSync(history, 'utf8'));
  const assetNames = JSON.parse(readFileSync(assets, 'utf8'));
  const plan = rollbackBuildPlan(entries, app.expo.version, assetNames);
  writeFileSync(out, JSON.stringify({ include: plan }, null, 2));
  process.stdout.write(JSON.stringify(plan));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
