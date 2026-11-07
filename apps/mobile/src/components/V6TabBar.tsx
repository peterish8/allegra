import React, { useRef } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { requireNativeView } from 'expo';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Signal, Space, Tactile, Text, type IconName } from '../ui';
import { tabTapParams } from '../navigation/tabs';
import { NAV_BAR_HEIGHT, shellNavHeight } from '../navigation/v6Shell';
import { useTabBarPushStyle } from '../navigation/sheetProgress';
import { useKeyboardVisible } from '../hooks/useKeyboardVisible';
import { useShallow } from 'zustand/react/shallow';
import { holdTabFor, holdTarget, TAB_HOLD_MS } from '../navigation/tabHold';
import { usePlaylistStore } from '../store/playlistStore';
import { useSettingsStore } from '../store/settingsStore';
import { LinearGradient } from 'expo-linear-gradient';
import { ShellFrost } from '../constants/allegraTheme';
import { CreateSheet } from './nav/CreateSheet';
import { ProfileMenu } from './nav/ProfileMenu';
import { CREATE_TAB, litTab, type CreateAction, type NavTab } from '../navigation/createMenu';
import type { ProfileAction } from '../navigation/profileMenu';
import { useShellMenuStore } from '../store/shellMenuStore';
import { useConnect } from '../services/connect/ConnectProvider';
import * as Haptics from '../utils/haptics';

// 1.42.0 (owner, Spotify's positions): Stream, Search, Library, Create. Luvs lives in the Create sheet and the You
// rows in the profile menu (your picture at the top left).
const TABS: readonly { route: NavTab; label: string; icon: IconName; filled: IconName }[] = [
  { route: 'Stream', label: 'Stream', icon: 'radio-outline', filled: 'radio' },
  { route: 'Search', label: 'Search', icon: 'search-outline', filled: 'search' },
  { route: 'Library', label: 'Library', icon: 'library-outline', filled: 'library' },
  { route: CREATE_TAB, label: 'Create', icon: 'add', filled: 'close' },
];
interface NativeProps {
  variant: string; activeTab: string; bottomInset: number; micEnabled: boolean; dark: boolean; glassBackground: boolean;
  activeTint: string; inactiveTint: string; moreActive: boolean; moreOpen: boolean; bottomOffset: number;
  style: { height: number }; onTabPress: (event: { nativeEvent: { route: string } }) => void; onMorePress: () => void;
  holdTab: string | null; onTabLongPress: (event: { nativeEvent: { route: string } }) => void;
}
const NativeBar = (() => { try { return Platform.OS === 'android' ? requireNativeView<NativeProps>('NativeTabBar') : null; } catch { return null; } })();

