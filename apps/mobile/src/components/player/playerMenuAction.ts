/** What the song menu can ask Now Playing to do (it owns lyrics, details, ambient, tempo, LuvLink and the queue sheets). */
export type PlayerMenuAction =
  | 'radio' | 'add' | 'share'
  | 'cast' | 'ambient' | 'lyrics' | 'shuffle' | 'download' | 'like' | 'repeat' | 'refetch'
  | 'artist' | 'ringtone' | 'together'
  | 'connect'
  | 'details' | 'equalizer' | 'advanced';

/** A request for the player: one of its actions, or one of its sheets. */
export type PlayerRequest =
  | { readonly action: PlayerMenuAction }
  | { readonly sheet: 'queue' | 'timer' };
