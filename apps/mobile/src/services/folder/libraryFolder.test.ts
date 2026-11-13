import type { LyricLine } from '../../types/song';
import { safeName, songBase, uniqueBases, playlistFolderName } from './folderNames';
import { buildPlaylistsFile, buildSidecar, lyricsToLrc, parsePlaylistsFile, parseSidecar } from './folderSidecar';
import { restoreLibraryFromFolder, saveLibraryToFolder, type FolderEntry, type FolderPort, type FolderSong } from './libraryFolder';
import { restoredNotice, savedNotice } from './folderMessages';

/** A folder in memory: files by "path/name", with the text or source they were written from. */
function fakeFolder(): { port: FolderPort; files: Map<string, { text?: string; source?: string }>; failOn: Set<string> } {
  const files = new Map<string, { text?: string; source?: string }>();
  const failOn = new Set<string>();
  const key = (path: string[], name: string): string => [...path, name].join('/');
  const port: FolderPort = {
    list: async path => {
      const prefix = path.length > 0 ? `${path.join('/')}/` : '';
      const out: FolderEntry[] = [];
      const dirs = new Set<string>();
      for (const k of files.keys()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        if (rest.includes('/')) dirs.add(rest.split('/')[0]!);
        else out.push({ name: rest, uri: `mem://${k}`, isDirectory: false });
      }
      for (const dir of dirs) out.push({ name: dir, uri: `mem://${prefix}${dir}`, isDirectory: true });
      return out;
    },
    readText: async uri => {
      const file = files.get(uri.replace('mem://', ''));
      if (file?.text === undefined) throw new Error('not text');
      return file.text;
    },
    write: async (path, name, _mime, source) => {
      if (failOn.has(name)) throw new Error(`cannot write ${name}`);
      files.set(key(path, name), 'uri' in source ? { source: source.uri } : { text: source.text });
      return `mem://${key(path, name)}`;
    },
  };
  return { port, files, failOn };
}

const lines = (items: [number, string][]): LyricLine[] => items.map(([timestamp, text], lineOrder) => ({ timestamp, text, lineOrder }));

const song = (id: string, title: string, artist: string, extra: Partial<FolderSong> = {}): FolderSong => ({
  id,
  title,
  artist,
  album: undefined,
  duration: 200,
  originId: undefined,
  coverRemoteUri: undefined,
  coverImageUri: undefined,
  audioUri: `file:///data/music/${id}/audio.mp3`,
  lyrics: [],
  ...extra,
});

// The same reading of LRC the app uses, kept simple here: "[mm:ss.xx]text".
const parseLrc = (lrc: string): LyricLine[] =>
  lrc.split('\n').map((raw, lineOrder) => {
    const m = raw.match(/^\[(\d+):(\d+)\.(\d+)\](.*)$/)!;
    return { timestamp: Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 100, text: m[4]!, lineOrder };
  });

describe('folder names', () => {
  it('drops what file systems refuse and never returns an empty or edge-dotted name', () => {
    expect(safeName('AC/DC: Back In Black?')).toBe('AC DC Back In Black');
    expect(safeName('  ..hidden.. ')).toBe('hidden');
    expect(safeName('???')).toBe('Untitled');
    expect(safeName(null, 'Playlist')).toBe('Playlist');
  });

  it('names a song "Artist - Title", or just the title with no artist', () => {
    expect(songBase('Tum Hi Ho', 'Arijit Singh')).toBe('Arijit Singh - Tum Hi Ho');
    expect(songBase('Tum Hi Ho', '')).toBe('Tum Hi Ho');
    expect(songBase('Tum Hi Ho')).toBe('Tum Hi Ho');
  });

  it('keeps two different songs with one name apart', () => {
    const bases = uniqueBases([
      { id: 'song_aaa111', title: 'Intro', artist: 'X' },
      { id: 'song_bbb222', title: 'intro', artist: 'x' },
    ]);
    expect(bases.get('song_aaa111')).toBe('X - Intro');
    expect(bases.get('song_bbb222')).toBe('x - intro (bbb222)');
  });

  it('names a playlist folder safely', () => {
    expect(playlistFolderName('Road trip / 2026')).toBe('Road trip 2026');
    expect(playlistFolderName('')).toBe('Playlist');
  });
});

