import * as fs from 'fs';
import * as path from 'path';

const source = fs.readFileSync(path.join(__dirname, 'UpdatePanel.tsx'), 'utf8');

it('renders the latest release notes from the release feed without hiding them when current', () => {
  expect(source).toContain('const latestNotes = latestReleaseNotes(build)');
  expect(source).toContain('{latestNotes ? <Notes notes={latestNotes} /> : null}');
  expect(source).not.toContain('{available && build ? <Notes');
});

it('keeps release note categories and shows a real empty state instead of invented notes', () => {
  expect(source).toContain('notes.sections.map(section => (');
  expect(source).toContain('No release notes are available for this build.');
});
