/**
 * Listening stats (1.45.0) is wired end to end: every listen is logged (signed in or not), the page is reachable
 * from the profile menu as on Spotify, tempo is measured natively, and the listener can pause and clear it.
 * These read the source, like the other guards, so a later change that drops a link fails here.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PROFILE_GROUPS } from '../../navigation/profileMenu';

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('listening stats wiring', () => {
  it('logs every listen as it ends, signed in or not, unless paused', () => {
    const connect = read('src/services/connect/ConnectProvider.tsx');
    // In the onLeft callback, which runs before (and regardless of) the signed-in check of onHeard.
    expect(connect).toMatch(/\(song, ending, startedAt\) => \{[\s\S]*?logListen\(song, ending, startedAt\);/);
    expect(read('src/services/sync/listenTracker.ts')).toMatch(/onLeft\(song, result, startedAt\);/);
    expect(read('src/services/stats/listenLog.ts')).toMatch(/if \(!useSettingsStore\.getState\(\)\.listeningStats\) return;/);
    const db = read('src/database/db.ts');
    expect(db).toMatch(/CREATE TABLE IF NOT EXISTS listen_log/);
    expect(db).toMatch(/CREATE INDEX IF NOT EXISTS idx_listen_log_started ON listen_log\(started_at\)/);
    expect(db).toMatch(/CREATE TABLE IF NOT EXISTS song_tempo/);
  });

  it('opens from the profile menu, first under Listening, like Spotify', () => {
    const listening = PROFILE_GROUPS.find(g => g.label === 'Listening')!;
    expect(listening.items[0]).toMatchObject({ id: 'stats', title: 'Listening stats' });
    expect(read('src/components/V6TabBar.tsx')).toMatch(/if \(action === 'stats'\) navigation\.navigate\('ListeningStats'\);/);
    expect(read('src/navigation/TabNavigator.tsx')).toMatch(/<Tab\.Screen name="ListeningStats" component=\{ListeningStatsScreen\}/);
  });

  it('measures tempo on the phone through a registered native module, tested on the JVM', () => {
    expect(read('android/app/src/main/java/expo/modules/ExpoModulesPackageList.kt')).toContain('com.lyricflow.app.modules.TempoModule::class.java');
    expect(read('android/app/src/main/java/com/lyricflow/app/modules/TempoModule.kt')).toMatch(/TempoMath\.estimate\(/);
    expect(fs.existsSync(path.join(ROOT, 'android/app/src/test/java/com/lyricflow/app/stats/TempoMathTest.kt'))).toBe(true);
  });

  it('shows everything the owner asked for, and lets the listener pause and clear it', () => {
    const screen = read('src/screens/ListeningStatsScreen.tsx');
    for (const part of ['<Hero ', '<TopArtists ', '<TopSongs ', '<OnRepeat ', '<ListeningClock ', '<TempoCard ', '<WeekBars ', '<DailyBars ', '<Habits ']) {
      expect(screen).toContain(part);
    }
    expect(screen).toMatch(/<Switch label="Keep counting"/);
    expect(screen).toMatch(/<ConfirmSheet visible=\{confirmClear\} title="Clear listening stats\?"/);
    expect(screen).toMatch(/STATS_RANGES\.map/);
    // Rules: no sparkle icons, no typed colours in the screen.
    expect(read('src/components/stats/StatsParts.tsx')).not.toMatch(/sparkle/);
    expect(screen).not.toMatch(/#[0-9a-f]{6}/i);
  });
});
