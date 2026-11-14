#!/usr/bin/env node
/**
 * Build the phone's user-facing release notes from the curated history at
 * apps/mobile/update-history.json. Commit subjects are for developers; they are
 * not suitable copy for the update screen.
 *
 * CI runs this when it publishes apk-latest:
 *   node scripts/mobile-release-notes.mjs --to <sha> --version 1.66.0 --out dist
 *
 * The current version's notes become changelog.json. The latest four entries
 * become update-history.json for the Stream updates dropdown.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_HISTORY_ENTRIES = 4;
const VERSION = /^\d+\.\d+\.\d+$/;
const COMMIT = /^[0-9a-f]{40}$/i;
const ROLLBACK_ASSET = /^LuvLyrics-rollback-(\d+\.\d+\.\d+)\.apk$/;
const ROLLBACK_DOWNLOADS = 'https://github.com/peterish8/allegra/releases/download/apk-latest';

const compareVersions = (left, right) => {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
};

/** Validate and limit the listener-facing history, newest version first. */
export function releaseHistoryFor(input, currentVersion, availableAssets = []) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.entries)) {
    throw new Error('update history must contain an entries array');
  }
  if (!Array.isArray(availableAssets) || availableAssets.some(name => typeof name !== 'string')) {
    throw new Error('available rollback assets must be a list of asset names');
  }

  const seen = new Set();
  const entries = input.entries.slice(0, MAX_HISTORY_ENTRIES).map((entry, index) => {
    if (!entry || typeof entry !== 'object' || typeof entry.version !== 'string' || !VERSION.test(entry.version)) {
      throw new Error(`update history entry ${index + 1} needs a version such as 1.66.0`);
    }
    if (seen.has(entry.version)) throw new Error(`update history repeats version ${entry.version}`);
    seen.add(entry.version);
    if (!Array.isArray(entry.changelog)) throw new Error(`update history ${entry.version} needs a changelog array`);

    const changelog = entry.changelog.map((section, sectionIndex) => {
      if (!section || typeof section !== 'object' || typeof section.title !== 'string' || !Array.isArray(section.items)) {
        throw new Error(`update history ${entry.version} section ${sectionIndex + 1} is invalid`);
      }
      const title = section.title.trim();
      if (!title) throw new Error(`update history ${entry.version} has a section without a title`);
      const items = section.items.map(item => typeof item === 'string' ? item.trim() : '');
      if (items.length === 0 || items.some(item => item.length === 0)) {
        throw new Error(`update history ${entry.version} has an empty update message`);
      }
      return { title, items };
    });

    let rollbackUrl;
    if (entry.rollbackAsset !== undefined) {
      const match = typeof entry.rollbackAsset === 'string' ? entry.rollbackAsset.match(ROLLBACK_ASSET) : null;
      if (!match || match[1] !== entry.version) {
        throw new Error('update history ' + entry.version + ' has an invalid rollback asset name');
      }
      if (typeof entry.sourceCommit !== 'string' || !COMMIT.test(entry.sourceCommit)) {
        throw new Error('update history ' + entry.version + ' needs a full source commit for its rollback APK');
      }
      if (entry.version === currentVersion) throw new Error('the current version cannot have a rollback APK');
      if (availableAssets.includes(entry.rollbackAsset)) rollbackUrl = ROLLBACK_DOWNLOADS + '/' + entry.rollbackAsset;
    }

    return {
      version: entry.version,
      description: typeof entry.description === 'string' ? entry.description.trim() : '',
      changelog,
      ...(rollbackUrl ? { rollbackUrl } : {}),
    };
  });

  if (entries.length === 0) throw new Error('update history needs at least one release');
  if (entries[0].version !== currentVersion) {
    throw new Error(`update history starts at ${entries[0].version}; expected the app version ${currentVersion}`);
  }
  for (let index = 1; index < entries.length; index += 1) {
    if (compareVersions(entries[index - 1].version, entries[index].version) < 0) {
      throw new Error('update history entries must be ordered newest first');
    }
  }
  return { entries };
}

/** Build only older APKs whose signed rollback assets are missing from apk-latest. */
export function rollbackBuildPlan(input, currentVersion, availableAssets = []) {
  releaseHistoryFor(input, currentVersion, availableAssets);
  const present = new Set(availableAssets);
  return input.entries.slice(1).flatMap((entry, index) => {
    const version = entry?.version;
    if (typeof version !== 'string' || !VERSION.test(version)) throw new Error('rollback entry ' + (index + 2) + ' has an invalid version');
    const assetMatch = typeof entry.rollbackAsset === 'string' ? entry.rollbackAsset.match(ROLLBACK_ASSET) : null;
    if (!assetMatch || assetMatch[1] !== version) throw new Error('rollback entry ' + version + ' has an invalid asset name');
    if (typeof entry.sourceCommit !== 'string' || !COMMIT.test(entry.sourceCommit)) throw new Error('rollback entry ' + version + ' needs a full source commit');
    return present.has(entry.rollbackAsset) ? [] : [{ version, commit: entry.sourceCommit.toLowerCase(), asset: entry.rollbackAsset }];
  });
}

export function markdownFor(version, sections, description) {
  const lines = [`# LuvLyrics ${version}`, ''];
  if (description) lines.push(description, '');
  for (const section of sections) {
    lines.push(`## ${section.title}`, ...section.items.map(item => `- ${item}`), '');
  }
  return lines.join('\n').trimEnd() + '\n';
}

/** The shape the app reads from changelog.json. */
export function changelogFor({ version, commit, entry }) {
  return { version, commit, description: entry.description, changelog: entry.changelog };
}

function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((pairs, value, index, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]]] : pairs), []),
  );
  const { to, version = '0.0.0', out = 'dist', history = 'apps/mobile/update-history.json', 'available-rollbacks': availableRollbacksPath } = args;
  if (!to) throw new Error('--to <commit> is required');
  const availableAssets = availableRollbacksPath ? JSON.parse(readFileSync(availableRollbacksPath, 'utf8')) : [];
  const releaseHistory = releaseHistoryFor(JSON.parse(readFileSync(history, 'utf8')), version, availableAssets);
  const current = releaseHistory.entries[0];
  const changelog = changelogFor({ version, commit: to, entry: current });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'changelog.json'), JSON.stringify(changelog, null, 2));
  writeFileSync(join(out, 'update-history.json'), JSON.stringify(releaseHistory, null, 2));
  writeFileSync(join(out, 'notes.md'), markdownFor(version, current.changelog, current.description));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
