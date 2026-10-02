import { DatabaseSync } from 'node:sqlite';
import type * as SQLite from 'expo-sqlite';

import { closeDatabase, getDatabase, initDatabase } from './db';
import * as syncDb from './syncQueries';
import { getAllPlaylists } from './playlistQueries';
import type { SongRef, SongSnapshot } from '@shared/songRef';
import { buildLocalIndex, LIKED_PLAYLIST_ID, opsForFirstSync, planInbound, planPhonePlaylistReplacement, refForLocalSong, snapshotOfLocal, type AccountLibrary, type PhoneLibrary } from '../services/sync/plan';
import type { LibraryChange } from '@shared/library';

// Keep db.ts and syncQueries.ts real. Only bridge Expo's async native API to Node's
// SQLite engine so these tests run the actual schema and SQL without a device runtime.
const mockOpenDatabaseAsync = jest.fn();
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: (...args: unknown[]) => mockOpenDatabaseAsync(...args),
  deleteDatabaseAsync: jest.fn(),
}));

// playlistQueries imports queries, which reaches for the file system; nothing here touches a file.
jest.mock('expo-file-system/legacy', () => ({}));

type SqlValue = string | number | bigint | null | Uint8Array;
let nativeDb: DatabaseSync;

function expoAdapter(): SQLite.SQLiteDatabase {
  return {
    execAsync: async (sql: string) => { nativeDb.exec(sql); },
    runAsync: async (sql: string, params: readonly SqlValue[] = []) => {
      nativeDb.prepare(sql).run(...params);
      return {};
    },
    getFirstAsync: async <T>(sql: string, params: readonly SqlValue[] = []) =>
      nativeDb.prepare(sql).get(...params) as T | undefined,
    getAllAsync: async <T>(sql: string, params: readonly SqlValue[] = []) =>
      nativeDb.prepare(sql).all(...params) as T[],
    closeAsync: async () => undefined,
  } as unknown as SQLite.SQLiteDatabase;
}

const song = (id: string, title: string, originId?: string) => ({
  id,
  title,
  artist: 'The Artist',
  gradient_id: 'dynamic',
  date_created: '2026-09-30T00:00:00.000Z',
  date_modified: '2026-09-30T00:00:00.000Z',
  duration: 210,
  audio_uri: `file:///music/${id}.mp3`,
  ...(originId ? { origin_id: originId } : {}),
});

const snapshot = (ref: SongRef, title: string): SongSnapshot => ({
  ref,
  title,
  artist: 'The Artist',
  artwork: 'https://img.example/cover.jpg',
  duration: 210,
});

const accountEmpty: AccountLibrary = { likedRefs: new Set(), playlists: new Map() };

async function resetTables(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM sync_outbox');
  await db.runAsync('DELETE FROM sync_meta');
  await db.runAsync('DELETE FROM liked_online_songs');
  await db.runAsync('DELETE FROM playlist_online_songs');
  await db.runAsync('DELETE FROM playlist_songs');
  await db.runAsync('DELETE FROM playlists WHERE is_default = 0');
  await db.runAsync('DELETE FROM songs');
}

async function insertSong(id: string, title: string, originId?: string): Promise<void> {
  const row = song(id, title, originId);
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO songs (id, title, artist, gradient_id, date_created, date_modified, duration, audio_uri, origin_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.title, row.artist, row.gradient_id, row.date_created, row.date_modified, row.duration, row.audio_uri, row.origin_id ?? null],
  );
}

beforeAll(async () => {
  nativeDb = new DatabaseSync(':memory:');
  mockOpenDatabaseAsync.mockResolvedValue(expoAdapter());
  await initDatabase();
});

beforeEach(resetTables);

afterAll(async () => {
  await closeDatabase();
  nativeDb.close();
});

