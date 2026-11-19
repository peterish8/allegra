import { SafeAreaView } from 'react-native-safe-area-context';
import React from 'react';
import { type ViewProps } from 'react-native';
import { Screen } from '../ui/Screen';
import { usePlayerStore } from '../store/playerStore';

/** Application binding kept outside the stateless UI library. */
export const AppScreen: React.FC<ViewProps & { staticGlow?: boolean }> = props => {
  const coverUri = usePlayerStore(s => s.currentSong?.coverImageUri ?? s.currentSong?.coverRemoteUri);
  return <Screen {...props} coverUri={coverUri} />;
};

/**
 * Safe-area binding for utility screens; content stays transparent above the shared glow. `staticGlow={false}` for a
 * page under a solid navigation bar: the bar hides the glow's top and leaves a tinted band below it.
 */
export const AppSafeArea: React.FC<React.ComponentProps<typeof SafeAreaView> & { staticGlow?: boolean }> = ({ children, style, staticGlow, ...props }) => (
  <AppScreen staticGlow={staticGlow}><SafeAreaView {...props} style={[style, { flex: 1, backgroundColor: 'transparent' }]}>{children}</SafeAreaView></AppScreen>
);
