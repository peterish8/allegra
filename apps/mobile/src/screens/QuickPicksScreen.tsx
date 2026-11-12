import React, { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BrowseStackParamList } from '../types/navigation';
import { DiscoveryCollection } from '../components/stream/DiscoveryCollection';
import { useLiveQuickPicks } from '../hooks/useLiveQuickPicks';
import { useQuickPicksStore } from '../store/quickPicksStore';
export default function QuickPicksScreen({ navigation }: NativeStackScreenProps<BrowseStackParamList, 'QuickPicks'>) {
  const { scope, entry, loading, error, refresh } = useLiveQuickPicks();
  const [saveError, setSaveError] = useState<string>();
  return <DiscoveryCollection title="Quick picks" subtitle={entry ? `${entry.daypart} · ${entry.source === 'discovery' ? 'Discover songs in your languages' : 'Updates with your listening'} · Live on this phone` : 'A live playlist based on your listening'}
    songs={entry?.songs ?? []} loading={loading} error={saveError || error} saved={entry?.saved}
    onBack={() => navigation.goBack()} onRefresh={() => { refresh(true); }} onSave={() => {
      if (!scope || !entry) return;
      setSaveError(undefined);
      useQuickPicksStore.getState().save(scope, !entry.saved).catch(() => setSaveError('Could not save the playlist. Try again.'));
    }} />;
}
