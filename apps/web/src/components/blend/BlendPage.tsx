import { Heart, ImageDown, LogOut, Pencil, Play, Share2 } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { CSSProperties, Ref } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { BlendTrack, PairMatch } from '@shared/blendTypes';
import type { BlendDetail } from '@shared/blendView';
import { BLEND_NAME_MAX, utcDay } from '@shared/blendLimits';
import type { UnifiedSong } from '@shared/types';

import { announceBlendsChanged } from '../../hooks/useBlends';
import { ApiError, fetchBlend, fetchBlendInvite, leaveBlend, renameBlend } from '../../lib/api';
import { BLEND_TEXT, blendTrackSong, changeText, artistName, learningOffText } from '../../lib/blendText';
import { paths } from '../../lib/routes';
import { exitUp, itemVariants, motionTokens, pageVariants, swapVariants } from '../../motion';
import { memberTones } from '../../lib/blendTones';
import { DEFAULT_PALETTE } from '../../lib/palette';
import { SkeletonCard, TactileButton } from '../ui';
import { BlendInviteSheet } from './BlendInviteSheet';
import { BlendRing } from './BlendRing';
import { markRevealSeen, revealKey, revealSeen, useBlendPalette } from './blendReveal';
import { BlendSheet } from './BlendSheet';
import { BlendStories } from './BlendStories';
import { BlendStage } from './BlendStage';
import { MatchCardSheet } from './MatchCardSheet';
import { BlendTones, MemberDiscs } from './MemberDisc';
import { InfoTour } from '../InfoTour';
import { BLEND_TOUR } from '../pageTours';
import { blendScene } from '../infoScenes';

interface BlendPageProps {
  readonly blendId: string;
  readonly currentSongId: string | null;
  readonly isPlaying: boolean;
  readonly likedIds: ReadonlySet<string>;
  /** The app's one playback funnel (App.playSong): never the audio element directly. */
  readonly onPlay: (song: UnifiedSong, queue: UnifiedSong[]) => void;
  readonly onLike: (song: UnifiedSong) => void;
}

type Load = { readonly kind: 'loading' } | { readonly kind: 'ready'; readonly detail: BlendDetail } | { readonly kind: 'notfound' } | { readonly kind: 'error'; readonly message: string };

export function BlendPage({ blendId, currentSongId, isPlaying, likedIds, onPlay, onLike }: BlendPageProps) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [revealing, setRevealing] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ kind: 'loading' });
    fetchBlend(blendId, controller.signal)
      .then((detail) => {
        if (controller.signal.aborted) return;
        setLoad({ kind: 'ready', detail });
        setRevealing(detail.state === 'ready' && detail.members.length >= 2 && !revealSeen(detail));
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        if (failure instanceof ApiError && failure.status === 404) setLoad({ kind: 'notfound' });
        else setLoad({ kind: 'error', message: failure instanceof Error ? failure.message : 'Your Blend could not be loaded.' });
      });
    return () => controller.abort();
  }, [blendId, attempt]);

  const waitingForBuild = load.kind === 'ready' && load.detail.members.length >= 2 && load.detail.stale === true;
  useEffect(() => {
    if (!waitingForBuild) return;
    const controller = new AbortController();
    let timer: number | undefined;
    let pending = false;
    let tries = 0;
    const schedule = () => {
      if (controller.signal.aborted || timer !== undefined || pending || tries >= 6 || document.visibilityState !== 'visible') return;
      timer = window.setTimeout(() => { timer = undefined; void tick(); }, 3000);
    };
    const tick = async () => {
      pending = true;
      tries += 1;
      try {
        const detail = await fetchBlend(blendId, controller.signal);
        if (controller.signal.aborted) return;
        setLoad({ kind: 'ready', detail });
        if (!detail.stale && detail.state === 'ready' && !revealSeen(detail)) setRevealing(true);
        if (!detail.stale) return;
      } catch { if (controller.signal.aborted) return; }
      finally { pending = false; }
      schedule();
    };
    document.addEventListener('visibilitychange', schedule);
    schedule();
    return () => { controller.abort(); if (timer !== undefined) window.clearTimeout(timer); document.removeEventListener('visibilitychange', schedule); };
  }, [blendId, waitingForBuild]);

  if (load.kind === 'loading') {
    return (
      <section className="blend-page" aria-busy="true" aria-label="Loading your Blend">
        <div className="blend-header blend-header--skeleton"><span className="skeleton blend-join__disc-skeleton" /><span className="skeleton-line skeleton-line-long" /></div>
        <div className="blend-stories blend-stories--skeleton" aria-hidden="true"><span className="skeleton story-card" /><span className="skeleton story-card" /></div>
        <div className="track-list"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      </section>
    );
  }
  if (load.kind === 'notfound') {
    return (
      <section className="blend-page"><div className="state-card"><h3>Blend not found</h3><p>{BLEND_TEXT.notfound}</p><Link className="import-link" href={paths.library}>Go to Library</Link></div></section>
    );
  }
  if (load.kind === 'error') {
    return (
      <section className="blend-page"><div className="state-card" role="alert"><h3>That did not load</h3><p>{load.message}</p><TactileButton variant="accent" onClick={() => setAttempt((count) => count + 1)}>Try again</TactileButton></div></section>
    );
  }
  return (
    <BlendView detail={load.detail} revealing={revealing} onRevealed={() => { markRevealSeen(load.detail); setRevealing(false); }} currentSongId={currentSongId} isPlaying={isPlaying} likedIds={likedIds} onPlay={onPlay} onLike={onLike} onRefresh={() => setAttempt(value => value + 1)} onRenamed={(name) => setLoad({ kind: 'ready', detail: { ...load.detail, name } })} />
  );
}

