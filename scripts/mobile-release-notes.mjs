#!/usr/bin/env node
/**
 * Release notes for a phone build, from the commits since the previous one.
 *
 * Echo Music ships a changelog file with every release and its update screen reads it; this is the
 * same idea for LuvLyrics. CI (.github/workflows/mobile-apk.yml) runs it when it publishes `apk-latest`:
 *
 *   node scripts/mobile-release-notes.mjs --from <previous sha> --to <sha> --version 0.2.0 --out dist
 *
 * and uploads `changelog.json` next to the APK. The app (apps/mobile/src/services/appUpdate.ts) reads it;
 * `notes.md` becomes the release page text. Only commits that touched the app, or code it imports, count.
 *
 * Commit subjects follow conventional commits (`feat(connect): …`). Features, fixes and speed-ups are
 * listed; chores, docs, tests and CI never are, since they change nothing a listener can feel.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Paths whose commits reach the phone: the workflow's own trigger list. */
export const APP_PATHS = ['apps/mobile', 'packages', 'convex/_generated'];

const SECTIONS = [
  { title: 'New', types: ['feat'] },
  { title: 'Fixed', types: ['fix'] },
  { title: 'Faster and smoother', types: ['perf', 'refactor'] },
];

const SUBJECT = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?:\s*(?<text>.+)$/i;
const MAX_ITEM = 120;

/** One commit subject as a line a listener can read, or null when it does not belong in the notes. */
export function itemFor(subject) {
  const match = SUBJECT.exec(subject.trim());
  if (!match?.groups) return null;
  const type = match.groups.type.toLowerCase();
  const section = SECTIONS.find(s => s.types.includes(type));
  if (!section) return null;
  let text = match.groups.text.trim().replace(/\s+/g, ' ').replace(/\.$/, '');
  if (text.length > MAX_ITEM) text = `${text.slice(0, MAX_ITEM - 1).trimEnd()}…`;
  return { section: section.title, text: text.charAt(0).toUpperCase() + text.slice(1) };
}

/** Sections in a fixed order, items in commit order (newest first), duplicates dropped. */
export function sectionsFor(subjects) {
  const by = new Map(SECTIONS.map(s => [s.title, []]));
  for (const subject of subjects) {
    const item = itemFor(subject);
    if (!item) continue;
    const items = by.get(item.section);
    if (!items.includes(item.text)) items.push(item.text);
  }
  return SECTIONS.map(s => ({ title: s.title, items: by.get(s.title) })).filter(s => s.items.length > 0);
}

export function markdownFor(version, sections, fallback) {
  const lines = [`# LuvLyrics ${version}`, ''];
  if (sections.length === 0) lines.push(fallback, '');
  for (const section of sections) {
    lines.push(`## ${section.title}`, ...section.items.map(item => `- ${item}`), '');
  }
  return lines.join('\n').trimEnd() + '\n';
}

/** The shape the app reads (`parseChangelog` in apps/mobile/src/services/appUpdate.ts). */
export function changelogFor({ version, commit, sections, description }) {
  return { version, commit, description, changelog: sections };
}

function subjectsBetween(from, to) {
  const range = from ? `${from}..${to}` : to;
  const args = ['log', range, '--no-merges', '--pretty=format:%s', ...(from ? [] : ['-n', '30']), '--', ...APP_PATHS];
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'git log failed');
  const out = result.stdout.trim();
  return out ? out.split('\n') : [];
}

function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((pairs, value, index, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]]] : pairs), []),
  );
  const { from = '', to, version = '0.0.0', out = 'dist' } = args;
  if (!to) throw new Error('--to <commit> is required');
  let subjects = [];
  try {
    subjects = subjectsBetween(from, to);
  } catch {
    // The previous build's commit is gone (a force-push): list what the last few commits changed instead.
    subjects = subjectsBetween('', to);
  }
  const sections = sectionsFor(subjects);
  const description = sections.length === 0 ? 'Small improvements and fixes.' : '';
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'changelog.json'), JSON.stringify(changelogFor({ version, commit: to, sections, description }), null, 2));
  writeFileSync(join(out, 'notes.md'), markdownFor(version, sections, description));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
