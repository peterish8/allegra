import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const screen = readFileSync(join(__dirname, '../../screens/BlendScreen.tsx'), 'utf8');

describe('Blend leave confirmation', () => {
  it('keeps the leave action behind a destructive ConfirmSheet with the existing choices', () => {
    const confirmation = screen.match(/<ConfirmSheet\b[\s\S]*?\/>/)?.[0] ?? '';

    expect(confirmation).not.toBe('');
    expect(confirmation).toContain('visible={leaveConfirmationOpen}');
    expect(confirmation).toContain('title={`Leave ${detail.name}?`}');
    expect(confirmation).toContain('body="You\'ll stop seeing it, and it refreshes without your songs."');
    expect(confirmation).toContain('confirmLabel="Leave"');
    expect(confirmation).toContain('cancelLabel="Stay"');
    expect(confirmation).toContain('destructive');
    expect(confirmation).toContain('onConfirm={confirmLeave}');
    expect(screen).toMatch(/const leave = \(\): void => \{\s*if \(!token \|\| !detail\) return;\s*setLeaveConfirmationOpen\(true\);/);
    expect(screen).toMatch(/const confirmLeave = \(\): void => \{[\s\S]*?leaveBlend\(token, detail.id\)[\s\S]*?navigation\.navigate\('Blends'\)/);
  });
});