function BlendView({ detail, revealing, onRevealed, currentSongId, isPlaying, likedIds, onPlay, onLike, onRefresh, onRenamed }: {
  readonly detail: BlendDetail;
  /** Play the reveal in the hero; everything below waits for the number to land. */
  readonly revealing: boolean;
  readonly onRevealed: () => void;
  readonly currentSongId: string | null;
  readonly isPlaying: boolean;
  readonly likedIds: ReadonlySet<string>;
  readonly onPlay: (song: UnifiedSong, queue: UnifiedSong[]) => void;
  readonly onLike: (song: UnifiedSong) => void;
  readonly onRenamed: (name: string) => void;
  readonly onRefresh: () => void;
}) {
  const router = useRouter();
  const palette = useBlendPalette(detail);
  const [filter, setFilter] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ code: string; url: string; expiresAt: number } | null>(null);
  const [openPair, setOpenPair] = useState<PairMatch | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const viewer = detail.members.find((member) => member.isYou);
  const group = detail.members.length > 2;
  const pair = detail.pairs[0];
  const match = group && detail.pairs.length > 0 ? Math.round(detail.pairs.reduce((total, item) => total + item.match, 0) / detail.pairs.length) : pair?.match;
  const tracks = useMemo(() => (filter ? detail.tracks.filter((track) => track.for.includes(filter)) : detail.tracks), [detail.tracks, filter]);
  const songs = useMemo(() => tracks.map(blendTrackSong), [tracks]);
  const updatedToday = !detail.stale && detail.builtFor === utcDay(Date.now());
  const waiting = detail.members.length < 2;
  const tones = useMemo(() => memberTones(detail.members), [detail.members]);
  const reduced = useReducedMotion() ?? false;

  const leave = async (): Promise<void> => {
    try {
      await leaveBlend(detail.id);
      announceBlendsChanged();
      router.push(paths.library);
    } catch (failure) {
      setLeaveError(failure instanceof Error ? failure.message : 'That did not work. Try again.');
    }
  };

  const openInvite = useCallback(async () => {
    setInviteError(null);
    try {
      setInvite(await fetchBlendInvite(detail.id));
    } catch (failure) {
      setInviteError(failure instanceof Error ? failure.message : 'The invite could not be loaded. Try again.');
    }
  }, [detail.id]);

  return (
    <BlendTones.Provider value={tones}>
    <motion.section className="blend-page" aria-labelledby="blend-title" variants={pageVariants} initial="hidden" animate="visible">
      <motion.header className="blend-hero" variants={itemVariants}>
        <BlendStage key={revealKey(detail)} members={detail.members} tones={tones} match={waiting ? undefined : match} group={group} intro={revealing} onIntroDone={onRevealed} focus={filter} />
        <div className="blend-hero__bar">
          <div className="blend-hero__copy">
            <div className="page-title-row"><BlendTitle detail={detail} canRename={viewer?.userId === detail.ownerId} onRenamed={onRenamed} /><InfoTour label="How this Blend works" steps={BLEND_TOUR} stage={blendScene} /></div>
            <p className="blend-hero__meta">
              {updatedToday ? <span>Updated today</span> : null}
              {!waiting ? <span>{detail.tracks.length} songs</span> : null}
              {!group && pair?.confidence === 'low' ? <span>{BLEND_TEXT.lowconfidence}</span> : null}
            </p>
            {detail.change ? <p className="blend-hero__note">{changeText(detail.change, artistName(detail.change.artist, detail.tracks))}</p> : null}
            {detail.members.filter((member) => !member.learning).map((member) => <p key={member.userId} className="blend-hero__note">{member.isYou ? 'Your picks come from likes and playlists.' : learningOffText(member.displayName)}</p>)}
          </div>
          <div className="blend-hero__actions">
            {songs.length > 0 ? (
              <button type="button" className="blend-round is-play" aria-label={`Play ${detail.name}`} title="Play" onClick={() => { const first = songs[0]; if (first) onPlay(first, songs); }}>
                <Play size={24} fill="currentColor" aria-hidden="true" />
              </button>
            ) : null}
            <button type="button" className="blend-round" aria-label="Invite someone" title="Invite" onClick={() => void openInvite()}><Share2 size={18} aria-hidden="true" /></button>
            {!waiting && match !== undefined && detail.state === 'ready' ? <button type="button" className="blend-round" aria-label="Share your match card" title="Match card" onClick={() => setCardOpen(true)}><ImageDown size={18} aria-hidden="true" /></button> : null}
            <button type="button" className="blend-round" aria-label="Leave this Blend" title="Leave" onClick={() => setLeaving(true)}><LogOut size={18} aria-hidden="true" /></button>
          </div>
        </div>
      </motion.header>
      {inviteError ? <p role="alert" className="blend-sheet__error">{inviteError}</p> : null}
      {detail.stale && !waiting ? <p role="status" className="blend-hero__note">Your Blend is waiting to refresh. <button type="button" onClick={onRefresh}>Refresh</button></p> : null}

      {waiting ? (
        <div className="state-card blend-waiting"><h3>Your Blend needs a second person</h3><p>Send the link. The empty orb fills in with their colour the moment they join.</p><TactileButton variant="accent" icon={Share2} onClick={() => void openInvite()}>Send invite</TactileButton></div>
      ) : detail.state === 'not_enough' ? (
        <div className="state-card"><h3>Not enough yet</h3><p>{BLEND_TEXT.notenough}</p></div>
      ) : (
        <motion.div className="blend-body" inert={revealing} initial={false} animate={revealing ? { opacity: 0, y: reduced ? 0 : 18 } : { opacity: 1, y: 0 }} transition={{ duration: reduced ? motionTokens.duration.instant : motionTokens.duration.slow, ease: motionTokens.ease.decelerate }}>
          {/* The match already fills the hero; the cards carry the rest of the story. */}
          <BlendStories detail={{ ...detail, stories: detail.stories.filter((story) => story.kind !== 'match' && story.kind !== 'groupMatch') }} palette={palette} onPlay={(song) => onPlay(song, [song])} />
          {group ? <section className="blend-pairs" aria-label="Pairs"><BlendRing members={detail.members} pairs={detail.pairs} onPair={setOpenPair} /></section> : null}
          <div className="blend-lens" role="group" aria-label="Show picks for">
            {[null, ...detail.members].map((member) => {
              const id = member?.userId ?? null;
              const active = filter === id;
              return (
                <button key={id ?? 'all'} type="button" aria-pressed={active} className={`blend-lens__option${active ? ' is-active' : ''}`} style={{ '--tone': id ? tones.get(id) : undefined } as CSSProperties} onClick={() => setFilter(id)}>
                  {active ? <motion.span layoutId="blend-lens-pill" className="blend-lens__pill" transition={{ duration: reduced ? 0 : motionTokens.duration.base, ease: motionTokens.ease.decelerate }} /> : null}
                  <span className="blend-lens__label">{member ? <><span className="blend-lens__dot" aria-hidden="true" />{member.isYou ? 'You' : member.displayName}</> : 'Everyone'}</span>
                </button>
              );
            })}
          </div>
          <ol className="blend-tracks">
            {/* Lens swap: rows not theirs lift away, theirs close up; a new tap retargets mid-swap. */}
            <AnimatePresence mode="popLayout" initial={false}>
            {tracks.map((track, index) => (
              <BlendTrackRow
                key={track.song.ref}
                reduced={reduced}
                track={track}
                index={index}
                detail={detail}
                tones={tones}
                song={songs[index] as UnifiedSong}
                active={currentSongId === songs[index]?.id}
                isPlaying={isPlaying}
                liked={likedIds.has(songs[index]?.id ?? '')}
                onPlay={() => { const song = songs[index]; if (song) onPlay(song, songs); }}
                onLike={() => { const song = songs[index]; if (song) onLike(song); }}
              />
            ))}
            </AnimatePresence>
          </ol>
        </motion.div>
      )}

      {leaving ? (
        <BlendSheet title={`Leave ${detail.name}?`} onClose={() => { setLeaving(false); setLeaveError(null); }}>
          {() => (
            <>
              <p className="blend-sheet__body">You&rsquo;ll stop seeing it, and it refreshes without your songs.</p>
              <div className="blend-sheet__actions">
                <TactileButton variant="accent" onClick={() => void leave()}>Leave</TactileButton>
                <TactileButton variant="ghost" onClick={() => setLeaving(false)}>Stay</TactileButton>
              </div>
              {leaveError ? <p className="blend-sheet__error" role="alert">{leaveError}</p> : null}
            </>
          )}
        </BlendSheet>
      ) : null}
      {invite ? <BlendInviteSheet blendId={detail.id} invite={invite} onClose={() => setInvite(null)} /> : null}
      {cardOpen && match !== undefined ? <MatchCardSheet detail={detail} tones={tones} palette={palette ?? DEFAULT_PALETTE} match={match} onClose={() => setCardOpen(false)} /> : null}
      {openPair ? <PairSheet pair={openPair} detail={detail} onClose={() => setOpenPair(null)} /> : null}
    </motion.section>
    </BlendTones.Provider>
  );
}

