import type { ListenVerdict } from '@shared/listenSignal';
import { RadioSession, radioReasonLabel, type RadioSource, type RadioTaste } from '@shared/radio';
import type { UnifiedSong } from '@shared/types';

import { catalogSongId } from './songIdentity';

/** The slice of the audio player the radio reads and edits. */
export interface RadioTransport {
  readonly currentSong: UnifiedSong | null;
  /** History, the current song and everything upcoming, in play order. */
  readonly queue: readonly UnifiedSong[];
  readonly repeat?: 'off' | 'all' | 'one';
  /** Replaces everything after the current song. */
  replaceUpcoming(songs: readonly UnifiedSong[]): void;
}

/** One related song from the fuller radio pool, tagged with why it was found. */
export interface RadioCandidate {
  readonly song: UnifiedSong;
  readonly source: Exclude<RadioSource, 'mix'>;
}

/** Where candidates come from. Both receive the session's abort signal and may answer late. */
export interface RadioSources {
  /** The catalog's quick suggestions for one song. */
  suggestions(id: string, signal: AbortSignal): Promise<UnifiedSong[]>;
  /** The fuller pool: the seed's artist and the listener's taste, plus that taste itself. */
  pool(id: string, signal: AbortSignal): Promise<{ readonly candidates: readonly RadioCandidate[]; readonly taste: RadioTaste | null }>;
}

/** Radio songs kept ready after everything the listener chose. */
const UPCOMING = 10;

interface SourceResult {
  readonly added: number;
  /** The provider sent songs back. An empty or failed answer may be an outage, so it can be asked again. */
  readonly answered: boolean;
}

const UNANSWERED: SourceResult = { added: 0, answered: false };

function upcomingOf(player: RadioTransport): UnifiedSong[] {
  const current = player.currentSong;
  const at = current ? player.queue.findIndex((song) => song.id === current.id) : -1;
  return at >= 0 ? player.queue.slice(at + 1) : [];
}

/**
 * A song radio for one listening session (`packages/shared/radio.ts` ranks it). It only ever moves
 * the songs it placed itself: the listener's own picks, an album or playlist, and a queue handed
 * over by Connect all stay where they are, and radio continues after them. Every async answer must
 * still belong to the running session before it touches the queue.
 */
export class SongRadio {
  private session: RadioSession<UnifiedSong> | null = null;
  private controller = new AbortController();
  /** Per catalog id: the session's fetch of its related songs, shared by every caller. */
  private readonly requests = new Map<string, Promise<void>>();
  private readonly reasons = new Map<string, string>();
  /** Songs the radio put in the queue: the only ones it may re-rank or replace. */
  private readonly picked = new Set<string>();
  private readonly skipped = new Set<string>();
  /** Songs that started under this radio: only their endings teach it. */
  private readonly heard = new Set<string>();
  /** The listener chose more than the seed (an album, a playlist, a handed-over queue). */
  private hasContext = false;

  public constructor(
    private readonly transport: { readonly current: RadioTransport },
    private readonly sources: RadioSources
  ) {}

  /** Starts a fresh radio from `seed`; `context` is what the listener chose to hear around it. */
  public start = (seed: UnifiedSong, context: readonly UnifiedSong[] = []): void => {
    this.stop();
    this.session = new RadioSession(seed);
    this.hasContext = context.some((song) => song.id !== seed.id);
    this.heard.add(seed.id);
    void this.load(this.session, seed);
  };

  public stop = (): void => {
    this.controller.abort();
    this.controller = new AbortController();
    this.session = null;
    this.requests.clear();
    this.reasons.clear();
    this.picked.clear();
    this.skipped.clear();
    this.heard.clear();
    this.hasContext = false;
  };

  /** Re-ranks the radio's own songs after everything else upcoming. Returns songs newly placed. */
  private rerank = (): number => {
    const radio = this.session;
    const player = this.transport.current;
    const current = player.currentSong;
    if (!radio || !current || !this.heard.has(current.id)) return 0;
    const upcoming = upcomingOf(player);
    const fixed = upcoming.filter((song) => !this.picked.has(song.id));
    // Repeat all on a chosen album or playlist loops it, as Spotify does: no radio after it.
    const loops = player.repeat === 'all' && this.hasContext;
    const ranked = loops ? [] : radio.next(UPCOMING, { exclude: fixed.map((song) => song.id), after: fixed.at(-1) ?? current });
    // Nothing to offer is an outage, not a decision: keep the playable tail.
    if (!loops && ranked.length === 0) return 0;
    const next = [...fixed, ...ranked.map((pick) => pick.song)];
    if (next.length === upcoming.length && next.every((song, index) => song.id === upcoming[index]?.id)) return 0;
    for (const pick of ranked) {
      this.picked.add(pick.song.id);
      this.reasons.set(pick.song.id, radioReasonLabel(pick.reason));
    }
    const previous = new Set(upcoming.map((song) => song.id));
    player.replaceUpcoming(next);
    return next.filter((song) => !previous.has(song.id)).length;
  };

