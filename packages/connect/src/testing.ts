import type { PlayerPort, PlayerSnapshot, RepeatMode } from './types.ts';
import type { SongSnapshot } from '../../shared/songRef.ts';

const EMPTY: PlayerSnapshot = {
  queue: [],
  isPlaying: false,
  positionSec: 0,
  volume: 1,
  shuffle: false,
  repeat: 'off'
};

/** Deterministic port fake; configure `rejectsAutoplay` to model browser gesture blocking. */
export class FakePlayerPort implements PlayerPort {
  readonly calls: Array<{ readonly method: string; readonly args: readonly unknown[] }> = [];
  rejectsAutoplay = false;
  nextLoadResult: 'ok' | 'not_found' | 'needs_gesture' = 'ok';
  private snapshot: PlayerSnapshot;
  private readonly listeners = new Set<(snapshot: PlayerSnapshot) => void>();

  constructor(initial: Partial<PlayerSnapshot> = {}) {
    this.snapshot = { ...EMPTY, ...initial, queue: [...(initial.queue ?? EMPTY.queue)] };
  }

  getSnapshot(): PlayerSnapshot {
    return this.snapshot;
  }

  onChange(listener: (snapshot: PlayerSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async play(): Promise<'ok' | 'needs_gesture'> {
    this.calls.push({ method: 'play', args: [] });
    if (this.rejectsAutoplay) return 'needs_gesture';
    this.update({ isPlaying: true });
    return 'ok';
  }

  async pause(): Promise<void> {
    this.calls.push({ method: 'pause', args: [] });
    this.update({ isPlaying: false });
  }

  async seek(sec: number): Promise<void> {
    this.calls.push({ method: 'seek', args: [sec] });
    this.update({ positionSec: Math.max(0, sec) });
  }

  async setVolume(volume: number): Promise<void> {
    this.calls.push({ method: 'setVolume', args: [volume] });
    this.update({ volume });
  }

  async load(song: SongSnapshot, queue: readonly SongSnapshot[], options: { readonly positionSec: number; readonly play: boolean }): Promise<'ok' | 'not_found' | 'needs_gesture'> {
    this.calls.push({ method: 'load', args: [song, [...queue], options] });
    if (this.nextLoadResult === 'not_found') return 'not_found';
    const needsGesture = options.play && (this.nextLoadResult === 'needs_gesture' || this.rejectsAutoplay);
    this.update({ song, queue: [...queue], positionSec: Math.max(0, options.positionSec), isPlaying: options.play && !needsGesture });
    this.nextLoadResult = 'ok';
    return needsGesture ? 'needs_gesture' : 'ok';
  }

  async next(): Promise<void> {
    this.calls.push({ method: 'next', args: [] });
  }

  async previous(): Promise<void> {
    this.calls.push({ method: 'previous', args: [] });
  }

  async setShuffle(on: boolean): Promise<void> {
    this.calls.push({ method: 'setShuffle', args: [on] });
    this.update({ shuffle: on });
  }

  async setRepeat(mode: RepeatMode): Promise<void> {
    this.calls.push({ method: 'setRepeat', args: [mode] });
    this.update({ repeat: mode });
  }

  async addToQueue(song: SongSnapshot): Promise<void> {
    this.calls.push({ method: 'addToQueue', args: [song] });
    this.update({ queue: [...this.snapshot.queue, song] });
  }

  /** Test-only direct mutation for simulating a device-originated playback event. */
  update(patch: Partial<PlayerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch, queue: [...(patch.queue ?? this.snapshot.queue)] };
    for (const listener of [...this.listeners]) listener(this.snapshot);
  }
}
