/**
 * Which rows the one song actions sheet shows (owner, 2026-11-13: one menu, opened by long press everywhere,
 * with everything that applies to the song). Pure so the rules are tested apart from the sheet.
 *
 * - Any song: download (streams), like, share, add to playlist, start song radio, go to artist.
 * - A song that is not the playing one: play next and add to queue.
 * - The playing song on this phone: the playback, lyrics and sound rows Now Playing's ••• menu has.
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
}

export type SongActionRow =
  | 'download' | 'like' | 'share' | 'addToPlaylist' | 'playNext' | 'addToQueue' | 'radio' | 'artist'
  | 'upNext' | 'sleepTimer' | 'shuffleUpcoming' | 'repeat' | 'reload'
  | 'lyrics' | 'details' | 'ambient' | 'ringtone'
  | 'luvLink' | 'devices' | 'output' | 'equalizer' | 'tempo';

export function songActionRows(c: SongActionContext): ReadonlySet<SongActionRow> {
  const rows = new Set<SongActionRow>(['like', 'share', 'addToPlaylist']);
  // A song radio replaces this phone's queue, so it is not offered while another device plays.
  if (!c.remote) rows.add('radio');
  if (c.stream) rows.add('download');
  if (c.artist) rows.add('artist');
  if (!c.current && !c.remote) {
    rows.add('playNext');
    if (c.appendable) rows.add('addToQueue');
  }
  const local = c.current && !c.remote;
  if (local) {
    for (const row of ['upNext', 'sleepTimer', 'shuffleUpcoming', 'repeat', 'reload', 'lyrics', 'details', 'ambient', 'luvLink'] as const) rows.add(row);
    if (c.ringtone) rows.add('ringtone');
  }
  if (c.current || c.remote) rows.add('devices');
  if (local && c.native) {
    rows.add('output');
    rows.add('equalizer');
    rows.add('tempo');
  }
  return rows;
}
