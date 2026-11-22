/**
 * Sideways pages with a tab strip: Library's Songs · Playlists · Artists · Albums.
 *
 * `SwipePager` lays its pages side by side and moves them as one: the drag is 1:1 under the finger, past the first or
 * last page it rubber-bands, and a release is thrown — the page is projected from the finger's speed and never more
 * than one away, on the same no-overshoot release spring as the sheets (`pagerPhysics`). It only takes clearly
 * sideways drags (vertical lists keep every scroll) and builds a page the first time it is near, then keeps it.
 *
 * `SwipeTabs` is the strip above it. Its underline reads the pager's position on the UI thread, so it slides and
 * stretches between tabs with the finger the whole way, not when the page lands. A tap on a tab springs the pager
 * there. Reduce Motion: pages and underline jump; a drag still follows the finger.
 *
 * The parent owns `position` (in pages) so the two stay in step: `useSharedValue(index)`.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS, useAnimatedReaction, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, type SharedValue,
} from 'react-native-reanimated';
import { releaseSpring } from '../components/allegra/physics';
import { Tactile } from '../components/allegra/motion';
import { Control, Motion, Signal, Space, Surface } from '../constants/allegraTheme';
import { Text } from './Text';
import { indicatorFrame, pageAfterRelease, pagerPosition } from './pagerPhysics';

/** A drag must move this far sideways before the pager takes it, and fails if it goes this far up or down first. */
const TAKE_X = 14;
const YIELD_Y = 12;
const UNDERLINE = 2;

export interface SwipePagerProps {
  count: number;
  index: number;
  /** A swipe landed on a new page (taps come in through `index`). */
  onIndexChange: (index: number) => void;
  /** The pager's position in pages, shared with `SwipeTabs`. */
  position: SharedValue<number>;
  /** Off while something else owns the screen (a search, an opened album). */
  enabled?: boolean;
  renderPage: (index: number) => React.ReactNode;
}

export function SwipePager({ count, index, onIndexChange, position, enabled = true, renderPage }: SwipePagerProps): React.ReactElement {
  const reduce = useReducedMotion();
  const { width: windowW } = useWindowDimensions();
  const [width, setWidth] = useState(windowW);
  const pageW = useSharedValue(windowW);
  const pos = useSharedValue(index * windowW);
  const start = useSharedValue(0);
  const from = useSharedValue(index);
  const dragging = useSharedValue(false);
  /** The page a swipe just landed on: when `index` comes back as that page, the throw is already carrying it there. */
  const landed = useRef(index);
  // Pages are built when they are first near the current one (so a swipe finds its neighbour ready), then kept.
  const [built, setBuilt] = useState<ReadonlySet<number>>(() => new Set([index - 1, index, index + 1]));

  const near = useCallback((i: number) => {
    setBuilt(prev => (prev.has(i - 1) && prev.has(i) && prev.has(i + 1) ? prev : new Set([...prev, i - 1, i, i + 1])));
  }, []);

  useAnimatedReaction(() => pos.value / Math.max(1, pageW.value), page => { position.value = page; });

  // A tap on a tab (or any outside change of page): spring there. A swipe's own landing is already moving.
  useEffect(() => {
    near(index);
    if (landed.current === index) return;
    landed.current = index;
    if (reduce) pos.value = index * pageW.value;
    else pos.value = withSpring(index * pageW.value, Motion.spring.open);
  }, [index, reduce, pos, pageW, near]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w <= 0 || w === width) return;
    setWidth(w);
    pageW.value = w;
    pos.value = landed.current * w;
  };

  const land = useCallback((i: number) => {
    landed.current = i;
    near(i);
    onIndexChange(i);
  }, [near, onIndexChange]);

  const settle = (velocityX: number) => {
    'worklet';
    const target = pageAfterRelease(pos.value, velocityX, pageW.value, count, from.value);
    if (reduce) pos.value = target * pageW.value;
    else pos.value = withSpring(target * pageW.value, releaseSpring(-velocityX, velocityX));
    if (target !== from.value) runOnJS(land)(target);
  };

  const pan = Gesture.Pan()
    .enabled(enabled && count > 1)
    .activeOffsetX([-TAKE_X, TAKE_X])
    .failOffsetY([-YIELD_Y, YIELD_Y])
    .onStart(() => {
      'worklet';
      dragging.value = true;
      start.value = pos.value;
      from.value = Math.round(pos.value / Math.max(1, pageW.value));
    })
    .onUpdate(e => {
      'worklet';
      pos.value = pagerPosition(start.value, e.translationX, (count - 1) * pageW.value);
    })
    .onEnd(e => {
      'worklet';
      dragging.value = false;
      settle(e.velocityX);
    })
    .onFinalize((_e, success) => {
      'worklet';
      // A drag the system cancels never reaches onEnd: land on the nearest page instead of stopping between two.
      if (!success && dragging.value) {
        dragging.value = false;
        settle(0);
      }
    });

  const row = useAnimatedStyle(() => ({ transform: [{ translateX: -pos.value }] }));

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.viewport} onLayout={onLayout}>
        <Animated.View style={[styles.row, { width: width * count }, row]}>
          {Array.from({ length: count }, (_, i) => (
            <View
              key={i}
              style={{ width }}
              // Only the page in front is read out; the others sit off-screen.
              importantForAccessibility={i === index ? 'auto' : 'no-hide-descendants'}
              accessibilityElementsHidden={i !== index}
            >
              {built.has(i) ? renderPage(i) : null}
            </View>
          ))}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

