/**
 * The one sheet. Everything that rises from the bottom — the player's menu, the sleep timer, song actions,
 * pickers, confirmations, "Saved in" — is a `Sheet`, so they all open, drag and close alike:
 *
 * - one value, the card's offset (`pos`), drives everything: the card, the scrim, the footer, the top bar,
 * - the drag is direct, 1:1 under the finger; pulled past its top it rubber-bands instead of a hard stop,
 * - a release throws it: the rest is projected from the finger's speed and the spring starts at that speed,
 *   critically damped (no bounce), never skipping a rest (`sheetPhysics.ts`),
 * - its list scrolls first; a drag down at the top of the list moves the sheet (`SheetScrollView`),
 * - travel is the card's measured height, so a short sheet doesn't wait on distance nobody sees,
 * - Reduce Motion: it fades in place; a drag still follows the finger.
 *
 * `expandable` gives Spotify's two rests: it opens short (about 60% of the screen) and a pull up takes it to
 * full height, where its list scrolls; a pull down walks back short → closed. Children read `useSheet()` for
 * how expanded it is (to fade in a top bar) and to `expand()` it (a search field taking focus).
 *
 * `presentation="modal"` (default) draws above everything, tab bar and pill included, in a native modal
 * (back button closes it). The player's own sheets pass `inline`: they must stay inside the player so a drag
 * closes the sheet before the player (see NowPlayingScreen).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, ScrollViewProps, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as GestureHandler from 'react-native-gesture-handler';
import Animated, { runOnJS, SharedValue, useAnimatedKeyboard, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Frosted from '../components/allegra/Frosted';
import type { AuraPalette } from '../components/allegra/palette';
import { releaseSpring } from '../components/allegra/physics';
import { Glass, Motion, Radius, Signal, Space, Surface, Typography } from '../constants/allegraTheme';
import * as Haptics from '../utils/haptics';
import { diag } from '../utils/diag';
import { CoverGlow } from './Screen';
import { dragPosition, nearestRest, pickRest, progressBetween } from './sheetPhysics';

const { Gesture, GestureDetector, GestureHandlerRootView } = GestureHandler;

/** How dark the page behind an open sheet gets. Clear glass over a light veil, never a slab. */
const SCRIM = 0.4;
const CORNER = Radius.sheet;
/** The card runs this far past the screen's bottom edge, so a pull up past its top never shows a gap under it. */
const SKIRT = 96;
/** An expandable sheet opens to this share of the screen. */
const SHORT_FRACTION = 0.62;
/** The band at the top of an expandable sheet: the grabber at rest, the top bar (Cancel · Done) when full. */
const SHEET_TOP_BAR = 52;
const CLOSE_REST = { restDisplacementThreshold: 0.5, restSpeedThreshold: 2 } as const;

/**
 * How far the sheet's own list is scrolled. A drag down closes the sheet only while that is 0 — otherwise the
 * drag scrolls the list back up. Lists inside a sheet report through `SheetScrollable`.
 */
interface SheetState {
  offset: SharedValue<number>;
  /** The list's native scroll, as a gesture the sheet's pan can cancel. */
  list: GestureHandler.NativeGesture;
  /** False while an expandable sheet rests short: the list holds still and a pull up expands the sheet. */
  scrollable: boolean;
  /** 0 at the short rest, 1 at full height. Always 1 for a sheet that isn't expandable. */
  expanded: SharedValue<number>;
  expand: () => void;
}

const SheetContext = createContext<SheetState | null>(null);

/** The sheet around this component: how expanded it is, and a way to expand it. */
export const useSheet = (): Pick<SheetState, 'expanded' | 'expand' | 'scrollable'> | null => useContext(SheetContext);

type OnScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => void;

/**
 * Wraps a sheet's scroll view (a FlatList, a FlashList) and reports its offset to the sheet. On Android a native
 * scroll view that starts dragging cancels every gesture-handler gesture, so without this a swipe down that begins
 * on the list never reaches the sheet. As a Native gesture the list takes part: the pan can win and cancel it.
 * The offset is wired here, not by the caller: a caller that read the sheet's context from the component that
 * renders `<Sheet>` got none, and a drag on a scrolled list closed the sheet instead of scrolling it.
 */
