import type { LyricLine } from '../../types/song';
import { legacyBase, nameCandidates, playlistFolderName, safeName, songBase } from './folderNames';
import { buildPlaylistsFile, buildSidecar, lyricsToLrc, parsePlaylistsFile, parseSidecar } from './folderSidecar';
import {
  restoreLibraryFromFolder,
  saveLibraryToFolder,
  type FolderEntry,
  type FolderPort,
  type FolderSong,
  type FolderSongInput,
} from './libraryFolder';
import { restoredNotice, savedNotice } from './folderMessages';

const ALL = 'All songs';

interface Stored {
  text?: string;
  source?: string;
}

/**
 * A folder in memory. `exportSong` does what the native side does (SafLibrary.exportSong): the song's name, "Name (2)"
 * for another song that has it, the .m4a name for an m4a source, a cover beside it and the details file last.
 */
function fakeFolder(): {
  port: FolderPort;
  files: Map<string, Stored>;
  failOn: Set<string>;
  exported: FolderSongInput[];
} {
  const files = new Map<string, Stored>();
  const failOn = new Set<string>();
  const exported: FolderSongInput[] = [];
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
    rename: async (path, from, to) => {
      const source = key(path, from);
      const target = key(path, to);
      const file = files.get(source);
      if (!file || files.has(target) || failOn.has(`rename:${from}`)) return false;
      files.delete(source);
      files.set(target, file);
      return true;
    },
    exportSong: async input => {
      if (failOn.has(`song:${input.id}`)) throw new Error('cannot export');
      exported.push(input);
      let base = input.base;
      for (let n = 2; files.has(key([ALL], `${base}.json`)); n += 1) {
        const text = files.get(key([ALL], `${base}.json`))!.text!;
        if (parseSidecar(text)?.id === input.id) break;
        base = `${input.base} (${n})`;
      }
      const audioName = input.audioUri.endsWith('.m4a') ? `${base}.m4a` : `${base}.mp3`;
      files.set(key([ALL], audioName), { source: input.audioUri });
      const coverName = input.coverUri ? `${base}.jpg` : null;
      if (input.coverUri && coverName) files.set(key([ALL], coverName), { source: input.coverUri });
      files.set(key([ALL], `${base}.json`), {
        text: buildSidecar(
          {
            id: input.id,
            title: input.title,
            artist: input.artist,
            album: input.album,
            duration: input.duration,
            originId: input.originId,
            coverRemoteUri: input.coverRemoteUri,
            lyrics: input.lyrics,
          },
          { audio: audioName, cover: coverName ?? undefined },
        ),
      });
      return { base, audioName, audioUri: `mem://${key([ALL], audioName)}`, coverName };
    },
  };
  return { port, files, failOn, exported };
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

/** What 1.63.0 left in the folder for a song: "Artist - Title" with its cover and details. */
function seedLegacy(files: Map<string, Stored>, id: string, title: string, artist: string, audioName = `${artist} - ${title}.mp3`): void {
  const base = `${artist} - ${title}`;
  files.set(`${ALL}/${audioName}`, { source: 'old' });
  files.set(`${ALL}/${base}.jpg`, { source: 'oldcover' });
  files.set(`${ALL}/${base}.json`, { text: buildSidecar({ id, title, artist, duration: 200 }, { audio: audioName, cover: `${base}.jpg` }) });
}

describe('folder names', () => {
  it('drops what file systems refuse and never returns an empty or edge-dotted name', () => {
    expect(safeName('AC/DC: Back In Black?')).toBe('AC DC Back In Black');
    expect(safeName('  ..hidden.. ')).toBe('hidden');
    expect(safeName('???')).toBe('Untitled');
    expect(safeName(null, 'Playlist')).toBe('Playlist');
    expect(safeName('Line\none\ttab')).toBe('Line one tab');
  });

  it('names a song for its title alone', () => {
    expect(songBase('Tum Hi Ho')).toBe('Tum Hi Ho');
    expect(songBase('Mozhiye (From "Baththa")')).toBe('Mozhiye (From Baththa)');
    expect(songBase('மொழியே')).toBe('மொழியே');
    expect(songBase('')).toBe('Untitled');
  });

  it('keeps a very long title within a safe length', () => {
    expect(songBase('x'.repeat(300)).length).toBeLessThanOrEqual(80);
  });

  it('knows the name 1.63.0 gave a song, only when there is an artist', () => {
    expect(legacyBase('Tum Hi Ho', 'Arijit Singh')).toBe('Arijit Singh - Tum Hi Ho');
    expect(legacyBase('Tum Hi Ho', '')).toBeNull();
    expect(legacyBase('Tum Hi Ho')).toBeNull();
  });

  it('offers "Title", "Title (2)", "Title (3)" in turn', () => {
    expect(nameCandidates('Intro', 3)).toEqual(['Intro', 'Intro (2)', 'Intro (3)']);
  });

  it('names a playlist folder safely', () => {
    expect(playlistFolderName('Road trip / 2026')).toBe('Road trip 2026');
    expect(playlistFolderName('')).toBe('Playlist');
  });
});

