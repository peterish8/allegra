/** What Settings says after choosing the downloads folder or copying the library into it. */

export function restoredNotice(songs: number, playlists: number): string {
  if (songs === 0 && playlists === 0) return 'Folder chosen. New downloads are copied there.';
  const parts = [`${songs} ${songs === 1 ? 'song' : 'songs'}`];
  if (playlists > 0) parts.push(`${playlists} ${playlists === 1 ? 'playlist' : 'playlists'}`);
  return `Folder chosen. Brought back ${parts.join(' and ')}.`;
}

export function savedNotice(saved: number, failed: number): string {
  if (failed > 0) return `Copied ${saved}. ${failed} could not be copied, try again.`;
  return saved === 0 ? 'Everything is already in the folder.' : `Copied ${saved} ${saved === 1 ? 'song' : 'songs'} to the folder.`;
}
