import { playbackStatus, playbackErrorMessage, type PlaybackSnapshot } from './playbackStatus';
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