export interface SwipeTabsProps {
  tabs: readonly string[];
  index: number;
  onSelect: (index: number) => void;
  /** The pager's position in pages (`SwipePager`'s `position`). */
  position: SharedValue<number>;
  /** Beside the strip (a search button). */
  trailing?: React.ReactNode;
}

export function SwipeTabs({ tabs, index, onSelect, position, trailing }: SwipeTabsProps): React.ReactElement {
  const lefts = useSharedValue<number[]>(tabs.map(() => 0));
  const widths = useSharedValue<number[]>(tabs.map(() => 0));

  const measure = (i: number) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    const nextLefts = [...lefts.value];
    const nextWidths = [...widths.value];
    nextLefts[i] = x;
    nextWidths[i] = width;
    lefts.value = nextLefts;
    widths.value = nextWidths;
  };

  // A 1pt bar moved and stretched by transform only: centred on the frame, scaled to its width.
  const underline = useAnimatedStyle((): ViewStyle => {
    const frame = indicatorFrame(position.value, lefts.value, widths.value);
    return { transform: [{ translateX: frame.left + frame.width / 2 - 0.5 }, { scaleX: Math.max(0, frame.width) }] };
  });

  return (
    <View style={styles.tabs}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabContent}>
        {tabs.map((label, i) => (
          <View key={label} onLayout={measure(i)}>
            <Tactile
              onPress={() => onSelect(i)}
              haptic="select"
              accessibilityRole="tab"
              accessibilityState={{ selected: i === index }}
              style={styles.tab}
            >
              <Text tone={i === index ? 'primary' : 'secondary'}>{label}</Text>
            </Tactile>
          </View>
        ))}
        <Animated.View pointerEvents="none" style={[styles.underline, underline]} />
      </ScrollView>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
  row: { flex: 1, flexDirection: 'row' },
  tabs: { flexDirection: 'row', alignItems: 'center', paddingLeft: Control.gutter, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Surface.divider },
  tabContent: { gap: Space.md },
  // The weight never changes and the underline floats over the bottom edge, so picking a tab moves nothing.
  tab: { minHeight: Control.target, minWidth: Control.target, justifyContent: 'center', paddingVertical: Space.sm },
  underline: { position: 'absolute', left: 0, bottom: 0, width: 1, height: UNDERLINE, backgroundColor: Signal.wave },
});
