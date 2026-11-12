import React, { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TabParamList } from '../types/navigation';
import { AppScreen } from '../components/AppScreen';
import { DownloadQueueModal } from '../components/DownloadQueueModal';
import AboutSheet from '../components/about/AboutSheet';
import { useConnect } from '../services/connect/ConnectProvider';
import { ListRow, PageHeader, Space, Text, useBottomClearance } from '../ui';

export default function YouScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<TabParamList>>();
  const { openDevices } = useConnect();
  const insets = useSafeAreaInsets();
  const bottom = useBottomClearance();
  const [downloads, setDownloads] = useState(false);
  const [about, setAbout] = useState(false);
  return <AppScreen style={{ paddingTop: insets.top }}>
    <PageHeader title="You" />
    <ScrollView contentContainerStyle={{ paddingBottom: bottom }}>
      <Text variant="meta" tone="secondary" style={styles.group}>Listening</Text>
      <ListRow title="Blends" subtitle="Mix your taste with a friend" icon="git-merge-outline" chevron onPress={() => navigation.navigate('Library', { screen: 'Blends' })} />
      <ListRow title="LuvLink" subtitle="Listen with friends in sync" icon="people-outline" chevron onPress={() => navigation.getParent()?.navigate('LuvLink')} />
      <Text variant="meta" tone="secondary" style={styles.group}>Library</Text>
      <ListRow title="Downloads" icon="download-outline" chevron onPress={() => setDownloads(true)} />
      <ListRow title="Import from Spotify" icon="cloud-download-outline" chevron onPress={() => navigation.navigate('Library', { screen: 'Import' })} />
      <ListRow title="Connect devices" icon="desktop-outline" chevron onPress={openDevices} />
      <Text variant="meta" tone="secondary" style={styles.group}>App</Text>
      <ListRow title="Settings" subtitle="Playback, lyrics, player background" icon="settings-outline" chevron onPress={() => navigation.navigate('Settings')} />
      <ListRow title="About LuvLyrics" subtitle="Updates and feedback" icon="information-circle-outline" chevron onPress={() => setAbout(true)} />
    </ScrollView>
    <DownloadQueueModal visible={downloads} onClose={() => setDownloads(false)} />
    <AboutSheet visible={about} onClose={() => setAbout(false)} />
  </AppScreen>;
}
const styles = StyleSheet.create({ group: { paddingHorizontal: Space.md, paddingTop: Space.lg, paddingBottom: Space.xs } });
