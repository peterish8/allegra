// nativeQueue.ts reaches for the native module; only its pure rule is used here.
jest.mock('../services/NativeAudioPlayer', () => ({ NativeAudioPlayer: { hasQueue: () => true } }));

import { previousWillRestart } from './nativeQueue';
import { playbackStatus, playbackErrorMessage, playheadIsMoving, type PlaybackSnapshot } from './playbackStatus';
import { extrapolatePosition } from './positionPrediction';
const ready: PlaybackSnapshot = { hasSong: true, playWhenReady: true, audible: true, buffering: false, error: null };
describe('transport feedback', () => {
  it('never shows a spinner without a loaded song', () => expect(playbackStatus({ ...ready, hasSong: false, buffering: true })).toBe('idle'));
  it('shows loading until playback becomes audible', () => {
    expect(playbackStatus({ ...ready, audible: false })).toBe('loading');
    expect(playbackStatus({ ...ready, buffering: true })).toBe('loading');
    expect(playbackStatus(ready)).toBe('playing');
  });
  it('lets a pause during buffering leave the loading state', () => expect(playbackStatus({ ...ready, playWhenReady: false, audible: false, buffering: true })).toBe('paused'));
  it('keeps retry visible after failure even when play intent remains set', () => expect(playbackStatus({ ...ready, error: 'expired' })).toBe('error'));
  it('explains an expired link and provides a safe message for unknown errors', () => {
    expect(playbackErrorMessage('expired')).toContain('fresh link');
    expect(playbackErrorMessage('unknown')).toContain('Try again');
  });
});

describe('whether the playhead is moving', () => {
  const player = { currentSongId: 'b', isPlaying: true, playbackSongId: 'b', audible: true, buffering: false, playbackError: null };

  it('is moving only while audio comes out', () => {
    expect(playheadIsMoving(player)).toBe(true);
    expect(playheadIsMoving({ ...player, isPlaying: false })).toBe(false);
  });

  // Skip into a stream: the transport already says playing (playWhenReady) while the song buffers at 0:00.
  it('is not moving while the song buffers or has not started, though the transport says playing', () => {
    expect(playheadIsMoving({ ...player, buffering: true })).toBe(false);
    expect(playheadIsMoving({ ...player, audible: false })).toBe(false);
  });

  it('is not moving on a report about the song before the skip', () => {
    expect(playheadIsMoving({ ...player, playbackSongId: 'a' })).toBe(false);
  });

  it('is not moving after a failure or with no song', () => {
    expect(playheadIsMoving({ ...player, playbackError: 'stall' })).toBe(false);
    expect(playheadIsMoving({ ...player, currentSongId: null })).toBe(false);
  });
});

// previous restarts a song past 3 s. A skip into a song that takes 4 s to start must not count those seconds, or the
// screen predicts a restart while the engine, at 0:00, goes back one song.
describe('the previous button while the song after a skip is still loading', () => {
  const loading = { currentSongId: 'b', isPlaying: true, playbackSongId: 'b', audible: false, buffering: true, playbackError: null };
  const reportedAtZero = 10_000;
  const fourSecondsLater = reportedAtZero + 4_000;

  it('does not read the wait as playing time', () => {
    const predicted = extrapolatePosition(0, reportedAtZero, fourSecondsLater, playheadIsMoving(loading));
    expect(predicted).toBe(0);
    expect(previousWillRestart(predicted, 1, 'off')).toBe(false);
  });

  it('still reads real playing time as past 3 s', () => {
    const playing = { ...loading, audible: true, buffering: false };
    const predicted = extrapolatePosition(0, reportedAtZero, fourSecondsLater, playheadIsMoving(playing));
    expect(predicted).toBeCloseTo(4);
    expect(previousWillRestart(predicted, 1, 'off')).toBe(true);
  });
});