  /**
   * Fetches candidates related to `from`, once per session. Resolves as soon as one source added
   * songs (the catalog's suggestions usually answer first); the slower source re-ranks on arrival.
   */
  private load(radio: RadioSession<UnifiedSong>, from: UnifiedSong): Promise<void> {
    const id = catalogSongId(from);
    const pending = this.requests.get(id);
    if (pending) return pending;
    const signal = this.controller.signal;
    const live = (): boolean => this.session === radio && !signal.aborted;
    const similar = this.sources.suggestions(id, signal).then((songs): SourceResult => {
      if (!live()) return UNANSWERED;
      const added = radio.add(songs.filter((song) => Boolean(song.streamUrl)), 'similar', from);
      this.rerank();
      return { added, answered: songs.length > 0 };
    }).catch(() => UNANSWERED);
    const pool = this.sources.pool(id, signal).then(({ candidates, taste }): SourceResult => {
      if (!live()) return UNANSWERED;
      let added = 0;
      if (taste) radio.setTaste(taste);
      for (const source of ['similar', 'artist', 'taste'] as const) {
        added += radio.add(candidates.filter((candidate) => candidate.source === source && candidate.song.streamUrl).map((candidate) => candidate.song), source, from);
      }
      this.rerank();
      return { added, answered: candidates.length > 0 };
    }).catch(() => UNANSWERED);
    const ready = new Promise<void>((resolve) => {
      let waiting = 2;
      const settle = ({ added }: SourceResult): void => {
        waiting -= 1;
        if (added > 0 || waiting === 0) resolve();
      };
      void similar.then(settle);
      void pool.then(settle);
    });
    // Ask again later only when neither provider answered. A list of songs already known is final.
    void Promise.all([similar, pool]).then(([a, b]) => {
      if (live() && !a.answered && !b.answered) this.requests.delete(id);
    });
    this.requests.set(id, ready);
    return ready;
  }

  /**
   * Keeps radio songs ready after the current one. Starts a radio from the playing song when none
   * is running (a song handed over by Connect), keeping whatever was already queued after it.
   */
  public fill = async (signal?: AbortSignal): Promise<number> => {
    const current = this.transport.current.currentSong;
    if (!current || signal?.aborted) return 0;
    if (!this.session) this.start(current, upcomingOf(this.transport.current));
    const radio = this.session;
    if (!radio) return 0;
    await this.load(radio, current);
    // A skip may have happened while the providers were answering. Never use its old queue snapshot.
    const stale = (): boolean => Boolean(signal?.aborted) || this.session !== radio || this.transport.current.currentSong?.id !== current.id;
    if (stale()) return 0;
    this.heard.add(current.id);
    radio.markPlayed(current);
    let added = this.rerank();
    if (radio.needsMore) {
      // Walk the related-song graph: the latest song heard out, then the queue's tail.
      const player = this.transport.current;
      const nextSeed = [radio.refillSeed, ...player.queue.slice().reverse()].find((song) => !this.requests.has(catalogSongId(song)));
      if (nextSeed) {
        await this.load(radio, nextSeed);
        if (stale()) return added;
        added += this.rerank();
      }
    }
    return added;
  };

  /** How a song ended: the radio learns and re-ranks its own songs. */
  public outcome = (song: UnifiedSong, verdict: ListenVerdict): void => {
    const radio = this.session;
    if (!radio || !this.heard.has(song.id)) return;
    radio.record(song, verdict);
    if (verdict === 'early-skip' || verdict === 'instant-skip') this.skipped.add(song.id);
    this.rerank();
    if (verdict === 'finished') void this.load(radio, song);
  };

  /** A song started. Coming back to one skipped moments ago takes the skip back. */
  public started = (song: UnifiedSong): void => {
    const radio = this.session;
    if (!radio) return;
    if (this.skipped.delete(song.id)) radio.undoSkip(song);
    radio.markPlayed(song);
    this.heard.add(song.id);
    this.rerank();
  };

  /** A like: more like this, now. */
  public love = (song: UnifiedSong): void => {
    const radio = this.session;
    if (!radio) return;
    radio.love(song);
    this.rerank();
    void this.load(radio, song);
  };

  public reasonFor = (songId: string): string | undefined => this.session ? this.reasons.get(songId) : undefined;
}
