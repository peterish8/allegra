import { Check, Heart, Pause, Play, Plus, Shuffle } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';

import type { AlbumDetail, UnifiedSong } from '@shared/types';

import { Artwork, IconButton, TactileButton } from './ui';
import { PlaylistMenu } from './PlaylistMenu';
import { SavePlaylistButton } from './SavePlaylistButton';
import { usePlaylistsContext } from '../hooks/usePlaylists';
import { formatAlbumDuration } from '../lib/album';
import type { Palette } from '../lib/palette';
import { formatTime } from '../lib/utils';
import { itemVariants, motionTokens, pageVariants, spring } from '../motion';

const compactPlayCount = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

function AlbumPlaylistAction({ song, savedIn, loading }: { readonly song: UnifiedSong; readonly savedIn: readonly string[]; readonly loading: boolean }) {
  const flowRef = useRef<HTMLSpanElement | null>(null);
  const saved = savedIn.length > 0;
  const label = loading
    ? `Checking playlist membership for ${song.title}`
    : saved
      ? `Saved in ${savedIn.join(', ')}. Manage playlists for ${song.title}`
      : `Save ${song.title} to a playlist`;

  return (
    <span ref={flowRef} className="album-track__playlist-action">
      <span className="album-track__playlist-flow" hidden aria-hidden="true"><PlaylistMenu song={song} /></span>
      <IconButton
        icon={saved ? Check : Plus}
        className={`album-track__playlist-trigger${saved ? ' is-saved' : ''}`}
        label={label}
        active={saved}
        aria-pressed={saved}
        disabled={loading}
        onClick={() => flowRef.current?.querySelector<HTMLButtonElement>('.album-track__playlist-flow button')?.click()}
      />
    </span>
  );
}

interface AlbumPageProps {
  readonly seed: UnifiedSong;
  /** The catalog's album (`GET /api/albums/:id`) once loaded: its name, artist and year win over the seed's. */
  readonly detail?: AlbumDetail | null;
  /** True while the catalog's tracks are on their way. */
  readonly loading?: boolean;
  readonly tracks: UnifiedSong[];
  readonly palette: Palette;
  readonly currentSongId: string | null;
  readonly isPlaying: boolean;
  readonly likedIds: Set<string>;
  readonly onPlayTrack: (song: UnifiedSong, queue: UnifiedSong[]) => void;
  readonly onPlayAll: () => void;
  readonly onShuffle: () => void;
  readonly onLike: (song: UnifiedSong) => void;
  readonly onLikeAlbum: () => void;
  readonly albumLiked: boolean;
}

/**
 * Immersive album surface: artwork palette + WebGL field + dark mask behind a
 * hero + track list. Feeling of the cover, not a giant blurry wallpaper.
 */
