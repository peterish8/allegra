import { Heart, Pause, Play, SkipForward } from 'lucide-react';

import type { UnifiedSong } from '@shared/types';

import type { Palette } from '../../lib/palette';
import { Artwork } from '../ui';
import { DjTint } from './DjMascot';

export interface DjNowPlayingProps {
  readonly song: UnifiedSong;
  readonly playing: boolean;
  readonly liked: boolean;
  /** True while the DJ's own set is playing. */
  readonly live: boolean;
  /** Why the DJ picked this song, when it did. */
  readonly reason: string;
  readonly palette: Palette;
  readonly onToggle: () => void;
  readonly onLike: () => void;
  /** Skips and tells the DJ this one was not right. */
  readonly onSkip: () => void;
}

/**
 * The top of the queue box: the song that is playing now. It is the only row washed in the song's
 * colours, with live level bars on the cover (driven by `--dj-bass`, `--dj-voice`, `--dj-energy` and
 * `--dj-onset` from the page's loop), so it reads as "this is on" rather than "this is next".
 */
export function DjNowPlaying({ song, playing, liked, live, reason, palette, onToggle, onLike, onSkip }: DjNowPlayingProps) {
  return (
    <div className="dj-now" data-playing={playing ? 'true' : 'false'}>
      <DjTint palette={palette} className="dj-now-wash" />
      <button type="button" className="dj-now-art" onClick={onToggle} aria-label={playing ? `Pause ${song.title}` : `Play ${song.title}`}>
        <Artwork song={song} size="small" />
        <span className="dj-eq" aria-hidden="true"><i /><i /><i /><i /></span>
      </button>
      <div className="dj-now-copy">
        <span className="dj-now-label"><i className="dj-now-dot" aria-hidden="true" />{playing ? 'Now playing' : 'Paused'}{live ? <span className="dj-now-badge" title="From your DJ’s set">DJ</span> : null}</span>
        <strong>{song.title}</strong>
        <small>{song.artist}</small>
        {reason ? <em title={reason}>{reason}</em> : null}
      </div>
      <div className="dj-now-actions">
        <button type="button" className={`dj-icon-button${liked ? ' is-liked' : ''}`} aria-label={liked ? 'Unlike this song' : 'Love this song'} aria-pressed={liked} onClick={onLike}>
          <Heart size={17} fill={liked ? 'currentColor' : 'none'} />
        </button>
        <button type="button" className="dj-icon-button dj-icon-button--solid" aria-label={playing ? 'Pause' : 'Play'} onClick={onToggle}>
          {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
        </button>
        <button type="button" className="dj-icon-button" aria-label="Not this one: skip and tell your DJ" title="Not this one" onClick={onSkip}>
          <SkipForward size={17} fill="currentColor" />
        </button>
      </div>
    </div>
  );
}
