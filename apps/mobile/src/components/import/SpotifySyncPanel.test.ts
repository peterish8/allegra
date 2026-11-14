import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

describe('Spotify disconnect confirmation', () => {
  it('keeps the account connected until the destructive sheet is confirmed', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/components/import/SpotifySyncPanel.tsx'), 'utf8');
    const disconnect = source.match(/const\s+disconnect\s*=\s*\(\):\s*void\s*=>\s*\{([\s\S]*?)\n\s*\};/)?.[1] ?? '';
    const confirm = source.match(/const\s+confirmSpotifyDisconnect\s*=\s*\(\):\s*void\s*=>\s*\{([\s\S]*?)\n\s*\};/)?.[1] ?? '';

    expect(source).not.toContain('Alert.alert');
    expect(disconnect).toContain('setConfirmDisconnect(true)');
    expect(disconnect).not.toContain('disconnectSpotify(');
    expect(confirm).toContain('disconnectSpotify(token)');
    expect(source).toMatch(/<ConfirmSheet[\s\S]*?visible=\{confirmDisconnect\}[\s\S]*?destructive[\s\S]*?onConfirm=\{confirmSpotifyDisconnect\}/);
  });
});