function BlendTitle({ detail, canRename, onRenamed }: { readonly detail: BlendDetail; readonly canRename: boolean; readonly onRenamed: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(detail.name);
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > BLEND_NAME_MAX) {
      setError(`A name needs 1 to ${BLEND_NAME_MAX} characters.`);
      return;
    }
    try {
      const saved = await renameBlend(detail.id, trimmed);
      onRenamed(saved.name);
      announceBlendsChanged();
      setEditing(false);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That did not save.');
    }
  };
  if (!editing) {
    return (
      <h1 id="blend-title" className="blend-header__title">
        {detail.name}
        {canRename ? <button type="button" className="blend-rename" onClick={() => { setName(detail.name); setEditing(true); }} aria-label="Rename this Blend"><Pencil size={14} aria-hidden="true" /></button> : null}
      </h1>
    );
  }
  return (
    <form className="blend-rename-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <h1 id="blend-title" className="sr-only">{detail.name}</h1>
      <label className="sr-only" htmlFor="blend-name">Blend name</label>
      <input id="blend-name" value={name} maxLength={BLEND_NAME_MAX} onChange={(event) => setName(event.target.value)} autoFocus />
      <TactileButton type="submit" variant="accent">Save</TactileButton>
      <TactileButton type="button" variant="ghost" onClick={() => { setEditing(false); setError(null); }}>Cancel</TactileButton>
      {error ? <p className="blend-sheet__error" role="alert">{error}</p> : null}
    </form>
  );
}

