import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { SafeAreaView } from 'react-native-safe-area-context';

import { creditedArtists, identityKey } from '@shared/identity';
import { playlistIdentity, type ImportBundle, type ImportedTrack } from '@shared/importParse';
import { runMatching, type MatchedTrack } from '@shared/importRun';
import { ImportPlanError, planImportOps, saveImportResumable } from '@shared/importPlan';
import type { SongSnapshot } from '@shared/songRef';
import { useAccount } from '../services/account/AccountProvider';
import { useOnlineLibraryStore } from '../store/onlineLibraryStore';
import { readPickedImport, type MobileImportError } from '../services/import/importFile';
import { applyImportLibraryOps, matchImportedTracks, sendImportSeed } from '../services/import/importApi';
import { clearMobileManifest, loadMobileManifest, saveMobileManifest, type MobileImportManifest } from '../services/import/importManifest';
import { Glass, Signal } from '../constants/allegraTheme';
import { SpotifySyncPanel } from '../components/import/SpotifySyncPanel';

type Step = 'choose' | 'preview' | 'matching' | 'review' | 'saving' | 'error' | 'done';
const copyError = (error: MobileImportError): string => error === 'too_large'
  ? 'This file is larger than the safe mobile import limit.'
  : error === 'empty' ? 'No songs were found in that file.' : 'We could not read that file. Choose a Spotify ZIP/JSON export or a CSV.';
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const saavnId = (song: SongSnapshot): string | null => song.ref.startsWith('saavn:') ? song.ref.slice(6) : null;

