import * as DocumentPicker from 'expo-document-picker';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { AppSafeArea } from '../components/AppScreen';

import { playlistIdentity } from '@shared/importParse';
import { useShallow } from 'zustand/react/shallow';
import { InfoTitleRow, InfoTour } from '../components/allegra/InfoTour';
import { IMPORT_TOUR, importScene } from '../components/allegra/infoTours';
import { SpotifySyncPanel } from '../components/import/SpotifySyncPanel';
import { Signal } from '../constants/allegraTheme';
import { useAccount } from '../services/account/AccountProvider';
import { readPickedImport, type MobileImportError } from '../services/import/importFile';
import type { MobileImportManifest } from '../services/import/importManifest';
import { selectedImportTracks, useFileImportStore } from '../store/fileImportStore';
import { useOnlineLibraryStore } from '../store/onlineLibraryStore';
import { Button, CheckRow, GUTTER, Panel, Space, Text as UIText, useBottomClearance } from '../ui';
import { countOf } from '../utils/formatters';

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
  const bottom = useBottomClearance();

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
    <Button label={label} onPress={onPress} variant={primary ? 'primary' : 'glass'} block disabled={disabled} />
  );

  if (!token || !accountKey) return <AppSafeArea style={{ flex: 1, backgroundColor: Signal.bg, padding: GUTTER }}><UIText variant="page" accessibilityRole="header">Bring your music</UIText><UIText variant="body" tone="secondary" style={{ marginTop: Space.xs }}>{account.loading ? 'Loading your account…' : 'Sign in to import playlists into your library.'}</UIText>{!account.loading ? <View style={{ marginTop: Space.lg - Space.xxs }}>{button('Sign in', () => void account.signInWithGoogle(), true)}</View> : null}</AppSafeArea>;

  return (
    <AppSafeArea style={{ flex: 1, backgroundColor: Signal.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: Space.sm, paddingBottom: bottom, gap: Space.sm }}>
        <InfoTitleRow><UIText variant="page" accessibilityRole="header">Bring your music</UIText><InfoTour label="How importing works" steps={IMPORT_TOUR} scene={importScene} /></InfoTitleRow>
        <SpotifySyncPanel key={accountKey} accountKey={accountKey} token={token} />
        {checkpoint && step === 'choose' ? (
          <Panel style={styles.card}>
            <UIText variant="row">Import in progress</UIText>
            <UIText variant="secondary" tone="secondary">Your review choices and confirmed library batches are saved to this account on this phone.</UIText>
            {button('Continue import', () => restore(checkpoint), true)}
            {button('Forget progress', () => store().forget())}
          </Panel>
        ) : null}
        {step === 'choose' || step === 'error' ? (
          <Panel style={styles.card}>
            {step === 'error' && error ? <UIText variant="body" tone="danger" accessibilityRole="alert">{error}</UIText> : null}
            {checkpoint?.stage === 'saving' && step === 'error' ? button('Resume saving', () => startSave(checkpoint), true, busy) : null}
            {step === 'error' && bundle ? button('Continue matching', () => match(), true, busy) : null}
            {button(picking ? 'Opening file…' : 'Choose ZIP, JSON or CSV', () => void pick(), true, busy || picking)}
            <UIText variant="caption" tone="muted">Export files stay on this phone; Allegra receives only song details for matching. ZIP up to 20 MB, files up to 5 MB each, archive expands to at most 30 MB.</UIText>
          </Panel>
        ) : null}
        {step === 'preview' && bundle ? (
          <View style={styles.stack}>
            <Panel style={styles.card} padding={Space.sm}>
              <UIText variant="lead" style={styles.cardTitle}>Choose what to bring</UIText>
              {bundle.liked.length > 0 ? <CheckRow label="Liked songs" detail={countOf(bundle.liked.length, 'song')} checked={includeLiked} onToggle={() => store().set({ includeLiked: !includeLiked })} /> : null}
              {bundle.playlists.map((playlist) => {
                const identity = playlistIdentity(playlist);
                return <CheckRow key={identity} label={playlist.name} detail={countOf(playlist.tracks.length, 'song')} checked={selectedPlaylists.has(identity)} onToggle={() => store().togglePlaylist(identity)} />;
              })}
              {bundle.skipped > 0 ? <UIText variant="caption" tone="muted" style={styles.cardNote}>{countOf(bundle.skipped, 'podcast, local file or unreadable row', 'podcasts, local files or unreadable rows')} will be skipped.</UIText> : null}
              {bundle.truncated ? <UIText variant="caption" tone="danger" style={styles.cardNote}>The export is larger than the 10,000-song import limit; remaining rows are skipped.</UIText> : null}
            </Panel>
            {button('Find these in Allegra', () => match(), true, tracks.size === 0 || busy)}
            {button('Choose another file', () => store().startOver())}
          </View>
        ) : null}
        {step === 'matching' ? (
          <Panel style={styles.card}>
            <UIText variant="body" tabular accessibilityLiveRegion="polite">Finding songs · {progress.done} of {progress.total}</UIText>
            <ActivityIndicator color={Signal.wave} />
            <UIText variant="caption" tone="muted">This keeps going if you leave. Stream shows how it is doing.</UIText>
            {button('Cancel matching', cancel)}
          </Panel>
        ) : null}
        {step === 'review' ? (
          <View style={styles.stack}>
            {error ? <UIText variant="body" tone="danger" accessibilityRole="alert">{error}</UIText> : null}
            <UIText variant="lead" tabular>Found {results.size ? [...results.values()].filter((row) => row.song && row.accepted).length : 0} of {results.size}</UIText>
            <Panel padding={Space.xs}>
              {[...results.entries()].slice(0, shownResults).map(([key, row]) => (
                <CheckRow
                  key={key}
                  label={`${row.track.title} · ${row.track.artist}`}
                  detail={row.song ? `${row.song.title} · ${row.song.artist}` : row.retryable ? 'Catalog unavailable · retry later' : 'Not found · left out'}
                  checked={Boolean(row.accepted)}
                  disabled={!row.song || row.retryable}
                  onToggle={() => store().toggleResult(key)}
                />
              ))}
            </Panel>
            {[...results.values()].some((row) => row.song && !row.accepted && !row.retryable) ? button('Tick all suggested matches', () => store().acceptAllSuggested()) : null}
            {results.size > shownResults ? button(`Show ${Math.min(100, results.size - shownResults)} more`, () => setShownResults((shown) => shown + 100)) : null}
            {[...results.values()].some((row) => row.retryable) ? button('Retry unavailable songs', () => match(true), false, busy) : null}
            {button('Add selected songs', () => startSave(), true, ![...results.values()].some((row) => row.accepted && row.song) || busy)}
          </View>
        ) : null}
        {step === 'saving' ? (
          <Panel style={styles.card}>
            <UIText variant="body" tabular accessibilityLiveRegion="polite">{busy ? 'Saving' : 'Ready to resume saving'} · {savedProgress.done} of {savedProgress.total}</UIText>
            {busy ? <><ActivityIndicator color={Signal.wave} /><UIText variant="caption" tone="muted">This keeps going if you leave. Stream shows how it is doing.</UIText></> : checkpoint ? button('Resume saving', () => startSave(checkpoint), true) : null}
            {busy ? button('Pause saving', cancel) : null}
          </Panel>
        ) : null}
        {step === 'done' ? (
          <Panel style={styles.card}>
            <UIText variant="lead" accessibilityRole="header">Your music is in Allegra</UIText>
            <UIText variant="body" tone="secondary">Import complete. Your playlists and matched songs are syncing with your library.</UIText>
            {button('Import another file', () => store().startOver())}
          </Panel>
        ) : null}
      </ScrollView>
    </AppSafeArea>
  );
};

const styles = StyleSheet.create({
  stack: { gap: Space.sm },
  card: { gap: Space.sm },
  cardTitle: { paddingHorizontal: Space.xxs, paddingTop: Space.xxs },
  cardNote: { paddingHorizontal: Space.xxs },
});

export default ImportScreen;