describe('sync queries against SQLite', () => {
  it('persists staged play progress so a retry resumes at the taste signal', async () => {
    const pending = {
      songRef: 'gaana:g1' as SongRef,
      song: snapshot('gaana:g1', 'Gaana song'),
      seconds: 17,
      playedAt: '2026-09-30T01:02:03.000Z',
      recentPosted: false,
    };
    await syncDb.enqueueOutbox('play', pending);

    const [queued] = await syncDb.peekOutbox('play', 20);
    expect(queued).toBeDefined();
    const parsed = JSON.parse(queued.body) as typeof pending;
    expect(parsed).toEqual(pending);

    await syncDb.updateOutboxBody(queued.id, { ...parsed, recentPosted: true });
    const [retry] = await syncDb.peekOutbox('play', 20);
    expect(JSON.parse(retry.body)).toMatchObject({ songRef: 'gaana:g1', playedAt: pending.playedAt, recentPosted: true });
  });

  it('counts online-only songs in a playlist beside the downloaded ones, and none twice', async () => {
    const db = await getDatabase();
    const now = '2026-09-30T00:00:00.000Z';
    await db.runAsync(
      "INSERT INTO playlists (id, name, is_default, sort_order, date_created, date_modified) VALUES ('road', 'Road trip', 0, 0, ?, ?)",
      [now, now],
    );
    await db.runAsync(
      "INSERT INTO playlists (id, name, is_default, sort_order, date_created, date_modified) VALUES ('web-only', 'Made on the website', 0, 0, ?, ?)",
      [now, now],
    );
    await insertSong('local-1', 'Downloaded', 'saavn:d1');
    await db.runAsync("INSERT INTO playlist_songs (playlist_id, song_id, added_at) VALUES ('road', 'local-1', ?)", [now]);
    const online = (ref: SongRef, title: string) => ({ ref, title, artist: 'The Artist', duration: 200, at: 1 });
    await syncDb.upsertOnlinePlaylistSong('road', online('saavn:o1' as SongRef, 'Streamed'));
    // The same song as the downloaded one: a copy is on the phone, so it is one song, not two.
    await syncDb.upsertOnlinePlaylistSong('road', online('saavn:d1' as SongRef, 'Downloaded'));
    await syncDb.upsertOnlinePlaylistSong('web-only', online('saavn:o2' as SongRef, 'One'));
    await syncDb.upsertOnlinePlaylistSong('web-only', online('saavn:o3' as SongRef, 'Two'));
    await syncDb.upsertOnlineLike(online('saavn:o1' as SongRef, 'Streamed'));

    const counts = Object.fromEntries((await getAllPlaylists()).map(playlist => [playlist.id, playlist.songCount]));
    expect(counts.road).toBe(2);
    expect(counts['web-only']).toBe(2);
    // Liked songs: the account's online likes count too.
    const liked = (await getAllPlaylists()).find(playlist => playlist.isDefault);
    expect(liked?.songCount).toBe(1);
  });

  it('clears first-sync library operations without discarding pending play history', async () => {
    await syncDb.enqueueOutbox('op', { op: 'like', ref: 'saavn:s1' });
    await syncDb.enqueueOutbox('play', {
      songRef: 'saavn:s1', seconds: 0, playedAt: '2026-09-30T01:02:03.000Z', recentOnly: true,
    });

    await syncDb.clearOutbox('op');

    expect(await syncDb.peekOutbox('op', 20)).toEqual([]);
    expect(await syncDb.peekOutbox('play', 20)).toHaveLength(1);
  });

  it('merges downloads and online library rows without turning online songs into downloads', async () => {
    await insertSong('download-1', 'Downloaded Gaana song');
    await syncDb.setOriginId('download-1', 'gaana:g1');
    await syncDb.setPlaylistMembership(LIKED_PLAYLIST_ID, 'download-1', true);
    await syncDb.upsertPlaylistRaw('mix-1', 'Mixed sources', undefined, 10);
    await syncDb.setPlaylistMembership('mix-1', 'download-1', true);
    await syncDb.upsertOnlineLike({ ref: 'saavn:s1', title: 'Online like', artist: 'The Artist', duration: 190, at: 20 });
    await syncDb.upsertOnlinePlaylistSong('mix-1', { ref: 'saavn:s2', title: 'Online playlist song', artist: 'The Artist', duration: 200, at: 30 });

    const [songs, playlists, onlineLikes] = await Promise.all([
      syncDb.getLocalSongs(), syncDb.getLocalPlaylists(), syncDb.getOnlineLikes(),
    ]);
    const byId = new Map(songs.map(row => [row.id, row]));
    const localItem = (id: string): { ref: SongRef; song: SongSnapshot } | null => {
      const row = byId.get(id);
      if (!row) return null;
      const ref = refForLocalSong(row);
      return ref ? { ref, song: snapshotOfLocal(row, ref) } : null;
    };
    const defaultList = playlists.find(list => list.isDefault);
    const localLikes = (defaultList?.songIds ?? []).map(localItem).filter((item): item is { ref: SongRef; song: SongSnapshot } => item !== null);
    const onlineLikeItems = onlineLikes.map(row => ({
      ref: row.ref as SongRef,
      song: snapshot(row.ref as SongRef, row.title),
    }));
    const mix = playlists.find(list => list.id === 'mix-1');
    const mixOnline = await syncDb.getOnlinePlaylistSongs('mix-1');
    const phone: PhoneLibrary = {
      likes: [...localLikes, ...onlineLikeItems],
      playlists: mix ? [{
        id: mix.id,
        name: mix.name,
        items: [
          ...mix.songIds.map(localItem).filter((item): item is { ref: SongRef; song: SongSnapshot } => item !== null),
          ...mixOnline.map(row => ({ ref: row.ref as SongRef, song: snapshot(row.ref as SongRef, row.title) })),
        ],
      }] : [],
    };

    const ops = opsForFirstSync('merge', phone, accountEmpty, 100);
    expect(ops.filter(op => op.op === 'like').map(op => op.ref)).toEqual(['gaana:g1', 'saavn:s1']);
    expect(ops.filter(op => op.op === 'playlist_add').map(op => op.ref)).toEqual(['gaana:g1', 'saavn:s2']);
    expect(songs).toHaveLength(1);
    expect(onlineLikes.map(row => row.ref)).toEqual(['saavn:s1']);
  });

  it('account replacement removes extra local and online playlist items but keeps downloaded songs', async () => {
    await insertSong('account-song', 'Account song');
    await syncDb.setOriginId('account-song', 'saavn:a');
    await insertSong('phone-song', 'Phone song');
    await syncDb.setOriginId('phone-song', 'gaana:p');
    await syncDb.upsertPlaylistRaw('mix-1', 'Mix', undefined, 10);
    await syncDb.setPlaylistMembership('mix-1', 'account-song', true);
    await syncDb.setPlaylistMembership('mix-1', 'phone-song', true);
    await syncDb.upsertOnlinePlaylistSong('mix-1', { ref: 'saavn:online-account', title: 'Online account song', duration: 180, at: 20 });
    await syncDb.upsertOnlinePlaylistSong('mix-1', { ref: 'gaana:online-phone', title: 'Online phone song', duration: 190, at: 30 });

    const [songs, playlists] = await Promise.all([syncDb.getLocalSongs(), syncDb.getLocalPlaylists()]);
    const online = await syncDb.getOnlinePlaylistSongs('mix-1');
    const account = new Map<string, ReadonlySet<SongRef>>([[
      'mix-1', new Set<SongRef>(['saavn:a', 'saavn:online-account']),
    ]]);
    const replacement = planPhonePlaylistReplacement(
      playlists.map(list => ({
        id: list.id,
        isDefault: list.isDefault,
        songIds: list.songIds,
        onlineRefs: list.id === 'mix-1' ? online.map(row => row.ref) : [],
      })),
      new Map(songs.map(songRow => [songRow.id, refForLocalSong(songRow)])),
      account,
    );
    for (const playlistId of replacement.deletePlaylistIds) await syncDb.deletePlaylistRaw(playlistId);
    for (const item of replacement.removeMemberships) await syncDb.setPlaylistMembership(item.playlistId, item.songId, false);
    for (const item of replacement.removeOnlineItems) await syncDb.removeOnlinePlaylistSong(item.playlistId, item.ref);

    expect((await syncDb.getLocalPlaylists()).find(list => list.id === 'mix-1')?.songIds).toEqual(['account-song']);
    expect((await syncDb.getOnlinePlaylistSongs('mix-1')).map(row => row.ref)).toEqual(['saavn:online-account']);
    expect((await syncDb.getLocalSongs()).map(songRow => songRow.id)).toEqual(['account-song', 'phone-song']);
  });

  it('uses persisted origin ids for matching and applies like and playlist tombstones to local SQL rows', async () => {
    await insertSong('download-1', 'Downloaded Gaana song');
    await syncDb.setOriginId('download-1', 'gaana:g1');
    await syncDb.setPlaylistMembership(LIKED_PLAYLIST_ID, 'download-1', true);
    await syncDb.upsertPlaylistRaw('mix-1', 'Mix', undefined, 10);
    await syncDb.upsertOnlinePlaylistSong('mix-1', { ref: 'saavn:s2', title: 'Online playlist song', duration: 180, at: 20 });

    const rows = await syncDb.getLocalSongs();
    const index = buildLocalIndex(rows);
    expect(index.songFor('gaana:g1', { title: 'Different title', artist: 'Different artist' })).toBe('download-1');

    const likeTombstone: LibraryChange = { kind: 'like', rev: 1, ref: 'gaana:g1', liked: false, likedAt: 10 };
    const likeActions = planInbound([likeTombstone], index, new Set(['mix-1']));
    expect(likeActions).toContainEqual({ kind: 'like_local', songId: 'download-1', ref: 'gaana:g1', liked: false });
    for (const action of likeActions) {
      if (action.kind === 'like_local') await syncDb.setPlaylistMembership(LIKED_PLAYLIST_ID, action.songId, action.liked);
      if (action.kind === 'online_unlike') await syncDb.removeOnlineLike(action.ref);
    }
    expect((await syncDb.getLocalPlaylists()).find(list => list.isDefault)?.songIds).toEqual([]);

    const playlistTombstone: LibraryChange = {
      kind: 'playlist', rev: 2, playlistId: 'mix-1', name: 'Mix', isPublic: false, deleted: true, createdAt: 10,
    };
    const playlistActions = planInbound([playlistTombstone], index, new Set(['mix-1']));
    expect(playlistActions).toContainEqual({ kind: 'playlist_delete', playlistId: 'mix-1' });
    for (const action of playlistActions) if (action.kind === 'playlist_delete') await syncDb.deletePlaylistRaw(action.playlistId);
    expect((await syncDb.getLocalPlaylists()).some(list => list.id === 'mix-1')).toBe(false);
    expect(await syncDb.getOnlinePlaylistSongs('mix-1')).toEqual([]);
  });
});
