import {
  copiesToUnlink, findPhoneCopy, hasLocalAudio, offlineLabel, offlineState, planOfflinePlaylist, reuseBeforeDownload,
  withoutCopies, type PhoneCopy, type StreamingEntry,
} from './offlinePlaylistPlan';

const file = (id: string, title: string, artist: string, extra: Partial<PhoneCopy> = {}): PhoneCopy =>
  ({ id, title, artist, audioUri: `file:///songs/${id}/audio.m4a`, ...extra });
const stream = (ref: string, title: string, artist: string, order = 0): StreamingEntry => ({ ref, title, artist, order });

describe('offline playlists: what counts as on the phone', () => {
  it('counts files and content addresses, not streams or nothing', () => {
    expect(hasLocalAudio({ audioUri: 'file:///a.m4a' })).toBe(true);
    expect(hasLocalAudio({ audioUri: 'content://media/1' })).toBe(true);
    expect(hasLocalAudio({ audioUri: 'https://cdn/a.mp4' })).toBe(false);
    expect(hasLocalAudio({})).toBe(false);
  });

  it('finds the same catalog song first, then the same title and lead artist', () => {
    const phone = [file('a', 'Sleep', 'Mira Vale'), file('b', 'Other', 'X', { originId: 'saavn:42' })];
    expect(findPhoneCopy({ ref: 'saavn:42', title: 'Renamed', artist: 'Y' }, phone)?.id).toBe('b');
    expect(findPhoneCopy({ title: 'Sleep (Remastered)', artist: 'Mira Vale' }, phone)?.id).toBe('a');
    expect(findPhoneCopy({ title: 'Nope', artist: 'Mira Vale' }, phone)).toBeUndefined();
  });

  it('never reuses a hidden song or a copy with no audio file', () => {
    const phone = [file('a', 'Sleep', 'Mira Vale', { isHidden: true }), { id: 'b', title: 'Sleep', artist: 'Mira Vale' }];
    expect(findPhoneCopy({ title: 'Sleep', artist: 'Mira Vale' }, phone)).toBeUndefined();
  });
});

describe('planning a playlist download', () => {
  it('links songs the phone already has and downloads only the rest', () => {
    const phone = [file('lib1', 'Low Tide', 'Harbor Kids')];
    const plan = planOfflinePlaylist([], [stream('s:1', 'Low Tide', 'Harbor Kids', 0), stream('s:2', 'Static', 'Orla North', 1)], phone);
    expect(plan.link).toEqual([{ songId: 'lib1', order: 0 }]);
    expect(plan.download.map(e => e.ref)).toEqual(['s:2']);
    expect(plan.total).toBe(2);
  });

  it('does nothing for a streaming entry the playlist already holds a copy of, and counts it once', () => {
    const inPlaylist = [file('copy', 'Low Tide', 'Harbor Kids', { originId: 's:1' })];
    const plan = planOfflinePlaylist(inPlaylist, [stream('s:1', 'Low Tide', 'Harbor Kids')], inPlaylist);
    expect(plan).toEqual({ link: [], download: [], ready: 1, total: 1 });
  });

  it('downloads a song listed twice only once', () => {
    const plan = planOfflinePlaylist([], [stream('s:1', 'Fade', 'Neon Choir', 0), stream('s:9', 'Fade', 'Neon Choir', 3)], []);
    expect(plan.download).toHaveLength(1);
    expect(plan.total).toBe(1);
  });

  it('is idempotent: a second run after the downloads landed has nothing left to do', () => {
    const entries = [stream('s:1', 'A', 'X', 0), stream('s:2', 'B', 'Y', 1)];
    const landed = [file('d1', 'A', 'X', { originId: 's:1', playlistOnly: true }), file('d2', 'B', 'Y', { originId: 's:2', playlistOnly: true })];
    expect(planOfflinePlaylist(landed, entries, landed)).toEqual({ link: [], download: [], ready: 2, total: 2 });
  });

  it('keeps an empty playlist empty', () => {
    expect(planOfflinePlaylist([], [], [])).toEqual({ link: [], download: [], ready: 0, total: 0 });
  });
});

describe('a download that is already on the phone', () => {
  const phone = [file('p', 'Night Drive', 'The Overpass', { playlistOnly: true, originId: 'saavn:7' })];

  it('saving a playlist-only song yourself moves it into the Library instead of downloading again', () => {
    expect(reuseBeforeDownload({ ref: 'saavn:7', title: 'Night Drive', artist: 'The Overpass', playlistOnly: false }, phone))
      .toEqual({ copy: phone[0], promote: true });
  });

  it('another playlist reuses it and leaves it playlist-only', () => {
    expect(reuseBeforeDownload({ ref: 'saavn:7', title: 'Night Drive', artist: 'The Overpass', playlistOnly: true }, phone))
      .toEqual({ copy: phone[0], promote: false });
  });

  it('a song that is not on the phone downloads', () => {
    expect(reuseBeforeDownload({ title: 'New', artist: 'Someone', playlistOnly: false }, phone)).toBeNull();
  });
});

describe('listing and removing', () => {
  it('lists a song once, as its phone copy, never also as its stream', () => {
    const inPlaylist = [file('c', 'Golden Hour Again', 'Sunny Arcade', { originId: 's:3' })];
    const rows = [stream('s:3', 'Golden Hour Again', 'Sunny Arcade'), stream('s:4', 'Small Hours', 'Mira Vale')];
    expect(withoutCopies(inPlaylist, rows).map(r => r.ref)).toEqual(['s:4']);
  });

  it('removing a download unlinks only playlist-only copies the playlist can stream again', () => {
    const inPlaylist = [
      file('mine', 'A', 'X', { originId: 's:1' }),
      file('po', 'B', 'Y', { originId: 's:2', playlistOnly: true }),
      file('orphanedEntry', 'C', 'Z', { playlistOnly: true }),
    ];
    const rows = [stream('s:1', 'A', 'X'), stream('s:2', 'B', 'Y')];
    expect(copiesToUnlink(inPlaylist, rows).map(s => s.id)).toEqual(['po']);
  });
});

describe('the playlist page control', () => {
  it('reads Download until the listener downloads it', () => {
    expect(offlineLabel(offlineState(false, 3, 10, 0))).toBe('Download');
  });

  it('shows progress while songs are queued, then Downloaded', () => {
    expect(offlineLabel(offlineState(true, 3, 10, 7))).toBe('Downloading 3 of 10');
    expect(offlineLabel(offlineState(true, 10, 10, 0))).toBe('Downloaded');
  });

  it('says how much is offline when some songs could not be found', () => {
    expect(offlineLabel(offlineState(true, 8, 10, 0))).toBe('8 of 10 offline');
  });
});