describe('sidecar files', () => {
  it('round-trips a song and ignores damaged or foreign files', () => {
    const text = buildSidecar({ id: 's1', title: 'Song', artist: 'Band', duration: 180, lyrics: '[00:01.00]Hi' }, 'Band - Song', true);
    expect(parseSidecar(text)).toMatchObject({ id: 's1', title: 'Song', artist: 'Band', file: 'Band - Song.mp3', cover: 'Band - Song.jpg', lyrics: '[00:01.00]Hi' });
    expect(parseSidecar('not json')).toBeNull();
    expect(parseSidecar('{"v":2,"id":"a","title":"b","file":"c"}')).toBeNull();
    expect(parseSidecar('{"v":1,"title":"b","file":"c"}')).toBeNull();
    expect(parseSidecar('[]')).toBeNull();
  });

  it('writes synced lines as LRC and nothing for none', () => {
    expect(lyricsToLrc(lines([[1.5, 'one'], [62, 'two']]))).toBe('[00:01.50]one\n[01:02.00]two');
    expect(lyricsToLrc([])).toBe('');
    expect(lyricsToLrc(undefined)).toBe('');
  });

  it('reads the playlists file leniently', () => {
    expect(parsePlaylistsFile(buildPlaylistsFile([{ name: 'Gym', songIds: ['a', 'b'] }]))).toEqual([{ name: 'Gym', songIds: ['a', 'b'] }]);
    expect(parsePlaylistsFile('{"playlists":[{"name":"x"},{"name":"ok","songIds":["a",1]}]}')).toEqual([{ name: 'ok', songIds: ['a'] }]);
    expect(parsePlaylistsFile('garbage')).toEqual([]);
  });
});

describe('saving the library to the folder', () => {
  it('writes each song into All songs with its cover and details, and each playlist into its own folder', async () => {
    const { port, files } = fakeFolder();
    const songs = [
      song('s1', 'Tum Hi Ho', 'Arijit Singh', { coverImageUri: 'file:///data/music/s1/cover.jpg', lyrics: lines([[1, 'line']]) }),
      song('s2', 'Kesariya', 'Arijit Singh'),
    ];
    const report = await saveLibraryToFolder(port, songs, [{ name: 'Gym', songIds: ['s2'] }]);

    expect(report).toEqual({ saved: 2, alreadyThere: 0, failed: 0, playlistCopies: 1 });
    expect(files.get('All songs/Arijit Singh - Tum Hi Ho.mp3')).toEqual({ source: 'file:///data/music/s1/audio.mp3' });
    expect(files.get('All songs/Arijit Singh - Tum Hi Ho.jpg')).toEqual({ source: 'file:///data/music/s1/cover.jpg' });
    expect(files.has('All songs/Arijit Singh - Kesariya.jpg')).toBe(false);
    expect(parseSidecar(files.get('All songs/Arijit Singh - Tum Hi Ho.json')!.text!)).toMatchObject({ id: 's1', lyrics: '[00:01.00]line', cover: 'Arijit Singh - Tum Hi Ho.jpg' });
    // A playlist copy comes from the file already in the folder, not the phone's own copy.
    expect(files.get('Playlists/Gym/Arijit Singh - Kesariya.mp3')).toEqual({ source: 'mem://All songs/Arijit Singh - Kesariya.mp3' });
    expect(parsePlaylistsFile(files.get('playlists.json')!.text!)).toEqual([{ name: 'Gym', songIds: ['s2'] }]);
  });

  it('adds only what is missing the second time and never deletes', async () => {
    const { port, files } = fakeFolder();
    const first = [song('s1', 'One', 'A')];
    await saveLibraryToFolder(port, first, []);
    files.set('All songs/Someone Else - Old.mp3', { source: 'x' });

    const report = await saveLibraryToFolder(port, [...first, song('s2', 'Two', 'A')], []);

    expect(report).toMatchObject({ saved: 1, alreadyThere: 1, failed: 0 });
    expect(files.has('All songs/Someone Else - Old.mp3')).toBe(true);
  });

  it('counts a song whose copy fails and still saves the others; a half-saved song is retried next time', async () => {
    const { port, files, failOn } = fakeFolder();
    failOn.add('A - Bad.json');
    const report = await saveLibraryToFolder(port, [song('s1', 'Bad', 'A'), song('s2', 'Good', 'A')], []);
    expect(report).toMatchObject({ saved: 1, failed: 1 });

    failOn.clear();
    const again = await saveLibraryToFolder(port, [song('s1', 'Bad', 'A'), song('s2', 'Good', 'A')], []);
    expect(again).toMatchObject({ saved: 1, alreadyThere: 1, failed: 0 });
    expect(files.has('All songs/A - Bad.json')).toBe(true);
  });

  it('skips songs with no audio on the phone and survives a missing cover', async () => {
    const { port, files, failOn } = fakeFolder();
    failOn.add('A - Covered.jpg');
    const report = await saveLibraryToFolder(
      port,
      [song('s1', 'Streamed', 'A', { audioUri: undefined }), song('s2', 'Covered', 'A', { coverImageUri: 'file:///c.jpg' })],
      [],
    );
    expect(report).toMatchObject({ saved: 1, failed: 0 });
    expect(files.has('All songs/A - Streamed.mp3')).toBe(false);
    expect(parseSidecar(files.get('All songs/A - Covered.json')!.text!)!.cover).toBeUndefined();
  });

  it('reports progress over songs and playlist copies', async () => {
    const { port } = fakeFolder();
    const seen: [number, number][] = [];
    await saveLibraryToFolder(port, [song('s1', 'One', 'A')], [{ name: 'P', songIds: ['s1'] }], (done, total) => seen.push([done, total]));
    expect(seen).toEqual([[1, 2], [2, 2]]);
  });
});

