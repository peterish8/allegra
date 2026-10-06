import React from 'react';
import { Easing, Platform, View } from 'react-native';
import { createBottomTabNavigator, type BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { CommonActions, StackActions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import { TabParamList, LibraryStackParamList, BrowseStackParamList } from '../types/navigation';
import { ModernPillTabBar } from '../components/ModernPillTabBar';
import { CustomTabBar } from '../components/CustomTabBar';
import { useSettingsStore } from '../store/settingsStore';
import { useThemeColors, useIsDark } from '../contexts/ThemeContext';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';

import LibraryScreen from '../screens/LibraryScreen';
import LuvsScreen from '../screens/LuvsScreen';
import PlaylistsScreen from '../screens/PlaylistsScreen';
import PlaylistDetailScreen from '../screens/PlaylistDetailScreen';
import { BlendsScreen } from '../screens/BlendsScreen';
import { BlendScreen } from '../screens/BlendScreen';
import BlendJoinScreen from '../screens/BlendJoinScreen';
import ImportScreen from '../screens/ImportScreen';
import SearchScreen from '../screens/SearchScreen';
import StreamScreen from '../screens/StreamScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ArtistScreen from '../screens/ArtistScreen';
import CollectionScreen from '../screens/CollectionScreen';
import { SCREEN_BG, stackContentStyle } from './theme';
import { Motion, Signal } from '../constants/allegraTheme';
import { isDoubleTap } from './tabs';
import { LIBRARY_ROOT, libraryRootMove, scrollLibraryHomeToTop } from './libraryRoot';
import * as Haptics from '../utils/haptics';

const Tab = createBottomTabNavigator<TabParamList>();


const LibraryStack = createNativeStackNavigator<LibraryStackParamList>();

/**
 * Pages pushed inside a tab. A page under the top one is frozen (react-native-screens): it keeps
 * its state and scroll position but stops re-rendering on every player and download update.
 */
const STACK_OPTIONS = {
  headerShown: false,
  animation: 'slide_from_right',
  contentStyle: stackContentStyle,
  freezeOnBlur: true,
} as const;
const BLEND_HEADER = { headerShown: true, headerStyle: { backgroundColor: Signal.bg }, headerTintColor: Signal.ink, headerShadowVisible: false } as const;

/**
 * iOS keeps the token-based fade. Android switches native scenes immediately:
 * the fade's animated activityState can leave an old scene attached and flash it
 * over the destination. Omit transitionSpec too, or bottom-tabs still animates.
 */
const TAB_FADE = {
  animation: 'timing',
  config: { duration: Motion.duration.fast, easing: Easing.bezier(0, 0, 0.2, 1) },
} as const;
const TAB_TRANSITION = Platform.OS === 'android'
  ? { animation: 'none' as const }
  : { animation: 'fade' as const, transitionSpec: TAB_FADE };

/**
 * Drilling into a playlist keeps the tab bar and mini player, because the detail
 * screen is pushed inside the tab rather than on top of the whole tab navigator.
 */
const LibraryStackScreen: React.FC<BottomTabScreenProps<TabParamList, 'Library'>> = ({ navigation }) => {
  useLibraryTabPress(navigation);
  return (
    <LibraryStack.Navigator
      id="LibraryStack"
      screenOptions={STACK_OPTIONS}
    >
      <LibraryStack.Screen name="LibraryHome" component={LibraryScreen} />
      <LibraryStack.Screen name="Playlists" component={PlaylistsScreen} />
      <LibraryStack.Screen name="PlaylistDetail" component={PlaylistDetailScreen} options={{ animation: 'slide_from_bottom' }} />
      <LibraryStack.Screen name="Blends" component={BlendsScreen} options={BLEND_HEADER} />
      <LibraryStack.Screen name="Blend" component={BlendScreen} options={BLEND_HEADER} />
      <LibraryStack.Screen name="BlendJoin" component={BlendJoinScreen} options={{ ...BLEND_HEADER, title: 'Join a Blend' }} />
      <LibraryStack.Screen name="Import" component={ImportScreen} options={{ ...BLEND_HEADER, title: 'Import Spotify' }} />
    </LibraryStack.Navigator>
  );
};

/**
 * Tapping the Library tab means "take me to Library": the stack inside it goes back to the Library home,
 * wherever it was left (the ••• menu and Library's own button push Playlists onto it, and a tab keeps its
 * stack). Tapping it twice in quick succession opens Playlists, as double-tapping Stream opens search; the
 * first tap still goes to the Library at once and nothing waits on a timer.
 */
function useLibraryTabPress(navigation: BottomTabScreenProps<TabParamList, 'Library'>['navigation']): void {
  const lastPress = React.useRef(0);
  React.useEffect(() => navigation.addListener('tabPress', () => {
    const now = Date.now();
    const nested = navigation.getState().routes.find(route => route.name === 'Library')?.state;
    if (isDoubleTap(lastPress.current, now)) {
      lastPress.current = 0;
      Haptics.selectionAsync().catch(() => {});
      // After the tab itself has switched, or the push lands on a screen that is not in front yet.
      setTimeout(() => navigation.navigate('Library', { screen: 'Playlists' }), 0);
      return;
    }
    lastPress.current = now;
    const move = libraryRootMove(nested);
    // Already on the Library home and it is the tab in front: a tap scrolls it to the top.
    if (move === 'none' && navigation.isFocused()) scrollLibraryHomeToTop();
    if (move === 'none' || !nested?.key) return;
    navigation.dispatch({
      ...(move === 'pop' ? StackActions.popToTop() : CommonActions.reset({ index: 0, routes: [{ name: LIBRARY_ROOT }] })),
      target: nested.key,
    });
  }), [navigation]);
}


const BrowseStack = createNativeStackNavigator<BrowseStackParamList>();

/**
 * YouTube Music pages. A stack inside a hidden tab: the bar and mini player
 * stay, and back walks artist → similar artist → album. `getId` makes each
 * artist or album its own screen instead of replacing the last one.
 */
const BrowseStackScreen: React.FC = () => (
  <BrowseStack.Navigator id="BrowseStack" screenOptions={STACK_OPTIONS}>
    <BrowseStack.Screen name="Artist" component={ArtistScreen} getId={({ params }) => params?.browseId ?? params?.name} />
    <BrowseStack.Screen name="Collection" component={CollectionScreen} getId={({ params }) => params?.browseId} />
  </BrowseStack.Navigator>
);

const StreamIcon = ({ color, focused }: { color: string; focused: boolean }) => (
  <Ionicons name={focused ? 'radio' : 'radio-outline'} size={24} color={color} />
);

const LuvsIcon = ({ color, focused }: { color: string; focused: boolean }) => (
  <MaterialCommunityIcons name={focused ? 'heart-multiple' : 'heart-multiple-outline'} size={24} color={color} />
);

const LibraryIcon = ({ color, focused }: { color: string; focused: boolean }) => (
  <Ionicons name={focused ? 'library' : 'library-outline'} size={24} color={color} />
);

const SearchIcon = ({ color, focused }: { color: string; focused: boolean }) => (
  <Ionicons name={focused ? 'search' : 'search-outline'} size={24} color={color} />
);

// Luvs keeps the nav bar so the feed is escapable by tapping another tab; only the
// mini player is suppressed there (see RootNavigator) because Luvs runs its own
// audio pool and a transport for a different player would be misleading.
const renderModernPillTabBar = (props: BottomTabBarProps) => <ModernPillTabBar {...props} />;
const renderCustomTabBar = (props: BottomTabBarProps) => <CustomTabBar {...props} />;

export const TabNavigator: React.FC = () => {
  const colors = useThemeColors();
  const isDark = useIsDark();
  const navBarStyle = useSettingsStore(state => state.navBarStyle);

  const activeTint = isDark ? '#fff' : colors.primary;
  const inactiveTint = isDark ? 'rgba(255,255,255,0.5)' : colors.textMuted;

  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        id="MainTabs"
        initialRouteName="Stream"
        // Back from Settings returns to the tab you came from.
        backBehavior="history"
        tabBar={navBarStyle === 'modern-pill' ? renderModernPillTabBar : renderCustomTabBar}
        screenOptions={{
          headerShown: false,
          ...TAB_TRANSITION,
          // A tab you left stops rendering once it becomes inactive and
          // picks up the latest state when you come back. Hidden tabs used to re-render on every
          // player, download and library change.
          freezeOnBlur: true,
          sceneStyle: { backgroundColor: SCREEN_BG },
          tabBarActiveTintColor: activeTint,
          tabBarInactiveTintColor: inactiveTint,
          tabBarShowLabel: navBarStyle === 'classic',
        }}
      >
        <Tab.Screen name="Stream" component={StreamScreen} options={{ tabBarLabel: 'Stream', tabBarIcon: StreamIcon }} />
        {/* Luvs drives a native player pool from its focus state: never frozen. */}
        <Tab.Screen name="Luvs" component={LuvsScreen} options={{ tabBarLabel: 'Luvs', tabBarIcon: LuvsIcon, freezeOnBlur: false }} />
        <Tab.Screen name="Library" component={LibraryStackScreen} options={{ tabBarLabel: 'Library', tabBarIcon: LibraryIcon }} />
        <Tab.Screen name="Search" component={SearchScreen} options={{ tabBarLabel: 'Search', tabBarIcon: SearchIcon }} />
        <Tab.Screen name="Settings" component={SettingsScreen} options={{ tabBarLabel: 'Settings' }} />
        <Tab.Screen name="Browse" component={BrowseStackScreen} options={{ tabBarLabel: 'Browse' }} />
      </Tab.Navigator>
    </View>
  );
};

export default TabNavigator;