export const ImportScreen: React.FC = () => {
  const account = useAccount();
  const accountKey = account.signedIn ? account.profile?.userId ?? null : null;
  const token = account.signedIn ? account.token : null;
  const likedRefs = useOnlineLibraryStore((state) => state.likedRefs);
  const [step, setStep] = useState<Step>('choose');
  const [bundle, setBundle] = useState<ImportBundle | null>(null);
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [includeLiked, setIncludeLiked] = useState(true);
  const [selectedPlaylists, setSelectedPlaylists] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Map<string, MatchedTrack>>(new Map());
  const resultsRef = useRef(results); resultsRef.current = results;
  const [checkpoint, setCheckpoint] = useState<MobileImportManifest | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [savedProgress, setSavedProgress] = useState({ done: 0, total: 0 });
  const [shownResults, setShownResults] = useState(100);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const runSequence = useRef(0);

  const tracks = useMemo(() => {
    const selected = new Map<string, ImportedTrack>();
    const add = (track: ImportedTrack): void => { const key = identityKey(track.title, track.artist); if (!selected.has(key)) selected.set(key, track); };
    if (includeLiked) bundle?.liked.forEach(add);
    bundle?.playlists.filter((playlist) => selectedPlaylists.has(playlistIdentity(playlist))).forEach((playlist) => playlist.tracks.forEach(add));
    return selected;
  }, [bundle, includeLiked, selectedPlaylists]);

  useEffect(() => {
    runSequence.current += 1;
    abort.current?.abort();
    setStep('choose'); setBundle(null); setFileHash(null); setResults(new Map()); resultsRef.current = new Map();
    setError(null); setBusy(false); setCheckpoint(null);
    if (!accountKey) { setCheckpoint(null); return; }
    let active = true;
    void loadMobileManifest(accountKey).then((saved) => { if (active) setCheckpoint(saved); }).catch(() => undefined);
    return () => { active = false; runSequence.current += 1; abort.current?.abort(); };
  }, [accountKey]);

  const persist = useCallback(async (stage: MobileImportManifest['stage'], overrides: Partial<MobileImportManifest> = {}) => {
    if (!accountKey || !bundle || !fileHash) return;
    const manifest: MobileImportManifest = {
      accountKey, fileHash, updatedAt: Date.now(), stage, bundle,
      selection: { includeLiked, playlists: [...selectedPlaylists] }, results: [...resultsRef.current],
      ...overrides
    };
    await saveMobileManifest(manifest).catch(() => undefined);
    setCheckpoint(manifest);
  }, [accountKey, bundle, fileHash, includeLiked, selectedPlaylists]);

  const pick = async (): Promise<void> => {
    if (!token || !accountKey || busy) return;
    setBusy(true); setError(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ['application/zip', 'application/json', 'text/csv', 'text/comma-separated-values'], copyToCacheDirectory: true, multiple: false });
      if (picked.canceled || !picked.assets[0]) return;
      const result = await readPickedImport(picked.assets[0]);
      if ('error' in result) { setError(copyError(result.error)); setStep('error'); return; }
      setBundle(result.bundle); setFileHash(result.fileHash); setIncludeLiked(result.bundle.liked.length > 0);
      setSelectedPlaylists(new Set(result.bundle.playlists.map(playlistIdentity)));
      setResults(new Map()); setCheckpoint(null); setStep('preview');
    } catch { setError('We could not open the selected file. Try copying it to this device and choosing it again.'); setStep('error'); }
    finally { setBusy(false); }
  };

  const restore = (manifest: MobileImportManifest): void => {
    setBundle(manifest.bundle); setFileHash(manifest.fileHash); setIncludeLiked(manifest.selection.includeLiked);
    setSelectedPlaylists(new Set(manifest.selection.playlists)); setResults(new Map(manifest.results));
    resultsRef.current = new Map(manifest.results); setCheckpoint(manifest);
    if (manifest.stage === 'saving' && manifest.chunks && manifest.sentAt !== undefined) {
      setSavedProgress({ done: manifest.saved ?? 0, total: manifest.total ?? manifest.chunks.flat().length }); setStep('saving');
    } else setStep(manifest.stage === 'review' ? 'review' : 'preview');
  };

  const match = async (retryOnly = false): Promise<void> => {
    if (!token || !accountKey || !bundle || !fileHash) return;
    const activeResults = new Map([...resultsRef.current].filter(([key]) => tracks.has(key)));
    resultsRef.current = activeResults; setResults(activeResults);
    const work = new Map<string, ImportedTrack>();
    for (const [key, track] of tracks) if (!retryOnly || activeResults.get(key)?.retryable) work.set(key, track);
    const sequence = ++runSequence.current;
    const controller = new AbortController(); abort.current?.abort(); abort.current = controller;
    setStep('matching'); setBusy(true); setProgress({ done: 0, total: work.size });
    await persist('matching');
    const missing = [...work.keys()].filter((key) => !activeResults.has(key) || activeResults.get(key)?.retryable === true);
    const completedKeys = new Set([...activeResults.keys()].filter((key) => !missing.includes(key)));
    setProgress({ done: completedKeys.size, total: tracks.size });
    const outcome = await runMatching({
      keys: missing, tracks: work, signal: controller.signal,
      send: (batch, signal) => matchImportedTracks(token, batch, signal),
      onBatch: async (entries) => {
        if (sequence !== runSequence.current) return;
        const next = new Map(activeResults);
        for (const [key, value] of entries) { next.set(key, value); completedKeys.add(key); }
        resultsRef.current = next; setResults(next); setProgress({ done: completedKeys.size, total: tracks.size });
        await persist('matching', { results: [...next] });
      }, sleep
    });
    if (sequence !== runSequence.current) return;
    abort.current = null; setBusy(false);
    if (outcome === 'done') { setShownResults(100); setStep('review'); await persist('review'); }
    else if (outcome !== 'cancelled') { setError('Matching paused. Your finished songs are saved here; continue when your connection returns.'); setStep('error'); await persist('preview'); }
  };

  const startSave = async (resume?: MobileImportManifest): Promise<void> => {
    if (!token || !accountKey || !bundle || !fileHash || busy) return;
    let manifest = resume;
    if (!manifest?.chunks || manifest.sentAt === undefined) {
      const accepted = (track: ImportedTrack): SongSnapshot | null => { const found = resultsRef.current.get(identityKey(track.title, track.artist)); return found?.accepted && found.song && !found.retryable ? found.song : null; };
      const liked = includeLiked ? bundle.liked.map(accepted).filter((song): song is SongSnapshot => song !== null) : [];
      const playlists = bundle.playlists.filter((playlist) => selectedPlaylists.has(playlistIdentity(playlist))).map((playlist) => ({ name: playlist.name, sourceId: playlist.sourceId, songs: playlist.tracks.map(accepted).filter((song): song is SongSnapshot => song !== null) }));
      const alreadyLiked = new Set(liked.filter((song) => likedRefs.has(saavnId(song) ?? '')).map((song) => song.ref));
      let plan: ReturnType<typeof planImportOps>;
      try { plan = planImportOps({ source: bundle.source, liked, playlists, alreadyLiked, now: Date.now() }); }
      catch (cause) {
        if (cause instanceof ImportPlanError) {
          const title = cause.operation && 'song' in cause.operation ? cause.operation.song?.title : undefined;
          setError(title ? `“${title}” has metadata too large to save. Uncheck it and try again.` : 'One imported item is too large to save. Remove it and try again.');
          return;
        }
        throw cause;
      }
      const unmatched = [...resultsRef.current.values()].filter((row) => !row.song || !row.accepted).length;
      manifest = {
        accountKey, fileHash, updatedAt: Date.now(), stage: 'saving', bundle,
        selection: { includeLiked, playlists: [...selectedPlaylists] }, results: [...resultsRef.current], chunks: plan.chunks,
        sentAt: Date.now(), acknowledged: [], saved: 0, total: plan.chunks.flat().length,
        added: plan.added, already: plan.already, playlistCount: playlists.filter((playlist) => playlist.songs.length > 0).length, unmatched
      };
    }
    await saveMobileManifest(manifest); setCheckpoint(manifest); setStep('saving'); setBusy(true); setError(null);
    const sequence = ++runSequence.current;
    const controller = new AbortController(); abort.current?.abort(); abort.current = controller;
    const ack = new Set(manifest.acknowledged ?? []);
    setSavedProgress({ done: manifest.saved ?? 0, total: manifest.total ?? manifest.chunks!.flat().length });
    const outcome = await saveImportResumable(manifest.chunks!, {
      acknowledged: ack, signal: controller.signal,
      apply: (ops) => applyImportLibraryOps(token, ops, manifest!.sentAt!, controller.signal),
      accepted: (reply, count) => {
        const receipt = reply as { readonly rejected: readonly unknown[]; readonly applied: number; readonly superseded: readonly number[] };
        return receipt.rejected.length === 0 && Number.isInteger(receipt.applied) && receipt.applied + receipt.superseded.length === count;
      },
      sleep,
      onChunk: async (index, count) => {
        if (sequence !== runSequence.current) return;
        ack.add(index); const saved = (manifest!.saved ?? 0) + count;
        manifest = { ...manifest!, updatedAt: Date.now(), acknowledged: [...ack], saved };
        setSavedProgress({ done: saved, total: manifest.total ?? 0 }); setCheckpoint(manifest);
        await saveMobileManifest(manifest);
      }
    });
    if (sequence !== runSequence.current) return;
    abort.current = null; setBusy(false);
    if (outcome !== 'ok') {
      setError(outcome === 'cancelled' ? 'Saving paused. Your confirmed batches are safe; resume to finish.' : 'Saving paused. Your confirmed batches are safe; continue when your connection returns.');
      setStep('error'); return;
    }
    await clearMobileManifest(accountKey, fileHash);
    useOnlineLibraryStore.getState().load().catch(() => undefined);
    const artistCounts = new Map<string, number>();
    for (const op of manifest!.chunks!.flat()) if ((op.op === 'like' || op.op === 'playlist_add') && op.song) {
      const artist = creditedArtists(op.song.artist)[0]; if (artist) artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
    }
    const seed = [...artistCounts].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([name, count]) => ({ name, count }));
    if (seed.length) void sendImportSeed(token, seed, new AbortController().signal).catch(() => undefined);
    setCheckpoint(null); setStep('done');
  };

  const cancel = (): void => { runSequence.current += 1; abort.current?.abort(); setBusy(false); if (step === 'matching') setStep('preview'); else if (step === 'saving') { setError('Saving paused. Your confirmed batches are safe; resume to finish.'); setStep('error'); } };

  const button = (label: string, onPress: () => void, primary = false, disabled = false) => (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled }} style={{ paddingVertical: 13, paddingHorizontal: 16, borderRadius: 14, backgroundColor: primary ? Signal.wave : Glass.fill, borderWidth: primary ? 0 : 1, borderColor: Glass.hairline, opacity: disabled ? 0.45 : 1 }}>
      <Text style={{ color: primary ? Signal.waveInk : Signal.ink, fontWeight: '700', textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );

  if (!token || !accountKey) return <SafeAreaView style={{ flex: 1, backgroundColor: Signal.bg, padding: 20 }}><Text accessibilityRole="header" style={{ color: Signal.ink, fontSize: 28, fontWeight: '800' }}>Bring your music</Text><Text style={{ color: Signal.inkSoft, marginTop: 10 }}>{account.loading ? 'Loading your account…' : 'Sign in to import playlists into your library.'}</Text>{!account.loading ? <View style={{ marginTop: 20 }}>{button('Sign in', () => void account.signInWithGoogle(), true)}</View> : null}</SafeAreaView>;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Signal.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 150, gap: 14 }}>
        <Text accessibilityRole="header" style={{ color: Signal.ink, fontSize: 28, fontWeight: '800' }}>Bring your music</Text>
        <Text style={{ color: Signal.inkSoft, lineHeight: 21 }}>Connect Spotify for playlist transfers, or choose a Spotify data export or CSV. Export files stay on this phone; Allegra receives only song details for matching.</Text>
        <SpotifySyncPanel key={accountKey} accountKey={accountKey} token={token} />
        {checkpoint && step === 'choose' ? <View style={{ backgroundColor: Glass.fill, borderColor: Glass.hairline, borderWidth: 1, borderRadius: 18, padding: 16, gap: 10 }}><Text style={{ color: Signal.ink, fontWeight: '700' }}>Import in progress</Text><Text style={{ color: Signal.inkSoft }}>Your review choices and confirmed library batches are saved to this account on this phone.</Text>{button('Continue import', () => restore(checkpoint), true)}{button('Forget progress', () => { void clearMobileManifest(accountKey, checkpoint.fileHash); setCheckpoint(null); })}</View> : null}
        {step === 'choose' || step === 'error' ? <View style={{ backgroundColor: Glass.fill, borderColor: Glass.hairline, borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 }}>
          {step === 'error' && error ? <Text accessibilityRole="alert" style={{ color: Signal.accentBright }}>{error}</Text> : null}
          {checkpoint?.stage === 'saving' && step === 'error' ? button('Resume saving', () => void startSave(checkpoint), true, busy) : null}
          {step === 'error' && bundle ? button('Continue matching', () => void match(), true, busy) : null}
          {button(busy ? 'Opening file…' : 'Choose ZIP, JSON or CSV', () => void pick(), true, busy)}
          <Text style={{ color: Signal.inkMuted, fontSize: 12 }}>On mobile: ZIP up to 20 MB, files up to 5 MB each, archive expands to at most 30 MB.</Text>
        </View> : null}
        {step === 'preview' && bundle ? <View style={{ gap: 12 }}>
          <View style={{ backgroundColor: Glass.fill, borderColor: Glass.hairline, borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 }}>
            <Text style={{ color: Signal.ink, fontSize: 18, fontWeight: '700' }}>Choose what to bring</Text>
            {bundle.liked.length > 0 ? button(`${includeLiked ? '✓' : '○'}  Liked songs · ${bundle.liked.length}`, () => setIncludeLiked(!includeLiked)) : null}
            {bundle.playlists.map((playlist) => { const identity = playlistIdentity(playlist); const checked = selectedPlaylists.has(identity); return <Pressable key={identity} onPress={() => setSelectedPlaylists((current) => { const next = new Set(current); checked ? next.delete(identity) : next.add(identity); return next; })} accessibilityRole="checkbox" accessibilityState={{ checked }} style={{ padding: 12, borderRadius: 12, backgroundColor: Glass.fillLight }}><Text style={{ color: Signal.ink }}>{checked ? '✓' : '○'}  {playlist.name} · {playlist.tracks.length}</Text></Pressable>; })}
            {bundle.skipped > 0 ? <Text style={{ color: Signal.inkMuted }}>{bundle.skipped} podcasts, local files or unreadable rows will be skipped.</Text> : null}
            {bundle.truncated ? <Text style={{ color: Signal.accentBright }}>The export is larger than the 10,000-song import limit; remaining rows are skipped.</Text> : null}
          </View>
          {button('Find these in Allegra', () => void match(), true, tracks.size === 0 || busy)}
          {button('Choose another file', () => { setStep('choose'); setBundle(null); setFileHash(null); })}
        </View> : null}
        {step === 'matching' ? <View style={{ backgroundColor: Glass.fill, borderColor: Glass.hairline, borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 }}><Text accessibilityLiveRegion="polite" style={{ color: Signal.ink }}>Finding songs · {progress.done} of {progress.total}</Text><ActivityIndicator color={Signal.wave} />{button('Cancel matching', cancel)}</View> : null}
        {step === 'review' ? <View style={{ gap: 10 }}>
          {error ? <Text accessibilityRole="alert" style={{ color: Signal.accentBright }}>{error}</Text> : null}
          <Text style={{ color: Signal.ink, fontSize: 18, fontWeight: '700' }}>Found {results.size ? [...results.values()].filter((row) => row.song && row.accepted).length : 0} of {results.size}</Text>
          {[...results.entries()].slice(0, shownResults).map(([key, row]) => <Pressable key={key} onPress={() => setResults((current) => { const next = new Map(current); next.set(key, { ...row, accepted: !row.accepted }); resultsRef.current = next; void persist('review', { results: [...next] }); return next; })} accessibilityRole="checkbox" accessibilityState={{ checked: Boolean(row.accepted), disabled: !row.song || row.retryable }} disabled={!row.song || row.retryable} style={{ backgroundColor: Glass.fill, borderColor: Glass.hairline, borderWidth: 1, borderRadius: 14, padding: 12, opacity: !row.song || row.retryable ? 0.7 : 1 }}><Text style={{ color: Signal.ink }}>{row.accepted ? '✓' : '○'}  {row.track.title} · {row.track.artist}</Text><Text style={{ color: Signal.inkMuted, marginTop: 4 }}>{row.song ? `${row.song.title} · ${row.song.artist}` : row.retryable ? 'Catalog unavailable · retry later' : 'Not found · left out'}</Text></Pressable>)}
          {[...results.values()].some((row) => row.song && !row.accepted && !row.retryable) ? button('Tick all suggested matches', () => setResults((current) => { const next = new Map([...current].map(([key, row]) => [key, row.song && !row.retryable ? { ...row, accepted: true } : row] as const)); resultsRef.current = next; void persist('review', { results: [...next] }); return next; })) : null}
          {results.size > shownResults ? button(`Show ${Math.min(100, results.size - shownResults)} more`, () => setShownResults((shown) => shown + 100)) : null}
          {[...results.values()].some((row) => row.retryable) ? button('Retry unavailable songs', () => void match(true), false, busy) : null}
          {button('Add selected songs', () => void startSave(), true, ![...results.values()].some((row) => row.accepted && row.song) || busy)}
        </View> : null}
        {step === 'saving' ? <View style={{ backgroundColor: Glass.fill, borderColor: Glass.hairline, borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 }}><Text accessibilityLiveRegion="polite" style={{ color: Signal.ink }}>{busy ? 'Saving' : 'Ready to resume saving'} · {savedProgress.done} of {savedProgress.total}</Text>{busy ? <ActivityIndicator color={Signal.wave} /> : checkpoint ? button('Resume saving', () => void startSave(checkpoint), true) : null}{busy ? button('Pause saving', cancel) : null}</View> : null}
        {step === 'done' ? <View style={{ backgroundColor: Glass.fill, borderRadius: 18, padding: 18, gap: 12 }}><Text accessibilityRole="header" style={{ color: Signal.ink, fontSize: 20, fontWeight: '800' }}>Your music is in Allegra</Text><Text style={{ color: Signal.inkSoft }}>Import complete. Your playlists and matched songs are syncing with your library.</Text>{button('Import another file', () => { setStep('choose'); setBundle(null); setFileHash(null); setResults(new Map()); })}</View> : null}
      </ScrollView>
    </SafeAreaView>
  );
};

export default ImportScreen;
