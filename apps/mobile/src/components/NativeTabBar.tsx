import React from 'react';
import { Platform, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { requireNativeView } from 'expo';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from '../utils/haptics';
import { useSettingsStore } from '../store/settingsStore';
import { useThemeColors, useIsDark } from '../contexts/ThemeContext';
import { VoiceMicButton } from './VoiceMicButton';
import { HostedMoreMenu, useMoreMenu } from './MoreMenu';
import { PILL_BAR_HEIGHT, PILL_PLAYER_HEIGHT, PILL_STACK_GAP, pillBarBottom, tabBarTopFromBottom, tabTapParams } from '../navigation/tabs';
import { TAB_BAR_HEIGHT } from '../constants/layout';
import { useTabBarPushStyle } from '../navigation/sheetProgress';
import { CustomTabBar } from './CustomTabBar';
import { ModernPillTabBar } from './ModernPillTabBar';

type NativeVariant = 'classic' | 'modern-pill';

interface NativeTabViewProps {
  variant: NativeVariant;
  activeTab: string;
  moreActive: boolean;
  moreOpen: boolean;
  micEnabled: boolean;
  dark: boolean;
  glassBackground: boolean;
  bottomInset: number;
  bottomOffset: number;
  activeTint: string;
  inactiveTint: string;
  onTabPress: (event: { nativeEvent: { route: string } }) => void;
  onMorePress: () => void;
  style?: StyleProp<ViewStyle>;
}

const loadNativeView = (): React.ComponentType<NativeTabViewProps> | null => {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeView<NativeTabViewProps>('NativeTabBar');
  } catch {
    return null;
  }
};

const NativeTabView = loadNativeView();

interface NativeTabBarProps extends BottomTabBarProps {
  variant?: NativeVariant;
}

