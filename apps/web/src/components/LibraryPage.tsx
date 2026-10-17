import Link from 'next/link';
import { paths } from '../lib/routes';
import { ArrowUpRight, Clock3, Heart, ListMusic, Music2, Play, RefreshCw, Users } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import type { UnifiedSong } from '@shared/types';

import { SongCard } from './SongCard';
import { usePlaylistsContext } from '../hooks/usePlaylists';
import type { LibraryRecord } from '../lib/api';
import type { LibrarySong } from '../lib/libraryRows';
import { EmptyState, TactileButton } from './ui';
import { BlendsShelf } from './blend/BlendsShelf';
import { flags } from '../lib/flags';
import { itemVariants, motionTokens, pageVariants } from '../motion';
import { InfoTour } from './InfoTour';
import { LIBRARY_TOUR } from './pageTours';

interface LibraryPageProps {
  readonly likedSongs: UnifiedSong[];
  readonly recentlyPlayed: UnifiedSong[];
  readonly likedIds: Set<string>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly actionError: string | null;
  readonly currentSongId?: string;
  readonly isPlaying: boolean;
  readonly onPlay: (song: UnifiedSong, queue?: UnifiedSong[]) => void;
  readonly onLike: (song: UnifiedSong) => void;
  readonly onRetry: () => void;
  readonly onDiscover: () => void;
  /** A signed-in account (not a guest): Blends and Import need one. */
  readonly signedIn?: boolean;
  readonly onSignIn?: () => void;
}

export function LibraryPage({ likedSongs, recentlyPlayed, likedIds, loading, error, actionError, currentSongId, isPlaying, onPlay, onLike, onRetry, onDiscover, signedIn = false, onSignIn = () => undefined }: LibraryPageProps) {
  const reduced = useReducedMotion();
  const transition = reduced ? { duration: motionTokens.duration.instant } : undefined;
  const playlistsApi = usePlaylistsContext();

  return (
    <motion.div className="library-page" variants={pageVariants} initial="hidden" animate="visible" transition={transition}>
      <motion.section className="inner-hero" variants={itemVariants}>
        <div>
          <div className="page-title-row plain-title"><h1>Library</h1><InfoTour label="About your library" steps={LIBRARY_TOUR} /></div>
        </div>
        <div className="library-stat-grid" aria-label="Library summary">
          <div className="library-stat"><Heart size={16} aria-hidden="true" /><strong>{likedSongs.length}</strong><span>kept close</span></div>
          <div className="library-stat"><Clock3 size={16} aria-hidden="true" /><strong>{recentlyPlayed.length}</strong><span>recent traces</span></div>
          <div className="library-stat"><ListMusic size={16} aria-hidden="true" /><strong>{playlistsApi.playlists.length}</strong><span>playlists</span></div>
        </div>
      </motion.section>

      {actionError ? <p className="library-sync-notice" role="status">{actionError}</p> : null}

      {loading ? (
        <section className="library-state" aria-live="polite"><div className="library-loading-mark"><span /><span /><span /></div><p>Loading your library</p></section>
      ) : error ? (
        <section className="library-state library-state-error" role="alert"><span className="state-mark" aria-hidden="true">✦</span><h2>Your library did not load</h2><p>{error}</p><TactileButton icon={RefreshCw} variant="primary" onClick={onRetry}>Try again</TactileButton></section>
      ) : (
        <>
          <LibrarySection eyebrow="Kept close" title="Your likes" icon={<Heart size={15} aria-hidden="true" />}>
            {likedSongs.length > 0 ? <SongGrid songs={likedSongs} currentSongId={currentSongId} isPlaying={isPlaying} likedIds={likedIds} onPlay={onPlay} onLike={onLike} /> : <EmptyState title="Make a small collection" copy="Tap the heart on any track and it will land here for the next listening session." action={<div className="library-empty-actions"><TactileButton variant="accent" icon={ArrowUpRight} onClick={onDiscover}>Find something to keep</TactileButton>{flags.import ? <Link className="import-link" href={paths.import}>Import your library</Link> : null}</div>} />}
          </LibrarySection>
          <LibrarySection eyebrow="Your rooms" title="Playlists" icon={<ListMusic size={15} aria-hidden="true" />}>
            <PlaylistsSection currentSongId={currentSongId} isPlaying={isPlaying} onPlay={onPlay} onDiscover={onDiscover} />
          </LibrarySection>
          {flags.blend ? (
            <LibrarySection eyebrow="Shared with friends" title="Blends" icon={<Users size={15} aria-hidden="true" />}>
              <BlendsShelf signedIn={signedIn} onSignIn={onSignIn} />
            </LibrarySection>
          ) : null}
          <LibrarySection eyebrow="Recent traces" title="Played lately" icon={<Clock3 size={15} aria-hidden="true" />}>
            {recentlyPlayed.length > 0 ? <SongGrid songs={recentlyPlayed} currentSongId={currentSongId} isPlaying={isPlaying} likedIds={likedIds} onPlay={onPlay} onLike={onLike} /> : <EmptyState title="The first song is waiting" copy="Start with a search, follow a mood, and your recent path will appear here." action={<TactileButton variant="primary" onClick={onDiscover}>Open discover</TactileButton>} />}
          </LibrarySection>
        </>
      )}
    </motion.div>
  );
}