function BlendTrackRow({ ref, reduced, track, index, detail, tones, song, active, isPlaying, liked, onPlay, onLike }: {
  /** AnimatePresence's popLayout measures the leaving row through this. */
  readonly ref?: Ref<HTMLLIElement>;
  readonly reduced: boolean;
  readonly track: BlendTrack;
  readonly index: number;
  readonly detail: BlendDetail;
  readonly tones: ReadonlyMap<string, string>;
  readonly song: UnifiedSong;
  readonly active: boolean;
  readonly isPlaying: boolean;
  readonly liked: boolean;
  readonly onPlay: () => void;
  readonly onLike: () => void;
}) {
  const holders = detail.members.filter((member) => track.for.includes(member.userId));
  // Whose taste it came from, as colour: one person's tone, a blend of tones when shared, none for a discovery.
  const colours = holders.map((member) => tones.get(member.userId) ?? 'transparent');
  const stripe = colours.length === 0 ? 'rgba(255, 255, 255, 0.18)' : colours.length === 1 ? colours[0] : `linear-gradient(180deg, ${colours.join(', ')})`;
  return (
    <motion.li
      ref={ref}
      className={`blend-track${active ? ' is-current' : ''} is-${track.kind}`}
      style={{ '--stripe': stripe } as CSSProperties}
      layout={reduced ? false : 'position'}
      variants={swapVariants}
      initial={reduced ? { opacity: 0 } : 'hidden'}
      animate="visible"
      exit={reduced ? { opacity: 0, transition: { duration: motionTokens.duration.instant } } : exitUp}
      transition={{ layout: { duration: motionTokens.duration.base, ease: motionTokens.ease.standard } }}
    >
      <span className="blend-track__index" aria-hidden="true">{index + 1}</span>
      <button type="button" className="blend-track__main" onClick={onPlay} aria-label={`Play ${song.title} by ${song.artist}`} aria-current={active && isPlaying ? 'true' : undefined}>
        {song.artwork ? <img className="blend-track__art" src={song.artwork} alt="" width={44} height={44} loading="lazy" /> : <span className="blend-track__art" />}
        <span className="blend-track__text"><span className="blend-track__title">{song.title}</span><span className="blend-track__artist">{song.artist}</span></span>
      </button>
      <span className="blend-track__for">
        {track.kind === 'discovery' ? <span className="blend-track__new">{BLEND_TEXT.newForYou}</span> : <MemberDiscs members={holders} size="small" />}
      </span>
      <button type="button" className={`blend-track__like${liked ? ' is-active' : ''}`} onClick={onLike} aria-pressed={liked} aria-label={liked ? `Unlike ${song.title}` : `Like ${song.title}`}>
        <Heart size={16} fill={liked ? 'currentColor' : 'none'} aria-hidden="true" />
      </button>
    </motion.li>
  );
}

