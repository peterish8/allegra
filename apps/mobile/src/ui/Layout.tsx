/**
 * Page structure: the large title every tab page starts with, the empty state, a floating glass panel, and a
 * loading placeholder that has the shape of what it becomes.
 *
 * Bottom padding for any scrolling page is `useBottomClearance()` (re-exported from the library): it clears the
 * tab bar and the pill. Never a number.
 */
import React, { useEffect } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { Control, Glass, Motion, Radius, Signal, Space, Surface } from '../constants/allegraTheme';
import Frosted from '../components/allegra/Frosted';
import { Text } from './Text';
import { Button, type IconName } from './Button';

/** Horizontal gutter for page content. */
export const GUTTER = Control.gutter;

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Up to two IconButtons on the right. */
  actions?: React.ReactNode;
  /** Inside a pushed page: a back control on the left. */
  leading?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, actions, leading, style }) => (
  <View style={[styles.header, style]}>
    {leading}
    <View style={styles.headerText}>
      <Text variant="page" numberOfLines={1} accessibilityRole="header">{title}</Text>
      {subtitle ? <Text variant="secondary" tone="muted" numberOfLines={1}>{subtitle}</Text> : null}
    </View>
    {actions ? <View style={styles.actions}>{actions}</View> : null}
  </View>
);

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  /** What to do about it, in one sentence. */
  body?: string;
  action?: { label: string; onPress: () => void; icon?: IconName };
  style?: StyleProp<ViewStyle>;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, body, action, style }) => (
  <View style={[styles.empty, style]}>
    <View style={styles.emptyIcon}><Ionicons name={icon} size={26} color={Signal.inkSoft} /></View>
    <Text variant="lead" align="center">{title}</Text>
    {body ? <Text variant="body" tone="muted" align="center">{body}</Text> : null}
    {action ? <Button label={action.label} icon={action.icon} variant="primary" onPress={action.onPress} style={styles.emptyAction} /> : null}
  </View>
);

/** Reading panels are opaque. A player palette opts into the existing frosted material. */
export const Panel: React.FC<{ children: React.ReactNode; radius?: number; padding?: number; style?: StyleProp<ViewStyle>; palette?: React.ComponentProps<typeof Frosted>['palette'] }> = ({ children, radius = Radius.well, padding = Space.md, style, palette }) => (
  <View style={[{ borderRadius: radius, padding, overflow: 'hidden' }, style]}>
    {palette ? <Frosted radius={radius} palette={palette} tint={0.3} /> : <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: Surface.raised }]} />}
    {children}
  </View>
);

/**
 * A placeholder block in the shape of the content it stands for. A slow breath of opacity while it waits (the
 * one loop allowed, because it means "still loading"); still under Reduce Motion.
 */
export const Placeholder: React.FC<{ width?: number | `${number}%`; height: number; radius?: number; style?: StyleProp<ViewStyle> }> = ({ width = '100%', height, radius = Space.xs, style }) => {
  const reduce = useReducedMotion();
  const breath = useSharedValue(0.5);
  useEffect(() => {
    if (reduce) return;
    breath.value = withRepeat(withTiming(1, { duration: Motion.duration.cinematic * 1.4, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [reduce, breath]);
  const style_ = useAnimatedStyle(() => ({ opacity: breath.value }));
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: Glass.fillLight }, style_, style]} />;
};

/** A list row's placeholder: cover square and two lines, at the row's real height. */
export const RowPlaceholder: React.FC = () => (
  <View style={styles.rowPh}>
    <Placeholder width={48} height={48} radius={Space.xs} />
    <View style={styles.rowPhText}>
      <Placeholder width="62%" height={14} />
      <Placeholder width="38%" height={12} />
    </View>
  </View>
);

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingHorizontal: GUTTER, paddingTop: Space.xs, paddingBottom: Space.sm },
  headerText: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  empty: { alignItems: 'center', gap: Space.xs, paddingHorizontal: Space.xl, paddingVertical: Space.xxl },
  emptyIcon: { width: 56, height: 56, borderRadius: Radius.panel, alignItems: 'center', justifyContent: 'center', backgroundColor: Surface.raised, marginBottom: Space.xs },
  emptyAction: { marginTop: Space.md },
  rowPh: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, height: 64, paddingHorizontal: Space.sm },
  rowPhText: { flex: 1, gap: Space.xs },
});
