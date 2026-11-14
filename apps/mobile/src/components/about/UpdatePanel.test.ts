import * as fs from 'fs';
import * as path from 'path';

const source = fs.readFileSync(path.join(__dirname, 'UpdatePanel.tsx'), 'utf8');

it('keeps the current release notes in About and shows recent versions in the Stream dropdown', () => {
  expect(source).toContain('const latestNotes = latestReleaseNotes(build)');
  expect(source).toContain('dropdown ? fetchReleaseHistory()');
  expect(source).toContain('<RecentVersions entries={versionsToShow} onRollback=');
  expect(source).toContain(': latestNotes ? <Notes notes={latestNotes} /> : null}');
  expect(source).not.toContain('{available && build ? <Notes');
});

it('keeps release note categories and shows a real empty state instead of invented notes', () => {
  expect(source).toContain('notes.sections.map(section => (');
  expect(source).toContain('No release notes are available for this build.');
  expect(source).toContain('Recent updates');
  expect(source).toContain('Version {entry.version}');
  expect(source).toContain('index === 0 ? <Text style={styles.latestBadge}>Latest</Text> : null');
  expect(source).toContain('entry.rollbackUrl && onRollback');
  expect(source).toContain('Install version {entry.version}');
  expect(source).toContain('<ConfirmSheet');
  expect(source).toContain('Install version ${rollback.version}?');
  expect(source).not.toContain('Alert.alert(');
  expect(source).toContain('Your library and downloaded songs stay on this phone');
});