function LibrarySection({ eyebrow, title, icon, children }: { readonly eyebrow: string; readonly title: string; readonly icon: ReactNode; readonly children: ReactNode }) {
  return <motion.section id={`library-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} className="library-section" variants={itemVariants}><div className="library-section-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><span className="library-section-icon">{icon}</span></div>{children}</motion.section>;
}

function SongGrid({ songs, currentSongId, isPlaying, likedIds, onPlay, onLike }: { readonly songs: UnifiedSong[]; readonly currentSongId?: string; readonly isPlaying: boolean; readonly likedIds: Set<string>; readonly onPlay: (song: UnifiedSong, queue?: UnifiedSong[]) => void; readonly onLike: (song: UnifiedSong) => void }) {
  return <div className="library-track-list">{songs.map((song, index) => <SongCard key={song.id} song={song} index={index} isCurrent={song.id === currentSongId} isPlaying={song.id === currentSongId && isPlaying} onPlay={(pick) => onPlay(pick, songs)} onLike={() => onLike(song)} liked={likedIds.has(song.id)} />)}</div>;
}

function PlaylistsSection({ currentSongId, isPlaying, onPlay, onDiscover }: { readonly currentSongId?: string; readonly isPlaying: boolean; readonly onPlay: (song: UnifiedSong, queue?: UnifiedSong[]) => void; readonly onDiscover: () => void }) {
  const { playlists, songs, loading, error, actionError, reload, create } = usePlaylistsContext();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (creating || !name.trim()) return;
    setCreating(true);
    if (await create(name)) setName('');
    setCreating(false);
  };

  if (loading && playlists.length === 0) return <p className="playlist-note" aria-live="polite">Loading your playlists</p>;
  if (error && playlists.length === 0) return <div className="playlist-note" role="alert"><p>{error}</p><TactileButton icon={RefreshCw} variant="primary" onClick={() => void reload()}>Try again</TactileButton></div>;

  return (
    <div className="playlist-section">
      <form className="playlist-new playlist-new-inline" onSubmit={(event) => void submit(event)}>
        <label className="sr-only" htmlFor="new-playlist-name">New playlist name</label>
        <input id="new-playlist-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="Name a new playlist" autoComplete="off" />
        <TactileButton type="submit" variant="primary" disabled={creating || !name.trim()}>Create playlist</TactileButton>
      </form>
      {actionError ? <p className="library-sync-notice" role="status">{actionError}</p> : null}
      {playlists.length === 0 ? <EmptyState title="Start a playlist" copy="Name one above, then use the list-plus button on any track to save it here." action={<TactileButton variant="accent" icon={ArrowUpRight} onClick={onDiscover}>Find something to save</TactileButton>} /> : (
        <div className="playlist-grid">
          {playlists.map((playlist) => <PlaylistFolder key={playlist.id} playlist={playlist} songs={playlist.songIds.map((id) => songs.get(id)).filter((song): song is LibrarySong => song !== undefined)} currentSongId={currentSongId} isPlaying={isPlaying} onPlay={onPlay} />)}
        </div>
      )}
    </div>
  );
}

/** Where each cover sits in the fan, and which of the playlist's covers it shows (the lead in the middle). */
const FOLDER_SLOTS = [['left', 1], ['centre', 0], ['right', 2]] as const;

/**
 * A playlist as a folder of its covers: three songs' artwork fanned out of a frosted pocket that
 * names its first songs. The whole folder opens the playlist; the round button plays it.
 */
function PlaylistFolder({ playlist, songs, currentSongId, isPlaying, onPlay }: { readonly playlist: LibraryRecord; readonly songs: UnifiedSong[]; readonly currentSongId?: string; readonly isPlaying: boolean; readonly onPlay: (song: UnifiedSong, queue?: UnifiedSong[]) => void }) {
  const first = songs[0];
  // A custom cover leads; then the first songs with their own artwork, one per cover.
  const covers: string[] = [];
  for (const url of [playlist.coverUrl, ...songs.map((song) => song.artwork)]) {
    if (url && !covers.includes(url)) covers.push(url);
    if (covers.length === 3) break;
  }
  const playing = currentSongId !== undefined && isPlaying && songs.some((song) => song.id === currentSongId);
  const count = playlist.songIds.length;
  return (
    <article className="playlist-folder" aria-label={`Playlist ${playlist.name}`}>
      <div className="playlist-folder__frame">
        <Link className="playlist-folder__stage" href={paths.playlist(playlist.id)} aria-label={`Open ${playlist.name}`}>
          <span className="playlist-folder__back" aria-hidden="true" />
          {FOLDER_SLOTS.map(([position, index]) => (
            <span key={position} className={`playlist-folder__cover is-${position}`} aria-hidden="true">
              {covers[index] ? <img src={covers[index]} alt="" loading="lazy" decoding="async" /> : <ListMusic size={22} strokeWidth={1.5} />}
            </span>
          ))}
          {/* The tab is its own element: a backdrop blur on a pseudo-element outside its box would not render. */}
          <span className="playlist-folder__tab" aria-hidden="true" />
          <span className="playlist-folder__pocket">
            <span className="playlist-folder__lines">
              {songs.length > 0 ? songs.slice(0, 3).map((song) => (
                <span key={song.id} className="playlist-folder__line">
                  <strong>{song.title}</strong>
                  <small>{song.artist}</small>
                </span>
              )) : <span className="playlist-folder__line"><strong>{count > 0 ? 'Loading songs' : 'Empty for now'}</strong><small>{count > 0 ? 'One moment' : 'Add songs with the list-plus button'}</small></span>}
            </span>
          </span>
        </Link>
        {first ? (
          <button type="button" className={`playlist-folder__play${playing ? ' is-playing' : ''}`} aria-label={`Play ${playlist.name}`} onClick={() => onPlay(first, songs)}>
            {playing ? <Music2 size={20} aria-hidden="true" /> : <Play size={19} fill="currentColor" aria-hidden="true" />}
          </button>
        ) : null}
      </div>
      <div className="playlist-folder__name">
        <h3 title={playlist.name}><Link href={paths.playlist(playlist.id)}>{playlist.name}</Link></h3>
        <span className="playlist-folder__count">{count} {count === 1 ? 'song' : 'songs'}</span>
      </div>
    </article>
  );
}