export function AlbumPage({
  seed,
  detail = null,
  loading = false,
  tracks,
  palette,
  currentSongId,
  isPlaying,
  likedIds,
  onPlayTrack,
  onPlayAll,
  onShuffle,
  onLike,
  onLikeAlbum,
  albumLiked
}: AlbumPageProps) {
  const reduced = useReducedMotion();
  const { playlists, contains, loading: playlistsLoading } = usePlaylistsContext();
  const totalDuration = useMemo(() => tracks.reduce((sum, track) => sum + track.duration, 0), [tracks]);
  const hasPlayCounts = tracks.some((track) => Number.isFinite(track.playCount) && track.playCount > 0);
  const savedInByTrack = useMemo(() => new Map(tracks.map((track) => [
    track.id,
    playlists.filter((playlist) => contains(playlist.id, track)).map((playlist) => playlist.name)
  ])), [contains, playlists, tracks]);
  // The catalog's year when it gave one; never a guess.
  const year = detail?.year ?? null;
  const title = detail?.name ?? (seed.album?.trim() || seed.title);
  const artist = detail?.artist ?? seed.artist;

  const shellStyle = {
    '--album-primary': palette.primary,
    '--album-secondary': palette.secondary,
    '--album-tertiary': palette.tertiary,
    ...(seed.artwork ? { '--cover': `url(${JSON.stringify(seed.artwork)})` } : {})
  } as CSSProperties;

  return (
    <motion.div
      className="album-page"
      style={shellStyle}
      variants={pageVariants}
      initial="hidden"
      animate="visible"
      transition={reduced ? { duration: motionTokens.duration.instant } : undefined}
    >
      <motion.section className="album-hero" variants={itemVariants} aria-labelledby="album-title">
        <motion.div
          className="album-hero__art"
          animate={reduced ? undefined : { scale: isPlaying && currentSongId && tracks.some((t) => t.id === currentSongId) ? 1.015 : 1 }}
          transition={spring.breathe}
        >
          <Artwork song={seed} size="large" layoutId={`album-art-${seed.id}`} />
        </motion.div>

        <div className="album-hero__copy">
          <span className="album-hero__eyebrow">Album</span>
          <h1 id="album-title">{title}</h1>
          <p className="album-hero__artist">{artist}</p>
          <p className="album-hero__meta" aria-live="polite">
            {year ? `${year} · ` : ''}
            {loading && tracks.length === 0
              ? 'Loading the whole album…'
              : `${tracks.length} ${tracks.length === 1 ? 'Song' : 'Songs'} · ${formatAlbumDuration(totalDuration)}${loading ? ' · loading the rest…' : ''}`}
          </p>
        </div>
      </motion.section>

      <motion.section className="album-hero__actions album-toolbar" variants={itemVariants} aria-label="Album actions">
        <IconButton icon={Play} className="album-toolbar__play" label={`Play ${title}`} onClick={onPlayAll} />
        <TactileButton variant="secondary" icon={Shuffle} className="album-toolbar__shuffle" aria-label={`Shuffle ${title}`} onClick={onShuffle}>
          Shuffle
        </TactileButton>
        <IconButton
          icon={Heart}
          label={albumLiked ? 'Remove album from likes' : 'Like album'}
          active={albumLiked}
          aria-pressed={albumLiked}
          onClick={onLikeAlbum}
        />
        <SavePlaylistButton songs={tracks} defaultName={title} disabled={loading} className="album-toolbar__save" />
      </motion.section>

      <motion.section className={`album-tracklist${hasPlayCounts ? ' album-tracklist--has-counts' : ''}`} variants={itemVariants} aria-label="Album tracks">
        <div className="album-tracklist__table" role="table" aria-label="Tracks">
          <div className="album-tracklist__head" role="rowgroup">
            <div className="album-tracklist__row album-tracklist__row--head" role="row">
              <span role="columnheader">Track</span>
              <span role="columnheader">Title and artist</span>
              {hasPlayCounts ? <span role="columnheader" className="album-track__plays">Plays</span> : null}
              <span role="columnheader" className="album-track__duration">Time</span>
              <span role="columnheader" className="sr-only">Track actions</span>
            </div>
          </div>
          {tracks.length > 0 ? (
            <div className="album-tracklist__rows" role="rowgroup">
              {tracks.map((track, index) => {
                const current = track.id === currentSongId;
                const playing = current && isPlaying;
                const liked = likedIds.has(track.id);
                const savedIn = savedInByTrack.get(track.id) ?? [];
                return (
                  <div key={track.id} className={`album-track${current ? ' is-current' : ''}`} role="row" data-playing={playing ? 'true' : undefined}>
                    <button
                      type="button"
                      role="cell"
                      aria-colspan={hasPlayCounts ? 4 : 3}
                      aria-current={current ? 'true' : undefined}
                      aria-pressed={current ? isPlaying : undefined}
                      className="album-track__main"
                      onClick={() => onPlayTrack(track, tracks)}
                      aria-label={`${playing ? 'Pause' : 'Play'} ${track.title}`}
                      title={`${playing ? 'Pause' : 'Play'} ${track.title}`}
                    >
                      <span className="album-track__index" aria-hidden="true">
                        {playing
                          ? <Pause className="album-track__index-current" size={14} fill="currentColor" />
                          : current
                            ? <Play className="album-track__index-current" size={14} fill="currentColor" />
                            : <><span className="album-track__index-number">{String(index + 1).padStart(2, '0')}</span><Play className="album-track__index-hover" size={14} fill="currentColor" /></>}
                      </span>
                      <span className="album-track__copy">
                        <span className="album-track__title">{track.title}</span>
                        <span className="album-track__artist">{track.artist}</span>
                      </span>
                      {hasPlayCounts ? <span className="album-track__plays">{track.playCount > 0 ? compactPlayCount.format(track.playCount) : '—'}</span> : null}
                      <span className="album-track__duration">{formatTime(track.duration)}</span>
                    </button>
                    <div className="album-track__actions" role="cell" aria-label={`Actions for ${track.title}`}>
                      <IconButton
                        icon={Heart}
                        className={`album-track__more${liked ? ' is-liked' : ''}`}
                        label={liked ? `Remove ${track.title} from likes` : `Add ${track.title} to likes`}
                        active={liked}
                        aria-pressed={liked}
                        onClick={() => onLike(track)}
                      />
                      <AlbumPlaylistAction song={track} savedIn={savedIn} loading={playlistsLoading} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="album-tracklist__empty" role="status">
              {loading ? 'Loading the album tracks…' : 'No playable tracks are available for this album.'}
            </p>
          )}
        </div>
      </motion.section>
    </motion.div>
  );
}