describe('restoring the library from the folder', () => {
  it('brings back every saved song with its audio, cover, lyrics and playlists, as after a reinstall', async () => {
    const { port } = fakeFolder();
    await saveLibraryToFolder(
      port,
      [
        song('s1', 'Tum Hi Ho', 'Arijit Singh', { coverImageUri: 'file:///c.jpg', lyrics: lines([[1, 'hello']]), originId: 'saavn:1', coverRemoteUri: 'https://x/c.jpg' }),
        song('s2', 'Kesariya', 'Arijit Singh'),
      ],
      [{ name: 'Gym', songIds: ['s1', 's2'] }],
    );

    const restored = await restoreLibraryFromFolder(port, new Set(), parseLrc, '2026-11-13T00:00:00.000Z');

    expect(restored.songs.map(s => s.id).sort()).toEqual(['s1', 's2']);
    const first = restored.songs.find(s => s.id === 's1')!;
    expect(first).toMatchObject({
      title: 'Tum Hi Ho',
      artist: 'Arijit Singh',
      audioUri: 'mem://All songs/Arijit Singh - Tum Hi Ho.mp3',
      coverImageUri: 'mem://All songs/Arijit Singh - Tum Hi Ho.jpg',
      originId: 'saavn:1',
      coverRemoteUri: 'https://x/c.jpg',
      dateCreated: '2026-11-13T00:00:00.000Z',
    });
    expect(first.lyrics).toEqual([{ timestamp: 1, text: 'hello', lineOrder: 0 }]);
    expect(restored.songs.find(s => s.id === 's2')!.coverImageUri).toBeUndefined();
    expect(restored.playlists).toEqual([{ name: 'Gym', songIds: ['s1', 's2'] }]);
  });

  it('leaves songs the library already has, and keeps their playlist membership', async () => {
    const { port } = fakeFolder();
    await saveLibraryToFolder(port, [song('s1', 'One', 'A'), song('s2', 'Two', 'A')], [{ name: 'Mix', songIds: ['s1', 's2'] }]);

    const restored = await restoreLibraryFromFolder(port, new Set(['s1']), parseLrc);

    expect(restored.songs.map(s => s.id)).toEqual(['s2']);
    expect(restored.playlists).toEqual([{ name: 'Mix', songIds: ['s1', 's2'] }]);
  });

  it('skips a song whose audio file is gone, a damaged details file, and playlist ids with no song', async () => {
    const { port, files } = fakeFolder();
    await saveLibraryToFolder(port, [song('s1', 'One', 'A'), song('s2', 'Two', 'A')], [{ name: 'Mix', songIds: ['s1', 's2'] }]);
    files.delete('All songs/A - One.mp3');
    files.set('All songs/broken.json', { text: '{oops' });

    const restored = await restoreLibraryFromFolder(port, new Set(), parseLrc);

    expect(restored.songs.map(s => s.id)).toEqual(['s2']);
    expect(restored.playlists).toEqual([{ name: 'Mix', songIds: ['s2'] }]);
  });

  it('restores nothing from an empty folder', async () => {
    const { port } = fakeFolder();
    expect(await restoreLibraryFromFolder(port, new Set(), parseLrc)).toEqual({ songs: [], playlists: [] });
  });
});

describe('settings messages', () => {
  it('says what came back in plain words', () => {
    expect(restoredNotice(0, 0)).toBe('Folder chosen. New downloads are copied there.');
    expect(restoredNotice(1, 0)).toBe('Folder chosen. Brought back 1 song.');
    expect(restoredNotice(12, 2)).toBe('Folder chosen. Brought back 12 songs and 2 playlists.');
    expect(savedNotice(0, 0)).toBe('Everything is already in the folder.');
    expect(savedNotice(3, 0)).toBe('Copied 3 songs to the folder.');
    expect(savedNotice(3, 1)).toBe('Copied 3. 1 could not be copied, try again.');
  });
});