/** One pair of a group, opened from its line in the ring: the match and both directions. */
function PairSheet({ pair, detail, onClose }: { readonly pair: PairMatch; readonly detail: BlendDetail; readonly onClose: () => void }) {
  const viewer = detail.members.find((member) => member.isYou)?.userId;
  const viewerIsA = pair.a === viewer;
  const otherId = viewerIsA ? pair.b : pair.a;
  const other = detail.members.find((member) => member.userId === otherId)?.displayName ?? 'Someone';
  return (
    <BlendSheet title={`You and ${other}`} onClose={onClose}>
      {() => (
        <>
          <p className="blend-sheet__lead">Taste match {pair.match}%{pair.confidence === 'low' ? ` · ${BLEND_TEXT.lowconfidence}` : ''}</p>
          <p className="blend-sheet__body">Estimated overlap: your picks fit {Math.round(100 * (viewerIsA ? pair.cover.b : pair.cover.a))}% of {other}&rsquo;s taste; theirs fit {Math.round(100 * (viewerIsA ? pair.cover.a : pair.cover.b))}% of yours.</p>
          {pair.together ? <p className="blend-sheet__body">The artist that brings you together: {artistName(pair.together, detail.tracks)}</p> : null}
          <div className="blend-sheet__actions"><TactileButton variant="ghost" onClick={onClose}>Close</TactileButton></div>
        </>
      )}
    </BlendSheet>
  );
}
