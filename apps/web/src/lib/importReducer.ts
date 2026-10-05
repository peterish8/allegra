/**
 * The import flow as a state machine (PLAN.md I4). Only the transitions in the diagram are
 * accepted; any other action leaves the state as it was, so a late reply (a cancelled batch, a
 * worker answering after "start again") cannot drag the page into a state it has left.
 *
 *   choose → reading → preview → matching → review → saving → done
 *                    ↘ error (file)        ↘ error (network, resumable)
 */
import { identityKey } from '@shared/identity';
import { playlistIdentity, type ImportBundle, type ImportedTrack } from '@shared/importParse';
import type { MatchedTrack } from '@shared/importRun';
import type { SongSnapshot } from '@shared/songRef';
import type { LibraryOp } from '@shared/library';

export type { MatchConfidence, MatchedTrack } from '@shared/importRun';

export interface ImportSelection {
  readonly includeLiked: boolean;
  /** Names of the playlists to import. */
  readonly playlists: ReadonlySet<string>;
}

export type ImportState =
  | { readonly step: 'choose' }
  | { readonly step: 'reading'; readonly fileName: string }
  | { readonly step: 'preview'; readonly bundle: ImportBundle; readonly fileHash: string; readonly selection: ImportSelection }
  | {
      readonly step: 'matching';
      readonly runId: number;
      readonly bundle: ImportBundle;
      readonly fileHash: string;
      readonly selection: ImportSelection;
      readonly done: number;
      readonly total: number;
      readonly results: ReadonlyMap<string, MatchedTrack>;
    }
  | { readonly step: 'review'; readonly bundle: ImportBundle; readonly fileHash: string; readonly selection: ImportSelection; readonly results: ReadonlyMap<string, MatchedTrack> }
  | {
      readonly step: 'saving'; readonly bundle: ImportBundle; readonly fileHash: string; readonly selection: ImportSelection;
      readonly results: ReadonlyMap<string, MatchedTrack>; readonly chunks: readonly (readonly LibraryOp[])[];
      readonly runId: number; readonly sentAt: number; readonly acknowledged: ReadonlySet<number>; readonly saved: number; readonly total: number;
      readonly added: number; readonly already: number; readonly playlists: number; readonly unmatched: number;
    }
  | { readonly step: 'done'; readonly added: number; readonly already: number; readonly playlists: number; readonly unmatched: number }
  | { readonly step: 'error'; readonly kind: 'file' | 'network'; readonly message: string; readonly resumable: boolean; readonly resume?: ImportState };

export type ImportAction =
  | { readonly type: 'pick'; readonly fileName: string }
  | { readonly type: 'read'; readonly bundle: ImportBundle; readonly fileHash: string }
  | { readonly type: 'togglePlaylist'; readonly name: string }
  | { readonly type: 'toggleLiked' }
  | { readonly type: 'startMatching'; readonly total: number; readonly runId: number }
  | { readonly type: 'matched'; readonly runId: number; readonly results: readonly (readonly [string, MatchedTrack])[] }
  | { readonly type: 'cancel' }
  | { readonly type: 'finishMatching' }
  | { readonly type: 'accept'; readonly key: string; readonly accepted: boolean }
  | { readonly type: 'replace'; readonly key: string; readonly song: SongSnapshot }
  | { readonly type: 'save'; readonly runId: number; readonly total: number; readonly chunks: readonly (readonly LibraryOp[])[]; readonly sentAt: number; readonly added: number; readonly already: number; readonly playlists: number; readonly unmatched: number }
  | { readonly type: 'savedChunk'; readonly runId: number; readonly index: number; readonly count: number }
  | { readonly type: 'saveFailed'; readonly runId: number; readonly message: string }
  | { readonly type: 'finish'; readonly runId: number; readonly added: number; readonly already: number; readonly playlists: number; readonly unmatched: number }
  | { readonly type: 'fail'; readonly kind: 'file' | 'network'; readonly message: string; readonly resumable: boolean }
  | { readonly type: 'resume' }
  | { readonly type: 'restore'; readonly state: Exclude<ImportState, { readonly step: 'choose' | 'reading' | 'done' | 'error' }> }
  | { readonly type: 'reset' };

export const INITIAL_IMPORT: ImportState = { step: 'choose' };

