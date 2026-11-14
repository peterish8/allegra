import fs from 'fs';
import path from 'path';

const read = (...parts: string[]): string => fs.readFileSync(path.join(__dirname, ...parts), 'utf8');

describe('Connect device sheet entry points', () => {
  it('routes Stream to the single app-level sheet used by the profile menu', () => {
    const dropdown = read('ConnectDropdown.tsx');
    const root = read('../../navigation/RootNavigator.tsx');
    const menuItems = read('../../navigation/profileMenu.ts');
    const tabBar = read('../V6TabBar.tsx');

    expect(dropdown).toContain('connect.openDevices()');
    expect(dropdown).toContain('expanded: connect.devicesVisible');
    expect(dropdown).not.toMatch(/ConnectDeviceList|SheetScrollView|<Sheet\b/);
    expect(root.match(/<ConnectDeviceSheet\s*\/>/g) ?? []).toHaveLength(1);
    expect(menuItems).toContain("id: 'devices', title: 'Connect devices'");
    expect(tabBar).toContain("if (action === 'devices') { openDevices(); return; }");
  });
});
