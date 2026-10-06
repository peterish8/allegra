/**
 * The file import (Spotify export ZIP/JSON or CSV) as an app-level job. It used to live in the Import
 * screen, so going back cancelled matching or saving; here it keeps running and the screen (and the
 * Stream tray) only show it. Progress is still written to the on-phone manifest after every batch.
 */
import { create } from 'zustand';

import { creditedArtists, identityKey } from '@shared/identity';
import { playlistIdentity, type ImportBundle, type ImportedTrack } from '@shared/importParse';
import { runMatching, type MatchedTrack } from '@shared/importRun';
import { ImportPlanError, planImportOps, saveImportResumable } from '@shared/importPlan';
import type { SongSnapshot } from '@shared/songRef';
import { applyImportLibraryOps, matchImportedTracks, sendImportSeed } from '../services/import/importApi';
import { clearMobileManifest, loadMobileManifest, saveMobileManifest, type MobileImportManifest } from '../services/import/importManifest';
import { useOnlineLibraryStore } from './onlineLibraryStore';

export type ImportStep = 'choose' | 'preview' | 'matching' | 'review' | 'saving' | 'error' | 'done';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const saavnId = (song: SongSnapshot): string | null => song.ref.startsWith('saavn:') ? song.ref.slice(6) : null;

/** The tracks the current selection covers, one per identity. */
export function selectedImportTracks(bundle: ImportBundle | null, includeLiked: boolean, playlists: ReadonlySet<string>): Map<string, ImportedTrack> {
  const selected = new Map<string, ImportedTrack>();
  const add = (track: ImportedTrack): void => { const key = identityKey(track.title, track.artist); if (!selected.has(key)) selected.set(key, track); };
  if (includeLiked) bundle?.liked.forEach(add);
  bundle?.playlists.filter((playlist) => playlists.has(playlistIdentity(playlist))).forEach((playlist) => playlist.tracks.forEach(add));
  return selected;
}

interface FileImportState {
  readonly accountKey: string | null;
  readonly step: ImportStep;
  readonly bundle: ImportBundle | null;
  readonly fileHash: string | null;
  readonly includeLiked: boolean;
  readonly selectedPlaylists: ReadonlySet<string>;
  readonly results: ReadonlyMap<string, MatchedTrack>;
  readonly checkpoint: MobileImportManifest | null;
  readonly progress: { readonly done: number; readonly total: number };
  readonly savedProgress: { readonly done: number; readonly total: number };
  readonly error: string | null;
  readonly busy: boolean;
  /** Signed in as someone else (or out): stop and start over. The same account keeps its job. */
  useAccount: (accountKey: string | null) => void;
  set: (next: Partial<Pick<FileImportState, 'step' | 'error' | 'busy' | 'includeLiked' | 'checkpoint'>>) => void;
  loaded: (bundle: ImportBundle, fileHash: string) => void;
  togglePlaylist: (identity: string) => void;
  toggleResult: (key: string) => void;
  acceptAllSuggested: () => void;
  startOver: () => void;
  restore: (manifest: MobileImportManifest) => void;
  forget: () => void;
  match: (token: string, retryOnly?: boolean) => Promise<void>;
  save: (token: string, likedRefs: ReadonlySet<string>, resume?: MobileImportManifest) => Promise<void>;
  cancel: () => void;
}

let abort: AbortController | null = null;
let runSequence = 0;