export const SheetScrollable: React.FC<{ children: React.ReactElement<{ onScroll?: OnScroll; scrollEventThrottle?: number; scrollEnabled?: boolean }> }> = ({ children }) => {
  const sheet = useContext(SheetContext);
  const own = children.props.onScroll;
  const onScroll = useCallback<OnScroll>(e => {
    if (sheet) sheet.offset.value = e.nativeEvent.contentOffset.y;
    own?.(e);
  }, [sheet, own]);
  if (!sheet) return children;
  const list = React.cloneElement(children, {
    onScroll,
    scrollEventThrottle: children.props.scrollEventThrottle ?? 16,
    scrollEnabled: sheet.scrollable && children.props.scrollEnabled !== false,
  });
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
  /** Spotify's two rests: opens short, pulls up to full height. Its content should fill the card (`flex: 1`). */
  expandable?: boolean;
  /** Expandable only: open at full height (a page-like tool); a pull down still walks back short → closed. */
  startFull?: boolean;
  /** Expandable only: drawn in the top band, fading in as the sheet reaches full height (Cancel · Done). */
  topBar?: React.ReactNode;
  /** Pinned to the bottom of the screen above the card (a floating Done), leaving with the sheet. */
  footer?: React.ReactNode;
  /** Tints the glass with the playing cover (the player's sheets). Neutral smoked glass without it. */
  palette?: AuraPalette;
  /** Song actions are deep opaque; player sheets may opt into glass. */
  surface?: 'deep' | 'raised' | 'player';
  /** `modal` draws above everything; `inline` fills its parent (the player's sheets). */
  presentation?: 'modal' | 'inline';
  /** Lift above the keyboard (sheets with a text field). */
  keyboard?: boolean;
  /** A faint glow of this cover across the top (an actions sheet for a song or a mix). */
  tintUri?: string;
  children: React.ReactNode;
}

