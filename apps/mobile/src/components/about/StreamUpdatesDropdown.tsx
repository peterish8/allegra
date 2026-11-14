import { Image } from 'expo-image';
import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';

import { BlurIntensity, Glass, Radius, Signal, Space } from '../../constants/allegraTheme';
import { Frosted } from '../allegra/Frosted';
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
        <Image
          source={require('../../../assets/luvlyrics_logo_med.png')}
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
            <Frosted radius={Radius.sheet} intensity={BlurIntensity.panel} tint={0.28} />
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
    backgroundColor: Glass.fillLight,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Glass.hairline,
  },
  logo: { width: 30, height: 30, borderRadius: 8 },
  backdrop: { backgroundColor: Glass.fillLight },
  dropdown: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: Radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Glass.hairlineStrong,
    backgroundColor: Glass.fill,
    shadowColor: Signal.bg,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.24,
    shadowRadius: 20,
    elevation: 16,
  },
  scroll: { flexGrow: 0 },
  content: { padding: Space.md },
});
