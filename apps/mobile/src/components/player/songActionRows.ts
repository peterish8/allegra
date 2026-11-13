/**
 * Which rows the one song actions sheet shows, and how they are grouped (owner, 2026-11-13: one menu, opened by
 * long press on any song row and from Now Playing's ••• , with everything that applies to the song). Pure so the
 * rules are tested apart from the sheet; the sheet only draws what this returns.
 *
 * - Any song: download (streams), like, share, add to playlist, start song radio, go to artist.
 * - A song that is not the playing one: play next and add to queue.
 * - The playing song on this phone: the playback, lyrics and sound rows Now Playing's ••• menu has.
 * - A song file on this phone (library, playlist): lyrics search, another version, cover, edit, hide, delete.
 * - Playing on another device (Connect): no local audio controls; devices stay.
 */
export interface SongActionContext {
  /** The song is the one playing (or loaded) on this phone. */
  readonly current: boolean;
  /** It plays on another device through Connect. */
  readonly remote: boolean;
  /** A catalog stream rather than a file on the phone. */
  readonly stream: boolean;
  /** Android's native player is there (output switcher, equalizer, tempo). */
  readonly native: boolean;
  readonly ringtone: boolean;
  readonly artist: boolean;
  /** A stream queue plays, so a song can join its end (StreamService.append only adds to that queue). */
  readonly appendable: boolean;
  /** The host can manage the song as a file on this phone (cover, edit, hide, delete). */
  readonly library?: boolean;
  /** Opened from a playlist: the song can leave it. */
  readonly fromPlaylist?: boolean;
  /** The host can queue this song next (a library song needs a playing queue it can join). Defaults to true. */
  readonly canPlayNext?: boolean;
}

export type SongActionRow =
  | 'download' | 'like' | 'share' | 'addToPlaylist' | 'playNext' | 'addToQueue' | 'radio' | 'artist'
  | 'upNext' | 'sleepTimer' | 'shuffleUpcoming' | 'repeat' | 'reload'
  | 'findLyrics' | 'lyrics' | 'version' | 'shareFile' | 'details' | 'ambient' | 'ringtone'
  | 'coverPhoto' | 'coverOnline' | 'coverRemove'
  | 'luvLink' | 'devices' | 'output' | 'equalizer' | 'tempo'
  | 'editInfo' | 'removeFromPlaylist' | 'hide' | 'delete';

export function songActionRows(c: SongActionContext): ReadonlySet<SongActionRow> {
  const rows = new Set<SongActionRow>(['like', 'share', 'addToPlaylist']);
  // A song radio replaces this phone's queue, so it is not offered while another device plays.
  if (!c.remote) rows.add('radio');
  if (c.stream) rows.add('download');
  if (c.artist) rows.add('artist');
  if (!c.current && !c.remote) {
    if (c.canPlayNext !== false) rows.add('playNext');
    if (c.appendable) rows.add('addToQueue');
  }
  const local = c.current && !c.remote;
  if (local) {
    for (const row of ['upNext', 'sleepTimer', 'shuffleUpcoming', 'repeat', 'reload', 'lyrics', 'details', 'ambient', 'luvLink'] as const) rows.add(row);
    if (c.ringtone) rows.add('ringtone');
  }
  if (c.library && !c.stream) {
    // The picker (lyrics) belongs to the playing song; for any other song the search queue is how lyrics are found.
    if (!c.current) rows.add('findLyrics');
    for (const row of ['version', 'shareFile', 'coverPhoto', 'coverOnline', 'coverRemove', 'editInfo', 'hide', 'delete'] as const) rows.add(row);
    if (c.fromPlaylist) rows.add('removeFromPlaylist');
  }
  if (c.current || c.remote) rows.add('devices');
  if (local && c.native) {
    rows.add('output');
    rows.add('equalizer');
    rows.add('tempo');
  }
  return rows;
}

export interface SongActionGroup {
  readonly id: 'queue' | 'playback' | 'song' | 'cover' | 'sound' | 'manage';
  /** Sentence-case heading; the first group has none. */
  readonly title?: string;
  readonly rows: readonly SongActionRow[];
}

const GROUPS: readonly { id: SongActionGroup['id']; title?: string; rows: readonly SongActionRow[] }[] = [
  { id: 'queue', rows: ['playNext', 'addToQueue', 'addToPlaylist', 'radio', 'artist'] },
  { id: 'playback', title: 'Playback', rows: ['upNext', 'sleepTimer', 'shuffleUpcoming', 'repeat', 'reload'] },
  { id: 'song', title: 'Lyrics and song', rows: ['findLyrics', 'lyrics', 'version', 'details', 'ambient', 'ringtone', 'shareFile'] },
  { id: 'cover', title: 'Cover', rows: ['coverPhoto', 'coverOnline', 'coverRemove'] },
  { id: 'sound', title: 'Listen together and sound', rows: ['luvLink', 'devices', 'output', 'equalizer', 'tempo'] },
  { id: 'manage', title: 'Manage', rows: ['editInfo', 'removeFromPlaylist', 'hide', 'delete'] },
];

/** The rows in display order, in the categories the sheet shows. Download, Like and Share sit above them. */
export function songActionGroups(rows: ReadonlySet<SongActionRow>): SongActionGroup[] {
  return GROUPS
    .map(group => ({ ...group, rows: group.rows.filter(row => rows.has(row)) }))
    .filter(group => group.rows.length > 0);
}
