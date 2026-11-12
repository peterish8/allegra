import React, { useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BrowseStackParamList } from '../types/navigation';
import { loadAlbum } from '../services/search/catalogSearch';
import { DiscoveryCollection } from '../components/stream/DiscoveryCollection';
export default function CatalogAlbumScreen({ route, navigation }: NativeStackScreenProps<BrowseStackParamList, 'CatalogAlbum'>) {
  const [album, setAlbum] = useState<Awaited<ReturnType<typeof loadAlbum>> | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(undefined); setAlbum(null);
    loadAlbum(route.params.id, controller.signal).then(value => { if (!controller.signal.aborted) setAlbum(value); })
      .catch(() => { if (!controller.signal.aborted) setError('Could not load this album. Try refreshing.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [route.params.id, attempt]);
  return <DiscoveryCollection title={album?.title ?? 'Album'} subtitle={album?.artist ?? 'Loading album'} artwork={album?.artwork} songs={album?.songs ?? []} loading={loading} error={error} onBack={() => navigation.goBack()} onRefresh={() => setAttempt(n => n + 1)} />;
}