export const useFileImportStore = create<FileImportState>((set, get) => {
  const persist = async (stage: MobileImportManifest['stage'], overrides: Partial<MobileImportManifest> = {}): Promise<void> => {
    const { accountKey, bundle, fileHash, includeLiked, selectedPlaylists, results } = get();
    if (!accountKey || !bundle || !fileHash) return;
    const manifest: MobileImportManifest = {
      accountKey, fileHash, updatedAt: Date.now(), stage, bundle,
      selection: { includeLiked, playlists: [...selectedPlaylists] }, results: [...results],
      ...overrides
    };
    await saveMobileManifest(manifest).catch(() => undefined);
    set({ checkpoint: manifest });
  };

  return {
    accountKey: null,
    step: 'choose',
    bundle: null,
    fileHash: null,
    includeLiked: true,
    selectedPlaylists: new Set(),
    results: new Map(),
    checkpoint: null,
    progress: { done: 0, total: 0 },
    savedProgress: { done: 0, total: 0 },
    error: null,
    busy: false,

    useAccount: (accountKey) => {
      if (accountKey === get().accountKey) return;
      runSequence += 1; abort?.abort(); abort = null;
      set({ accountKey, step: 'choose', bundle: null, fileHash: null, results: new Map(), error: null, busy: false, checkpoint: null });
      if (!accountKey) return;
      void loadMobileManifest(accountKey).then((saved) => { if (get().accountKey === accountKey && get().step === 'choose') set({ checkpoint: saved }); }).catch(() => undefined);
    },
    set: (next) => set(next),
    loaded: (bundle, fileHash) => set({
      bundle, fileHash, includeLiked: bundle.liked.length > 0, selectedPlaylists: new Set(bundle.playlists.map(playlistIdentity)),
      results: new Map(), checkpoint: null, step: 'preview', error: null
    }),
    togglePlaylist: (identity) => {
      const next = new Set(get().selectedPlaylists);
      if (next.has(identity)) next.delete(identity); else next.add(identity);
      set({ selectedPlaylists: next });
    },
    toggleResult: (key) => {
      const row = get().results.get(key);
      if (!row) return;
      set({ results: new Map(get().results).set(key, { ...row, accepted: !row.accepted }) });
      void persist('review');
    },
    acceptAllSuggested: () => {
      set({ results: new Map([...get().results].map(([key, row]) => [key, row.song && !row.retryable ? { ...row, accepted: true } : row] as const)) });
      void persist('review');
    },
    startOver: () => set({ step: 'choose', bundle: null, fileHash: null, results: new Map(), error: null }),
    restore: (manifest) => {
      set({
        bundle: manifest.bundle, fileHash: manifest.fileHash, includeLiked: manifest.selection.includeLiked,
        selectedPlaylists: new Set(manifest.selection.playlists), results: new Map(manifest.results), checkpoint: manifest
      });
      if (manifest.stage === 'saving' && manifest.chunks && manifest.sentAt !== undefined) {
        set({ savedProgress: { done: manifest.saved ?? 0, total: manifest.total ?? manifest.chunks.flat().length }, step: 'saving' });
      } else set({ step: manifest.stage === 'review' ? 'review' : 'preview' });
    },
    forget: () => {
      const { accountKey, checkpoint } = get();
      if (accountKey && checkpoint) void clearMobileManifest(accountKey, checkpoint.fileHash);
      set({ checkpoint: null });
    },

    match: async (token, retryOnly = false) => {
      const { accountKey, bundle, fileHash, includeLiked, selectedPlaylists } = get();
      if (!accountKey || !bundle || !fileHash) return;
      const tracks = selectedImportTracks(bundle, includeLiked, selectedPlaylists);
      const activeResults = new Map([...get().results].filter(([key]) => tracks.has(key)));
      set({ results: activeResults });
      const work = new Map<string, ImportedTrack>();
      for (const [key, track] of tracks) if (!retryOnly || activeResults.get(key)?.retryable) work.set(key, track);
      const sequence = ++runSequence;
      const controller = new AbortController(); abort?.abort(); abort = controller;
      set({ step: 'matching', busy: true, progress: { done: 0, total: work.size } });
      await persist('matching');
      const missing = [...work.keys()].filter((key) => !activeResults.has(key) || activeResults.get(key)?.retryable === true);
      const missingSet = new Set(missing);
      const completedKeys = new Set([...activeResults.keys()].filter((key) => !missingSet.has(key)));
      set({ progress: { done: completedKeys.size, total: tracks.size } });
      const outcome = await runMatching({
        keys: missing, tracks: work, signal: controller.signal,
        send: (batch, signal) => matchImportedTracks(token, batch, signal),
        onBatch: async (entries) => {
          if (sequence !== runSequence) return;
          const next = new Map(get().results);
          for (const [key, value] of entries) { next.set(key, value); completedKeys.add(key); }
          set({ results: next, progress: { done: completedKeys.size, total: tracks.size } });
          await persist('matching', { results: [...next] });
        }, sleep
      });
      if (sequence !== runSequence) return;
      abort = null; set({ busy: false });
      if (outcome === 'done') { set({ step: 'review' }); await persist('review'); }
      else if (outcome !== 'cancelled') { set({ error: 'Matching paused. Your finished songs are saved here; continue when your connection returns.', step: 'error' }); await persist('preview'); }
    },

    save: async (token, likedRefs, resume) => {
      const { accountKey, bundle, fileHash, includeLiked, selectedPlaylists, busy } = get();
      if (!accountKey || !bundle || !fileHash || busy) return;
      let manifest = resume;
      if (!manifest?.chunks || manifest.sentAt === undefined) {
        const results = get().results;
        const accepted = (track: ImportedTrack): SongSnapshot | null => { const found = results.get(identityKey(track.title, track.artist)); return found?.accepted && found.song && !found.retryable ? found.song : null; };
        const liked = includeLiked ? bundle.liked.map(accepted).filter((song): song is SongSnapshot => song !== null) : [];
        const playlists = bundle.playlists.filter((playlist) => selectedPlaylists.has(playlistIdentity(playlist))).map((playlist) => ({ name: playlist.name, sourceId: playlist.sourceId, songs: playlist.tracks.map(accepted).filter((song): song is SongSnapshot => song !== null) }));
        const alreadyLiked = new Set(liked.filter((song) => likedRefs.has(saavnId(song) ?? '')).map((song) => song.ref));
        let plan: ReturnType<typeof planImportOps>;
        try { plan = planImportOps({ source: bundle.source, liked, playlists, alreadyLiked, now: Date.now() }); }
        catch (cause) {
          if (cause instanceof ImportPlanError) {
            const title = cause.operation && 'song' in cause.operation ? cause.operation.song?.title : undefined;
            set({ error: title ? `“${title}” has metadata too large to save. Uncheck it and try again.` : 'One imported item is too large to save. Remove it and try again.' });
            return;
          }
          throw cause;
        }
        const unmatched = [...results.values()].filter((row) => !row.song || !row.accepted).length;
        manifest = {
          accountKey, fileHash, updatedAt: Date.now(), stage: 'saving', bundle,
          selection: { includeLiked, playlists: [...selectedPlaylists] }, results: [...results], chunks: plan.chunks,
          sentAt: Date.now(), acknowledged: [], saved: 0, total: plan.chunks.flat().length,
          added: plan.added, already: plan.already, playlistCount: playlists.filter((playlist) => playlist.songs.length > 0).length, unmatched
        };
      }
      await saveMobileManifest(manifest);
      set({ checkpoint: manifest, step: 'saving', busy: true, error: null });
      const sequence = ++runSequence;
      const controller = new AbortController(); abort?.abort(); abort = controller;
      const ack = new Set(manifest.acknowledged ?? []);
      set({ savedProgress: { done: manifest.saved ?? 0, total: manifest.total ?? manifest.chunks!.flat().length } });
      const outcome = await saveImportResumable(manifest.chunks!, {
        acknowledged: ack, signal: controller.signal,
        apply: (ops) => applyImportLibraryOps(token, ops, manifest!.sentAt!, controller.signal),
        accepted: (reply, count) => {
          const receipt = reply as { readonly rejected: readonly unknown[]; readonly applied: number; readonly superseded: readonly number[] };
          return receipt.rejected.length === 0 && Number.isInteger(receipt.applied) && receipt.applied + receipt.superseded.length === count;
        },
        sleep,
        onChunk: async (index, count) => {
          if (sequence !== runSequence) return;
          ack.add(index); const saved = (manifest!.saved ?? 0) + count;
          manifest = { ...manifest!, updatedAt: Date.now(), acknowledged: [...ack], saved };
          set({ savedProgress: { done: saved, total: manifest.total ?? 0 }, checkpoint: manifest });
          await saveMobileManifest(manifest);
        }
      });
      if (sequence !== runSequence) return;
      abort = null; set({ busy: false });
      if (outcome !== 'ok') {
        set({ error: outcome === 'cancelled' ? 'Saving paused. Your confirmed batches are safe; resume to finish.' : 'Saving paused. Your confirmed batches are safe; continue when your connection returns.', step: 'error' });
        return;
      }
      await clearMobileManifest(accountKey, fileHash);
      useOnlineLibraryStore.getState().load().catch(() => undefined);
      const artistCounts = new Map<string, number>();
      for (const op of manifest!.chunks!.flat()) if ((op.op === 'like' || op.op === 'playlist_add') && op.song) {
        const artist = creditedArtists(op.song.artist)[0]; if (artist) artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
      }
      const seed = [...artistCounts].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([name, count]) => ({ name, count }));
      if (seed.length) void sendImportSeed(token, seed, new AbortController().signal).catch(() => undefined);
      set({ checkpoint: null, step: 'done' });
    },

    cancel: () => {
      runSequence += 1; abort?.abort(); abort = null;
      const { step } = get();
      set({ busy: false });
      if (step === 'matching') set({ step: 'preview' });
      else if (step === 'saving') set({ error: 'Saving paused. Your confirmed batches are safe; resume to finish.', step: 'error' });
    },
  };
});
