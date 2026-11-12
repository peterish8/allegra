import React, { useEffect } from 'react';
import { useAccount } from '../../services/account/AccountProvider';
import { useQuickPicksStore } from '../../store/quickPicksStore';
import { Button, CollectionCard, Space, Text } from '../../ui';
import { StyleSheet, View } from 'react-native';
import { navigationRef } from '../../utils/navigationService';
export function useSavedQuickPicks() {
  const account = useAccount();
  const scope = account.loading ? null : account.signedIn ? account.profile?.userId ?? null : 'guest';
  const entry = useQuickPicksStore(s => scope ? s.entries[scope] : undefined);
  useEffect(() => { if (scope) useQuickPicksStore.getState().hydrate(scope); }, [scope]);
  return { scope, entry };
}
export function SavedQuickPicks({ query = '' }: { query?: string }) {
  const { scope, entry } = useSavedQuickPicks();
  if (!entry?.saved || (query && !'quick picks'.includes(query.toLowerCase()))) return null;
  return <View style={styles.card}>
    <CollectionCard title="Quick picks" uri={entry.songs[0]?.highResArt} onPress={() => navigationRef.navigate('Main', { screen: 'Browse', params: { screen: 'QuickPicks' } })} />
    <Text variant="meta" tone="secondary">Live · Updates on this phone</Text>
    <Button label="Remove from library" size="compact" onPress={() => { if (scope) useQuickPicksStore.getState().save(scope, false).catch(() => {}); }} />
  </View>;
}
const styles = StyleSheet.create({ card: { alignItems: 'flex-start', gap: Space.xs, padding: Space.md } });

