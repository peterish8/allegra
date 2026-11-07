import { Pause, Play } from 'lucide-react';
import { useEffect, useState } from 'react';

import { fromAllegraSong, parseSongRef, type SongRef } from '@shared/songRef';
import type { UnifiedSong } from '@shared/types';
import { fetchSongsByRefs, searchSongs } from '../lib/api';
import { LuvCodeCard, codeTint } from './LuvCodeCard';
import { OpenInApp } from './OpenInApp';
import { Artwork, EmptyState, TactileButton } from './ui';

/**
 * A shared song (`/song/<source>/<id>?t=&a=`, packages/shared/shareLinks.ts): the catalog song by its ref, else the
 * best match for its title and artist. Play starts it in the website's player; on Android, Open in LuvLyrics hands
 * the link to the app. Its LuvLyrics code is shown for someone to scan from this screen.
 */
export function SongSharePage({ songRef, title, artist, currentSongId, isPlaying, onPlay, onToggle }: {
  readonly songRef: SongRef | null;
  readonly title: string;
  readonly artist: string;
  readonly currentSongId: string | null;
  readonly isPlaying: boolean;
  readonly onPlay: (song: UnifiedSong) => void;
  readonly onToggle: () => void;
}) {
  const [song, setSong] = useState<UnifiedSong | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    void (async () => {
      const byRef = songRef ? await fetchSongsByRefs([songRef], controller.signal).catch(() => []) : [];
      const parsed = songRef ? parseSongRef(songRef) : null;
      let found = byRef.find((item) => parsed && item.id === parsed.id) ?? byRef[0] ?? null;
      if (!found && title) {
        const results = await searchSongs(`${title} ${artist}`.trim(), controller.signal).then((r) => r.results).catch(() => []);
        found = results[0] ?? null;
      }
      if (controller.signal.aborted) return;
      setSong(found);
      setState(found ? 'ready' : 'missing');
    })();
    return () => controller.abort();
  }, [songRef, title, artist]);

  if (state === 'missing') {
    return <EmptyState title="This song could not be found" copy={title ? `Nothing in the catalog matches “${title}” right now.` : 'The link may be incomplete.'} />;
  }
  if (!song) return <div className="share-page" aria-busy="true"><div className="share-page__art skeleton" /></div>;

  const ref = fromAllegraSong(song);
  const parsed = ref ? parseSongRef(ref) : null;
  const playing = currentSongId === song.id && isPlaying;
  return (
    <section className="share-page" aria-labelledby="share-title">
      <div className="share-page__art"><Artwork song={song} size="large" /></div>
      <h1 id="share-title" className="share-page__title">{song.title}</h1>
      <p className="share-page__artist">{song.artist}</p>
      <div className="share-page__actions">
        <TactileButton variant="primary" icon={playing ? Pause : Play} onClick={() => (currentSongId === song.id ? onToggle() : onPlay(song))}>
          {playing ? 'Pause' : currentSongId === song.id ? 'Resume' : 'Play'}
        </TactileButton>
      </div>
      <OpenInApp />
      {parsed?.source === 'saavn' ? <LuvCodeCard payload={{ kind: 'song', source: 'saavn', id: parsed.id }} tint={codeTint(song.title)} label={song.title} /> : null}
    </section>
  );
}
