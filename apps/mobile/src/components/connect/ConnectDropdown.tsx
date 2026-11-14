import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet } from 'react-native';

import { Glass, Signal } from '../../constants/allegraTheme';
import { useConnect } from '../../services/connect/ConnectProvider';
import { Tactile } from '../../ui';
import * as Haptics from '../../utils/haptics';

/** The Stream header opens the same app-level Connect sheet as the profile menu. */
export function ConnectDropdown(): React.JSX.Element {
  const connect = useConnect();
  return (
    <Tactile
      accessibilityRole="button"
      accessibilityLabel={connect.view?.activeDevice ? `Connect, playing on ${connect.view.activeDevice.name}` : 'Connect devices'}
      accessibilityState={{ expanded: connect.devicesVisible }}
      onPress={() => { Haptics.selectionAsync().catch(() => undefined); connect.openDevices(); }}
      hitSlop={8}
      pressScale={0.9}
      style={[styles.trigger, connect.remotePlayback && styles.triggerRemote]}
    >
      <MaterialCommunityIcons name="devices" size={20} color={connect.remotePlayback ? Signal.wave : Signal.ink} />
    </Tactile>
  );
}

const styles = StyleSheet.create({
  // Same 40pt circle as the logo button beside it; hitSlop takes the target past 48dp.
  trigger: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: Glass.fillLight, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairline },
  triggerRemote: { backgroundColor: Glass.selected, borderColor: Glass.selectedRim },
});