describe('sidecar files', () => {
  it('round-trips a song and ignores damaged or foreign files', () => {
    const text = buildSidecar({ id: 's1', title: 'Song', artist: 'Band', duration: 180, lyrics: '[00:01.00]Hi' }, { audio: 'Song.m4a', cover: 'Song.jpg' });
    expect(parseSidecar(text)).toMatchObject({ id: 's1', title: 'Song', artist: 'Band', file: 'Song.m4a', cover: 'Song.jpg', lyrics: '[00:01.00]Hi' });
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
  it('names each file for the song alone and hands the artist, album and lyrics over for its tags', async () => {
    const { port, files, exported } = fakeFolder();
    const report = await saveLibraryToFolder(
      port,
      [song('s1', 'Tum Hi Ho', 'Arijit Singh', { album: 'Aashiqui 2', coverImageUri: 'file:///c.jpg', lyrics: lines([[1, 'line']]) })],
      [],
    );

    expect(report).toMatchObject({ saved: 1, alreadyThere: 0, failed: 0 });
    expect([...files.keys()].sort()).toEqual(
      [`${ALL}/Tum Hi Ho.jpg`, `${ALL}/Tum Hi Ho.json`, `${ALL}/Tum Hi Ho.mp3`, 'playlists.json'].sort(),
    );
    expect(exported[0]).toMatchObject({ title: 'Tum Hi Ho', artist: 'Arijit Singh', album: 'Aashiqui 2', lyrics: '[00:01.00]line', coverUri: 'file:///c.jpg', base: 'Tum Hi Ho' });
    expect(parseSidecar(files.get(`${ALL}/Tum Hi Ho.json`)!.text!)).toMatchObject({ id: 's1', artist: 'Arijit Singh', album: 'Aashiqui 2' });
  });

  it('keeps two different songs with one name apart, and the same song on its own files', async () => {
    const { port, files } = fakeFolder();
    const a = song('sa', 'Intro', 'Band A');
    const b = song('sb', 'Intro', 'Band B');
    await saveLibraryToFolder(port, [a, b], []);
    expect(parseSidecar(files.get(`${ALL}/Intro.json`)!.text!)!.id).toBe('sa');
    expect(parseSidecar(files.get(`${ALL}/Intro (2).json`)!.text!)!.id).toBe('sb');

    // Again, in the other order: each finds its own files, nothing new is made.
    const second = await saveLibraryToFolder(port, [b, a], []);
    expect(second).toMatchObject({ saved: 0, alreadyThere: 2, failed: 0 });
    expect([...files.keys()].filter(k => k.startsWith(`${ALL}/`) && k.endsWith('.json')).sort()).toEqual([`${ALL}/Intro (2).json`, `${ALL}/Intro.json`]);
  });

  it('keeps an m4a source as .m4a and copies it into playlists under that name', async () => {
    const { port, files } = fakeFolder();
    await saveLibraryToFolder(port, [song('s1', 'Kesariya', 'Arijit Singh', { audioUri: 'file:///data/music/s1/audio.m4a' })], [{ name: 'Gym', songIds: ['s1'] }]);
    expect(files.has(`${ALL}/Kesariya.m4a`)).toBe(true);
    expect(files.has(`${ALL}/Kesariya.mp3`)).toBe(false);
    expect(files.get('Playlists/Gym/Kesariya.m4a')).toEqual({ source: `mem://${ALL}/Kesariya.m4a` });
    expect(parseSidecar(files.get(`${ALL}/Kesariya.json`)!.text!)!.file).toBe('Kesariya.m4a');
  });

  it('writes each playlist into its own folder, copying from the folder rather than the phone', async () => {
    const { port, files } = fakeFolder();
    const report = await saveLibraryToFolder(port, [song('s1', 'One', 'A'), song('s2', 'Two', 'A')], [{ name: 'Gym', songIds: ['s2'] }]);
    expect(report.playlistCopies).toBe(1);
    expect(files.get('Playlists/Gym/Two.mp3')).toEqual({ source: `mem://${ALL}/Two.mp3` });
    expect(files.has('Playlists/Gym/One.mp3')).toBe(false);
    expect(parsePlaylistsFile(files.get('playlists.json')!.text!)).toEqual([{ name: 'Gym', songIds: ['s2'] }]);
  });

  it('adds only what is missing the second time and never deletes', async () => {
    const { port, files } = fakeFolder();
    const first = [song('s1', 'One', 'A')];
    await saveLibraryToFolder(port, first, []);
    files.set(`${ALL}/Someone Else - Old.mp3`, { source: 'x' });

    const report = await saveLibraryToFolder(port, [...first, song('s2', 'Two', 'A')], []);

    expect(report).toMatchObject({ saved: 1, alreadyThere: 1, failed: 0 });
    expect(files.has(`${ALL}/Someone Else - Old.mp3`)).toBe(true);
  });

  it('counts a song whose copy fails and still saves the others', async () => {
    const { port, failOn } = fakeFolder();
    failOn.add('song:s1');
    const report = await saveLibraryToFolder(port, [song('s1', 'Bad', 'A'), song('s2', 'Good', 'A')], []);
    expect(report).toMatchObject({ saved: 1, failed: 1 });
  });

  it('copies a song again when its details are in the folder but its audio is gone', async () => {
    const { port, files } = fakeFolder();
    await saveLibraryToFolder(port, [song('s1', 'One', 'A')], []);
    files.delete(`${ALL}/One.mp3`);

    const report = await saveLibraryToFolder(port, [song('s1', 'One', 'A')], []);

    expect(report).toMatchObject({ saved: 1, alreadyThere: 0 });
    expect(files.has(`${ALL}/One.mp3`)).toBe(true);
    expect(files.has(`${ALL}/One (2).json`)).toBe(false);
  });

  it('skips songs with no audio on the phone', async () => {
    const { port, files } = fakeFolder();
    const report = await saveLibraryToFolder(port, [song('s1', 'Streamed', 'A', { audioUri: undefined })], []);
    expect(report).toMatchObject({ saved: 0, failed: 0 });
    expect(files.has(`${ALL}/Streamed.mp3`)).toBe(false);
  });

  it('puts lyrics that arrived after the download into the details file', async () => {
    const { port, files } = fakeFolder();
    await saveLibraryToFolder(port, [song('s1', 'One', 'A')], []);
    expect(parseSidecar(files.get(`${ALL}/One.json`)!.text!)!.lyrics).toBeUndefined();

    const report = await saveLibraryToFolder(port, [song('s1', 'One', 'A', { lyrics: lines([[2, 'hello']]) })], []);

    expect(report).toMatchObject({ saved: 0, alreadyThere: 1 });
    expect(parseSidecar(files.get(`${ALL}/One.json`)!.text!)!.lyrics).toBe('[00:02.00]hello');
  });

  it('reports progress over songs and playlist copies', async () => {
    const { port } = fakeFolder();
    const seen: [number, number][] = [];
    await saveLibraryToFolder(port, [song('s1', 'One', 'A')], [{ name: 'P', songIds: ['s1'] }], (done, total) => seen.push([done, total]));
    expect(seen).toEqual([[1, 2], [2, 2]]);
  });
});

describe('songs 1.63.0 saved as "Artist - Title"', () => {
  it('are renamed to their title when the phone has its own copy, details file included', async () => {
    const { port, files } = fakeFolder();
    seedLegacy(files, 's1', 'Tum Hi Ho', 'Arijit Singh');

    const report = await saveLibraryToFolder(port, [song('s1', 'Tum Hi Ho', 'Arijit Singh')], []);

    expect(report).toMatchObject({ renamed: 1, saved: 0, alreadyThere: 1, failed: 0 });
    expect([...files.keys()].filter(k => k.startsWith(`${ALL}/`)).sort()).toEqual([`${ALL}/Tum Hi Ho.jpg`, `${ALL}/Tum Hi Ho.json`, `${ALL}/Tum Hi Ho.mp3`]);
    expect(parseSidecar(files.get(`${ALL}/Tum Hi Ho.json`)!.text!)).toMatchObject({ id: 's1', file: 'Tum Hi Ho.mp3', cover: 'Tum Hi Ho.jpg' });
  });

  it('are left alone when the library plays them from the folder (their row points at that file)', async () => {
    const { port, files } = fakeFolder();
    seedLegacy(files, 's1', 'Tum Hi Ho', 'Arijit Singh');

    const report = await saveLibraryToFolder(port, [song('s1', 'Tum Hi Ho', 'Arijit Singh', { audioUri: `content://tree/${ALL}/Arijit Singh - Tum Hi Ho.mp3` })], []);

    expect(report).toMatchObject({ renamed: 0, saved: 0, alreadyThere: 1 });
    expect(files.has(`${ALL}/Arijit Singh - Tum Hi Ho.mp3`)).toBe(true);
    expect(files.has(`${ALL}/Tum Hi Ho.mp3`)).toBe(false);
  });

  it('are not renamed over another song that has the title: they take the next free name', async () => {
    const { port, files } = fakeFolder();
    seedLegacy(files, 's1', 'Intro', 'Band A');
    files.set(`${ALL}/Intro.mp3`, { source: 'other' });
    files.set(`${ALL}/Intro.json`, { text: buildSidecar({ id: 'other', title: 'Intro', artist: 'Band B', duration: 1 }, { audio: 'Intro.mp3' }) });

    await saveLibraryToFolder(port, [song('s1', 'Intro', 'Band A')], []);

    expect(parseSidecar(files.get(`${ALL}/Intro.json`)!.text!)!.id).toBe('other');
    expect(parseSidecar(files.get(`${ALL}/Intro (2).json`)!.text!)).toMatchObject({ id: 's1', file: 'Intro (2).mp3' });
  });

  it('stay as they are when the provider cannot rename, and are still found', async () => {
    const { port, files, failOn } = fakeFolder();
    seedLegacy(files, 's1', 'Tum Hi Ho', 'Arijit Singh');
    failOn.add('rename:Arijit Singh - Tum Hi Ho.mp3');

    const report = await saveLibraryToFolder(port, [song('s1', 'Tum Hi Ho', 'Arijit Singh')], []);

    expect(report).toMatchObject({ renamed: 0, saved: 0, alreadyThere: 1, failed: 0 });
    expect(files.has(`${ALL}/Arijit Singh - Tum Hi Ho.mp3`)).toBe(true);
    expect(files.has(`${ALL}/Tum Hi Ho.mp3`)).toBe(false);
  });
});

describe('restoring the library from the folder', () => {
  it('brings back every saved song by title, with its audio, cover, lyrics and playlists, as after a reinstall', async () => {
    const { port } = fakeFolder();
    await saveLibraryToFolder(
      port,
      [
        song('s1', 'Tum Hi Ho', 'Arijit Singh', { coverImageUri: 'file:///c.jpg', lyrics: lines([[1, 'hello']]), originId: 'saavn:1', coverRemoteUri: 'https://x/c.jpg', album: 'Aashiqui 2' }),
        song('s2', 'Kesariya', 'Arijit Singh', { audioUri: 'file:///data/music/s2/audio.m4a' }),
      ],
      [{ name: 'Gym', songIds: ['s1', 's2'] }],
    );

    const restored = await restoreLibraryFromFolder(port, new Set(), parseLrc, '2026-11-13T00:00:00.000Z');

    expect(restored.songs.map(s => s.id).sort()).toEqual(['s1', 's2']);
    const first = restored.songs.find(s => s.id === 's1')!;
    expect(first).toMatchObject({
      title: 'Tum Hi Ho',
      artist: 'Arijit Singh',
      album: 'Aashiqui 2',
      audioUri: `mem://${ALL}/Tum Hi Ho.mp3`,
      coverImageUri: `mem://${ALL}/Tum Hi Ho.jpg`,
      originId: 'saavn:1',
      coverRemoteUri: 'https://x/c.jpg',
      dateCreated: '2026-11-13T00:00:00.000Z',
    });
    expect(first.lyrics).toEqual([{ timestamp: 1, text: 'hello', lineOrder: 0 }]);
    expect(restored.songs.find(s => s.id === 's2')!.audioUri).toBe(`mem://${ALL}/Kesariya.m4a`);
    expect(restored.playlists).toEqual([{ name: 'Gym', songIds: ['s1', 's2'] }]);
  });

  it('still reads the "Artist - Title" files an older version saved', async () => {
    const { port, files } = fakeFolder();
    seedLegacy(files, 's1', 'Tum Hi Ho', 'Arijit Singh');
    const restored = await restoreLibraryFromFolder(port, new Set(), parseLrc);
    expect(restored.songs.map(s => s.id)).toEqual(['s1']);
    expect(restored.songs[0]!.audioUri).toBe(`mem://${ALL}/Arijit Singh - Tum Hi Ho.mp3`);
  });

  it('keeps a song once when its details were written under two names', async () => {
    const { port, files } = fakeFolder();
    seedLegacy(files, 's1', 'Tum Hi Ho', 'Arijit Singh');
    files.set(`${ALL}/Tum Hi Ho.mp3`, { source: 'new' });
    files.set(`${ALL}/Tum Hi Ho.json`, { text: buildSidecar({ id: 's1', title: 'Tum Hi Ho', artist: 'Arijit Singh', duration: 200 }, { audio: 'Tum Hi Ho.mp3' }) });
    const restored = await restoreLibraryFromFolder(port, new Set(), parseLrc);
    expect(restored.songs.map(s => s.id)).toEqual(['s1']);
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
    files.delete(`${ALL}/One.mp3`);
    files.set(`${ALL}/broken.json`, { text: '{oops' });

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
