import * as fs from 'fs';
import * as path from 'path';

/**
 * Guards for native fixes whose failure only shows on a phone (1.41.2). Each test names the owner report it keeps
 * from coming back. The pure rules behind them are unit-tested on the JVM (IslandRecoveryTest, ResumeOnlineTest), and
 * this file makes sure the Android code still calls them.
 */
const java = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'lyricflow', 'app');
const read = (...parts: string[]): string =>
  fs.readFileSync(path.join(java, ...parts), 'utf8')
    // Comments may mention anything; only code counts.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('island comes back after the phone restarts', () => {
  const service = read('island', 'IslandService.kt');
  const window = read('island', 'IslandWindow.kt');

  it('the service listens for the unlock itself, not only through a window that may not exist yet', () => {
    expect(service).toMatch(/addAction\(Intent\.ACTION_USER_PRESENT\)/);
    expect(service).toMatch(/addAction\(Intent\.ACTION_SCREEN_ON\)/);
    expect(service).toMatch(/addAction\(Intent\.ACTION_USER_UNLOCKED\)/);
    expect(service).toMatch(/override fun onServiceConnected\(\)[\s\S]*?watchScreen\(\)[\s\S]*?refreshNow\(\)/);
  });

  it('a refused or failed window is tried again with backoff instead of staying off', () => {
    expect(service).toMatch(/IslandRecovery\.needsRetry\(wanted, window\?\.isAdded == true\)/);
    expect(service).toMatch(/IslandRecovery\.retryDelayMs\(retryAttempt\)/);
    expect(service).toMatch(/retryHandler\.postDelayed\(retry, delay\)/);
    // tearDown stops retrying and listening.
    expect(service).toMatch(/private fun tearDown\(\)[\s\S]*?removeCallbacks\(retry\)[\s\S]*?unwatchScreen\(\)/);
  });

  it('the window reads the lock again after it is built and on every refresh from the app', () => {
    expect(window).toMatch(/applyVisibility\(\)\s*\n\s*settleLockAfterBuild\(\)\s*\n\s*\}/);
    expect(window).toMatch(/IslandRecovery\.LOCK_RECHECK_MS/);
    expect(window).toMatch(/if \(resized\) measure\(\)\s*\n\s*refreshLock\(\)\s*\n\s*applyVisibility\(\)/);
    expect(window).toMatch(/removeCallbacks\(settleLock\)/);
  });

  // 1.44.0 (owner: still gone after a restart on their sister's phone, on 1.41.2+). Switching the island off and on in
  // the app fixed it because it builds a new window; the service now does that by itself.
  it('a service started by a restart rebuilds its window on the boot timer, never while the island is in hand', () => {
    expect(service).toMatch(/IslandRecovery\.connectedAtBoot\(sinceBoot\)/);
    expect(service).toMatch(/retryHandler\.postDelayed\(bootRebuild, IslandRecovery\.BOOT_REBUILD_MS\[0\]\)/);
    expect(service).toMatch(/IslandRecovery\.onBootRebuild\(wanted = isWanted\(\), windowAdded = w\?\.isAdded == true, inUse = w\?\.isInUse == true\)/);
    expect(service).toMatch(/private fun tearDown\(\)[\s\S]*?removeCallbacks\(bootRebuild\)/);
  });

  it('the first unlock or screen-on rebuilds, and a window Android dropped is rebuilt on any later one', () => {
    expect(service).toMatch(/IslandRecovery\.onScreenEvent\(\s*wanted = isWanted\(\),\s*windowAdded = w\?\.isAdded == true,\s*windowHealthy = w\?\.isHealthy == true,\s*inUse = w\?\.isInUse == true,\s*firstSinceConnect = !screenEventSeen,\s*\)/);
    expect(service).toMatch(/if \(IslandRecovery\.consumesFirstEvent\(action\)\) screenEventSeen = true/);
    // Every connect starts over: the next screen event rebuilds again.
    expect(service).toMatch(/override fun onServiceConnected\(\)[\s\S]*?screenEventSeen = false/);
    // A rebuild is exactly the app's off-and-on: the old window goes, a new one is built.
    expect(service).toMatch(/private fun rebuild\(\)[\s\S]*?window\?\.destroy\(\)[\s\S]*?window = null[\s\S]*?refreshNow\(\)/);
  });

  it('the window knows when Android dropped it, and every recheck measures the screen again', () => {
    expect(window).toMatch(/val isHealthy get\(\) = added && view\?\.isAttachedToWindow == true && view\?\.windowToken != null && geometry != null/);
    expect(window).toMatch(/val isInUse get\(\) = expandedTouch \|\| searchAdded \|\| launch != null/);
    expect(window).toMatch(/fun recheck\(\) \{[\s\S]*?measure\(\)\s*\n\s*refreshLock\(\)\s*\n\s*applyVisibility\(\)/);
    // The settle steps after a build use the full recheck, not only the lock.
    expect(window).toMatch(/override fun run\(\) \{\s*\n\s*recheck\(\)/);
  });
});

describe('music comes back after the connection drops', () => {
  const service = read('services', 'PlaybackService.kt');

  it('a network give-up arms the resume, and the returning network plays on', () => {
    expect(service).toMatch(/exoPlayer\.playWhenReady = false\s*\n\s*if \(network\) armResumeOnline\(\)/);
    expect(service).toMatch(/registerDefaultNetworkCallback\(callback\)/);
    expect(service).toMatch(/ResumeOnline\.shouldResume\(armedAt, now, exoPlayer\.playWhenReady, exoPlayer\.currentMediaItem != null\)/);
  });

  it('the listener pressing play, a new song or the service ending cancels it', () => {
    expect(service).toMatch(/if \(playWhenReady\) disarmResumeOnline\(\)/);
    expect(service).toMatch(/override fun onMediaItemTransition[\s\S]*?disarmResumeOnline\(\)/);
    expect(service).toMatch(/override fun onDestroy\(\)[\s\S]*?disarmResumeOnline\(\)/);
    expect(service).toMatch(/unregisterNetworkCallback\(callback\)/);
  });

  it('keeps the existing safeguards: noisy pause, audio focus, wake locks', () => {
    expect(service).toMatch(/setHandleAudioBecomingNoisy\(true\)/);
    // setAudioAttributes(attributes, handleAudioFocus = true): pause for calls, duck for navigation prompts.
    expect(service).toMatch(/\.setAudioAttributes\([\s\S]*?\.build\(\),\s*true\s*\)/);
    expect(service).toMatch(/setWakeMode\(C\.WAKE_MODE_NETWORK\)/);
    expect(service).toMatch(/addSession\(session\)/);
  });
});

describe('playback starts with the app closed (widget, island)', () => {
  const module = read('modules', 'MainPlayerModule.kt');

  it('never calls a bare startService that Android refuses in the background', () => {
    expect(module).toMatch(/private fun awaitEngine\(\)[\s\S]*?startPlaybackService\(context\)/);
    expect(module).toMatch(/try \{\s*\n\s*context\.startService\(intent\)\s*\n\s*return\s*\n\s*\} catch \(e: IllegalStateException\)/);
    expect(module).toMatch(/context\.bindService\(intent, connection, Context\.BIND_AUTO_CREATE\)/);
    expect(module).toMatch(/context\.unbindService\(held\)/);
    // Exactly one place starts the service, and it is the guarded one.
    expect(module.match(/context\.startService\(/g)).toHaveLength(1);
  });
});