export const Sheet: React.FC<SheetProps> = ({ visible, onClose, title, tall = false, expandable = false, startFull = false, topBar, footer, palette, surface = palette ? 'player' : 'deep', presentation = 'modal', keyboard = false, tintUri, children }) => {
  const insets = useSafeAreaInsets();
  const { height: windowH } = useWindowDimensions();
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const [atFull, setAtFull] = useState(!expandable || startFull);
  const scrolled = useSharedValue(0);
  const fade = useSharedValue(reduce ? 0 : 1);
  const kb = useAnimatedKeyboard();

  // Geometry. Offsets are measured down from the open position; `closedY` is fully off-screen.
  const fullH = Math.max(0, windowH - insets.top - Space.xs);
  const closedY = useSharedValue(expandable ? fullH : windowH);
  const shortY = useSharedValue(expandable ? Math.max(0, fullH - windowH * SHORT_FRACTION) : 0);
  useEffect(() => {
    if (!expandable) return;
    closedY.value = fullH;
    shortY.value = Math.max(0, fullH - windowH * SHORT_FRACTION);
  }, [expandable, fullH, windowH, closedY, shortY]);
  const pos = useSharedValue(expandable ? fullH : windowH);
  const dragStart = useSharedValue(0);
  const dragFrom = useSharedValue(0);

  /** Set when a swipe closed the sheet: its spring is already running, `visible` turning false must not restart it. */
  const swiped = useRef(false);
  const list = useMemo(() => Gesture.Native(), []);
  const expanded = useDerivedValue(() => (expandable ? progressBetween(pos.value, shortY.value, 0) : 1));

  const unmount = useCallback(() => setMounted(false), []);

  useEffect(() => {
    if (visible) {
      swiped.current = false;
      setMounted(true);
      setAtFull(!expandable || startFull);
      scrolled.value = 0;
      const rest = expandable && !startFull ? shortY.value : 0;
      if (reduce) {
        pos.value = rest;
        fade.value = withTiming(1, { duration: Motion.duration.base });
      } else {
        fade.value = 1;
        pos.value = withSpring(rest, Motion.spring.open);
      }
    } else if (mounted && !swiped.current) {
      const done = (finished?: boolean) => {
        'worklet';
        if (finished) runOnJS(unmount)();
      };
      if (reduce) fade.value = withTiming(0, { duration: Motion.duration.fast }, done);
      else pos.value = withSpring(closedY.value, { ...Motion.spring.open, ...CLOSE_REST }, done);
    }
    // Only `visible` drives opening and closing; the rest are stable refs or read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const closedBySwipe = useCallback(() => {
    swiped.current = true;
    Haptics.tap();
    onClose();
  }, [onClose]);

  const expand = useCallback(() => {
    if (!expandable) return;
    setAtFull(true);
    pos.value = reduce ? withTiming(0, { duration: Motion.duration.fast }) : withSpring(0, Motion.spring.open);
  }, [expandable, reduce, pos]);

  const state = useMemo<SheetState>(() => ({ offset: scrolled, list, scrollable: atFull, expanded, expand }), [scrolled, list, atFull, expanded, expand]);

  // The scrim darkens with the card's travel from closed to its first open rest.
  const scrim = useAnimatedStyle(() => {
    const firstRest = expandable ? shortY.value : 0;
    return { opacity: SCRIM * fade.value * progressBetween(pos.value, closedY.value, firstRest) };
  });
  const card = useAnimatedStyle(() => {
    const lift = keyboard && !expandable ? -kb.height.value : 0;
    return { opacity: fade.value, transform: [{ translateY: pos.value + lift }] };
  });
  // The footer sits at the bottom of the screen while the card is open, and leaves with it below its first rest.
  const footerStyle = useAnimatedStyle(() => {
    const firstRest = expandable ? shortY.value : 0;
    const lift = keyboard ? -kb.height.value : 0;
    return { opacity: fade.value, transform: [{ translateY: Math.max(0, pos.value - firstRest) + lift }] };
  });
  const grabberStyle = useAnimatedStyle(() => ({ opacity: 1 - expanded.value }));
  const topBarStyle = useAnimatedStyle(() => ({ opacity: expanded.value }));

  /** Settles on a rest from a release, carrying the finger's speed; closing hands over to `onClose`. */
  const settle = (velocityY: number) => {
    'worklet';
    const rests = expandable ? [0, shortY.value, closedY.value] : [0, closedY.value];
    const target = pickRest(pos.value, velocityY, rests, dragFrom.value, Motion.flingVelocity);
    const closing = target === rests.length - 1;
    const to = rests[target];
    if (expandable) runOnJS(setAtFull)(target === 0);
    if (closing) {
      runOnJS(diag)('sheet', `swipe close vy ${velocityY.toFixed(0)}`);
      const finish = (finished?: boolean) => {
        'worklet';
        if (finished) runOnJS(unmount)();
      };
      if (reduce) fade.value = withTiming(0, { duration: Motion.duration.fast }, finish);
      else pos.value = withSpring(to, { ...releaseSpring(velocityY, velocityY), ...CLOSE_REST }, finish);
      runOnJS(closedBySwipe)();
      return;
    }
    pos.value = reduce ? withTiming(to, { duration: Motion.duration.fast }) : withSpring(to, releaseSpring(velocityY, velocityY));
  };

  /**
   * The card's pan. `twoWay` lets it move up as well as down: always on the top band, and on the whole card while
   * an expandable sheet rests short (its list holds still, so a pull up there is the sheet's). Otherwise it only
   * takes downward drags, and only while the list is at its top, so the list keeps every scroll. It activates at
   * 6pt, inside Android's 8dp touch slop, so on a list at the top it wins before the list starts scrolling.
   */
  const makePan = (twoWay: boolean, watchList: boolean) => {
    const pan = Gesture.Pan().failOffsetX([-22, 22]);
    if (twoWay) pan.activeOffsetY([-6, 6]);
    else pan.activeOffsetY(6).failOffsetY(-8);
    return pan
      .onTouchesDown((_e, manager) => {
        'worklet';
        if (watchList && scrolled.value > 2) manager.fail();
      })
      .onStart(() => {
        'worklet';
        dragStart.value = pos.value;
        // The open rest the drag leaves from (never "closed": it is already moving).
        dragFrom.value = nearestRest(pos.value, expandable ? [0, shortY.value] : [0]);
      })
      .onUpdate(e => {
        'worklet';
        pos.value = dragPosition(dragStart.value, e.translationY, 0);
      })
      .onEnd(e => {
        'worklet';
        settle(e.velocityY);
      })
      .onFinalize((_e, success) => {
        'worklet';
        // A pan the list's scroll cancels never reaches onEnd: settle where the finger left it.
        if (!success && Math.abs(pos.value - dragStart.value) > 0.5) settle(0);
      });
  };
  const bodyTwoWay = expandable && !atFull;
  const headPan = makePan(true, false);
  const bodyPan = makePan(bodyTwoWay, !bodyTwoWay);

  if (!mounted) return null;

  const surfaceLayer = surface === 'player'
    ? <Frosted radius={CORNER} intensity={85} tint={0.3} palette={palette} />
    : <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: surface === 'deep' ? Surface.deep : Surface.raised }]} />;

  const body = (
    <View style={[StyleSheet.absoluteFill, styles.layer]} pointerEvents={visible ? 'box-none' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrim]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      </Animated.View>
      <SheetContext.Provider value={state}>
        <Animated.View
          onLayout={e => {
            if (!expandable) closedY.value = Math.max(1, e.nativeEvent.layout.height - SKIRT);
          }}
          style={[
            styles.card,
            expandable ? { height: fullH + SKIRT } : tall ? { maxHeight: windowH * 0.88 + SKIRT } : { maxHeight: windowH * 0.7 + SKIRT },
            { paddingBottom: insets.bottom + Space.sm + SKIRT },
            card,
          ]}
          accessibilityViewIsModal
        >
          {surfaceLayer}
          {tintUri && surface !== 'player' ? <View pointerEvents="none" style={styles.tint}><CoverGlow uri={tintUri} /></View> : null}
          <GestureDetector gesture={headPan}>
            <View>
              {expandable ? (
                <View style={styles.topBand}>
                  <Animated.View style={[styles.grabberBand, grabberStyle]} pointerEvents="none">
                    <View style={styles.grabber} accessibilityElementsHidden importantForAccessibility="no" />
                  </Animated.View>
                  {topBar ? <Animated.View style={[StyleSheet.absoluteFill, topBarStyle]} pointerEvents={atFull ? 'box-none' : 'none'}>{topBar}</Animated.View> : null}
                </View>
              ) : (
                <View style={styles.grabber} accessibilityElementsHidden importantForAccessibility="no" />
              )}
              {title ? <Text style={styles.title} accessibilityRole="header">{title}</Text> : expandable ? null : <View style={styles.untitled} />}
            </View>
          </GestureDetector>
          <GestureDetector gesture={bodyPan}>
            <View style={expandable ? styles.fill : styles.bodyFit}>{children}</View>
          </GestureDetector>
        </Animated.View>
        {footer ? <Animated.View pointerEvents="box-none" style={[styles.footer, { bottom: insets.bottom + Space.sm }, footerStyle]}>{footer}</Animated.View> : null}
      </SheetContext.Provider>
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
  bodyFit: { flexShrink: 1 },
  // Above the player's header (zIndex 20) and controls (15), which otherwise drew through the menu.
  layer: { zIndex: 100, elevation: 100 },
  scrim: { backgroundColor: Surface.scrim },
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -SKIRT,
    borderTopLeftRadius: CORNER,
    borderTopRightRadius: CORNER,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Surface.divider,
    overflow: 'hidden',
    paddingHorizontal: Space.md,
    paddingTop: Space.sm - 2,
  },
  tint: { ...StyleSheet.absoluteFillObject, opacity: 0.6 },
  untitled: { height: Space.sm },
  topBand: { height: SHEET_TOP_BAR, marginTop: -(Space.sm - 2), justifyContent: 'flex-start' },
  grabberBand: { paddingTop: Space.sm - 2 },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: Radius.pill, backgroundColor: Glass.grabber },
  title: { ...Typography.title, color: Signal.ink, marginTop: Space.md, marginBottom: Space.xs, marginLeft: Space.xxs },
  footer: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
});
