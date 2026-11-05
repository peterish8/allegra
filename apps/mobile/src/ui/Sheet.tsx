/**
 * The one sheet. Everything that rises from the bottom — the player's menu, the sleep timer, song actions,
 * pickers, confirmations — is a `Sheet`, so they all open, drag and close alike:
 *
 * - opens on the open spring, closes on it when a button closes it (decelerating, never an ease-in),
 * - follows the finger down, with the scrim fading by how far it has travelled,
 * - a flick shut keeps the finger's speed, a slow drag past the line closes, anything else settles back,
 * - its list scrolls first; a drag down at the top of the list moves the sheet (`SheetScrollView`),
 * - travel is the card's measured height, so a short sheet doesn't wait on distance nobody sees,
 * - Reduce Motion: it fades in place.
 *
 * `presentation="modal"` (default) draws above everything, tab bar and pill included, in a native modal
 * (back button closes it). The player's own sheets pass `inline`: they must stay inside the player so a drag
 * closes the sheet before the player (see NowPlayingScreen).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, ScrollViewProps, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as GestureHandler from 'react-native-gesture-handler';
import Animated, { runOnJS, SharedValue, useAnimatedKeyboard, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Frosted from '../components/allegra/Frosted';
import type { AuraPalette } from '../components/allegra/palette';
import { releaseSpring } from '../components/allegra/physics';
import { Glass, Motion, Radius, Signal, Space, Surface, Typography } from '../constants/allegraTheme';
import { shouldCloseSheet } from '../navigation/sheetClose';
import * as Haptics from '../utils/haptics';
import { diag } from '../utils/diag';

const { Gesture, GestureDetector, GestureHandlerRootView } = GestureHandler;

/** How dark the page behind an open sheet gets. Clear glass over a light veil, never a slab. */
const SCRIM = 0.4;
/** The card floats this far off the screen's edges. */
const EDGE = 0;
const CORNER = Radius.sheet;
const CLOSE_REST = { restDisplacementThreshold: 0.002, restSpeedThreshold: 0.02 } as const;

/**
 * How far the sheet's own list is scrolled. A drag down closes the sheet only while that is 0 — otherwise the
 * drag scrolls the list back up. Lists inside a sheet report through `useSheetScroll`.
 */
interface SheetScrollState {
  offset: SharedValue<number>;
  /** The list's native scroll, as a gesture the sheet's pan can cancel. */
  list: GestureHandler.NativeGesture;
}

const SheetScrollContext = createContext<SheetScrollState | null>(null);

type OnScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => void;

/**
 * Wraps a sheet's scroll view (a FlatList, a FlashList) and reports its offset to the sheet. On Android a native
 * scroll view that starts dragging cancels every gesture-handler gesture, so without this a swipe down that begins
 * on the list never reaches the sheet. As a Native gesture the list takes part: the pan can win and cancel it.
 * The offset is wired here, not by the caller: a caller that read the sheet's context from the component that
 * renders `<Sheet>` got none, and a drag on a scrolled list closed the sheet instead of scrolling it.
 */
export const SheetScrollable: React.FC<{ children: React.ReactElement<{ onScroll?: OnScroll; scrollEventThrottle?: number }> }> = ({ children }) => {
  const sheet = useContext(SheetScrollContext);
  const own = children.props.onScroll;
  const onScroll = useCallback<OnScroll>(e => {
    if (sheet) sheet.offset.value = e.nativeEvent.contentOffset.y;
    own?.(e);
  }, [sheet, own]);
  if (!sheet) return children;
  const list = React.cloneElement(children, { onScroll, scrollEventThrottle: children.props.scrollEventThrottle ?? 16 });
  return <GestureDetector gesture={sheet.list}>{list}</GestureDetector>;
};

/** A ScrollView that lives in a sheet. */
export const SheetScrollView: React.FC<ScrollViewProps> = props => (
  <SheetScrollable>
    <ScrollView {...props} />
  </SheetScrollable>
);

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  /** Leave out for a sheet that starts straight with its content (a menu). */
  title?: string;
  /** Room for a long list: up to 88% of the screen (otherwise 70%). */
  tall?: boolean;
  /** Tints the glass with the playing cover (the player's sheets). Neutral smoked glass without it. */
  palette?: AuraPalette;
  /** Song actions are deep opaque; player sheets may opt into glass. */
  surface?: 'deep' | 'raised' | 'player';
  /** `modal` draws above everything; `inline` fills its parent (the player's sheets). */
  presentation?: 'modal' | 'inline';
  /** Lift above the keyboard (sheets with a text field). */
  keyboard?: boolean;
  children: React.ReactNode;
}

