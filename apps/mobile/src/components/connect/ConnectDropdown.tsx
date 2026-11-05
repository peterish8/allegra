import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';

import { Signal } from '../../constants/allegraTheme';
import { useConnect } from '../../services/connect/ConnectProvider';
import { Sheet, SheetScrollView, Tactile } from '../../ui';
import * as Haptics from '../../utils/haptics';
import { ConnectDeviceList } from './ConnectDeviceSheet';

/** The Stream header and the player picker share the same session and device actions. */
export function ConnectDropdown(): React.JSX.Element {
  const connect = useConnect();
  const focused = useIsFocused();
  const { width, height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [focused, width, height, connect.signedIn]);
  const close = (): void => setOpen(false);
  return (
    <>
      <Tactile
        accessibilityRole="button"
        accessibilityLabel={connect.view?.activeDevice ? `Connect, playing on ${connect.view.activeDevice.name}` : 'Connect devices'}
        accessibilityState={{ expanded: open }}
        onPress={() => { Haptics.selectionAsync().catch(() => undefined); setOpen(true); }}
        hitSlop={8}
        pressScale={0.9}
        style={[styles.trigger, connect.remotePlayback && styles.triggerRemote]}
      >
        <MaterialCommunityIcons name="devices" size={20} color={connect.remotePlayback ? Signal.wave : Signal.ink} />
      </Tactile>
      <Sheet visible={open} onClose={close} title="Connect devices">
        <SheetScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <ConnectDeviceList onClose={close} />
        </SheetScrollView>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  // Same 40pt circle as the logo button beside it; hitSlop takes the target past 48dp.
  trigger: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  triggerRemote: { backgroundColor: 'rgba(217,230,106,0.12)', borderColor: 'rgba(217,230,106,0.55)' },
});
