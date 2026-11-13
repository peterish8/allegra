import * as fs from 'fs';
import * as path from 'path';

/**
 * Guards for native fixes whose failure only shows on a phone (1.41.2). Each test names the owner report it keeps
 * from coming back. The pure rules behind them are unit-tested on the JVM (ResumeOnlineTest), and
 * this file makes sure the Android code still calls them.
 */
const java = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'lyricflow', 'app');
const read = (...parts: string[]): string =>
  fs.readFileSync(path.join(java, ...parts), 'utf8')
    // Comments may mention anything; only code counts.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('music comes back after the connection drops', () => {
  const service = read('services', 'PlaybackService.kt');

  it('a network give-up arms the resume, and the returning network plays on', () => {
    expect(service).toMatch(/exoPlayer\.playWhenReady = false\s*\n\s*if \(network\) armResumeOnline\(\)/);
    expect(service).toMatch(/registerDefaultNetworkCallback\(callback\)/);
    expect(service).toMatch(/ResumeOnline\.shouldResume\(armedAt, now, exoPlayer\.playWhenReady, exoPlayer\.currentMediaItem != null, resumeSawLoss, usable\)/);
  });

  // 2026-11-11: Android reports the network already up when the watch starts, so a stream that failed while the
  // phone stayed online resumed at once. Only a real loss and then a validated network resume it.
  it('resumes only after a real loss and a usable network, not the network already up', () => {
    expect(service).toMatch(/resumeSawLoss = connectivity\.activeNetwork == null/);
    expect(service).toMatch(/override fun onLost\(network: Network\)[\s\S]*?resumeSawLoss = true/);
    expect(service).toMatch(/NET_CAPABILITY_VALIDATED/);
    expect(service).not.toMatch(/override fun onAvailable/);
    expect(service).toMatch(/private fun disarmResumeOnline\(\) \{\s*resumeArmedAt = null\s*resumeSawLoss = false/);
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

describe('playback starts with the app closed (widget)', () => {
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
