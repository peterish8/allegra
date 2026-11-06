import React, { useRef } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { requireNativeView } from 'expo';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Signal, Surface, Space, Tactile, Text, type IconName } from '../ui';
import { usePlayerStore } from '../store/playerStore';
import { tabTapParams } from '../navigation/tabs';
import { NAV_BAR_HEIGHT, shellNavHeight } from '../navigation/v6Shell';
import { useTabBarPushStyle } from '../navigation/sheetProgress';
import { useKeyboardVisible } from '../hooks/useKeyboardVisible';
import { ShellMaterial } from './ShellMaterial';
import * as Haptics from '../utils/haptics';

const TABS: readonly { route: string; label: string; icon: IconName; filled: IconName }[] = [
  { route: 'Stream', label: 'Stream', icon: 'radio-outline', filled: 'radio' },
  { route: 'Luvs', label: 'Luvs', icon: 'heart-outline', filled: 'heart' },
  { route: 'Library', label: 'Library', icon: 'library-outline', filled: 'library' },
  { route: 'Search', label: 'Search', icon: 'search-outline', filled: 'search' },
  { route: 'You', label: 'You', icon: 'person-circle-outline', filled: 'person-circle' },
];
interface NativeProps {
  variant: string; activeTab: string; bottomInset: number; micEnabled: boolean; dark: boolean; glassBackground: boolean;
  activeTint: string; inactiveTint: string; moreActive: boolean; moreOpen: boolean; bottomOffset: number;
  style: { height: number }; onTabPress: (event: { nativeEvent: { route: string } }) => void; onMorePress: () => void;
}
const NativeBar = (() => { try { return Platform.OS === 'android' ? requireNativeView<NativeProps>('NativeTabBar') : null; } catch { return null; } })();

export function V6TabBar({ state, navigation }: BottomTabBarProps) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const barHeight = shellNavHeight(height, insets.bottom);
  const keyboard = useKeyboardVisible();
  const route = state.routes[state.index]?.name ?? 'Stream';
  const previousTab = useRef('Stream');
  if (TABS.some(tab => tab.route === route)) previousTab.current = route;
  const active = route === 'Settings' || route === 'Dj' ? 'You' : route === 'Browse' ? previousTab.current : route;
  const cover = usePlayerStore(s => s.currentSong?.coverImageUri ?? s.currentSong?.coverRemoteUri);
  const push = useTabBarPushStyle(barHeight);
  const press = (name: string) => {
    const target = state.routes.find(r => r.name === name);
    if (!target) return;
    const event = navigation.emit({ type: 'tabPress', target: target.key, canPreventDefault: true });
    if (target.key !== state.routes[state.index]?.key && !event.defaultPrevented) navigation.navigate(name, tabTapParams(target.params));
    Haptics.tap();
  };
  if (keyboard) return null;
  return <View pointerEvents="box-none" style={styles.host}><AnimatedBar height={barHeight} push={push}>
    <ShellMaterial uri={cover} />
    {NativeBar ? <NativeBar variant="v6" activeTab={active} moreActive={false} moreOpen={false} micEnabled={false} dark glassBackground bottomInset={barHeight - NAV_BAR_HEIGHT} bottomOffset={0}
      activeTint={Signal.ink} inactiveTint={Signal.inkSoft} style={{ height: barHeight }} onTabPress={e => press(e.nativeEvent.route)} onMorePress={() => {}} />
      : <View style={[styles.row, { paddingBottom: barHeight - NAV_BAR_HEIGHT }]}>{TABS.map(tab => <Tactile key={tab.route} onPress={() => press(tab.route)} accessibilityRole="tab" accessibilityLabel={tab.label}
        accessibilityState={{ selected: active === tab.route }} wrapperStyle={styles.target} style={styles.item}>
        <View style={[styles.indicator, active === tab.route && styles.selected]}><Ionicons name={active === tab.route ? tab.filled : tab.icon} size={24} color={active === tab.route ? Signal.ink : Signal.inkSoft} /></View>
        <Text variant="caption" maxFontSizeMultiplier={1.3} style={active === tab.route && styles.bold}>{tab.label}</Text>
      </Tactile>)}</View>}
  </AnimatedBar></View>;
}
import Animated from 'react-native-reanimated';
const AnimatedBar: React.FC<{ height: number; push: ReturnType<typeof useTabBarPushStyle>; children: React.ReactNode }> = ({ height, push, children }) => <Animated.View style={[{ height }, push]}>{children}</Animated.View>;
const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  row: { flexDirection: 'row', minHeight: NAV_BAR_HEIGHT }, target: { flex: 1 }, item: { alignItems: 'center', justifyContent: 'center', gap: Space.xxs, height: NAV_BAR_HEIGHT },
  indicator: { width: 56, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, selected: { backgroundColor: Surface.control }, bold: { fontWeight: '600' },
});
