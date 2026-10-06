import { createAndroidPerformanceInstrumentation } from './performanceTrace';

describe('Android performance instrumentation', () => {
  it('separates lookup duration from attempt elapsed time', () => {
    let now = 100;
    const instrumentation = createAndroidPerformanceInstrumentation(true, () => now);
    const attempt = instrumentation.beginSearchAttempt('online', 7);

    now = 112;
    instrumentation.record(attempt, 'query.changed');
    now = 140;
    instrumentation.record(attempt, 'catalog.completed', { resultCount: 3, durationMs: 18 });
    now = 145;
    instrumentation.record(attempt, 'artists.completed', { resultCount: 2, durationMs: 31 });

    const records = instrumentation.trace.exportRecords();
    expect(records.filter(record => record.event === 'catalog.completed')[0]).toMatchObject({
      scenario: 'online',
      generation: 7,
      elapsedMs: 40,
      durationMs: 18,
      resultCount: 3,
    });
    expect(records.filter(record => record.event === 'artists.completed')[0]).toMatchObject({
      durationMs: 31,
      resultCount: 2,
    });
    instrumentation.dispose();
  });

  it('only observes playback after matching native status advances while actually playing', () => {
    let now = 0;
    const instrumentation = createAndroidPerformanceInstrumentation(true, () => now);
    const attempt = instrumentation.beginSearchAttempt('online', 4);
    expect(instrumentation.selectPlayback('online', attempt, 'stream:private-track-id')).toBe(true);
    instrumentation.playbackCommanded(attempt);

    const observe = (status: Parameters<typeof instrumentation.observeNativePlayback>[0], songId: string | null) => {
      now += 10;
      return instrumentation.observeNativePlayback(status, songId);
    };
    expect(observe({ position: 10, isPlaying: false, playWhenReady: true, isBuffering: false, suppressed: false }, 'stream:private-track-id')).toBe(false);
    expect(observe({ position: 10, isPlaying: true, playWhenReady: true, isBuffering: true, suppressed: false }, 'stream:private-track-id')).toBe(false);
    expect(observe({ position: 10, isPlaying: true, playWhenReady: true, isBuffering: false, suppressed: true }, 'stream:private-track-id')).toBe(false);
    expect(observe({ position: 10, isPlaying: true, playWhenReady: true, isBuffering: false, suppressed: false }, 'other-track')).toBe(false);
    expect(observe({ position: 10, isPlaying: true, playWhenReady: true, isBuffering: false, suppressed: false }, 'stream:private-track-id')).toBe(false);
    expect(observe({ position: 10.25, isPlaying: true, playWhenReady: true, isBuffering: false, suppressed: false }, 'stream:private-track-id')).toBe(true);

    const records = instrumentation.trace.exportRecords();
    expect(records.map(record => record.event)).toContain('playback.observed');
    expect(records.at(-1)).toMatchObject({ event: 'attempt.finished', outcome: 'success' });
    expect(JSON.stringify(records)).not.toContain('private-track-id');
    instrumentation.dispose();
  });

  it('keeps the disabled trace clock-free and empty', () => {
    const now = jest.fn(() => 1);
    const instrumentation = createAndroidPerformanceInstrumentation(false, now);

    expect(instrumentation.beginSearchAttempt('local', 1)).toBeNull();
    expect(instrumentation.trace.exportRecords()).toEqual([]);
    expect(now).not.toHaveBeenCalled();
    instrumentation.dispose();
  });

  it('dumps only allowlisted records on explicit request and clears live attempts', () => {
    const log = jest.spyOn(console, 'info').mockImplementation(() => {});
    const instrumentation = createAndroidPerformanceInstrumentation(true, () => 1);
    const attempt = instrumentation.beginSearchAttempt('local', 2);
    instrumentation.record(attempt, 'query.changed');
    instrumentation.selectPlayback('local', attempt, 'private-local-song-id');

    expect(instrumentation.dumpSnapshotToLog()).toBe(2);
    const dumped = log.mock.calls.map(([line]) => String(line)).join('\n');
    expect(dumped).toContain('[ALLEGRA_PERF_TRACE_BEGIN]2');
    expect(dumped).toContain('[ALLEGRA_PERF_TRACE_END]');
    expect(dumped).not.toContain('private-local-song-id');

    instrumentation.clearSnapshot();
    expect(instrumentation.trace.exportRecords()).toEqual([]);
    expect(instrumentation.trace.getActiveAttempt('android.search.local')).toBeNull();
    expect(instrumentation.trace.getActiveAttempt('android.search.online')).toBeNull();
    log.mockRestore();
    instrumentation.dispose();
  });
});
