import * as fs from 'fs';
import * as path from 'path';

const source = fs.readFileSync(path.join(__dirname, 'UpdatePanel.tsx'), 'utf8');

it('keeps the current release notes in About and shows recent versions in the Stream dropdown', () => {
  expect(source).toContain('const latestNotes = latestReleaseNotes(build)');
  expect(source).toContain('dropdown ? fetchReleaseHistory()');
  expect(source).toContain('<RecentVersions entries={versionsToShow} />');
  expect(source).toContain(': latestNotes ? <Notes notes={latestNotes} /> : null}');
  expect(source).not.toContain('{available && build ? <Notes');
});

it('keeps release note categories and shows a real empty state instead of invented notes', () => {
  expect(source).toContain('notes.sections.map(section => (');
  expect(source).toContain('No release notes are available for this build.');
  expect(source).toContain('Recent updates');
  expect(source).toContain('Version {entry.version}');
  expect(source).toContain('index === 0 ? <Text style={styles.latestBadge}>Latest</Text> : null');
});