/** Android tab chrome rendered by a Kotlin Canvas view; route state stays in React Navigation. */
export const NativeTabBar: React.FC<NativeTabBarProps> = props => {
  const { state, navigation } = props;
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const micEnabled = useSettingsStore(s => s.micEnabled);
  const navBarStyle = useSettingsStore(s => s.navBarStyle);
  const variant = props.variant ?? navBarStyle;
  const dark = useIsDark();
  const colors = useThemeColors();
  const isPill = variant === 'modern-pill';
  const bottomOffset = isPill ? pillBarBottom(insets.bottom) : 0;
  const activeKey = state.routes[state.index]?.key;
  const activeName = state.routes[state.index]?.name ?? 'Stream';
  const more = useMoreMenu(state, navigation);
  const moreActive = more.open || more.activeKey !== null;
  const pushStyle = useTabBarPushStyle(tabBarTopFromBottom(insets.bottom, isPill));
  const pillWidth = Math.min(screenWidth * 0.92, 440);
  const activeTint = isPill ? (dark ? '#FFFFFF' : colors.textPrimary) : '#FFFFFF';
  const inactiveTint = isPill ? (dark ? 'rgba(255,255,255,0.45)' : colors.textMuted) : 'rgba(255,255,255,0.5)';
  const fallbackBg = dark ? 'rgba(10,10,12,0.93)' : 'rgba(255,255,255,0.9)';
  const gradientColors: [string, string] = dark
    ? ['rgba(0,0,0,0.1)', 'rgba(0,0,0,0.5)']
    : ['rgba(255,255,255,0.1)', 'rgba(248,248,252,0.5)'];
  const scrimHeight = bottomOffset + PILL_BAR_HEIGHT + PILL_STACK_GAP + PILL_PLAYER_HEIGHT + 44;
  const borderColor = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  const onTabPress = (event: { nativeEvent: { route: string } }) => {
    const route = state.routes.find(item => item.name === event.nativeEvent.route);
    if (!route) return;
    const isFocused = route.key === activeKey && !moreActive;
    const tabEvent = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!isFocused && !tabEvent.defaultPrevented) {
      navigation.navigate(route.name, tabTapParams(route.params));
    }
    if (isPill && route.name === 'Luvs') {
      if (!isFocused) {
        import('../store/luvsFeedStore').then(({ useLuvsFeedStore }) => {
          if (useLuvsFeedStore.getState().feedSongs.length === 0) {
            import('../services/luvsEngine').then(m => m.luvsEngine.refresh()).catch(console.error);
          }
        });
      } else {
        import('../services/luvsEngine').then(m => m.luvsEngine.refresh()).catch(console.error);
      }
    }
    if (isPill) Haptics.selectionAsync().catch(() => {});
  };

  if (!NativeTabView) {
    return variant === 'modern-pill'
      ? <ModernPillTabBar {...props} />
      : <CustomTabBar {...props} />;
  }

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.outer,
        // Open, the layer covers the screen (top: 0 and bottom: 0) so the menu's backdrop can take touches. The
        // fixed height belongs to the closed bar only: an explicit `height: undefined` does not clear it natively.
        more.open
          ? styles.open
          : { height: isPill ? bottomOffset + PILL_BAR_HEIGHT : TAB_BAR_HEIGHT + insets.bottom },
        pushStyle,
      ]}
    >
      {isPill ? (
        <LinearGradient
          pointerEvents="none"
          colors={dark
            ? ['rgba(8,9,12,0)', 'rgba(8,9,12,0.72)', 'rgba(8,9,12,0.96)']
            : ['rgba(248,248,252,0)', 'rgba(248,248,252,0.8)', 'rgba(248,248,252,0.96)']}
          locations={[0, 0.5, 1]}
          style={[styles.scrim, { height: scrimHeight, bottom: -bottomOffset }]}
        />
      ) : null}
      <HostedMoreMenu
        open={more.open}
        activeKey={more.activeKey}
        anchorBottom={isPill ? bottomOffset + PILL_BAR_HEIGHT : TAB_BAR_HEIGHT + insets.bottom}
        anchorRight={isPill ? Math.max(8, (screenWidth - pillWidth) / 2) : 12}
        onSelect={more.select}
        onClose={more.close}
      />
      {isPill ? (
        <View
          style={[
            styles.pill,
            { width: pillWidth, marginLeft: -pillWidth / 2, bottom: bottomOffset, borderColor },
          ]}
        >
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <View style={[StyleSheet.absoluteFill, { backgroundColor: fallbackBg }]} />
            <LinearGradient colors={gradientColors} style={StyleSheet.absoluteFill} />
            <BlurView intensity={60} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          </View>
          <NativeTabView
            variant={variant}
            activeTab={activeName}
            moreActive={moreActive}
            moreOpen={more.open}
            micEnabled={micEnabled}
            dark={dark}
            glassBackground
            bottomInset={0}
            bottomOffset={0}
            activeTint={activeTint}
            inactiveTint={inactiveTint}
            onTabPress={onTabPress}
            onMorePress={more.toggle}
            style={StyleSheet.absoluteFill}
          />
        </View>
      ) : (
        <NativeTabView
          variant={variant}
          activeTab={activeName}
          moreActive={moreActive}
          moreOpen={more.open}
          micEnabled={micEnabled}
          dark={dark}
          glassBackground={false}
          bottomInset={insets.bottom}
          bottomOffset={0}
          activeTint={activeTint}
          inactiveTint={inactiveTint}
          onTabPress={onTabPress}
          onMorePress={more.toggle}
          style={[styles.nativeClassic, { height: TAB_BAR_HEIGHT + insets.bottom }]}
        />
      )}
      {micEnabled ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.mic,
            {
              bottom: isPill ? bottomOffset + (PILL_BAR_HEIGHT - 56) / 2 : insets.bottom + (TAB_BAR_HEIGHT - 56) / 2,
              width: 56,
              height: 56,
            },
          ]}
        >
          <VoiceMicButton variant="inline" />
        </View>
      ) : null}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    zIndex: 1000,
    elevation: 100,
  },
  open: {
    top: 0,
  },
  pill: {
    position: 'absolute',
    height: PILL_BAR_HEIGHT,
    left: '50%',
    borderRadius: 32,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    elevation: 24,
  },
  scrim: { position: 'absolute', left: 0, right: 0 },
  nativeClassic: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  mic: {
    position: 'absolute',
    left: '50%',
    marginLeft: -28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
