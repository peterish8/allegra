/**
 * Anything outside the phone's own player that starts this phone's audio must ask Connect first.
 * Otherwise an action taken while another device plays starts the music here and takes playback
 * from that device: on 2026-10-04 a song tapped on the phone, while it was the laptop's remote,
 * played on the phone and stopped the laptop.
 *
 * A file that starts playback (the calls below) is either one of the player's own parts, listed
 * here with why it may, or it imports the Connect routing (`services/connect/playbackIntents` or
 * `pickRouter`), which decides where the action goes. A list screen needs neither: it plays
 * through `setPlaylistQueue`, which asks Connect itself.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname);
const STARTS = [/requestPlayback\(\s*true\s*\)/, /\.loadSong\(/, /\bnextInPlaylist\(/, /\bpreviousInPlaylist\(/, /\bskipToQueueIndex\(/];

/** The player's own parts, which act only on this phone's player by design. */
const PLAYER_PARTS: Record<string, string> = {
  'store/playerStore.ts': 'the player itself; setPlaylistQueue asks Connect before it plays',
  'services/connect/mobilePlayerPort.ts': 'Connect driving this phone when it is the device that plays',
  'components/MiniPlayer.tsx': "this phone's mini player, hidden while another device plays",
  'hooks/useNowPlayingLogic.ts': "this phone's Now Playing, replaced by the remote player while another device plays",
  'screens/NowPlayingScreen.tsx': "this phone's Now Playing, replaced by the remote player while another device plays",
  'components/player/UpNextPanel.tsx': "the queue under this phone's own player",
  'contexts/PlayerContext.tsx': "this phone's player events, and its lock-screen and headset buttons",
  'widget/widgetTaskHandler.tsx': "the home-screen widget's buttons on this phone's own player",
  'playback/recovery.ts': "reloads this phone's song after a playback error",
  'services/luvLink/legacy/sync.ts': 'an Echo LuvLink room, which owns playback while it is open',
};

const ROUTING_IMPORT = /from '[^']*(?:services\/connect\/|\.\/)(?:playbackIntents|pickRouter)'/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === '__tests__' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe('starting this phone’s audio', () => {
  it('happens only in the player itself or behind the Connect routing', () => {
    const unrouted = sourceFiles(SRC).flatMap(file => {
      const relative = path.relative(SRC, file).split(path.sep).join('/');
      if (relative in PLAYER_PARTS) return [];
      const source = fs.readFileSync(file, 'utf8');
      if (!STARTS.some(start => start.test(source))) return [];
      return ROUTING_IMPORT.test(source) ? [] : [relative];
    });
    expect(unrouted).toEqual([]);
  });

  it('names only player parts that still exist and still start audio', () => {
    for (const relative of Object.keys(PLAYER_PARTS)) {
      const file = path.join(SRC, relative);
      expect(fs.existsSync(file)).toBe(true);
      const source = fs.readFileSync(file, 'utf8');
      expect(STARTS.some(start => start.test(source))).toBe(true);
    }
  });
});