export function V6TabBar({ state, navigation }: BottomTabBarProps) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const barHeight = shellNavHeight(height, insets.bottom);
  const keyboard = useKeyboardVisible();
  const route = state.routes[state.index]?.name ?? 'Stream';
  const previousTab = useRef<NavTab>('Stream');
  const active = litTab(route, previousTab.current);
  previousTab.current = active;
  const push = useTabBarPushStyle(barHeight);
  const createOpen = useShellMenuStore(s => s.createOpen);
  const setCreateOpen = useShellMenuStore(s => s.setCreateOpen);
  const { openDevices } = useConnect();
  const press = (name: string) => {
    if (name === CREATE_TAB) { Haptics.tap(); setCreateOpen(!useShellMenuStore.getState().createOpen); return; }
    setCreateOpen(false);
    const target = state.routes.find(r => r.name === name);
    if (!target) return;
    const event = navigation.emit({ type: 'tabPress', target: target.key, canPreventDefault: true });
    if (target.key !== state.routes[state.index]?.key && !event.defaultPrevented) navigation.navigate(name, tabTapParams(target.params));
    Haptics.tap();
  };
  // Navigation that the tab navigator does not own (CreatePlaylist, LuvLink) bubbles up to the root stack.
  const create = (action: CreateAction) => {
    setCreateOpen(false);
    if (action === 'luvs') navigation.navigate('Luvs');
    else if (action === 'playlist') navigation.navigate('CreatePlaylist');
    else if (action === 'blend') navigation.navigate('Library', { screen: 'Blends' });
    else navigation.navigate('LuvLink');
  };
  const profile = (action: Exclude<ProfileAction, 'about' | 'downloads'>) => {
    if (action === 'devices') { openDevices(); return; }
    if (action === 'dj') navigation.navigate('Dj');
    else if (action === 'import') navigation.navigate('Library', { screen: 'Import' });
    else if (action === 'blends') navigation.navigate('Library', { screen: 'Blends' });
    else if (action === 'luvlink') navigation.navigate('LuvLink');
    else navigation.navigate('Settings');
  };
  // Settings → Hold Library for 2 seconds: the chosen playlist opens straight away.
  const holdPlaylistId = useSettingsStore(s => s.libraryHoldPlaylistId);
  const playlistIds = usePlaylistStore(useShallow(s => s.playlists.map(p => p.id)));
  const holdTab = holdTabFor(holdPlaylistId, playlistIds);
  const hold = (name: string) => {
    const playlistId = holdTarget(name, holdPlaylistId, playlistIds);
    if (!playlistId) return;
    Haptics.toggle();
    navigation.navigate('Library', { screen: 'PlaylistDetail', params: { playlistId } });
  };
  if (keyboard) return null;
  // While the Create sheet is up the host covers the screen (its dimmed page closes it); otherwise only the bar.
  return <View pointerEvents="box-none" style={[styles.host, createOpen && styles.hostOpen]}>
    <CreateSheet open={createOpen} bottom={barHeight} onClose={() => setCreateOpen(false)} onPick={create} />
    <AnimatedBar height={barHeight} push={push}>
    {/* 1.43.0 (owner's Spotify screenshot): no slab behind the bar. The page fades to black under it, starting
        ShellFrost.navFade above it; touches on the fade reach the page. */}
    <LinearGradient pointerEvents="none" colors={ShellFrost.navFadeColors} locations={ShellFrost.navFadeStops}
      style={[styles.fade, { top: -ShellFrost.navFade }]} />
    {NativeBar ? <NativeBar variant="v6" activeTab={active} moreActive={false} moreOpen={createOpen} micEnabled={false} dark glassBackground bottomInset={barHeight - NAV_BAR_HEIGHT} bottomOffset={0}
      activeTint={Signal.ink} inactiveTint={Signal.inkSoft} style={{ height: barHeight }} onTabPress={e => press(e.nativeEvent.route)} onMorePress={() => press(CREATE_TAB)}
      holdTab={holdTab} onTabLongPress={e => hold(e.nativeEvent.route)} />
      : <View style={[styles.row, { paddingBottom: barHeight - NAV_BAR_HEIGHT }]}>{TABS.map(tab => {
        const isCreate = tab.route === CREATE_TAB;
        const lit = isCreate ? createOpen : active === tab.route;
        return <Tactile key={tab.route} onPress={() => press(tab.route)} accessibilityRole={isCreate ? 'button' : 'tab'}
          accessibilityLabel={isCreate && createOpen ? 'Close Create' : tab.label}
          onLongPress={holdTab === tab.route ? () => hold(tab.route) : undefined} delayLongPress={TAB_HOLD_MS}
          accessibilityState={isCreate ? { expanded: createOpen } : { selected: lit }} wrapperStyle={styles.target} style={styles.item}>
          <View style={[styles.indicator, isCreate && createOpen && styles.closeDisc]}>
            <Ionicons name={lit ? tab.filled : tab.icon} size={24} color={isCreate && createOpen ? Signal.bgDeep : lit ? Signal.ink : Signal.inkSoft} />
          </View>
          {isCreate && createOpen ? null : <Text variant="caption" maxFontSizeMultiplier={1.3} style={lit && styles.bold}>{tab.label}</Text>}
        </Tactile>;
      })}</View>}
  </AnimatedBar>
    <ProfileMenu onAction={profile} />
  </View>;
}
import Animated from 'react-native-reanimated';
const AnimatedBar: React.FC<{ height: number; push: ReturnType<typeof useTabBarPushStyle>; children: React.ReactNode }> = ({ height, push, children }) => <Animated.View style={[{ height }, push]}>{children}</Animated.View>;
const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  hostOpen: { top: 0, zIndex: 20, justifyContent: 'flex-end' },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  // Spotify's open Create tab: a white disc with a dark close mark.
  closeDisc: { width: 40, height: 40, borderRadius: 20, backgroundColor: Signal.ink },
  row: { flexDirection: 'row', minHeight: NAV_BAR_HEIGHT }, target: { flex: 1 }, item: { alignItems: 'center', justifyContent: 'center', gap: Space.xxs, height: NAV_BAR_HEIGHT },
  // Round 7 item 3: the selected tab is its filled icon and semibold label only; nothing is drawn behind it.
  indicator: { width: 56, height: 28, alignItems: 'center', justifyContent: 'center' }, bold: { fontWeight: '600' },
});
