import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useShallow } from 'zustand/react/shallow';
import { playlistIdentity } from '@shared/importParse';
import { useAccount } from '../services/account/AccountProvider';
import { useOnlineLibraryStore } from '../store/onlineLibraryStore';
import { readPickedImport, type MobileImportError } from '../services/import/importFile';
import type { MobileImportManifest } from '../services/import/importManifest';
import { selectedImportTracks, useFileImportStore } from '../store/fileImportStore';
import { Glass, Signal } from '../constants/allegraTheme';
import { SpotifySyncPanel } from '../components/import/SpotifySyncPanel';
import { InfoTitleRow, InfoTour } from '../components/allegra/InfoTour';
import { IMPORT_TOUR, importScene } from '../components/allegra/infoTours';

const copyError = (error: MobileImportError): string => error === 'too_large'
  ? 'This file is larger than the safe mobile import limit.'
  : error === 'empty' ? 'No songs were found in that file.' : 'We could not read that file. Choose a Spotify ZIP/JSON export or a CSV.';

export const ImportScreen: React.FC = () => {
  const account = useAccount();
  const accountKey = account.signedIn ? account.profile?.userId ?? null : null;
  const token = account.signedIn ? account.token : null;
  const likedRefs = useOnlineLibraryStore((state) => state.likedRefs);
  // The import itself lives in fileImportStore: going back never cancels matching or saving.
  const job = useFileImportStore(useShallow((state) => ({
    step: state.step, bundle: state.bundle, includeLiked: state.includeLiked, selectedPlaylists: state.selectedPlaylists,
    results: state.results, checkpoint: state.checkpoint, progress: state.progress, savedProgress: state.savedProgress,
    error: state.error, busy: state.busy
  })));
  const { step, bundle, includeLiked, selectedPlaylists, results, checkpoint, progress, savedProgress, error, busy } = job;
  const store = useFileImportStore.getState;
  const [shownResults, setShownResults] = useState(100);
  const [picking, setPicking] = useState(false);

  const tracks = useMemo(() => selectedImportTracks(bundle, includeLiked, selectedPlaylists), [bundle, includeLiked, selectedPlaylists]);

  useEffect(() => { store().useAccount(accountKey); }, [accountKey, store]);
  useEffect(() => { if (step === 'review') setShownResults(100); }, [step]);

  const pick = async (): Promise<void> => {
    if (!token || !accountKey || busy || picking) return;
    setPicking(true); store().set({ error: null });
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ['application/zip', 'application/json', 'text/csv', 'text/comma-separated-values'], copyToCacheDirectory: true, multiple: false });
      if (picked.canceled || !picked.assets[0]) return;
      const result = await readPickedImport(picked.assets[0]);
      if ('error' in result) { store().set({ error: copyError(result.error), step: 'error' }); return; }
      store().loaded(result.bundle, result.fileHash);
    } catch { store().set({ error: 'We could not open the selected file. Try copying it to this device and choosing it again.', step: 'error' }); }
    finally { setPicking(false); }
  };
  const match = (retryOnly = false): void => { if (token) void store().match(token, retryOnly); };
  const startSave = (resume?: MobileImportManifest): void => { if (token) void store().save(token, likedRefs, resume); };
  const restore = (manifest: MobileImportManifest): void => store().restore(manifest);
  const cancel = (): void => store().cancel();

  const button = (label: string, onPress: () => void, primary = false, disabled = false) => (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled }} style={{ paddingVertical: 13, paddingHorizontal: 16, borderRadius: 14, backgroundColor: primary ? Signal.wave : Glass.fill, borderWidth: primary ? 0 : 1, borderColor: Glass.hairline, opacity: disabled ? 0.45 : 1 }}>
      <Text style={{ color: primary ? Signal.waveInk : Signal.ink, fontWeight: '700', textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );

  if (!token || !accountKey) return <SafeAreaView style={{ flex: 1, backgroundColor: Signal.bg, padding: 20 }}><Text accessibilityRole="header" style={{ color: Signal.ink, fontSize: 28, fontWeight: '800' }}>Bring your music</Text><Text style={{ color: Signal.inkSoft, marginTop: 10 }}>{account.loading ? 'Loading your account…' : 'Sign in to import playlists into your library.'}</Text>{!account.loading ? <View style={{ marginTop: 20 }}>{button('Sign in', () => void account.signInWithGoogle(), true)}</View> : null}</SafeAreaView>;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Signal.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 150, gap: 14 }}>
        <InfoTitleRow><Text accessibilityRole="header" style={{ color: Signal.ink, fontSize: 28, fontWeight: '800' }}>Bring your music</Text><InfoTour label="How importing works" steps={IMPORT_TOUR} scene={importScene} /></InfoTitleRow>
        <SpotifySyncPanel key={accountKey} accountKey={accountKey} token={token} />
        {checkpoint && step === 'choose' ? <View style={{ backgroundColor: Glass.fill, borderColor: Glass.hairline, borderWidth: 1, borderRadius: 18, padding: 16, gap: 10 }}><Text style={{ color: Signal.ink, fontWeight: '700' }}>Import in progress</Text><Text style={{ color: Signal.inkSoft }}>Your review choices and confirmed library batches are saved to this account on this phone.</Text>{button('Continue import', () => restore(checkpoint), true)}{button('Forget progress', () => store().forget())}</View> : null}
        {step === 'choose' || step === 'error' ? <View style={{ backgroundColor: Glass.fill, borderColor: Glass.hairline, borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 }}>
          {step === 'error' && error ? <Text accessibilityRole="alert" style={{ color: Signal.accentBright }}>{error}</Text> : null}
          {checkpoint?.stage === 'saving' && step === 'error' ? button('Resume saving', () => startSave(checkpoint), true, busy) : null}
          {step === 'error' && bundle ? button('Continue matching', () => match(), true, busy) : null}
          {button(picking ? 'Opening file…' : 'Choose ZIP, JSON or CSV', () => void pick(), true, busy || picking)}
          <Text style={{ color: Signal.inkMuted, fontSize: 12 }}>Export files stay on this phone; Allegra receives only song details for matching. ZIP up to 20 MB, files up to 5 MB each, archive expands to at most 30 MB.</Text>
        </View> : null}
        {step === 'preview' && bundle ? <View style={{ gap: 12 }}>
          <View style={{ backgroundColor: Glass.fill, borderColor: Glass.hairline, borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 }}>
            <Text style={{ color: Signal.ink, fontSize: 18, fontWeight: '700' }}>Choose what to bring</Text>
            {bundle.liked.length > 0 ? button(`${includeLiked ? '✓' : '○'}  Liked songs · ${bundle.liked.length}`, () => store().set({ includeLiked: !includeLiked })) : null}
            {bundle.playlists.map((playlist) => { const identity = playlistIdentity(playlist); const checked = selectedPlaylists.has(identity); return <Pressable key={identity} onPress={() => store().togglePlaylist(identity)} accessibilityRole="checkbox" accessibilityState={{ checked }} style={{ padding: 12, borderRadius: 12, backgroundColor: Glass.fillLight }}><Text style={{ color: Signal.ink }}>{checked ? '✓' : '○'}  {playlist.name} · {playlist.tracks.length}</Text></Pressable>; })}
            {bundle.skipped > 0 ? <Text style={{ color: Signal.inkMuted }}>{bundle.skipped} podcasts, local files or unreadable rows will be skipped.</Text> : null}
            {bundle.truncated ? <Text style={{ color: Signal.accentBright }}>The export is larger than the 10,000-song import limit; remaining rows are skipped.</Text> : null}
          </View>
          {button('Find these in Allegra', () => match(), true, tracks.size === 0 || busy)}
          {button('Choose another file', () => store().startOver())}
        </View> : null}
        {step === 'matching' ? <View style={{ backgroundColor: Glass.fill, borderColor: Glass.hairline, borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 }}><Text accessibilityLiveRegion="polite" style={{ color: Signal.ink }}>Finding songs · {progress.done} of {progress.total}</Text><ActivityIndicator color={Signal.wave} /><Text style={{ color: Signal.inkMuted, fontSize: 12 }}>This keeps going if you leave. Stream shows how it is doing.</Text>{button('Cancel matching', cancel)}</View> : null}
        {step === 'review' ? <View style={{ gap: 10 }}>
          {error ? <Text accessibilityRole="alert" style={{ color: Signal.accentBright }}>{error}</Text> : null}
          <Text style={{ color: Signal.ink, fontSize: 18, fontWeight: '700' }}>Found {results.size ? [...results.values()].filter((row) => row.song && row.accepted).length : 0} of {results.size}</Text>
          {[...results.entries()].slice(0, shownResults).map(([key, row]) => <Pressable key={key} onPress={() => store().toggleResult(key)} accessibilityRole="checkbox" accessibilityState={{ checked: Boolean(row.accepted), disabled: !row.song || row.retryable }} disabled={!row.song || row.retryable} style={{ backgroundColor: Glass.fill, borderColor: Glass.hairline, borderWidth: 1, borderRadius: 14, padding: 12, opacity: !row.song || row.retryable ? 0.7 : 1 }}><Text style={{ color: Signal.ink }}>{row.accepted ? '✓' : '○'}  {row.track.title} · {row.track.artist}</Text><Text style={{ color: Signal.inkMuted, marginTop: 4 }}>{row.song ? `${row.song.title} · ${row.song.artist}` : row.retryable ? 'Catalog unavailable · retry later' : 'Not found · left out'}</Text></Pressable>)}
          {[...results.values()].some((row) => row.song && !row.accepted && !row.retryable) ? button('Tick all suggested matches', () => store().acceptAllSuggested()) : null}
          {results.size > shownResults ? button(`Show ${Math.min(100, results.size - shownResults)} more`, () => setShownResults((shown) => shown + 100)) : null}
          {[...results.values()].some((row) => row.retryable) ? button('Retry unavailable songs', () => match(true), false, busy) : null}
          {button('Add selected songs', () => startSave(), true, ![...results.values()].some((row) => row.accepted && row.song) || busy)}
        </View> : null}
        {step === 'saving' ? <View style={{ backgroundColor: Glass.fill, borderColor: Glass.hairline, borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 }}><Text accessibilityLiveRegion="polite" style={{ color: Signal.ink }}>{busy ? 'Saving' : 'Ready to resume saving'} · {savedProgress.done} of {savedProgress.total}</Text>{busy ? <><ActivityIndicator color={Signal.wave} /><Text style={{ color: Signal.inkMuted, fontSize: 12 }}>This keeps going if you leave. Stream shows how it is doing.</Text></> : checkpoint ? button('Resume saving', () => startSave(checkpoint), true) : null}{busy ? button('Pause saving', cancel) : null}</View> : null}
        {step === 'done' ? <View style={{ backgroundColor: Glass.fill, borderRadius: 18, padding: 18, gap: 12 }}><Text accessibilityRole="header" style={{ color: Signal.ink, fontSize: 20, fontWeight: '800' }}>Your music is in Allegra</Text><Text style={{ color: Signal.inkSoft }}>Import complete. Your playlists and matched songs are syncing with your library.</Text>{button('Import another file', () => store().startOver())}</View> : null}
      </ScrollView>
    </SafeAreaView>
  );
};

export default ImportScreen;