export const Sheet: React.FC<SheetProps> = ({ visible, onClose, title, tall = false, palette, surface = palette ? 'player' : 'deep', presentation = 'modal', keyboard = false, children }) => {
  const insets = useSafeAreaInsets();
  const { height: windowH } = useWindowDimensions();
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const shown = useSharedValue(0);
  const drag = useSharedValue(0);
  const scrolled = useSharedValue(0);
  // Until the card is measured, assume it is as tall as the screen: it starts off-screen either way.
  const travel = useSharedValue(windowH);
  const kb = useAnimatedKeyboard();
  /** Set when a swipe closed the sheet: its spring is already running, `visible` turning false must not restart it. */
  const swiped = useRef(false);
  const list = useMemo(() => Gesture.Native(), []);
  const scrollState = useMemo(() => ({ offset: scrolled, list }), [scrolled, list]);

  useEffect(() => {
    if (visible) {
      swiped.current = false;
      setMounted(true);
      drag.value = 0;
      scrolled.value = 0;
      shown.value = reduce ? withTiming(1, { duration: Motion.duration.base }) : withSpring(1, Motion.spring.open);
    } else if (mounted && !swiped.current) {
      const done = (finished?: boolean) => {
        'worklet';
        if (finished) runOnJS(setMounted)(false);
      };
      shown.value = reduce
        ? withTiming(0, { duration: Motion.duration.fast }, done)
        : withSpring(0, { ...Motion.spring.open, ...CLOSE_REST }, done);
    }
  }, [visible, mounted, reduce, shown, drag, scrolled]);

  const closedBySwipe = useCallback(() => {
    swiped.current = true;
    Haptics.tap();
    onClose();
  }, [onClose]);

  const scrim = useAnimatedStyle(() => ({
    opacity: SCRIM * shown.value * (1 - Math.min(1, drag.value / Math.max(1, travel.value))),
  }));
  const card = useAnimatedStyle(() => {
    const lift = keyboard ? -kb.height.value : 0;
    if (reduce) return { opacity: shown.value, transform: [{ translateY: drag.value + lift }] };
    return { transform: [{ translateY: (1 - shown.value) * travel.value + drag.value + lift }] };
  });

  // Swiping down closes this sheet and nothing else. It activates at 6pt, inside Android's 8dp touch slop, so
  // on a list at the top it wins before the list starts scrolling and the list's touch is cancelled.
  const pan = Gesture.Pan()
    .activeOffsetY(6)
    .failOffsetY(-8)
    .failOffsetX([-22, 22])
    .onTouchesDown((_e, state) => {
      'worklet';
      if (scrolled.value > 2) state.fail();
    })
    .onUpdate(e => {
      'worklet';
      drag.value = Math.max(0, e.translationY);
    })
    .onEnd(e => {
      'worklet';
      if (!shouldCloseSheet(e.translationY, e.velocityY)) {
        drag.value = withSpring(0, releaseSpring(0, e.velocityY));
        return;
      }
      runOnJS(diag)('sheet', `swipe close dy ${e.translationY.toFixed(0)} vy ${e.velocityY.toFixed(0)}`);
      // Fold the drag into `shown`, then let the spring carry on at the finger's speed.
      const distance = Math.max(1, travel.value);
      shown.value = Math.max(0, shown.value - drag.value / distance);
      drag.value = 0;
      const finish = (finished?: boolean) => {
        'worklet';
        if (finished) runOnJS(setMounted)(false);
      };
      shown.value = reduce
        ? withTiming(0, { duration: Motion.duration.fast }, finish)
        : withSpring(0, { ...releaseSpring(-e.velocityY / distance, e.velocityY), ...CLOSE_REST }, finish);
      runOnJS(closedBySwipe)();
    })
    .onFinalize((_e, success) => {
      'worklet';
      // A pan the list's scroll cancels never reaches onEnd: settle back instead of staying where it was let go.
      if (!success && drag.value > 0) drag.value = withSpring(0, Motion.spring.settle);
    });

  if (!mounted) return null;

  const body = (
    <View style={[StyleSheet.absoluteFill, styles.layer]} pointerEvents={visible ? 'box-none' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrim]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View
          onLayout={e => { travel.value = e.nativeEvent.layout.height + EDGE * 2; }}
          style={[styles.card, tall && styles.tall, { paddingBottom: insets.bottom + Space.sm }, card]}
          accessibilityViewIsModal
        >
          {surface === 'player'
            ? <Frosted radius={CORNER} intensity={85} tint={0.3} palette={palette} />
            : <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: surface === 'deep' ? Surface.deep : Surface.raised }]} />}
          <View style={styles.grabber} accessibilityElementsHidden importantForAccessibility="no" />
          {title ? <Text style={styles.title} accessibilityRole="header">{title}</Text> : <View style={styles.untitled} />}
          <SheetScrollContext.Provider value={scrollState}>{children}</SheetScrollContext.Provider>
        </Animated.View>
      </GestureDetector>
    </View>
  );

  if (presentation === 'inline') return body;
  return (
    <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.fill}>{body}</GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Above the player's header (zIndex 20) and controls (15), which otherwise drew through the menu.
  layer: { zIndex: 100, elevation: 100 },
  scrim: { backgroundColor: Surface.scrim },
  card: {
    position: 'absolute',
    left: EDGE,
    right: EDGE,
    bottom: EDGE,
    maxHeight: '70%',
    borderTopLeftRadius: CORNER,
    borderTopRightRadius: CORNER,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Surface.divider,
    overflow: 'hidden',
    paddingHorizontal: Space.md,
    paddingTop: Space.sm - 2,
  },
  tall: { maxHeight: '88%' },
  untitled: { height: Space.sm },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: Radius.pill, backgroundColor: Glass.grabber },
  title: { ...Typography.title, color: Signal.ink, marginTop: Space.md, marginBottom: Space.xs, marginLeft: Space.xxs },
});
