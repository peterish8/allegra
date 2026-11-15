import { Image } from 'expo-image';
import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';

import { Glass, Radius, Signal, Space, Surface } from '../../constants/allegraTheme';
import { Tactile } from '../allegra/motion';
import UpdatePanel from './UpdatePanel';

interface Props {
  /** Screen-space top edge of the dropdown, just below the fixed Stream header. */
  topOffset: number;
  rightOffset: number;
}

/** The real LuvLyrics mark opens the latest release and its notes without the rest of About. */
export function StreamUpdatesDropdown({ topOffset, rightOffset }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const close = (): void => setOpen(false);
  const panelWidth = Math.max(0, Math.min(380, width - rightOffset * 2));
  const panelMaxHeight = Math.max(0, height - topOffset - insets.bottom - Space.md);

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
        visible={open}
        transparent
        statusBarTranslucent
        animationType={reduceMotion ? 'none' : 'fade'}
        onRequestClose={close}
      >
        <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
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
          <View style={[styles.dropdown, { top: topOffset, right: rightOffset, width: panelWidth, maxHeight: panelMaxHeight }]}>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              <UpdatePanel visible={open} dropdown onClose={close} />
            </ScrollView>
          </View>
        </View>
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
  },
  scroll: { flexGrow: 0 },
  content: { padding: Space.md },
});