function toggled<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function importReducer(state: ImportState, action: ImportAction): ImportState {
  if (action.type === 'restore' && state.step === 'choose') return action.state;
  switch (state.step) {
    case 'choose':
      return action.type === 'pick' ? { step: 'reading', fileName: action.fileName } : state;

    case 'reading':
      if (action.type === 'read') {
        return {
          step: 'preview',
          bundle: action.bundle,
          fileHash: action.fileHash,
          selection: { includeLiked: action.bundle.liked.length > 0, playlists: new Set(action.bundle.playlists.map(playlistIdentity)) }
        };
      }
      if (action.type === 'fail' && action.kind === 'file') return { step: 'error', kind: 'file', message: action.message, resumable: false };
      if (action.type === 'reset') return INITIAL_IMPORT;
      return state;

    case 'preview':
      if (action.type === 'togglePlaylist') return { ...state, selection: { ...state.selection, playlists: toggled(state.selection.playlists, action.name) } };
      if (action.type === 'toggleLiked') return { ...state, selection: { ...state.selection, includeLiked: !state.selection.includeLiked } };
      if (action.type === 'startMatching') {
        return { step: 'matching', runId: action.runId, bundle: state.bundle, fileHash: state.fileHash, selection: state.selection, done: 0, total: action.total, results: new Map() };
      }
      if (action.type === 'reset') return INITIAL_IMPORT;
      return state;

    case 'matching':
      if (action.type === 'matched') {
        if (action.runId !== state.runId) return state;
        const results = new Map(state.results);
        for (const [key, match] of action.results) results.set(key, match);
        return { ...state, results, done: Math.min(state.total, results.size) };
      }
      if (action.type === 'finishMatching') return { step: 'review', bundle: state.bundle, fileHash: state.fileHash, selection: state.selection, results: state.results };
      if (action.type === 'cancel') return { step: 'preview', bundle: state.bundle, fileHash: state.fileHash, selection: state.selection };
      if (action.type === 'fail' && action.kind === 'network') {
        return { step: 'error', kind: 'network', message: action.message, resumable: true, resume: { step: 'preview', bundle: state.bundle, fileHash: state.fileHash, selection: state.selection } };
      }
      return state;

    case 'review': {
      if (action.type === 'accept' || action.type === 'replace') {
        const match = state.results.get(action.key);
        if (!match) return state;
        const results = new Map(state.results);
        results.set(action.key, action.type === 'accept' ? { ...match, accepted: action.accepted } : { ...match, song: action.song, confidence: 'exact', accepted: true });
        return { ...state, results };
      }
      if (action.type === 'save') return {
        step: 'saving', runId: action.runId, bundle: state.bundle, fileHash: state.fileHash, selection: state.selection, results: state.results,
        chunks: action.chunks, sentAt: action.sentAt, acknowledged: new Set(), saved: 0, total: action.total,
        added: action.added, already: action.already, playlists: action.playlists, unmatched: action.unmatched
      };
      return state;
    }

    case 'saving':
      if (action.type === 'savedChunk') {
        if (action.runId !== state.runId) return state;
        if (state.acknowledged.has(action.index)) return state;
        const acknowledged = new Set(state.acknowledged);
        acknowledged.add(action.index);
        return { ...state, acknowledged, saved: Math.min(state.total, state.saved + action.count) };
      }
      if (action.type === 'finish' && action.runId === state.runId) return { step: 'done', added: action.added, already: action.already, playlists: action.playlists, unmatched: action.unmatched };
      if (action.type === 'saveFailed' && action.runId === state.runId) return { step: 'error', kind: 'network', message: action.message, resumable: true, resume: { ...state, runId: state.runId + 1 } };
      return state;

    case 'error':
      if (action.type === 'resume' && state.resumable && state.resume) return state.resume;
      return action.type === 'reset' ? INITIAL_IMPORT : state;

    case 'done':
      return action.type === 'reset' ? INITIAL_IMPORT : state;
  }
}

/** The selected tracks, once each by identity: a song in the liked list and a playlist is matched once. */
export function selectedTracks(bundle: ImportBundle, selection: ImportSelection): Map<string, ImportedTrack> {
  const tracks = new Map<string, ImportedTrack>();
  const add = (track: ImportedTrack): void => {
    const key = identityKey(track.title, track.artist);
    if (!tracks.has(key)) tracks.set(key, track);
  };
  if (selection.includeLiked) bundle.liked.forEach(add);
  for (const playlist of bundle.playlists) if (selection.playlists.has(playlistIdentity(playlist))) playlist.tracks.forEach(add);
  return tracks;
}
