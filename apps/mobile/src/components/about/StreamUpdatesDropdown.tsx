import { Image } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { LinearTransition, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { Glass, Motion, Radius, Signal, Space, Surface } from '../../constants/allegraTheme';
import { isFling, projectMomentum, releaseSpring, rubberBand } from '../allegra/physics';
import { Tactile } from '../allegra/motion';
import UpdatePanel from './UpdatePanel';

/** The panel grows out of the mark from this scale (a popover never starts from nothing). */
const ENTER_SCALE = 0.95;
/** How far a pull down on the grabber may stretch (the rubber band's dimension, pt). */
const STRETCH = 32;

interface Props {
  /** Screen-space top edge of the dropdown, just below the fixed Stream header. */
  topOffset: number;
  rightOffset: number;
}

/**
 * The real LuvLyrics mark opens the latest release and its notes without the rest of About.
 *
 * It moves like the app's sheets, mirrored for a panel that hangs from the top: it grows out of the mark on a
 * critically damped spring; the grabber on its bottom edge follows the finger 1:1 up (and rubber-bands down), and
 * a release is thrown — dismissed when its projected rest is past a third of the panel or on a flick up, the spring
 * starting at the finger's speed. A tap outside or back fades it away. Reduce Motion: it fades, nothing scales.
 */
export function StreamUpdatesDropdown({ topOffset, rightOffset }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const panelWidth = Math.max(0, Math.min(380, width - rightOffset * 2));
  const panelMaxHeight = Math.max(0, height - topOffset - insets.bottom - Space.md);
  const shown = useSharedValue(0);
  const drag = useSharedValue(0);
  const panelH = useSharedValue(panelMaxHeight);
  /** Set when a swipe dismissed it: its spring is already running; `open` turning false must not restart it. */
  const swiped = useRef(false);
  const unmount = (): void => setMounted(false);

  useEffect(() => {
    if (open) {
      swiped.current = false;
      setMounted(true);
      drag.value = 0;
      if (reduceMotion) shown.value = 1;
      else shown.value = withSpring(1, Motion.spring.open);
    } else if (!swiped.current) {
      shown.value = withTiming(0, { duration: reduceMotion ? 0 : Motion.duration.fast }, finished => {
        if (finished) runOnJS(unmount)();
      });
    }
  }, [open, reduceMotion, shown, drag]);

  const close = (): void => setOpen(false);
  const dismissedBySwipe = (): void => { swiped.current = true; setOpen(false); };

  const backdrop = useAnimatedStyle(() => ({ opacity: shown.value }));
  const panel = useAnimatedStyle((): ViewStyle => ({
    opacity: shown.value,
    transform: [{ translateY: drag.value }, { scale: reduceMotion ? 1 : ENTER_SCALE + (1 - ENTER_SCALE) * shown.value }],
  }));

  const pull = Gesture.Pan()
    .activeOffsetY([-6, 6])
    .onUpdate(e => {
      'worklet';
      const y = e.translationY;
      drag.value = y < 0 ? y : rubberBand(y, STRETCH);
    })
    .onEnd(e => {
      'worklet';
      const projected = drag.value + projectMomentum(e.velocityY);
      const dismiss = (isFling(e.velocityY) && e.velocityY < 0) || projected < -panelH.value / 3;
      if (!dismiss) {
        if (reduceMotion) drag.value = 0;
        else drag.value = withSpring(0, releaseSpring(e.velocityY, e.velocityY));
        return;
      }
      // Carried off the top at the finger's speed, fading as it goes (Reduce Motion: it only fades).
      if (!reduceMotion) drag.value = withSpring(-(panelH.value + topOffset), releaseSpring(e.velocityY, e.velocityY));
      shown.value = withTiming(0, { duration: reduceMotion ? 0 : Motion.duration.base }, finished => {
        if (finished) runOnJS(unmount)();
      });
      runOnJS(dismissedBySwipe)();
    });

  return (
    <>
      <Tactile
        accessibilityRole="button"
        accessibilityLabel="LuvLyrics updates"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(value => !value)}
        hitSlop={8}
        pressScale={0.96}
        style={styles.trigger}
      >
        {/* Owner, 1.69.0: the black-and-white LuvLyrics mark, a full disc the size of the Devices button beside it. */}
        <Image
          source={require('../../../assets/luvlyrics-icon-monochrome.png')}
          contentFit="cover"
          transition={0}
          style={styles.logo}
        />
      </Tactile>

      <Modal
        visible={mounted}
        transparent
        statusBarTranslucent
        animationType="none"
        onRequestClose={close}
      >
        <GestureHandlerRootView style={StyleSheet.absoluteFill} accessibilityViewIsModal>
          <Animated.View style={[StyleSheet.absoluteFill, backdrop]}>
            <Tactile
              accessibilityRole="button"
              accessibilityLabel="Dismiss updates"
              onPress={close}
              pressScale={1}
              wrapperStyle={StyleSheet.absoluteFillObject}
              style={[StyleSheet.absoluteFillObject, styles.backdrop]}
            >
              <View />
            </Tactile>
          </Animated.View>
          {/* The panel grows and shrinks with its content (the Recent updates arrow) instead of jumping. */}
          <Animated.View
            layout={reduceMotion ? undefined : LinearTransition.duration(Motion.duration.base)}
            onLayout={e => { panelH.value = e.nativeEvent.layout.height; }}
            style={[styles.dropdown, { top: topOffset, right: rightOffset, width: panelWidth, maxHeight: panelMaxHeight }, panel]}
          >
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              <UpdatePanel visible={open} dropdown onClose={close} />
            </ScrollView>
            <GestureDetector gesture={pull}>
              <View style={styles.grabberBand} accessibilityElementsHidden importantForAccessibility="no">
                <View style={styles.grabber} />
              </View>
            </GestureDetector>
          </Animated.View>
        </GestureHandlerRootView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: Signal.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Glass.hairline,
  },
  // The mark's own black fills the circle; the heart sits in the middle at the Devices glyph's visual weight.
  logo: { width: 40, height: 40 },
  backdrop: { backgroundColor: Glass.scrim },
  dropdown: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: Radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Glass.hairlineStrong,
    backgroundColor: Surface.deep,
    shadowColor: Signal.bg,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.24,
    shadowRadius: 20,
    elevation: 16,
    // It grows out of the mark at the top right.
    transformOrigin: 'top right',
  },
  // A drag handle on the bottom edge: pull it up to put the panel away. Tall enough to catch a thumb.
  grabberBand: { height: Space.lg, alignItems: 'center', justifyContent: 'center' },
  grabber: { width: 36, height: 5, borderRadius: Radius.pill, backgroundColor: Glass.grabber },
  scroll: { flexGrow: 0 },
  content: { padding: Space.md },
});
