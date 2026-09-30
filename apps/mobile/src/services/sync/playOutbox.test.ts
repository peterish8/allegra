import { nextPlayOutboxAction, parsePendingPlay } from './playOutbox';

describe('offline play reporting', () => {
  it('retries the taste signal after Recently played has already accepted the event', () => {
    const pending = parsePendingPlay(JSON.stringify({
      songId: 'song-1', seconds: 24, playedAt: '2026-09-30T10:00:00.000Z', recentPosted: true,
    }));

    expect(pending).not.toBeNull();
    expect(pending && nextPlayOutboxAction(pending)).toBe('taste');
  });

  it('sends Recently played first for events still waiting in the outbox', () => {
    const pending = parsePendingPlay(JSON.stringify({ songId: 'song-1', seconds: 24, playedAt: '2026-09-30T10:00:00.000Z' }));

    expect(pending && nextPlayOutboxAction(pending)).toBe('recent');
  });

  it('supports history-only events before a listen is finished', () => {
    const pending = parsePendingPlay(JSON.stringify({
      songRef: 'saavn:track-5',
      song: { ref: 'saavn:track-5', title: 'A song', artist: 'An artist', artwork: '', duration: 180 },
      seconds: 0,
      playedAt: '2026-09-30T10:00:00.000Z',
      recentOnly: true,
    }));

    expect(pending?.recentOnly).toBe(true);
    expect(pending && nextPlayOutboxAction(pending)).toBe('recent');
  });

  it('keeps Gaana identity and snapshot without inventing a Saavn song id', () => {
    const pending = parsePendingPlay(JSON.stringify({
      songRef: 'gaana:track-4',
      song: { ref: 'gaana:track-4', title: 'A song', artist: 'An artist', artwork: '', duration: 180 },
      seconds: 24,
      playedAt: '2026-09-30T10:00:00.000Z',
    }));

    expect(pending?.songRef).toBe('gaana:track-4');
    expect(pending?.songId).toBeUndefined();
    expect(pending?.song?.title).toBe('A song');
  });
});
